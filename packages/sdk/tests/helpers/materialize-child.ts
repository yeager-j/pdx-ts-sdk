/**
 * One materialization in its own process, so a test can kill it.
 *
 * Everything the crash matrix and the lock probes assert needs a second OS
 * process: a lock is only exclusive against one, and a transaction is only
 * interrupted if the writer really stops running. Node runs this file's
 * TypeScript directly, and `--conditions=pdx-source` resolves the workspace
 * packages to their sources, so there is nothing to build and no dependency to
 * add.
 *
 * The import graph is deliberately narrow — the two sinks, the rendered mod,
 * and the seam, never `src/index.ts` — so that what stands between the spawn
 * and the instant under test is the writer and little else.
 *
 * Usage:
 *   materialize-child.ts <crash|hold|attempt> <build|install> <root> <dirName>
 *                        <point> <1|2>
 *
 * `crash` kills itself at `point`; `hold` stops there until its standard input
 * says to go on, holding the lock meanwhile; `attempt` installs no hook at all
 * and reports what an ordinary run did. Every subcommand prints exactly one
 * JSON line, and the parent reads that rather than any log output.
 */

import path from "node:path";

import { install } from "../../src/output/install.ts";
import { _setMaterializationTestHook } from "../../src/output/test-hooks.ts";
import { write } from "../../src/output/write.ts";
import { renderGeneration, type Generation } from "./crash-mod.ts";

type Command = "crash" | "hold" | "attempt";
type Mode = "build" | "install";

const [command, mode, root, dirName, point, generation] = process.argv.slice(2) as [
  Command,
  Mode,
  string,
  string,
  string,
  string,
];

/**
 * Stop this process at the instant under test, and never come back.
 *
 * The never-resolving await matters as much as the signal: `process.kill` is a
 * request, and without something that can never continue, a writer could run
 * past the point it was supposed to die at and publish a state the test then
 * mistakes for the crash it was measuring. Windows has no SIGKILL, so the exit
 * code a killed POSIX process reports is used there instead.
 */
async function die(): Promise<never> {
  if (process.platform === "win32") {
    process.exit(137);
  }
  process.kill(process.pid, "SIGKILL");
  await new Promise<never>(() => {});
  throw new Error("unreachable");
}

/** Announce that the lock is held and this process is not going anywhere. */
async function holdUntilReleased(): Promise<void> {
  process.stdout.write("READY\n");
  await new Promise<void>((resolve) => {
    const go = () => {
      process.stdin.off("data", go);
      process.stdin.off("end", go);
      // A resumed stdin keeps the event loop alive, and this process has to be
      // able to end on its own once the materialization it was holding is done.
      process.stdin.pause();
      resolve();
    };
    process.stdin.on("data", go);
    process.stdin.on("end", go);
    process.stdin.resume();
  });
}

async function run(): Promise<unknown> {
  const rendered = renderGeneration(Number(generation) as Generation);
  return mode === "build"
    ? write(path.join(root, dirName), rendered)
    : install(rendered, { modDir: root, dirName });
}

function report(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (command === "crash") {
  _setMaterializationTestHook(async (reached) => {
    if (reached === point) {
      await die();
    }
  });
} else if (command === "hold") {
  let held = false;
  _setMaterializationTestHook(async (reached) => {
    if (reached === point && !held) {
      held = true;
      await holdUntilReleased();
    }
  });
}

try {
  const result = (await run()) as { status: string };
  report({ ok: true, status: result.status });
} catch (error) {
  const failure = (error as { failure?: unknown }).failure;
  report({
    ok: false,
    name: (error as Error).name,
    message: (error as Error).message,
    ...(failure === undefined ? {} : { failure }),
  });
  // Not `process.exit`: standard output to a pipe is asynchronous, and the
  // parent reads that line rather than the exit code alone.
  process.exitCode = 1;
}
