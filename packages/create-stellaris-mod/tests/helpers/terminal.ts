/**
 * A `Terminal` a test can script, and read back.
 *
 * Interactive flows are the part of a CLI that usually goes untested, because
 * driving a real prompt library means driving a real terminal. The `Terminal`
 * seam is what makes them ordinary: this implementation answers from a queue
 * and writes one deterministic line per serviced prompt, so an interactive
 * transcript is a committed file a human reads rather than a video nobody
 * watches.
 *
 * The rendering here is deliberately plain — `? message › answer` rather than
 * clack's boxes and colors. What a golden transcript is evidence *for* is the
 * order of the questions, the wording of each one, and which stream it went to;
 * freezing clack's drawing would make every one of those reviews a diff of box
 * characters.
 *
 * A queue that runs out fails the test, and so does one with answers left in
 * it: both mean the flow asked something other than what the test claims.
 */

import { expect } from "vitest";

import type { CliIo } from "../../src/io.ts";
import { CancelledError, type Terminal } from "../../src/terminal.ts";

/** The scripted answer that means ctrl-c. */
export const CANCEL = Symbol("cancel");

export type ScriptedAnswer = string | boolean | typeof CANCEL;

export interface FakeTerminal extends Terminal {
  /** Fails when the script queued answers no prompt asked for. */
  expectDrained(): void;
}

export function fakeTerminal(io: CliIo, answers: readonly ScriptedAnswer[]): FakeTerminal {
  const queue = [...answers];

  function next(message: string): ScriptedAnswer {
    if (queue.length === 0) {
      throw new Error(`The terminal was asked ${JSON.stringify(message)} with no answer left.`);
    }
    return queue.shift()!;
  }

  function serviced(message: string, answer: string): void {
    io.stderr.write(`? ${message} › ${answer}\n`);
  }

  /** Recorded before it is thrown, so a transcript shows *where* ctrl-c landed. */
  function cancelled(message: string): CancelledError {
    serviced(message, "(cancelled)");
    return new CancelledError();
  }

  return {
    async text(prompt) {
      for (;;) {
        const answer = next(prompt.message);
        if (answer === CANCEL) {
          throw cancelled(prompt.message);
        }
        if (typeof answer !== "string") {
          throw new Error(`${JSON.stringify(prompt.message)} is a text prompt, not a confirm.`);
        }
        const problem = prompt.validate?.(answer);
        if (problem !== undefined) {
          // The re-ask, which is the behaviour worth recording: a rejected
          // answer shows its reason and the prompt comes back.
          serviced(prompt.message, answer);
          io.stderr.write(`! ${problem}\n`);
          continue;
        }
        serviced(prompt.message, answer);
        return answer;
      }
    },

    async select(prompt) {
      const answer = next(prompt.message);
      if (answer === CANCEL) {
        throw cancelled(prompt.message);
      }
      if (typeof answer !== "string" || !prompt.options.some((o) => o.value === answer)) {
        throw new Error(
          `${JSON.stringify(String(answer))} is not one of the choices offered by ` +
            `${JSON.stringify(prompt.message)} ` +
            `(${prompt.options.map((o) => o.value).join(", ")}).`
        );
      }
      serviced(prompt.message, answer);
      return answer;
    },

    async confirm(prompt) {
      const answer = next(prompt.message);
      if (answer === CANCEL) {
        throw cancelled(prompt.message);
      }
      if (typeof answer !== "boolean") {
        throw new Error(`${JSON.stringify(prompt.message)} is a confirm, not a text prompt.`);
      }
      serviced(prompt.message, answer ? "yes" : "no");
      return answer;
    },

    note(message, title) {
      io.stderr.write(`${title === undefined ? "note" : `note: ${title}`}\n`);
      for (const line of message.split("\n")) {
        io.stderr.write(line === "" ? "\n" : `  ${line}\n`);
      }
    },

    info: (message) => io.stderr.write(`info: ${message}\n`),

    expectDrained() {
      expect(queue, "the script queued answers no prompt asked for").toEqual([]);
    },
  };
}
