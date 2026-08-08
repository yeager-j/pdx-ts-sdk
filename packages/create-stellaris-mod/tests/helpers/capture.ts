/**
 * A `CliIo` a test can read back.
 *
 * `main` writes through this rather than `process`, so the whole CLI runs
 * in-process and stdout and stderr are readable *apart* — which is the thing
 * being asserted whenever a command promises that only its result goes to
 * stdout.
 */

import { Readable, Writable } from "node:stream";

import type { CliIo } from "../../src/io.ts";

export interface Capture {
  readonly io: CliIo;
  out(): string;
  err(): string;
}

export function capture(cwd = "/tmp/somewhere"): Capture {
  const out: string[] = [];
  const err: string[] = [];
  const sink = (into: string[]): Writable =>
    new Writable({
      write(chunk: unknown, _encoding, callback) {
        into.push(String(chunk));
        callback();
      },
    });
  return {
    io: {
      cwd,
      // Not a TTY: nothing here may reach a prompt, and a test that hangs
      // waiting for one is the failure mode worth making impossible.
      stdin: Readable.from([]),
      stdout: sink(out),
      stderr: sink(err),
    },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}
