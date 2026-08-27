/** Declared-unchecked references to names this build does not define. */

import { localizationRef } from "./localization.ts";

/**
 * References to names outside this mod — vanilla's, or another mod's.
 *
 * Everything here is declared rather than checked: this build has no record of
 * the names in question, so a misspelling survives to the shipped mod, where
 * the game shows the key itself. Only syntax is validated. Reach for it only
 * where the name really does come from elsewhere — a key this mod owns comes
 * from `mod.localization()`, which is checked.
 *
 * @example
 * ```ts
 * mod.tradition("adaptive", {
 *   customTooltip: [external.localization("tradition_adaptability_delta")],
 * });
 * ```
 */
export const external = Object.freeze({
  localization: localizationRef,
});
