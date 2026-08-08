/**
 * The terminal seam: the five things a command may ask a person for, and the
 * one way a person says no.
 *
 * Every command talks to this interface rather than to `@clack/prompts`, for
 * the same reason `main` takes a `CliIo` rather than reaching for `process`: a
 * test can then drive an interactive flow deterministically and read back the
 * bytes an author would have seen. `clackTerminal` is the only implementation
 * that draws anything.
 *
 * Everything here writes to **stderr**. `generate` promises that a successful
 * run puts exactly the written path on stdout, and a prompt drawn on stdout
 * would make that promise false the moment anyone piped the output anywhere.
 *
 * Cancellation is an exception rather than a return value, and that is
 * deliberate: every prompt in a flow can be cancelled, and threading a
 * "cancelled" case through each call site is how one of them ends up forgetting.
 * `cli.ts` catches it once.
 */

import { autocomplete, confirm, isCancel, log, note, select, text } from "@clack/prompts";

import type { CliIo } from "./io.ts";

/** Somebody pressed ctrl-c, or answered no to the confirmation. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelledError";
  }
}

export interface TextPrompt {
  readonly message: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  /** A problem to show, which re-asks; `undefined` accepts the answer. */
  readonly validate?: (value: string) => string | undefined;
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

export interface SelectPrompt {
  readonly message: string;
  readonly options: readonly SelectOption[];
  readonly initialValue?: string;
  /**
   * Type-to-filter rather than arrow keys alone. The recipe picker sets it,
   * because the catalog is a list that grows; a question's four choices are
   * faster to arrow through than to type at.
   */
  readonly filter?: boolean;
}

export interface ConfirmPrompt {
  readonly message: string;
  readonly initialValue?: boolean;
}

export interface Terminal {
  text(prompt: TextPrompt): Promise<string>;
  select(prompt: SelectPrompt): Promise<string>;
  confirm(prompt: ConfirmPrompt): Promise<boolean>;
  /** A boxed aside: several lines of context the next question needs. */
  note(message: string, title?: string): void;
  /** One line of running commentary, such as where an answer came from. */
  info(message: string): void;
}

/**
 * The real terminal. Every clack call is handed the injected streams, so even
 * this implementation never reaches for `process` — which is what lets the
 * child-process smoke test and an in-process test exercise the same code.
 */
export function clackTerminal(io: CliIo): Terminal {
  const streams = { input: io.stdin, output: io.stderr } as const;

  function unwrap<T>(value: T | symbol): T {
    if (isCancel(value)) {
      throw new CancelledError();
    }
    return value as T;
  }

  return {
    async text(prompt) {
      return unwrap(
        await text({
          ...streams,
          message: prompt.message,
          ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
          ...(prompt.defaultValue === undefined ? {} : { defaultValue: prompt.defaultValue }),
          ...(prompt.validate === undefined
            ? {}
            : { validate: (value = "") => prompt.validate!(value) }),
        })
      );
    },

    async select(prompt) {
      const options = prompt.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.hint === undefined ? {} : { hint: option.hint }),
      }));
      const common = {
        ...streams,
        message: prompt.message,
        options,
        ...(prompt.initialValue === undefined ? {} : { initialValue: prompt.initialValue }),
      };
      return unwrap(
        prompt.filter === true
          ? await autocomplete({ ...common, placeholder: "Type to filter" })
          : await select(common)
      );
    },

    async confirm(prompt) {
      return unwrap(
        await confirm({
          ...streams,
          message: prompt.message,
          ...(prompt.initialValue === undefined ? {} : { initialValue: prompt.initialValue }),
        })
      );
    },

    note: (message, title) => note(message, title, streams),
    info: (message) => log.info(message, streams),
  };
}
