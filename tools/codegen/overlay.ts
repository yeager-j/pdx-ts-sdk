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
 * events use for their description. Only the requiredness is ours: definitions
 * need a display name even where the rules do not mark the slot required.
 *
 * Description/flavor/effects slots stay optional. Missing tooltip text is a
 * lint to grow, not a reason to block generated placeholder content.
 */
export const REQUIRED_LOCALISATION = new Set([
  "technology.name",
  "building.name",
  "tradition.name",
  "tradition_category.name",
  "ascension_perk.name",
  "agenda.name",
  "edict.name",
  "councilor.name",
  "decision.name",
  "job.name",
]);

/**
 * Fields the emitter can lower but that review has decided not to emit, with
 * the reason.
 *
 * {@link CONTENT_EMITTED_FIELDS} is a queue that shrinks: a field absent from
 * it usually means "not reviewed yet", and codegen reports those so they can be
 * worked down. A permanent decision is different in kind, and recording it here
 * keeps it out of that queue instead of re-surfacing every run for someone to
 * re-litigate.
 *
 * Only for fields that lower successfully. A field the emitter cannot lower is
 * detected mechanically and belongs in no list.
 */
export const CONTENT_DECLINED_FIELDS = new Map<string, string>([
  [
    "job.auto_generate_description",
    "CWT declares `cardinality = 0..inf` on a bare bool, which lowers to a " +
      "nonsensical `boolean[]` — an upstream authoring quirk, not a real list field",
  ],
]);

export type ContentFieldShape =
  | "value"
  | "valueList"
  | "trigger"
  | "effect"
  | "economicResources"
  | "triggeredModifierBlock"
  | "modifierBlock"
  | "weightBlock"
  | "nested";

export interface ContentFieldOverride {
  readonly shape: ContentFieldShape;
  readonly quoted?: boolean;
  readonly reason: string;
}

/**
 * Lowerings that cannot be inferred solely from the CWT value type.
 *
 * Modifier and weight blocks contain alias splices rather than ordinary
 * fields. The quoted technology prerequisite list preserves the SDK's existing
 * byte contract. Tradition swaps are nested definitions with their own
 * localization identity.
 */
export const CONTENT_FIELD_OVERRIDES = new Map<string, ContentFieldOverride>([
  [
    "technology.prerequisites",
    {
      shape: "valueList",
      quoted: true,
      reason: "Technology prerequisites are conventionally quoted and existing goldens require it.",
    },
  ],
  [
    "building.planet_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "tradition.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "tradition.ai_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "tradition.tradition_swap",
    {
      shape: "nested",
      reason:
        "A tradition swap is a repeated nested definition with its own identity and localization.",
    },
  ],
  [
    "tradition_category.ai_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "ascension_perk.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "ascension_perk.triggered_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "ascension_perk.ai_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "ascension_perk.tradition_swap",
    {
      shape: "nested",
      reason:
        "An ascension perk swap is a repeated nested definition with its own identity and localization.",
    },
  ],
  [
    "agenda.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "agenda.ai_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "edict.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "edict.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "edict.triggered_country_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "edict.relay_network_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "edict.ai_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "councilor.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "councilor.triggered_country_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "councilor.ai_hiring_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "decision.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "decision.ai_weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "job.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "job.overlord_resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "job.pop_group_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "job.country_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "job.planet_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "job.system_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "job.triggered_planet_pop_group_modifier_for_all",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "job.triggered_country_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "job.triggered_planet_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "job.triggered_system_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map.",
    },
  ],
  [
    "job.weight",
    {
      shape: "weightBlock",
      reason: "modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
]);

export interface NestedContentDefinition {
  readonly typeName: string;
  readonly identityKey: string;
  readonly localisationType: string;
  readonly fields: readonly string[];
}

export const NESTED_CONTENT_DEFINITIONS = new Map<string, NestedContentDefinition>([
  [
    "tradition.tradition_swap",
    {
      typeName: "TraditionSwap",
      identityKey: "name",
      localisationType: "swapped_tradition",
      fields: [
        "inherit_icon",
        "inherit_name",
        "inherit_effects",
        "unlocks_agenda",
        "custom_tooltip",
        "custom_tooltip_with_modifiers",
        "modifier",
        "weight",
        "trigger",
      ],
    },
  ],
  [
    "ascension_perk.tradition_swap",
    {
      typeName: "AscensionPerkSwap",
      identityKey: "name",
      localisationType: "swapped_ascension_perk",
      fields: [
        "inherit_icon",
        "inherit_name",
        "inherit_effects",
        "custom_tooltip",
        "custom_tooltip_with_modifiers",
        "modifier",
        "on_enabled",
        "weight",
        "trigger",
      ],
    },
  ],
]);

export const NESTED_FIELD_OVERRIDES = new Map<string, ContentFieldOverride>([
  [
    "tradition.tradition_swap.modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as its parent.",
    },
  ],
  [
    "tradition.tradition_swap.weight",
    {
      shape: "weightBlock",
      reason: "Nested modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
  [
    "ascension_perk.tradition_swap.modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as its parent.",
    },
  ],
  [
    "ascension_perk.tradition_swap.weight",
    {
      shape: "weightBlock",
      reason: "Nested modifier_rule blocks lower to a base plus gated Modifier rows.",
    },
  ],
]);

/**
 * Bool triggers take `(value = true)` rather than a required argument.
 *
 * Script is written `is_ai = yes` far more often than `is_ai = no`, so the
 * common case should be `isAi()`.
 */
export const BOOL_TRIGGERS_DEFAULT_TRUE = true;
