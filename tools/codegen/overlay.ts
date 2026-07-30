/**
 * The hand-maintained overlay: every place the generated API deliberately
 * departs from a mechanical reading of the rules.
 *
 * Keeping these in one table is the point. The rules cover an enormous surface
 * but they describe what the *game* accepts, not what a TypeScript API should
 * look like, and they carry no information at all about some things the SDK
 * needs. Scattering the differences through the emitters would hide how much
 * hand-maintenance this pipeline actually costs; collected here, it is a short
 * list anyone can audit.
 *
 * Each entry states what it changes and why. Adding one should feel expensive.
 */

/** Scope names the docs use that are not scopes: they mean "every scope". */
export const UNIVERSAL_SCOPES = new Set(["all", "any"]);

/**
 * Scopes the game's doc dump names that `scopes.cwt` does not define.
 *
 * 27 triggers are documented as `no_scope` — evaluated with nothing scoped —
 * and dropping them because upstream's scope list omits the entry would lose
 * real triggers to a bookkeeping gap.
 */
export const EXTRA_SCOPES = ["no_scope"];

/**
 * Structural triggers the SDK models by hand rather than generating.
 *
 * These are not conditions, they are the shape of the condition tree, and the
 * SDK gives them signatures the rules cannot express: `and()` flattens its
 * operands into one block, and all three infer the scope intersection of their
 * arguments.
 */
export const HAND_WRITTEN_TRIGGERS = new Set(["and", "or", "not", "nand", "nor"]);

/**
 * Structural effects the SDK models by hand rather than generating.
 *
 * `if`/`else_if`/`else`/`while`/`switch` and the random lists are control flow,
 * not effects — their ergonomics (`scope.iff(...)`, `scope.randomList([...])`)
 * are SDK design the rules cannot express, and `random_list`'s weighted `int`
 * keys mix `modifier_rule` and effect splices no mechanical emitter can type.
 * `save_event_target_as` takes a scope-branded `EventTarget<S>` rather than the
 * bare value-set string the rules describe — the brand is the entire point.
 * `add_resource` keys its block by `<resource>`, a computed key the emitter
 * cannot type yet. All live in `src/effect-core.ts` as `StructuralEffects`.
 */
export const HAND_WRITTEN_EFFECTS = new Set([
  "if",
  "else",
  "else_if",
  "while",
  "switch",
  "inverted_switch",
  "random",
  "random_list",
  "locked_random_list",
  "save_event_target_as",
  "save_global_event_target_as",
  "add_resource",
]);

/**
 * Event-firing effects, deferred to the events vertical.
 *
 * Their `id` argument is an `EventRef` carrying the fired event's FROM
 * contract, and each needs the hand-written witness-overload pair the probe
 * validated (`from: ctx.self`, with `NoInfer` on the witness) — see
 * `docs/verdict-effects-probe.md`. Generating them as plain `id: string`
 * methods would silently bypass the contract, so they are skipped until the
 * event system lands.
 */
export const FIRE_EFFECTS = new Set([
  "country_event",
  "planet_event",
  "ship_event",
  "fleet_event",
  "pop_group_event",
  "pop_faction_event",
  "pop_event",
  "first_contact_event",
  "observer_event",
  "leader_event",
  "situation_event",
  "agreement_event",
  "starbase_event",
  "system_event",
  "espionage_operation_event",
  "astral_rift_event",
  "bypass_event",
  "cosmic_storm_event",
  "cosmic_storm_influence_field_event",
  "carrier_event",
  "colony_event",
]);

export interface FieldWidening {
  /** Appended to the mechanically derived type. */
  readonly extraType: string;
  readonly reason: string;
}

/**
 * Ergonomic widenings on generated content-type fields.
 *
 * The rules describe the file format; these accept the shape a modder would
 * reach for first and normalise it at emit time.
 */
export const FIELD_WIDENINGS = new Map<string, FieldWidening>([
  [
    "technology.category",
    {
      extraType: "TechnologyCategoryRef | string",
      reason:
        "The rules type this as a list, but a technology almost always has exactly one " +
        "category. Accepting the bare value avoids making every caller write a one-element array.",
    },
  ],
  [
    "technology.tier",
    {
      extraType: "number",
      reason:
        "Tiers are a content type whose vanilla keys are the integers 0-5, so modders write " +
        "`tier: 3`. Refusing a number here would be pedantically correct and useless.",
    },
  ],
]);

/**
 * Localisation slots the SDK always writes, and therefore requires.
 *
 * Slot *names* come straight from the rules — `name` and `desc` — which also
 * matches how the rest of the script surface reads, since `desc` is the key
 * events use for their description. Only the requiredness is ours: the rules
 * mark neither slot required, but `defineTechnology` unconditionally emits a
 * localisation entry under the tech id, so a technology has to have a name.
 *
 * `desc` stays optional. A tech with no `_desc` key does render a raw key in
 * game, but that is a lint to grow, not a reason to block generating placeholder
 * technologies in a loop.
 */
export const REQUIRED_LOCALISATION = new Set(["technology.name"]);

/**
 * Bool triggers take `(value = true)` rather than a required argument.
 *
 * Script is written `is_ai = yes` far more often than `is_ai = no`, so the
 * common case should be `isAi()`.
 */
export const BOOL_TRIGGERS_DEFAULT_TRUE = true;

/**
 * Technology fields the SDK's emitter can write today.
 *
 * The rules model 26 fields; `Technology.toEntries()` writes these. Everything
 * else is reported by codegen as modelled-but-unemitted rather than dropped, so
 * the gap stays visible.
 */
export const TECHNOLOGY_EMITTED_FIELDS = [
  "cost",
  "area",
  "tier",
  "category",
  "prerequisites",
  "start_tech",
  "is_rare",
  "weight",
  "potential",
] as const;
