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
 */

import { runInit } from "./commands/init.ts";
import { runList } from "./commands/list.ts";
import { runPending } from "./commands/pending.ts";
import { runView } from "./commands/view.ts";
import { processIo, type CliIo } from "./io.ts";
import { splitCommand } from "./options.ts";

export async function main(argv: readonly string[], io: CliIo = processIo()): Promise<number> {
  const { command, rest } = splitCommand(argv);
  switch (command) {
    case "init":
      return runInit(rest, io);
    case "list":
      return runList(rest, io);
    case "view":
      return runView(rest, io);
    case "generate":
      return runPending(command, rest, io);
  }
}

export { detectPackageManager } from "./exec.ts";
export { processIo, type CliIo } from "./io.ts";
