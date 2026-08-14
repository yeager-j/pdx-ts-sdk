/**
 * Running `materialize-child.ts`, and reading the one line it prints.
 *
 * The parent asserts on structured data rather than on anything the child
 * logged: a refusal is a `MaterializationFailure`, and a test that matched an
 * error message would pass for the wrong reason the day the wording changes.
 * `NODE_OPTIONS` is cleared so a loader or an inspector the developer happens
 * to have exported cannot change what the child runs.
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Generation } from "./crash-mod.ts";

const CHILD = fileURLToPath(new URL("./materialize-child.ts", import.meta.url));

export interface ChildRequest {
  readonly command: "crash" | "hold" | "attempt";
  readonly mode: "build" | "install";
  /** The parent directory: an out directory's parent, or the mod directory. */
  readonly root: string;
  readonly dirName: string;
  /** The point to stop at; unused by `attempt`. */
  readonly point?: string;
  readonly generation: Generation;
  /**
   * Run under this many open file descriptors. A limit is the only way to ask
   * whether the walk holds one descriptor per directory level, because the
   * process cannot lower its own — so the shell lowers it before exec.
   */
  readonly descriptorLimit?: number;
}

/** What one materialization reported about itself, as data. */
export interface ChildReport {
  readonly ok: boolean;
  readonly status?: string;
  readonly name?: string;
  readonly message?: string;
  readonly failure?: { readonly reason: string; readonly [key: string]: unknown };
}

export interface ChildOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Absent when the child was killed before it could report. */
  readonly report?: ChildReport;
}

export function spawnMaterializeChild(request: ChildRequest): ChildProcessWithoutNullStreams {
  const argv = [
    "--conditions=pdx-source",
    CHILD,
    request.command,
    request.mode,
    request.root,
    request.dirName,
    request.point ?? "-",
    String(request.generation),
  ];
  const options: SpawnOptionsWithoutStdio = {
    env: { ...process.env, NODE_OPTIONS: "" },
    stdio: ["pipe", "pipe", "pipe"],
  };
  if (request.descriptorLimit === undefined) {
    return spawn(process.execPath, argv, options);
  }
  // `"$0"` is the interpreter and `"$@"` its arguments, so nothing here is
  // pasted into a shell word and no path needs quoting.
  return spawn(
    "/bin/sh",
    ["-c", `ulimit -n ${request.descriptorLimit}; exec "$0" "$@"`, process.execPath, ...argv],
    options
  );
}

export async function runMaterializeChild(request: ChildRequest): Promise<ChildOutcome> {
  return collect(spawnMaterializeChild(request));
}

/** A child stopped at its point, holding the lock until it is released. */
export interface Holder {
  readonly pid: number;
  /** Let the held materialization finish, and wait for its outcome. */
  release(): Promise<ChildOutcome>;
}

export async function holdMaterialization(request: ChildRequest): Promise<Holder> {
  const child = spawnMaterializeChild({ ...request, command: "hold" });
  const outcome = collect(child);
  await new Promise<void>((resolve, reject) => {
    let seen = "";
    const onData = (chunk: Buffer) => {
      seen += chunk.toString("utf8");
      if (seen.includes("READY")) {
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", () => {
      reject(new Error(`the holder exited before it reached ${request.point}: ${seen}`));
    });
  });
  return {
    pid: child.pid!,
    release: async () => {
      child.stdin.write("go\n");
      child.stdin.end();
      return outcome;
    },
  };
}

async function collect(child: ChildProcessWithoutNullStreams): Promise<ChildOutcome> {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.once("close", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  return { code, signal, stdout, stderr, report: parseReport(stdout) };
}

/** The last JSON line the child printed, which is its whole report. */
function parseReport(stdout: string): ChildReport | undefined {
  for (const line of stdout.split("\n").reverse()) {
    if (line.startsWith("{")) {
      return JSON.parse(line) as ChildReport;
    }
  }
  return undefined;
}
