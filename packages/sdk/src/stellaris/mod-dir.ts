/**
 * The launcher's mod directory — where a `<name>.mod` descriptor has to land
 * for the launcher to offer the mod in a playset.
 *
 * Deliberately not called `locateModDir`. `locateInstall` *searches* candidates
 * and validates a sentinel, because an install can be anywhere and a wrong
 * answer is silent. This is one path per platform with nothing to search and
 * nothing to validate: the launcher creates the directory, so a fresh install
 * legitimately lacks it, and checking existence would refuse the very case the
 * caller is about to fix by writing into it.
 *
 * `STELLARIS_MOD_DIR` overrides, mirroring `STELLARIS_PATH`. That escape is
 * load-bearing on Windows, where OneDrive can redirect `Documents` somewhere
 * this function has no way to discover — guessing at that would be exactly the
 * silent wrong answer the sentinel exists to prevent elsewhere, so it is stated
 * rather than inferred.
 */

import { homedir } from "node:os";
import { join } from "node:path";

const PARADOX = ["Paradox Interactive", "Stellaris", "mod"];

/**
 * The pure core, platform and home injected. Split out because a function that
 * reads `process.platform` can only ever be tested on the platform running the
 * tests, and two of the three answers would go unchecked forever.
 */
export function modDirFor(platform: NodeJS.Platform, home: string): string {
  switch (platform) {
    case "darwin":
    case "win32":
      return join(home, "Documents", ...PARADOX);
    default:
      return join(home, ".local", "share", ...PARADOX);
  }
}

/**
 * The launcher's mod directory. Precedence mirrors `locateInstall`: an explicit
 * argument, then `STELLARIS_MOD_DIR`, then the platform default.
 */
export function modDir(explicit?: string): string {
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  const fromEnv = process.env["STELLARIS_MOD_DIR"];
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return modDirFor(process.platform, homedir());
}
