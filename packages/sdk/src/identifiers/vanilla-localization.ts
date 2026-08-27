/**
 * The packaged vanilla localization key inventory, and the checked reference
 * constructor published as `vanilla.localization` (SDK-307, ADR-0006).
 *
 * Hand-written rather than generated, and that is the seam: the inventory is
 * install-derived, so `@pdx-ts/codegen-vanilla` owns it and ships it as
 * `@pdx-ts/stellaris-ids/localization-keys`; `@pdx-ts/codegen-cwt`, which emits
 * the rest of the `vanilla.*` namespace, never reads an install and has no
 * knowledge of a localization key. What it does own is what the namespace
 * contains, so `generated/vanilla-refs.ts` re-exports the constructor below.
 *
 * Every other `vanilla.*` member is checked by the compiler against a literal
 * union. 149,217 keys is an order of magnitude past the largest of those, so
 * this one is checked at build time against a `Set` instead — which is why it
 * is the one member of the namespace with runtime behaviour.
 *
 * The package-was-regenerated-inconsistently gate stays
 * `checkVanillaPathInventoryConsistency` (`vanilla-paths.ts`) alone: one
 * generator run writes every file in the package, so a second stamp comparison
 * here would restate that check rather than detect anything it cannot.
 */

import {
  VANILLA_LOCALIZATION_GAME_VERSION,
  VANILLA_LOCALIZATION_KEYS,
} from "@pdx-ts/stellaris-ids/localization-keys";

import { localizationRef, type LocalizationRef } from "../authoring/localization.ts";
import { immutableSet } from "../compiler/freeze.ts";

let cached: ReadonlySet<string> | undefined;

/**
 * Every localization key the packaged inventory ships, as an immutable `Set`.
 *
 * Built lazily on first call and memoized, so a project that never names a
 * vanilla key never pays to build it, and one that names a thousand pays once.
 */
export function packagedVanillaLocalizationKeys(): ReadonlySet<string> {
  if (cached === undefined) {
    cached = immutableSet(VANILLA_LOCALIZATION_KEYS);
  }
  return cached;
}

/** The game build the packaged localization inventory was generated from. */
export function packagedVanillaLocalizationGameVersion(): string {
  return VANILLA_LOCALIZATION_GAME_VERSION;
}

/**
 * References a localization key vanilla defines, checked against the installed
 * `@pdx-ts/stellaris-ids` inventory. Published as `vanilla.localization`.
 *
 * Use it for any key the game ships. A key from a third-party mod is
 * `external.localization`, which validates syntax and nothing more; a key this
 * build owns comes from `mod.localization()` or a definition's `loc` member.
 *
 * @throws Error If the key is not one vanilla defines.
 * @example
 * ```ts
 * mod.ascensionPerk("apotheosis", {
 *   name: "Apotheosis",
 *   potential: isIndependent({ failText: vanilla.localization("requires_independence") }),
 * });
 * ```
 */
export function vanillaLocalizationRef(key: string): LocalizationRef {
  if (!packagedVanillaLocalizationKeys().has(key)) {
    throw new Error(
      `"${key}" is not a localization key Stellaris ${VANILLA_LOCALIZATION_GAME_VERSION} ` +
        "defines. Check the spelling against the game's localisation/english files. If the key " +
        "comes from another mod, or from a game build this one does not describe, spell it " +
        `external.localization("${key}") — that is declared rather than checked.`
    );
  }
  return localizationRef(key);
}
