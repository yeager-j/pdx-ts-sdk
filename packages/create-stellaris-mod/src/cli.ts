/**
 * `create-stellaris-mod` — the command router.
 *
 * `main` takes argv and returns an exit code rather than calling
 * `process.exit`, and writes through an injected `CliIo` rather than reaching
 * for `process`, so the tests can drive the whole thing in-process.
 *
 * Routing is the only decision made here. `init`, `list`, `view` and `generate`
 * are reserved first-position command names; anything else — including nothing
 * at all — is the compatibility spelling of `init`, so bare
 * `create-stellaris-mod my-mod` keeps meaning what it always did and shares one
 * code path with `create-stellaris-mod init my-mod`.
 *
 * The one thing decided here beyond routing is what cancelling means. Every
 * prompt in every command throws `CancelledError` rather than exiting, and this
 * is the single place that catches it: one sentence, one exit code, no command
 * able to disagree about either.
 */

import { runGenerate } from "./commands/generate.ts";
import { runInit } from "./commands/init.ts";
import { runList } from "./commands/list.ts";
import { runView } from "./commands/view.ts";
import { processIo, type CliIo } from "./io.ts";
import { splitCommand } from "./options.ts";
import { CancelledError, clackTerminal, type Terminal } from "./terminal.ts";

export async function main(
  argv: readonly string[],
  io: CliIo = processIo(),
  terminal: Terminal = clackTerminal(io)
): Promise<number> {
  const { command, rest } = splitCommand(argv);
  try {
    switch (command) {
      case "init":
        return await runInit(rest, io);
      case "list":
        return runList(rest, io);
      case "view":
        return runView(rest, io);
      case "generate":
        return await runGenerate(rest, io, terminal);
    }
  } catch (error) {
    if (!(error instanceof CancelledError)) {
      throw error;
    }
    // 130 is the shell's own spelling of "ended by ctrl-c", and the sentence
    // is the promise: a cancelled run left the project exactly as it was.
    io.stderr.write("Nothing was written.\n");
    return 130;
  }
}

export { detectPackageManager } from "./exec.ts";
export { processIo, type CliIo } from "./io.ts";
