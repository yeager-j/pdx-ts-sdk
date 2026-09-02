/**
 * This release's SDK coordinate, derived rather than written down.
 *
 * Tests that stand for "the version this release verifies" read these instead
 * of a literal. A literal has to be found and moved by hand at every release,
 * and `scripts/release.mjs` rewrites only the files it is told about; a file it
 * is not told about goes stale and fails the release gates instead. Deriving
 * from `VERIFIED_SDK_RANGE` moves these cases with the release on their own.
 *
 * Versions written as literals elsewhere in these tests are deliberate: they
 * stand for *some other* version, and must not move with the release.
 */

import semver from "semver";

import { VERIFIED_SDK_RANGE } from "../../src/sdk-range.ts";

const minimum = semver.minVersion(VERIFIED_SDK_RANGE);
if (minimum === null) {
  throw new Error(`VERIFIED_SDK_RANGE ${VERIFIED_SDK_RANGE} admits no version.`);
}

/** The one version the verified range admits. */
export const VERIFIED_SDK_VERSION = minimum.version;

/** An installed version the verified range does not admit. */
export const STALE_SDK_VERSION = semver.inc(VERIFIED_SDK_VERSION, "patch") ?? VERIFIED_SDK_VERSION;

/** The next minor, for writing a range that contains the verified version and more. */
export const NEXT_SDK_MINOR = semver.inc(VERIFIED_SDK_VERSION, "minor") ?? VERIFIED_SDK_VERSION;
