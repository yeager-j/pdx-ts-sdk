/**
 * The packaged vanilla path inventory: the SDK's one runtime read of
 * `@pdx-ts/stellaris-ids/paths` (SDK-173, ADR-0006).
 *
 * `@pdx-ts/stellaris-ids`'s root export stays free of eager-load work — the
 * package declares a hard dependency, and every project that imports it pays
 * for whatever the root does at module-evaluation time. The path inventory is
 * large (tens of thousands of entries) and only the Fold needs it, so it lives
 * behind its own `/paths` subpath instead of the root, and this module is the
 * only place in the SDK that imports that subpath. A static import is the
 * proven resolver-safe pattern here — `createRequire` is for the runtime
 * `package.json` version read in `package-pin.ts`, which has to tolerate a
 * package that cannot be resolved at all; this subpath is a hard dependency's
 * own export and resolves the same way any other import does.
 */

import { VANILLA_PATH_GAME_VERSION, VANILLA_PATHS } from "@pdx-ts/stellaris-ids/paths";

import { immutableSet } from "../compiler/freeze.ts";
import { VanillaPathInventoryError } from "../errors.ts";
import { vanillaPackageGameVersion } from "./version-scheme.ts";

let cached: ReadonlySet<string> | undefined;

/**
 * Every path the packaged vanilla inventory ships, as an immutable `Set`.
 * Built lazily on first call and memoized — the same reference comes back on
 * every later call — so the tens of thousands of entries are turned into a
 * `Set` at most once per process, however many builds run in it.
 *
 * `immutableSet` (`compiler/freeze.ts`), not `Object.freeze(new Set(...))`:
 * freezing a `Set` object freezes its own properties but not the internal
 * slots `.add`/`.delete` mutate, so a frozen `Set` still accepts `.add()`.
 * This value is memoized module-wide and handed to every build, so a real
 * mutator has to be absent, not merely refused by a check nothing enforces.
 */
export function packagedVanillaPaths(): ReadonlySet<string> {
  if (cached === undefined) {
    cached = immutableSet(VANILLA_PATHS);
  }
  return cached;
}

/** The game build the packaged path inventory was generated from. */
export function packagedVanillaPathGameVersion(): string {
  return VANILLA_PATH_GAME_VERSION;
}

/**
 * The self-consistency gate on the installed `@pdx-ts/stellaris-ids`
 * package: its `package.json` version and its path inventory both name a game
 * build, and those two readings have to agree.
 *
 * This is not a second copy of the install-vs-package mismatch gate —
 * `checkVanillaPackagePin` and `acceptGameVersion` (`identifiers/package-pin.ts`)
 * still own "does the package match the install a `VanillaView` was built
 * from", and nothing here duplicates that check or its warning code. A
 * mismatch here means something else: the *package itself* was regenerated
 * inconsistently, its `package.json` stamped for one game build and its path
 * inventory (`@pdx-ts/stellaris-ids/paths`) shipped from another — a defect in
 * how the package was produced, not in which install it is being checked
 * against, so it throws {@link VanillaPathInventoryError} rather than
 * `VanillaPackageMismatchError`.
 *
 * Silent pass when `packageVersion` is `undefined` (no version could be read;
 * see {@link installedVanillaPackageVersion "installedVanillaPackageVersion"}
 * in `package-pin.ts`) or `"0.0.0"` (the unstamped sentinel: no generation has
 * produced this package, so there is no pin to compare).
 */
export function checkVanillaPathInventoryConsistency(packageVersion: string | undefined): void {
  if (packageVersion === undefined || packageVersion === "0.0.0") {
    return;
  }
  const pinnedByPackage = vanillaPackageGameVersion(packageVersion);
  if (pinnedByPackage === VANILLA_PATH_GAME_VERSION) {
    return;
  }
  throw new VanillaPathInventoryError(
    `@pdx-ts/stellaris-ids was regenerated inconsistently: its package.json pins Stellaris ` +
      `${pinnedByPackage}, but its path inventory (@pdx-ts/stellaris-ids/paths) was generated ` +
      `from ${VANILLA_PATH_GAME_VERSION}. Rerun npm run codegen:vanilla to regenerate the whole ` +
      "package from one install."
  );
}
