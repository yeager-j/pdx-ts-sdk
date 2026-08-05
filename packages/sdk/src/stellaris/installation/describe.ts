/**
 * `describeInstall()`: where the game is and what build it states.
 *
 * This is `stellaris.load()`'s metadata without `load()`'s work. `load` reads
 * and hashes every file in the directories it models — ~35 of them — because it
 * is building a parsed view; a caller that only wants to say "found Stellaris
 * 4.4.6 at /path" should not pay for that, and should not inherit `load`'s
 * strictness about vanilla's directory shape either. Locating plus one small
 * JSON read is the whole job.
 */

import { locateInstall } from "./locate.ts";
import { readGameVersion } from "./version.ts";

export interface InstallDescription {
  readonly installPath: string;
  /** The install's own statement of its build, when it makes one. */
  readonly gameVersion: string | undefined;
}

/**
 * Locate the install and read its version. Throws `InstallNotFoundError` when
 * there is no install to describe — the same precedence and the same message
 * `locateInstall` already gives, since this is that call plus a file read.
 */
export function describeInstall(installPath?: string): InstallDescription {
  const root = locateInstall(installPath);
  return { installPath: root, gameVersion: readGameVersion(root) };
}
