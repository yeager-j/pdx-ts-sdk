/**
 * A `CliIo` a test can read back.
 *
 * `main` writes through this rather than `process`, so the whole CLI runs
 * in-process and stdout and stderr are readable *apart* — which is the thing
 * being asserted whenever a command promises that only its result goes to
 * stdout.
 *
 * Every write is recorded once, into one ordered list, and `out()`/`err()` are
 * views over it. Two separate buffers would answer "what went to stdout"
 * correctly and "what did this session look like" wrongly: an interactive run
 * writes prompts to stderr and its result to stdout, and a transcript that
 * prints one stream after the other shows the result arriving before the
 * questions that produced it. The order things were written in is part of what
 * a golden transcript is evidence for.
 */

import { Readable, Writable } from "node:stream";

import type { CliIo } from "../../src/io.ts";

export type Channel = "out" | "err";

export interface CaptureEvent {
  readonly channel: Channel;
  readonly text: string;
}

export interface Capture {
  readonly io: CliIo;
  out(): string;
  err(): string;
  /** Every write, in the order it happened. */
  events(): readonly CaptureEvent[];
}

/**
 * `tty` is what decides whether the CLI believes there is somebody to ask. It
 * defaults off, because a test that reaches a real prompt hangs, and the
 * interactive flows are driven through the scripted `Terminal` instead.
 */
export function capture(cwd = "/tmp/somewhere", tty = false): Capture {
  const events: CaptureEvent[] = [];
  const sink = (channel: Channel): Writable =>
    new Writable({
      write(chunk: unknown, _encoding, callback) {
        events.push({ channel, text: String(chunk) });
        callback();
      },
    });
  const joined = (channel: Channel): string =>
    events
      .filter((event) => event.channel === channel)
      .map((event) => event.text)
      .join("");

  return {
    io: {
      cwd,
      stdin: Object.assign(Readable.from([]), { isTTY: tty }),
      stdout: sink("out"),
      stderr: sink("err"),
    },
    out: () => joined("out"),
    err: () => joined("err"),
    events: () => events,
  };
}
