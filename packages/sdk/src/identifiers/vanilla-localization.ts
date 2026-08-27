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
 * It is also the one place in the SDK that loads its inventory lazily, and the
 * contrast with `vanilla-paths.ts` is the reason. That module imports its
 * array statically and is reached only from `compiler/compile-finalize.ts`, so
 * the 2.8 MB it costs is paid by builds, which need it. This one is re-exported
 * into `vanilla.*`, which is the vocabulary namespace every mod file evaluates
 * on import — a static import here would make every project that never names a
 * vanilla key parse and retain 4.5 MB anyway. `createRequire` (the same
 * runtime-read pattern `package-pin.ts` uses) defers that to the first call
 * without making the constructor async, which it must not be: it is called in
 * an ordinary field position.
 *
 * The package-was-regenerated-inconsistently gate stays
 * `checkVanillaPathInventoryConsistency` (`vanilla-paths.ts`) alone: one
 * generator run writes every file in the package, so a second stamp comparison
 * here would restate that check rather than detect anything it cannot.
 */

import { createRequire } from "node:module";

import { localizationRef, type LocalizationRef } from "../authoring/localization.ts";
import { immutableSet } from "../compiler/freeze.ts";

/** The packaged inventory, in the form this module answers questions from. */
interface PackagedLocalizationInventory {
  readonly keys: ReadonlySet<string>;
  readonly gameVersion: string;
}

let loaded: PackagedLocalizationInventory | undefined;

/**
 * Loads and memoizes the packaged inventory on first use.
 *
 * The key set and the game version come out of one module, so they load
 * together: deferring only one of them would pull the 4.5 MB in anyway.
 *
 * `immutableSet` (`compiler/freeze.ts`), not `Object.freeze(new Set(...))`:
 * freezing a `Set` object freezes its own properties but not the internal
 * slots `.add`/`.delete` mutate, so a frozen `Set` still accepts `.add()`.
 * This value is memoized module-wide and answers every later call, so a real
 * mutator has to be absent, not merely refused by a check nothing enforces.
 */
function packagedLocalizationInventory(): PackagedLocalizationInventory {
  if (loaded === undefined) {
    const require = createRequire(import.meta.url);
    const inventory =
      require("@pdx-ts/stellaris-ids/localization-keys") as typeof import("@pdx-ts/stellaris-ids/localization-keys");
    loaded = {
      keys: immutableSet(inventory.VANILLA_LOCALIZATION_KEYS),
      gameVersion: inventory.VANILLA_LOCALIZATION_GAME_VERSION,
    };
  }
  return loaded;
}

/**
 * Every localization key the packaged inventory ships, as an immutable `Set`.
 *
 * Loaded on first call and memoized, so a project that never names a vanilla
 * key never loads the inventory at all, and one that names a thousand keys
 * loads it once.
 */
export function packagedVanillaLocalizationKeys(): ReadonlySet<string> {
  return packagedLocalizationInventory().keys;
}

/** The game build the packaged localization inventory was generated from. */
export function packagedVanillaLocalizationGameVersion(): string {
  return packagedLocalizationInventory().gameVersion;
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
 * mod.building("resonance_archive", {
 *   name: "Resonance Archive",
 *   potential: customTooltip({
 *     failText: vanilla.localization("requires_independence"),
 *     conditions: owner(isSubject(false)),
 *   }),
 * });
 * ```
 */
export function vanillaLocalizationRef(key: string): LocalizationRef {
  const { keys, gameVersion } = packagedLocalizationInventory();
  if (!keys.has(key)) {
    throw new Error(
      `"${key}" is not a localization key Stellaris ${gameVersion} defines. Check the spelling ` +
        "against the game's localisation/english files. If the key comes from another mod, or " +
        "from a game build this one does not describe, spell it " +
        `external.localization("${key}") — that is declared rather than checked.`
    );
  }
  return localizationRef(key);
}
