/**
 * The install's own statement of its build, from `launcher-settings.json`.
 *
 * One parser, two policies. Reading the file is the same work either way, but
 * what a caller does with a missing or malformed version genuinely differs:
 * `stellaris.load()` is version-agnostic by design and carries `undefined`
 * happily, while a caller that stamps a package version cannot default past it.
 * A `{ strict }` flag would hide that difference behind a boolean; two verbs put
 * it in the call site, where it belongs.
 *
 * The version here is always `v`-less — it exists to be *compared*, against
 * `SUPPORTED_STELLARIS_BUILD` and against the `@pdx-ts/stellaris-ids` package
 * pin, both of which spell it `4.4.6`. That is the opposite convention from
 * `supportedVersionFor`, which produces the descriptor field the launcher
 * reads; see its docblock.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GameVersionError } from "../errors.ts";

const SETTINGS = "launcher-settings.json";

/** `major.minor.patch` — what npm can express and what the pin compares. */
const CORE_VERSION = /^\d+\.\d+\.\d+$/;

function settingsPath(installPath: string): string {
  return join(installPath, SETTINGS);
}

/**
 * The install's build, or `undefined` when the install does not say. Every
 * failure — no file, unreadable, malformed JSON, no `rawVersion` — reads the
 * same way here: the install stated nothing. Callers that need to tell those
 * apart want `requireGameVersion`.
 *
 * Deliberately *not* validated against `CORE_VERSION`. A four-part Paradox
 * version is a real string the install really stated, and the gates downstream
 * — the rule-table staleness check and the identifier-package pin — compare it
 * and fail loudly with it named. Returning `undefined` for it would turn both
 * of those loud failures into silent passes.
 */
export function readGameVersion(installPath: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(settingsPath(installPath), "utf8");
  } catch {
    return undefined;
  }
  let settings: { rawVersion?: unknown };
  try {
    settings = JSON.parse(raw) as { rawVersion?: unknown };
  } catch {
    return undefined;
  }
  if (typeof settings.rawVersion !== "string") {
    return undefined;
  }
  return settings.rawVersion.replace(/^v/, "");
}

/**
 * The install's build as `major.minor.patch`, or a loud stop naming the file
 * and the reason. For callers that turn the version into an artifact — a
 * stamped package version, a pinned dependency — where defaulting past a
 * missing version would produce something claiming to describe a build nobody
 * can identify.
 */
export function requireGameVersion(installPath: string): string {
  const file = settingsPath(installPath);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new GameVersionError(`${file} is missing, so the install states no version`);
  }
  let settings: { rawVersion?: unknown };
  try {
    settings = JSON.parse(raw) as { rawVersion?: unknown };
  } catch {
    throw new GameVersionError(`${file} is not valid JSON, so the install states no version`);
  }
  if (typeof settings.rawVersion !== "string" || settings.rawVersion === "") {
    throw new GameVersionError(`${file} has no rawVersion string`);
  }
  const version = settings.rawVersion.replace(/^v/, "");
  if (!CORE_VERSION.test(version)) {
    throw new GameVersionError(
      `${file} states rawVersion ${settings.rawVersion}, which is not major.minor.patch`
    );
  }
  return version;
}

/**
 * The launcher's `supported_version` pattern for a build: `4.4.6` -> `v4.4.*`.
 *
 * The `v` is not decoration and not a coin flip. Every mod installed in a real
 * launcher directory writes it — `supported_version="v4.4.*"` — and none writes
 * the bare form. This is deliberately the opposite of the comparison spelling
 * above: `4.4.6` is what the SDK checks versions against, `v4.4.*` is what
 * Stellaris reads out of a descriptor.
 *
 * Only the minor line is widened. A mod built against 4.4.6 is a claim about
 * 4.4, not about 4.x, and the author can always widen it by hand.
 */
export function supportedVersionFor(gameVersion: string): string {
  const version = gameVersion.replace(/^v/, "");
  const match = /^(\d+)\.(\d+)\./.exec(version);
  if (match === null) {
    throw new GameVersionError(
      `Cannot derive a supported_version from "${gameVersion}": expected major.minor.patch`
    );
  }
  return `v${match[1]}.${match[2]}.*`;
}
