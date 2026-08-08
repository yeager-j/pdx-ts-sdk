/**
 * The process seam: the four things the CLI needs from the outside world.
 *
 * `main` takes one of these rather than reaching for `process`, so a test can
 * drive the whole CLI in-process and read back exactly what an author would
 * have seen — and read stdout and stderr *apart*, which matters because the
 * catalog commands promise that only the result goes to stdout.
 *
 * `cwd` is here for the same reason it used to be `main`'s second parameter:
 * relative paths the author types are resolved against it, and a test that
 * scaffolds into a temporary directory has to be able to say where that is.
 */

import type { Readable, Writable } from "node:stream";

export interface CliIo {
  readonly cwd: string;
  /**
   * `isTTY` is the whole reason stdin is here in this slice: it decides whether
   * anyone is available to answer a prompt. Later slices hand the stream itself
   * to the prompt library.
   */
  readonly stdin: Readable & { readonly isTTY?: boolean };
  readonly stdout: Writable;
  readonly stderr: Writable;
}

/** The real process, and the default for every caller that is not a test. */
export function processIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
