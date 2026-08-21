/**
 * `create-stellaris-mod init [directory]` — scaffold a Stellaris mod project.
 *
 * This is the whole scaffold flow, and the one command bare
 * `create-stellaris-mod [directory]` still routes to. It returns an exit code
 * rather than calling `process.exit`, and writes through the injected `io`
 * rather than `process`, so the tests can drive it in-process.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { toPackageName } from "../derive.ts";
import { gitInitCommands, insideGitWorkTree, installCommand, run } from "../exec.ts";
import { preflight, writeTree } from "../fs.ts";
import { VERIFIED_STELLARIS_BUILD } from "../generated/verified-build.ts";
import type { CliIo } from "../io.ts";
import { helpText, parseArgv, type Resolved } from "../options.ts";
import { planProject } from "../plan.ts";
import { resolveInteractive, resolveNonInteractive } from "../prompts.ts";
import { CancelledError } from "../terminal.ts";
import { VERSION } from "../version.ts";

export async function runInit(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
    io.stderr.write(helpText("init"));
    return 1;
  }

  if (parsed.values.help === true) {
    io.stdout.write(helpText("init"));
    return 0;
  }
  if (parsed.values.version === true) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Non-interactive whenever there is nobody to ask — a CI run must never hang
  // waiting on a prompt nobody will see.
  const interactive = parsed.values.yes !== true && io.stdin.isTTY === true;

  let resolved: Resolved;
  try {
    resolved = interactive
      ? await resolveInteractive(parsed, io)
      : resolveNonInteractive(parsed, parsed.positionals[0] ?? "my-stellaris-mod");
  } catch (error) {
    // Cancellation is not this command's to report: `main` catches it once, so
    // ctrl-c says the same thing here as it does under `generate`.
    if (error instanceof CancelledError) {
      throw error;
    }
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const targetDir = path.resolve(io.cwd, resolved.targetDir);
  const packageName = toPackageName(path.basename(targetDir));
  // `--local ../pdx-sdk` is resolved against *this* process's cwd, but the
  // `file:` dependency it becomes is resolved by npm against the scaffolded
  // project's package.json. Canonicalizing here makes the two agree, and makes
  // the checkout check below test the same directory npm will.
  const localSdk =
    resolved.localSdk === undefined ? undefined : path.resolve(io.cwd, resolved.localSdk);
  const project = planProject({ ...resolved, targetDir, localSdk }, packageName);

  if (parsed.values["dry-run"] === true) {
    io.stdout.write(`Would scaffold ${targetDir}:\n`);
    for (const [relPath, entry] of project) {
      const target = entry.kind === "symlink" ? ` -> ${entry.target}` : "";
      io.stdout.write(`  ${relPath}${target}\n`);
    }
    for (const command of plannedCommands(resolved)) {
      io.stdout.write(`  $ ${command}\n`);
    }
    return 0;
  }

  try {
    checkLocalCheckout(localSdk);
    await preflight(targetDir);
    await writeTree(targetDir, project);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  // Install first, so the lockfile it produces is part of the initial commit.
  // The other order leaves a freshly scaffolded repository immediately dirty,
  // with its first commit describing a dependency graph that was never resolved.
  let installed = false;
  let installOutput = "";
  if (resolved.install) {
    const result = await run(installCommand(resolved.packageManager), targetDir);
    installed = result.code === 0;
    installOutput = result.output;
  }

  if (resolved.git && !(await insideGitWorkTree(targetDir))) {
    for (const command of gitInitCommands()) {
      await run(command, targetDir);
    }
  }

  io.stdout.write(nextSteps(resolved, targetDir, io.cwd, installed, installOutput));
  return 0;
}

/**
 * Whichever of the relative and absolute paths is easier to read. A relative
 * path is friendlier when the project is nearby and absurd when it is not —
 * `cd ../../../../../../tmp/my-mod` is not an improvement on the absolute one.
 */
function shortestPath(targetDir: string, cwd: string): string {
  const relative = path.relative(cwd, targetDir);
  if (relative === "") {
    return ".";
  }
  return relative.startsWith("..") && relative.length >= targetDir.length ? targetDir : relative;
}

