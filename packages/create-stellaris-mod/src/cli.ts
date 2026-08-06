/**
 * `create-stellaris-mod` — scaffold a Stellaris mod project.
 *
 * `main` takes argv and returns an exit code rather than calling
 * `process.exit`, so the tests can drive the whole thing in-process.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { toPackageName } from "./derive.ts";
import {
  detectPackageManager,
  gitInitCommands,
  insideGitWorkTree,
  installCommand,
  run,
} from "./exec.ts";
import { preflight, writeTree } from "./fs.ts";
import { helpText, parseArgv, type Resolved } from "./options.ts";
import { planFiles } from "./plan.ts";
import { resolveInteractive, resolveNonInteractive } from "./prompts.ts";

const VERSION = "0.2.0";

export async function main(argv: readonly string[], cwd = process.cwd()): Promise<number> {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
    process.stderr.write(helpText());
    return 1;
  }

  if (parsed.values.help === true) {
    process.stdout.write(helpText());
    return 0;
  }
  if (parsed.values.version === true) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Non-interactive whenever there is nobody to ask — a CI run must never hang
  // waiting on a prompt nobody will see.
  const interactive = parsed.values.yes !== true && process.stdin.isTTY === true;

  let resolved: Resolved;
  try {
    resolved = interactive
      ? await resolveInteractive(parsed)
      : resolveNonInteractive(parsed, parsed.positionals[0] ?? "my-stellaris-mod");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const targetDir = path.resolve(cwd, resolved.targetDir);
  const packageName = toPackageName(path.basename(targetDir));
  // `--local ../pdx-sdk` is resolved against *this* process's cwd, but the
  // `file:` dependency it becomes is resolved by npm against the scaffolded
  // project's package.json. Canonicalizing here makes the two agree, and makes
  // the checkout check below test the same directory npm will.
  const localSdk =
    resolved.localSdk === undefined ? undefined : path.resolve(cwd, resolved.localSdk);
  const files = planFiles({ ...resolved, targetDir, localSdk }, packageName);

  if (parsed.values["dry-run"] === true) {
    process.stdout.write(`Would scaffold ${targetDir}:\n`);
    for (const relPath of files.keys()) {
      process.stdout.write(`  ${relPath}\n`);
    }
    for (const command of plannedCommands(resolved)) {
      process.stdout.write(`  $ ${command}\n`);
    }
    return 0;
  }

  try {
    checkLocalCheckout(localSdk);
    await preflight(targetDir);
    await writeTree(targetDir, files);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  // Install first, so the lockfile it produces is part of the initial commit.
  // The other order leaves a freshly scaffolded repository immediately dirty,
  // with its first commit describing a dependency graph that was never resolved.
  let installed = false;
  if (resolved.install) {
    installed = (await run(installCommand(resolved.packageManager), targetDir)) === 0;
  }

  if (resolved.git && !(await insideGitWorkTree(targetDir))) {
    for (const command of gitInitCommands()) {
      await run(command, targetDir);
    }
  }

  process.stdout.write(nextSteps(resolved, targetDir, installed));
  return 0;
}

/**
 * Whichever of the relative and absolute paths is easier to read. A relative
 * path is friendlier when the project is nearby and absurd when it is not —
 * `cd ../../../../../../tmp/my-mod` is not an improvement on the absolute one.
 */
function shortestPath(targetDir: string, cwd = process.cwd()): string {
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
  const missing = ["sdk", "sdk-testing", "pdxscript"].filter(
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

function nextSteps(resolved: Resolved, targetDir: string, installed: boolean): string {
  const pm = resolved.packageManager;
  const lines = ["", `Scaffolded ${resolved.name} in ${targetDir}`, ""];

  lines.push("Next:");
  lines.push(`  cd ${shortestPath(targetDir)}`);
  if (!installed && resolved.install) {
    lines.push(`  ${pm} install        # the install did not complete; run it again`);
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
      "No Stellaris install was used, so vanilla ids are unchecked strings.",
      "Set STELLARIS_PATH and see the README to turn checking on.",
      ""
    );
  }
  return lines.join("\n");
}

export { detectPackageManager };
