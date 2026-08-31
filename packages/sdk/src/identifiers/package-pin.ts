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
 * The result of reading the installed `@pdx-ts/stellaris-ids` package pin.
 * `"absent"` means the package could not be resolved; `"unreadable"` means
 * resolution succeeded or failed for another reason, but usable metadata was
 * not available.
 */
export type VanillaPackagePin =
  | { readonly state: "read"; readonly version: string }
  | { readonly state: "absent"; readonly detail: string }
  | { readonly state: "unreadable"; readonly detail: string };

/**
 * Reads the installed `@pdx-ts/stellaris-ids` package pin from its
 * `package.json` via `createRequire`.
 *
 * `specifier` exists for tests: point it at a fixture `package.json` path to
 * exercise this without touching the workspace-installed package. An
 * unresolvable fixture path is reported as `"absent"` without probing a
 * package name.
 */
export function installedVanillaPackagePin(
  specifier = "@pdx-ts/stellaris-ids/package.json"
): VanillaPackagePin {
  try {
    const require = createRequire(import.meta.url);
    const pkg: unknown = require(specifier);
    if (!isPackageMetadata(pkg)) {
      return {
        state: "unreadable",
        detail: `metadata was ${describeValue(pkg)}, not a JSON object`,
      };
    }
    if (!("version" in pkg)) {
      return { state: "unreadable", detail: "metadata has no version field" };
    }
    if (typeof pkg.version !== "string") {
      return {
        state: "unreadable",
        detail: `metadata version was ${describeValue(pkg.version)}, not a string`,
      };
    }
    return { state: "read", version: pkg.version };
  } catch (error) {
    const detail = `could not read package metadata from ${JSON.stringify(specifier)}: ${errorDetail(
      error
    )}`;
    if (!isModuleNotFoundError(error)) {
      return { state: "unreadable", detail };
    }
    const packageName = packageNameFromSpecifier(specifier);
    if (packageName === undefined) {
      return { state: "absent", detail };
    }
    try {
      createRequire(import.meta.url).resolve(packageName);
      return {
        state: "unreadable",
        detail: `${detail}; package ${JSON.stringify(packageName)} resolves, so its metadata is unreadable`,
      };
    } catch (probeError) {
      return isModuleNotFoundError(probeError)
        ? { state: "absent", detail }
        : {
            state: "unreadable",
            detail:
              `${detail}; package ${JSON.stringify(packageName)} could not be probed: ` +
              errorDetail(probeError),
          };
    }
  }
}

function isPackageMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModuleNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("#") ||
    specifier.startsWith("node:") ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  ) {
    return undefined;
  }
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return parts[0] === "" ? undefined : parts[0];
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "string") {
    return `the string ${JSON.stringify(value)}`;
  }
  return `${typeof value} ${String(value)}`;
}

/**
 * The pure check behind the gate: throws `VanillaPackageMismatchError` when
 * the installed `@pdx-ts/stellaris-ids` package is pinned to a game
 * version that differs from the install a `VanillaView` was built from,
 * unless the mod config explicitly accepts that install version.
 *
 * Silent pass when:
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
  packageVersion: string,
  installGameVersion: string | undefined,
  acceptGameVersion: string | undefined
): void {
  if (packageVersion === "0.0.0" || installGameVersion === undefined) {
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
 * pin to compare and no claim about ids to weigh it against.
 */
export function vanillaIdsCheckWarning(
  packageVersion: string,
  installGameVersion: string | undefined,
  acceptGameVersion: string | undefined
): string | undefined {
  if (packageVersion === "0.0.0" || installGameVersion === undefined) {
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