/**
 * `--local` writes `file:` dependencies at a checkout, and npm materializes
 * those as symlinks — but the generated project resolves those packages through
 * their published `exports`, which point at `dist/`. The repo itself skips that
 * via a `pdx-source` condition it passes internally; a scaffolded project is a
 * consumer and does not. So the checkout has to have been built.
 *
 * Saying so here turns a confusing "cannot find module" at the author's first
 * build into one sentence naming the command that fixes it.
 */
function checkLocalCheckout(localSdk: string | undefined): void {
  if (localSdk === undefined) {
    return;
  }
  const missing = ["sdk", "sdk-testing", "pdxscript", "stellaris-ids"].filter(
    (pkg) => !existsSync(path.join(localSdk, "packages", pkg, "dist"))
  );
  if (missing.length > 0) {
    throw new Error(
      `${localSdk} has not been built, so ${missing.map((p) => `@pdx-ts/${p}`).join(", ")} ` +
        `would resolve to a dist/ that does not exist.\n\n  cd ${localSdk} && npm run build\n\n` +
        `then re-run this command.`
    );
  }
}

function plannedCommands(resolved: Resolved): string[] {
  const commands: string[] = [];
  if (resolved.git) {
    commands.push("git init");
  }
  if (resolved.install) {
    commands.push(`${resolved.packageManager} install`);
  }
  return commands;
}

function idsPackageUnavailable(output: string): boolean {
  return (
    output.includes("@pdx-ts/stellaris-ids") &&
    /(?:\bETARGET\b|\bnotarget\b|\bYN0082\b|no matching versions? found|no candidates found)/i.test(
      output
    )
  );
}

/**
 * What to tell an author whose install did not complete.
 *
 * The identifier package having no release for their build is a refusal, not a
 * detour. `@pdx-ts/sdk` reads that package's id tables (ADR-0006), so a project
 * without it does not typecheck — there is no shorter route to a working
 * project that skips it, and offering one would hand the author a scaffold that
 * cannot build. What is left is the two real ways forward: publish the
 * identifier package for that build, or pin the project to a build that has
 * one.
 */
export function installFailureSteps(
  packageManager: string,
  gameVersion: string | undefined,
  output: string
): string[] {
  if (!idsPackageUnavailable(output)) {
    return [`  ${packageManager} install        # the install did not complete; run it again`];
  }
  const build = gameVersion === undefined ? "the detected game build" : `game build ${gameVersion}`;
  return [
    `  No @pdx-ts/stellaris-ids release matches ${build}, so this project cannot`,
    "  be installed as scaffolded. @pdx-ts/sdk reads that package's id tables, and",
    "  removing it leaves a project that does not typecheck.",
    "",
    "  Either wait for the release for that build, or edit the",
    '  "@pdx-ts/stellaris-ids" range in package.json to a build that has one and',
    `  re-run ${packageManager} install. Ids that moved between the two builds are`,
    "  then checked against the wrong game.",
  ];
}

function nextSteps(
  resolved: Resolved,
  targetDir: string,
  cwd: string,
  installed: boolean,
  installOutput: string
): string {
  const pm = resolved.packageManager;
  const lines = ["", `Scaffolded ${resolved.name} in ${targetDir}`, ""];

  lines.push("Next:");
  lines.push(`  cd ${shortestPath(targetDir, cwd)}`);
  if (!installed && resolved.install) {
    lines.push(...installFailureSteps(pm, resolved.gameVersion, installOutput));
  } else if (!resolved.install) {
    lines.push(`  ${pm} install`);
  }
  lines.push(
    `  ${pm} run build      # write the mod into ./out/`,
    `  ${pm} test           # run the example event chain`,
    `  ${pm} run install-mod # install it where the launcher looks`,
    ""
  );

  if (resolved.installPath === undefined) {
    lines.push(
      "No Stellaris install was used, so vanilla ids are checked against the game",
      `build this scaffolder ships against (${VERIFIED_STELLARIS_BUILD}), not yours. Set`,
      "STELLARIS_PATH and see the README if your game is a different build.",
      ""
    );
  }
  return lines.join("\n");
}
