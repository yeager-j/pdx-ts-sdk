/**
 * Locating the Stellaris install. Precedence: an explicit `installPath`
 * option, then the `STELLARIS_PATH` environment variable, then the Steam
 * default for the platform. A candidate qualifies only if it contains
 * `common/technology` — the sentinel for "this is really a game root", not
 * just a directory that exists. An explicit path or env override that fails
 * the sentinel is its own loud error rather than a silent fall-through:
 * whoever set it meant it.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { InstallNotFoundError } from "../errors.ts";

const SENTINEL = join("common", "technology");

function platformDefaults(): string[] {
  switch (process.platform) {
    case "darwin":
      return [join(homedir(), "Library/Application Support/Steam/steamapps/common/Stellaris")];
    case "win32":
      return ["C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stellaris"];
    default:
      return [
        join(homedir(), ".local/share/Steam/steamapps/common/Stellaris"),
        join(homedir(), ".steam/steam/steamapps/common/Stellaris"),
      ];
  }
}

function qualifies(root: string): boolean {
  return existsSync(join(root, SENTINEL));
}

export function locateInstall(explicit?: string): string {
  if (explicit !== undefined) {
    if (!qualifies(explicit)) {
      throw new InstallNotFoundError(
        `installPath ${explicit} is not a Stellaris install (no ${SENTINEL} inside)`
      );
    }
    return explicit;
  }
  const fromEnv = process.env["STELLARIS_PATH"];
  if (fromEnv !== undefined && fromEnv !== "") {
    if (!qualifies(fromEnv)) {
      throw new InstallNotFoundError(
        `STELLARIS_PATH=${fromEnv} is not a Stellaris install (no ${SENTINEL} inside)`
      );
    }
    return fromEnv;
  }
  const defaults = platformDefaults();
  for (const candidate of defaults) {
    if (qualifies(candidate)) {
      return candidate;
    }
  }
  throw new InstallNotFoundError(
    `No Stellaris install found. Searched, in order:\n` +
      defaults.map((candidate) => `  - ${candidate}`).join("\n") +
      `\nSet STELLARIS_PATH (or pass installPath) to point at the game root.`
  );
}
