/**
 * Finding the game, and reading what build it is.
 *
 * This duplicates `stellaris.describeInstall()` rather than importing it, and
 * the duplication is deliberate: taking `@pdx-ts/sdk` as a runtime dependency
 * would couple this CLI's release to the SDK's, so `npx create-stellaris-mod`
 * would resolve an SDK version before knowing which one the scaffold should
 * pin. The SDK remains the authority — `packages/sdk/src/stellaris/`
 * is where these rules live, this is a copy, and `detect.test.ts` asserts the
 * two agree, since the SDK *is* available as a devDependency.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** "This is really a game root", not just a directory that exists. */
const SENTINEL = join("common", "technology");

export interface Detection {
  readonly installPath: string;
  readonly gameVersion: string | undefined;
}

export function platformDefaults(platform: NodeJS.Platform, home: string): string[] {
  switch (platform) {
    case "darwin":
      return [join(home, "Library/Application Support/Steam/steamapps/common/Stellaris")];
    case "win32":
      return ["C:\\Program Files (x86)\\Steam\\steamapps\\common\\Stellaris"];
    default:
      return [
        join(home, ".local/share/Steam/steamapps/common/Stellaris"),
        join(home, ".steam/steam/steamapps/common/Stellaris"),
      ];
  }
}

export function isInstall(root: string): boolean {
  return existsSync(join(root, SENTINEL));
}

/** The install's build, `v` stripped, or `undefined` when it does not say. */
export function readGameVersion(installPath: string): string | undefined {
  try {
    const raw = readFileSync(join(installPath, "launcher-settings.json"), "utf8");
    const settings = JSON.parse(raw) as { rawVersion?: unknown };
    if (typeof settings.rawVersion !== "string") {
      return undefined;
    }
    return settings.rawVersion.replace(/^v/, "");
  } catch {
    return undefined;
  }
}

/** `4.4.6` -> `v4.4.*`, the form every shipped mod's descriptor uses. */
export function supportedVersionFor(gameVersion: string): string | undefined {
  const match = /^v?(\d+)\.(\d+)\./.exec(gameVersion);
  return match === null ? undefined : `v${match[1]}.${match[2]}.*`;
}

/**
 * Where Stellaris is, if it can be found. Unlike the SDK's `locateInstall`,
 * this answers `undefined` rather than throwing: a mod that neither patches
 * vanilla nor uses the identifier package builds fine without an install, so a
 * missing one degrades the scaffold instead of blocking it.
 */
export function detectInstall(explicit?: string): Detection | undefined {
  const candidates =
    explicit !== undefined && explicit !== ""
      ? [explicit]
      : [
          ...(process.env["STELLARIS_PATH"] !== undefined && process.env["STELLARIS_PATH"] !== ""
            ? [process.env["STELLARIS_PATH"]]
            : []),
          ...platformDefaults(process.platform, homedir()),
        ];
  for (const candidate of candidates) {
    if (isInstall(candidate)) {
      return { installPath: candidate, gameVersion: readGameVersion(candidate) };
    }
  }
  return undefined;
}
