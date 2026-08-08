/**
 * `generate`, until it can write a file.
 *
 * `list` and `view` are the catalog's read-only half and are implemented; this
 * is the half that touches an author's project, and it says so and fails rather
 * than half-working. Reserving the name early is what keeps `init` from ever
 * becoming ambiguous — once `generate` can mean a directory, making it mean a
 * command is a breaking change — but a reserved name that silently succeeds
 * would be worse than one that does not exist.
 *
 * `--help` is answered here without parsing anything else. The flag table for
 * this command is per-recipe and does not exist yet, so pretending to parse its
 * arguments would mean inventing rules the real command has to keep.
 */

import type { CliIo } from "../io.ts";
import { catalogPending, helpText } from "../options.ts";

export function runPending(command: "generate", argv: readonly string[], io: CliIo): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout.write(helpText(command));
    return 0;
  }
  io.stderr.write(`${catalogPending(command)}\n`);
  return 1;
}
