/** Declared-unchecked references to names this build does not define. */

import { isBareString } from "@pdx-ts/pdxscript";

import { localizationRef } from "./localization.ts";

/**
 * A content id this build has no record of, named as an object so a field
 * overloaded between a localization key and a content reference can still tell
 * the two apart.
 *
 * It carries the id alone, and so satisfies every generated `TypedRef`
 * arm: those brands are optional precisely because which ids exist is decided
 * by the install rather than by the rules. Carrying a brand of its own would
 * be worse than carrying none — it would have to name one registry, and this
 * reference is for exactly the case where nothing here knows which.
 */
export interface ExternalReference {
  /** The exact id written into the file. */
  readonly id: string;
}

/**
 * References a content id by its exact spelling, validating only its syntax.
 * Published as `external.reference`.
 *
 * Reach for it only in a field overloaded between a localization key and a
 * content reference, where a bare string can no longer mean both: elsewhere a
 * raw id string is still accepted, and a checked `vanilla.*` reference or an
 * SDK-owned item is better than either.
 *
 * @throws Error If the id cannot be written as a bare PDXScript string identifier.
 * @example
 * ```ts
 * scope.createShip({ design: external.reference("other_mod_dreadnought") });
 * ```
 */
export function externalReference(id: string): ExternalReference {
  if (typeof id !== "string" || !isBareString(id)) {
    throw new Error(
      `external.reference(${JSON.stringify(id)}) is not a content id: an id is one bare ` +
        "PDXScript string identifier, not a number, boolean, variable, or quoted value."
    );
  }
  return Object.freeze({ id });
}

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
  reference: externalReference,
});
