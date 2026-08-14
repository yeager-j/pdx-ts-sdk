/**
 * Resolvers over the lookup tables `@pdx-ts/stellaris-ids` publishes.
 *
 * The package is a hard dependency (ADR-0006), so the tables arrive along an
 * ordinary import: `VanillaIds`, `VanillaEnums` and `VanillaTries` are the
 * package's own generated interfaces, not empty placeholders something else
 * merges into. Every resolver below is therefore total — a vanilla reference
 * is checked, or it does not compile.
 *
 * Each resolver's key is constrained to its table rather than falling back to
 * plain `string`. The two tables are generated from different sources — this
 * package's registries from the CWT rules, the id sets from a game install —
 * so they can drift apart, and the constraint makes that drift a compile error
 * in the SDK's own generated code, where a maintainer can see it, instead of a
 * silently unchecked registry in an author's project.
 */

import type { VanillaEnums, VanillaIds, VanillaTries } from "@pdx-ts/stellaris-ids";

export type VanillaRegistry = keyof VanillaIds;

/** A vanilla id for registry `K`, checked against that registry's id set. */
export type VanillaId<K extends VanillaRegistry> = VanillaIds[K] & string;

/** A member of CWT complex enum `K`, checked against the install's members. */
export type VanillaEnumMember<K extends keyof VanillaEnums> = VanillaEnums[K] & string;

declare const invalidVanillaId: unique symbol;

/**
 * The error carrier `CheckedVanillaId` produces for an id its registry does
 * not define. Deliberately not a bare string-literal error message: a
 * distinct, unique-symbol-branded type, so it can never accidentally satisfy a
 * `string`-typed parameter and pass silently, and so both the offending
 * registry and id print in the type-checker's message.
 */
export interface InvalidVanillaId<K extends string, Id extends string> {
  readonly [invalidVanillaId]: [K, Id];
}

/**
 * Checks a given string literal `Id` against registry `K`'s vanilla id set:
 * `Id` itself when it belongs, `InvalidVanillaId<K, Id>` when it does not.
 *
 * This is the oversized-registry (trie) counterpart to `VanillaId`:
 * `VanillaId` narrows a *parameter type*, this narrows a *given literal*
 * against that same set — which is what a checked call form like
 * `vanilla.sprite("GFX_...")` needs, since a flat 9k-member union parameter is
 * exactly the completion-menu blowup the trie exists to avoid.
 */
export type CheckedVanillaId<K extends VanillaRegistry, Id extends string> = [Id] extends [
  VanillaIds[K] & string,
]
  ? Id
  : InvalidVanillaId<K, Id>;

/** The navigable trie node type for registry `K`'s oversized ids. */
export type VanillaTrie<K extends keyof VanillaTries> = VanillaTries[K];
