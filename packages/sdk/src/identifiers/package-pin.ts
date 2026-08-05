/**
 * The version-pin gate for the optional `@pdx-ts/stellaris-ids` package
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
 * The version pinned by the installed `@pdx-ts/stellaris-ids` package,
 * read from its `package.json` at runtime via `createRequire` — never
 * imported as a module, so this resolves correctly whether or not the
 * package is present. Any failure (not installed, no such export in the
 * resolver, malformed `package.json`, missing or non-string `version`)
 * silently returns `undefined`: an absent package is a legal, fully
 * supported configuration (see `contracts.ts`'s per-registry degradation).
 *
 * `specifier` exists for tests: point it at a fixture `package.json` path to
 * exercise this without touching the workspace-installed package.
 */
export function installedVanillaPackageVersion(
  specifier = "@pdx-ts/stellaris-ids/package.json"
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
 * the installed `@pdx-ts/stellaris-ids` package is pinned to a game
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
    `the install is Stellaris ${installGameVersion} but @pdx-ts/stellaris-ids is pinned to ` +
      `${pinned} — install @pdx-ts/stellaris-ids@${installGameVersion} to match, or set ` +
      `acceptGameVersion: "${installGameVersion}" to proceed on mismatched identifier types`
  );
}

/**
 * The canary for compile-time vanilla id checking being *inactive*, as a
 * warning message, or `undefined` when it is doing its job.
 *
 * The gate above refuses a build; this only reports, because both worlds it
 * describes are legal ones an author may have chosen. What makes it worth
 * reporting is that neither announces itself: without the package every
 * `VanillaId<K>` degrades to plain `string` (`contracts.ts`), by design and
 * silently, so a typo'd vanilla reference typechecks, builds, ships, and does
 * nothing in game. A protection that can switch itself off unnoticed is worth
 * one line on `mod.warnings`.
 *
 * Two ways it is off:
 * - the package does not resolve at runtime — not installed, so nothing is
 *   merged into `VanillaIds` and every registry is unchecked.
 * - it resolves but pins a different game build than the install this mod is
 *   being built against. Reachable only with `acceptGameVersion` set, since
 *   the gate above refuses that build otherwise; the ids then typecheck
 *   against a build that is not the one being shipped for.
 *
 * `"0.0.0"` — the unstamped sentinel — reports nothing, the same reading the
 * gate above takes: no generation has produced that package, so there is no
 * pin to compare and no claim about ids to weigh it against.
 *
 * **What this cannot see: installed but never imported.** Checking is active
 * only once the package's `declare module "@pdx-ts/sdk"` augmentation joins
 * the consumer's TypeScript *program*, which takes an import of
 * `@pdx-ts/stellaris-ids` somewhere in it. A consumer who installs the
 * package and never imports it is in exactly the state this canary exists to
 * expose, and gets no warning: resolution is a runtime fact, program
 * membership is a compile-time one, and this runs at neither the right time
 * nor with the right information to observe the second. Nothing in the
 * package announces itself at runtime either — its entry is an `import
 * "./augment.ts"` plus type-only re-exports, and `augment.ts` is `import
 * type` and `declare module` alone, so loading it executes nothing. (The
 * `/triggers` and `/effects` subpaths do call back into `scriptedTrigger`
 * per definition, but that is unsound as a signal in both directions: a
 * root-only import activates every id check while calling nothing, and the
 * same public function is the SDK's own documented hand-declaration hatch,
 * so a call proves nothing about the package.) Closing this needs the
 * generator to emit a runtime registration the SDK can observe — a
 * `@pdx-ts/codegen-vanilla` change with an install-gated regeneration and a
 * `licensing.test.ts` shape update behind it. Until then both messages below
 * say "installed *and* imported" rather than pretending resolution is the
 * whole story.
 */
export function vanillaIdsCheckWarning(
  packageVersion: string | undefined,
  installGameVersion: string | undefined,
  acceptGameVersion: string | undefined
): string | undefined {
  if (packageVersion === undefined) {
    return (
      "Vanilla ids are not checked: @pdx-ts/stellaris-ids is not installed, so every vanilla " +
      "id parameter — technologies, buildings, sprites, scripted trigger and effect names — " +
      "is an unchecked plain string, and a misspelled one builds cleanly and reaches the game " +
      "as a reference to nothing. Install @pdx-ts/stellaris-ids matching your Stellaris " +
      "version, and import it somewhere in the project — checking starts only once its " +
      "declaration merge is part of your TypeScript program, which an installed-but-unimported " +
      "package never joins. Or set uncheckedVanillaIds: true on the mod config to acknowledge " +
      "authoring without it."
    );
  }
  if (packageVersion === "0.0.0" || installGameVersion === undefined) {
    return undefined;
  }
  const pinned = corePatchVersion(packageVersion);
  if (pinned === installGameVersion) {
    return undefined;
  }
  // Past the gate above only because `acceptGameVersion` allowed it through.
  return (
    `Vanilla ids are checked against the wrong game build: @pdx-ts/stellaris-ids is pinned to ` +
    `${pinned} but this build's install is Stellaris ${installGameVersion}, accepted via ` +
    `acceptGameVersion: "${acceptGameVersion}". Ids that moved between those builds typecheck ` +
    `here and are still wrong in game. Install @pdx-ts/stellaris-ids@${installGameVersion} to ` +
    `match the install (and import it somewhere in the project — an installed package that is ` +
    `never imported checks nothing at all), or set uncheckedVanillaIds: true on the mod config ` +
    `to acknowledge building on mismatched identifier types.`
  );
}
