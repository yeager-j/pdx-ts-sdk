/**
 * The version-pin gate for the `@pdx-ts/stellaris-ids` package
 * (SDK-12). Distinct from the rule-table staleness gate in `compiler/compile.ts`: that
 * one guards patch emission against an unverified CWT rule table, and only
 * fires when patches exist. This one guards every authored vanilla
 * reference — identifiers influence everything authored, not only patches —
 * against an identifier package generated for a different game build than
 * the install a `VanillaView` was parsed from.
 */

import { createRequire } from "node:module";

import { VanillaPackageMismatchError } from "../errors.ts";
import { vanillaPackageGameVersion, vanillaPackageInstallRange } from "./version-scheme.ts";

/**
 * The version pinned by the installed `@pdx-ts/stellaris-ids` package,
 * read from its `package.json` at runtime via `createRequire` — a runtime
 * read rather than an import, because the version is data and the package's
 * types are what the SDK imports.
 *
 * Any failure (no such export in the resolver, malformed `package.json`,
 * missing or non-string `version`) returns `undefined`, and every check below
 * then passes silently. That is not tolerance for an absent package — the
 * package is a hard dependency, and a project without it fails to typecheck on
 * the SDK's own import of it. It is that a runtime version read is the wrong
 * place to re-litigate a compile-time fact, and has nothing useful to say when
 * it cannot read one.
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
 * The pure check behind the gate: throws `VanillaPackageMismatchError` when
 * the installed `@pdx-ts/stellaris-ids` package is pinned to a game
 * version that differs from the install a `VanillaView` was built from,
 * unless the mod config explicitly accepts that install version.
 *
 * Silent pass when:
 * - `packageVersion` is `undefined` — no version could be read; see
 *   {@link installedVanillaPackageVersion}.
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
  const pinned = vanillaPackageGameVersion(packageVersion);
  if (pinned === installGameVersion || acceptGameVersion === installGameVersion) {
    return;
  }
  throw new VanillaPackageMismatchError(
    `the install is Stellaris ${installGameVersion} but @pdx-ts/stellaris-ids is pinned to ` +
      `${pinned} — install "@pdx-ts/stellaris-ids": "${vanillaPackageInstallRange(
        installGameVersion
      )}" to match, or set ` +
      `acceptGameVersion: "${installGameVersion}" to proceed on mismatched identifier types`
  );
}

/**
 * The canary for vanilla ids being checked against the *wrong game build*, as
 * a warning message, or `undefined` when the pin matches.
 *
 * The gate above refuses that build; this reports it, because it is reachable
 * only with `acceptGameVersion` set — a legal state an author chose
 * deliberately. What makes it worth a line on `mod.warnings` anyway is that
 * the checking still looks like it is working: ids that moved between the two
 * builds typecheck cleanly against the pinned package and are still wrong in
 * the game being shipped for.
 *
 * `"0.0.0"` — the unstamped sentinel — reports nothing, the same reading the
 * gate above takes: no generation has produced that package, so there is no
 * pin to compare and no claim about ids to weigh it against. An unreadable
 * version reports nothing either, for the reason
 * {@link installedVanillaPackageVersion} gives.
 */
export function vanillaIdsCheckWarning(
  packageVersion: string | undefined,
  installGameVersion: string | undefined,
  acceptGameVersion: string | undefined
): string | undefined {
  if (
    packageVersion === undefined ||
    packageVersion === "0.0.0" ||
    installGameVersion === undefined
  ) {
    return undefined;
  }
  const pinned = vanillaPackageGameVersion(packageVersion);
  if (pinned === installGameVersion) {
    return undefined;
  }
  // Past the gate above only because `acceptGameVersion` allowed it through.
  return (
    `Vanilla ids are checked against the wrong game build: @pdx-ts/stellaris-ids is pinned to ` +
    `${pinned} but this build's install is Stellaris ${installGameVersion}, accepted via ` +
    `acceptGameVersion: "${acceptGameVersion}". Ids that moved between those builds typecheck ` +
    `here and are still wrong in game. Install "@pdx-ts/stellaris-ids": ` +
    `"${vanillaPackageInstallRange(installGameVersion)}" to match the install.`
  );
}
