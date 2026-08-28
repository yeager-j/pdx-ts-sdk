/**
 * Finding the game, and reading what build it is.
 *
 * The CLI has no runtime dependency on the SDK, so it owns its best-effort
 * policy while consuming the same generated install protocol facts.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

import {
  CORE_GAME_VERSION_PATTERN,
  INSTALL_SENTINEL_PATH_SEGMENTS,
  LAUNCHER_SETTINGS_FILENAME,
  LAUNCHER_VERSION_FIELD,
  LAUNCHER_VERSION_PREFIX,
  PLATFORM_INSTALL_DEFAULTS,
  SUPPORTED_VERSION_FROM_GAME_PATTERN,
} from "./generated/verified-build.ts";

const SENTINEL = join(...INSTALL_SENTINEL_PATH_SEGMENTS);

function withoutLauncherPrefix(version: string): string {
  return version.startsWith(LAUNCHER_VERSION_PREFIX)
    ? version.slice(LAUNCHER_VERSION_PREFIX.length)
    : version;
}

export interface Detection {
  readonly installPath: string;
  readonly gameVersion: string | undefined;
}

/** Returns the platform's default install candidates in search order. */
export function platformDefaults(platform: NodeJS.Platform, home: string): string[] {
  const defaults =
    platform === "darwin"
      ? PLATFORM_INSTALL_DEFAULTS.darwin
      : platform === "win32"
        ? PLATFORM_INSTALL_DEFAULTS.win32
        : PLATFORM_INSTALL_DEFAULTS.other;
  const platformJoin = platform === "win32" ? win32.join : posix.join;
  return defaults.map((candidate) =>
    candidate.kind === "home" ? platformJoin(home, ...candidate.segments) : candidate.path
  );
}

export function isInstall(root: string): boolean {
  return existsSync(join(root, SENTINEL));
}

/** The install's build, `v` stripped, or `undefined` when it does not say. */
export function readGameVersion(installPath: string): string | undefined {
  try {
    const raw = readFileSync(join(installPath, LAUNCHER_SETTINGS_FILENAME), "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const rawVersion = settings[LAUNCHER_VERSION_FIELD];
    if (typeof rawVersion !== "string") {
      return undefined;
    }
    return withoutLauncherPrefix(rawVersion);
  } catch {
    return undefined;
  }
}

/** `4.4.6` -> `v4.4.*`, the form every shipped mod's descriptor uses. */
export function supportedVersionFor(gameVersion: string): string | undefined {
  const version = withoutLauncherPrefix(gameVersion);
  if (!CORE_GAME_VERSION_PATTERN.test(version)) return undefined;
  const match = SUPPORTED_VERSION_FROM_GAME_PATTERN.exec(version);
  return match === null ? undefined : `${LAUNCHER_VERSION_PREFIX}${match[1]}.${match[2]}.*`;
}

/**
 * Where Stellaris is, if it can be found. Unlike the SDK's `locateInstall`,
 * this answers `undefined` rather than throwing: a mod that does not patch
 * vanilla builds fine without an install, so a missing one drops
 * `src/vanilla.ts` from the scaffold instead of blocking it. The identifier
 * package is pinned either way — see `templates/project.ts`'s
 * `idsGameVersion`.
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
