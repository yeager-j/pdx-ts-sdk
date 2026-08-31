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
import {
  describeCommand,
  gitInitCommands,
  insideGitWorkTree,
  installCommand,
  run,
  type Command,
  type CommandResult,
} from "../exec.ts";
import { preflight, writeTree } from "../fs.ts";
import { VERIFIED_STELLARIS_BUILD } from "../generated/verified-build.ts";
import type { CliIo } from "../io.ts";
import { helpText, parseArgv, type Resolved } from "../options.ts";
import { installDependencies, runScript } from "../package-manager.ts";
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
  const steps = plannedSteps(resolved);

  if (parsed.values["dry-run"] === true) {
    io.stdout.write(`Would scaffold ${targetDir}:\n`);
    for (const [relPath, entry] of project) {
      const target = entry.kind === "symlink" ? ` -> ${entry.target}` : "";
      io.stdout.write(`  ${relPath}${target}\n`);
    }
    for (const line of previewSteps(steps)) {
      io.stdout.write(`${line}\n`);
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

  const outcomes = await runSteps(steps, targetDir);
  const install = outcomes.get("install");

  io.stdout.write(
    nextSteps(resolved, targetDir, io.cwd, install?.code === 0, install?.output ?? "")
  );
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

/** The steps a scaffold performs after its files, named so outcomes read back. */
type StepId = "install" | "git";

/**
 * One group of commands the scaffold runs against the target, and the condition
 * under which it does not.
 *
 * A group rather than a command because `git init`, `git add` and `git commit`
 * share one precondition and it stops holding after the first of them runs:
 * asking again before `git add` would find the repository the step just made
 * and skip the rest of its own work.
 */
interface ScaffoldStep {
  readonly id: StepId;
  readonly commands: readonly Command[];
  /** Answered against the real target. A dry run has no target to ask. */
  readonly skipWhen?: (targetDir: string) => Promise<boolean>;
  /** That condition in words, since the preview cannot evaluate it. */
  readonly condition?: string;
}

/**
 * Everything the scaffold does after writing files, in the order it does it.
 *
 * One value, read twice: the dry run prints it and the real run executes it.
 * The order is a decision rather than an accident — the install runs first so
 * the lockfile it produces is part of the initial commit, and the other order
 * leaves a freshly scaffolded repository immediately dirty, its first commit
 * describing a dependency graph that was never resolved. A preview that
 * reconstructed the list separately said the opposite, and was describing a
 * command this one is not.
 */
function plannedSteps(resolved: Resolved): ScaffoldStep[] {
  const steps: ScaffoldStep[] = [];
  if (resolved.install) {
    steps.push({ id: "install", commands: [installCommand(resolved.packageManager)] });
  }
  if (resolved.git) {
    steps.push({
      id: "git",
      commands: gitInitCommands(),
      skipWhen: insideGitWorkTree,
      condition: "skipped when the target is already inside a git repository",
    });
  }
  return steps;
}

/** The plan as lines, for the dry run. */
function previewSteps(steps: readonly ScaffoldStep[]): string[] {
  return steps.flatMap((step) => [
    ...(step.condition === undefined ? [] : [`  # ${step.condition}`]),
    ...step.commands.map((command) => `  $ ${describeCommand(command)}`),
  ]);
}

/**
 * The plan, performed. Every step is best-effort: a scaffold whose files are
 * all correctly written but whose install hit a network blip should tell the
 * author to run it again, not delete their project and exit non-zero.
 *
 * A skipped step has no result, which is a different fact from a step that ran
 * and failed — `nextSteps` distinguishes the two.
 */
async function runSteps(
  steps: readonly ScaffoldStep[],
  targetDir: string
): Promise<Map<StepId, CommandResult>> {
  const outcomes = new Map<StepId, CommandResult>();
  for (const step of steps) {
    if (step.skipWhen !== undefined && (await step.skipWhen(targetDir))) {
      continue;
    }
    let last: CommandResult = { code: 0, output: "" };
    for (const command of step.commands) {
      last = await run(command, targetDir);
    }
    outcomes.set(step.id, last);
  }
  return outcomes;
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
    return [
      `  ${installDependencies(packageManager)}        # the install did not complete; run it again`,
    ];
  }
  const build = gameVersion === undefined ? "the detected game build" : `game build ${gameVersion}`;
  return [
    `  No @pdx-ts/stellaris-ids release matches ${build}, so this project cannot`,
    "  be installed as scaffolded. @pdx-ts/sdk reads that package's id tables, and",
    "  removing it leaves a project that does not typecheck.",
    "",
    "  Either wait for the release for that build, or edit the",
    '  "@pdx-ts/stellaris-ids" range in package.json to a build that has one and',
    `  re-run ${installDependencies(packageManager)}. Ids that moved between the two builds are`,
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
    lines.push(`  ${installDependencies(pm)}`);
  }
  const commands = [
    ["build", "write the mod into ./out/"],
    ["inspect", "review the compiled project as YAML"],
    ["test", "run the example event chain"],
    ["install-mod", "install it where the launcher looks"],
  ].map(([script, what]) => [runScript(pm, script!), what!] as const);
  const width = Math.max(...commands.map(([command]) => command.length));
  lines.push(...commands.map(([command, what]) => `  ${command.padEnd(width)} # ${what}`), "");

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
