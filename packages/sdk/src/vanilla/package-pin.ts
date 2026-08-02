/**
 * The version-pin gate for the optional `@pdx-ts/stellaris-vanilla` package
 * (SDK-12). Distinct from the rule-table staleness gate in `build.ts`: that
 * one guards patch emission against an unverified CWT rule table, and only
 * fires when patches exist. This one guards every authored vanilla
 * reference — identifiers influence everything authored, not only patches —
 * against an identifier package generated for a different game build than
 * the install a `VanillaView` was parsed from.
 */

import { createRequire } from "node:module";

import { VanillaPackageMismatchError } from "../errors.ts";

/**
 * The version pinned by the installed `@pdx-ts/stellaris-vanilla` package,
 * read from its `package.json` at runtime via `createRequire` — never
 * imported as a module, so this resolves correctly whether or not the
 * package is present. Any failure (not installed, no such export in the
 * resolver, malformed `package.json`, missing or non-string `version`)
 * silently returns `undefined`: an absent package is a legal, fully
 * supported configuration (see `vanilla-ids.ts`'s per-registry degradation).
 *
 * `specifier` exists for tests: point it at a fixture `package.json` path to
 * exercise this without touching the workspace-installed package.
 */
export function installedVanillaPackageVersion(
  specifier = "@pdx-ts/stellaris-vanilla/package.json"
): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg: unknown = require(specifier);
    if (
      typeof pkg === "object" &&
      pkg !== null &&
      "version" in pkg &&
      typeof (pkg as { version: unknown }).version === "string"
    ) {
      return (pkg as { version: string }).version;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Strips a prerelease/build suffix from a semver string, e.g.
 * `"4.4.6-r2+build"` -> `"4.4.6"`. The identifier package pins a game
 * version by its `major.minor.patch` alone, so a regen-fix release
 * (`4.4.6-r2`) still pins install `4.4.6`.
 */
function corePatchVersion(version: string): string {
  return version.split(/[-+]/, 1)[0]!;
}

/**
 * The pure check behind the gate: throws `VanillaPackageMismatchError` when
 * the installed `@pdx-ts/stellaris-vanilla` package is pinned to a game
 * version that differs from the install a `VanillaView` was built from,
 * unless the mod config explicitly accepts that install version.
 *
 * Silent pass when:
 * - `packageVersion` is `undefined` — the package is not installed; every
 *   `VanillaId<K>` already degrades to plain `string` in that world, so
 *   there is nothing to enforce here either.
 * - `packageVersion` is `"0.0.0"` — the UNSTAMPED SENTINEL: 0.0.0 means no
 *   generation has produced this package; there is no pin to enforce.
 * - `installGameVersion` is `undefined` — a hermetic or metadata-less view
 *   carries no install version to compare against.
 * - the package's `major.minor.patch` (prerelease/build suffix stripped)
 *   equals `installGameVersion`.
 * - `acceptGameVersion` equals `installGameVersion` — an explicit,
 *   per-version escape, mirroring `StaleRuleTableError`'s
 *   `acceptGameVersion`.
 */
export function checkVanillaPackagePin(
  packageVersion: string | undefined,
  installGameVersion: string | undefined,
  acceptGameVersion: string | undefined
): void {
  if (
    packageVersion === undefined ||
    packageVersion === "0.0.0" ||
    installGameVersion === undefined
  ) {
    return;
  }
  const pinned = corePatchVersion(packageVersion);
  if (pinned === installGameVersion || acceptGameVersion === installGameVersion) {
    return;
  }
  throw new VanillaPackageMismatchError(
    `the install is Stellaris ${installGameVersion} but @pdx-ts/stellaris-vanilla is pinned to ` +
      `${pinned} — install @pdx-ts/stellaris-vanilla@${installGameVersion} to match, or set ` +
      `acceptGameVersion: "${installGameVersion}" to proceed on mismatched identifier types`
  );
}
