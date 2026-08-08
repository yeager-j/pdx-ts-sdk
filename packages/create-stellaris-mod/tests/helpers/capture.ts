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

/**
 * `tty` is what decides whether the CLI believes there is somebody to ask. It
 * defaults off, because a test that reaches a real prompt hangs, and the
 * interactive flows are driven through the scripted `Terminal` instead.
 */
export function capture(cwd = "/tmp/somewhere", tty = false): Capture {
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
      stdin: Object.assign(Readable.from([]), { isTTY: tty }),
      stdout: sink(out),
      stderr: sink(err),
    },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}
