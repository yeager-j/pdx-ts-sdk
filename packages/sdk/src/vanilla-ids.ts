/**
 * Merge targets and resolvers for the optional `@pdx-ts/stellaris-vanilla`
 * package (SDK-12).
 *
 * `VanillaIds`, `VanillaScriptedTriggers`, `VanillaScriptedEffects`, and
 * `VanillaTries` are declared empty here, on purpose. TypeScript's declaration
 * merging can only ADD members to an interface — it cannot narrow or replace
 * one — so an empty interface is the only shape a later
 * `declare module "@pdx-ts/sdk" { ... }` augmentation can safely extend
 * without this module knowing anything about the package that might do so.
 * `@pdx-ts/stellaris-vanilla`'s `src/augment.ts` is the one place that
 * augmentation happens; everything below reads the merge result back out
 * through a conditional type.
 *
 * Degradation is per-registry, never all-or-nothing:
 * - package absent entirely: every `VanillaId<K>` is plain `string`.
 * - package installed but stale, missing a registry the SDK now asks about:
 *   only that registry's `K extends keyof VanillaIds` check fails, so
 *   `VanillaId<K>` is `string` for that one registry while every registry the
 *   installed package does cover stays checked.
 */

// Deliberately empty — see the module doc. `@pdx-ts/stellaris-vanilla`'s
// augmentation adds one `readonly <registry>: Vanilla<PascalCase>Id` member
// per `CONTENT_MANIFEST` registry (registry name = `as ?? type`), plus the
// `VANILLA_REF_EXTRAS` registries.
export interface VanillaIds {}

// Deliberately empty — extended via
// `interface VanillaScriptedTriggers extends VanillaScriptedTriggerParams {}`
// inside the package's augmentation.
export interface VanillaScriptedTriggers {}

// Deliberately empty — same mechanism as `VanillaScriptedTriggers`, for
// scripted effects.
export interface VanillaScriptedEffects {}

/**
 * A vanilla id for registry `K`: checked against
 * `@pdx-ts/stellaris-vanilla`'s real id set when it is installed and covers
 * `K`, plain `string` otherwise (package absent, or present but missing this
 * one registry).
 */
export type VanillaId<K extends string> = K extends keyof VanillaIds
  ? VanillaIds[K] & string
  : string;

declare const invalidVanillaId: unique symbol;

/**
 * The error carrier `CheckedVanillaId` produces for a real registry given an
 * id that registry does not define. Deliberately not a bare string-literal
 * error message: a distinct, unique-symbol-branded type, so it can never
 * accidentally satisfy a `string`-typed parameter and pass silently, and so
 * both the offending registry and id print in the type-checker's message.
 */
export interface InvalidVanillaId<K extends string, Id extends string> {
  readonly [invalidVanillaId]: [K, Id];
}

/**
 * Checks a given string literal `Id` against registry `K`'s vanilla id set:
 * `Id` itself when it belongs, `InvalidVanillaId<K, Id>` when `K` is a known
 * registry and `Id` does not belong to it, or plain `Id` when `K` is not a
 * registry the installed package (or no package at all) covers.
 *
 * This is the oversized-registry (trie) counterpart to `VanillaId`:
 * `VanillaId` narrows a *parameter type*, this narrows a *given literal*
 * against that same set — which is what a checked call form like
 * `vanilla.sprite("GFX_...")` needs, since a flat 9k-member union parameter is
 * exactly the completion-menu blowup the trie exists to avoid.
 */
export type CheckedVanillaId<K extends string, Id extends string> = K extends keyof VanillaIds
  ? [Id] extends [VanillaIds[K] & string]
    ? Id
    : InvalidVanillaId<K, Id>
  : Id;

// Deliberately empty — see the module doc. The package adds trie roots here,
// e.g. `readonly sprite: VanillaSpriteTrie`.
export interface VanillaTries {}

/**
 * The navigable trie node type for registry `K`'s oversized ids (sprites,
 * sounds): the package's real node interface when it is installed and covers
 * `K`, otherwise `{}` — no navigation, but the string-call form (guarded by
 * `CheckedVanillaId`) still accepts any string.
 */
export type VanillaTrie<K extends string> = K extends keyof VanillaTries ? VanillaTries[K] : {};
