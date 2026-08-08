/**
 * The reserved catalog commands, until the Recipe Catalog lands.
 *
 * The names are reserved now rather than later so that `init` never has to
 * become ambiguous afterwards: once `list` can mean a directory, making it mean
 * a command is a breaking change. Until then each one says so and fails, which
 * is the only honest thing a reserved name can do.
 *
 * `--help` is answered here without parsing anything else. The flag table for
 * these commands is per-recipe and does not exist yet, so pretending to parse
 * their arguments would mean inventing rules the real command has to keep.
 */

import type { CliIo } from "../io.ts";
import { catalogPending, helpText, type CommandName } from "../options.ts";

export function runPending(
  command: Exclude<CommandName, "init">,
  argv: readonly string[],
  io: CliIo
): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout.write(helpText(command));
    return 0;
  }
  io.stderr.write(`${catalogPending(command)}\n`);
  return 1;
}
