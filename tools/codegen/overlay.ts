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
 * Scope *references* the game's scope dump lists alongside the real links.
 *
 * `links.cwt` deliberately omits them: they are not navigation from one scope
 * kind to another but positional references into the evaluation context, with
 * "Output Scope: various". Typing them needs definition-context threading that
 * is a separate design, so the link join excludes them instead of recording
 * them as drift.
 */
export const SPECIAL_SCOPE_PATHS = new Set([
  "root",
  "this",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
]);

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
 * The method names `src/effect-core.ts` hand-writes onto the scope
 * interfaces — `StructuralEffects` plus per-scope augmentations such as the
 * author-asserted `target` link. The scope-link pass must not emit a method by
 * any of these names: the generated interface member would merge with (or
 * shadow) the structural one and the runtime Proxy would dispatch the wrong
 * table. Update this list together with the `STRUCTURAL` table.
 */
export const STRUCTURAL_EFFECT_METHODS = new Set([
  "if",
  "within",
  "target",
  "randomList",
  "lockedRandomList",
  "random",
  "whileLoop",
  "saveEventTargetAs",
  "saveGlobalEventTargetAs",
  "addResource",
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

export interface HandWrittenDefiner {
  readonly reason: string;
}

/**
 * Registries whose `defineX` is re-exported from `src/definers.ts` instead of
 * being the mechanical one the emitter would write.
 *
 * The `HAND_WRITTEN_TRIGGERS` arrangement, one level up: codegen skips the
 * member and the hand-written module supplies it, so there is exactly one
 * definition of the graft and it is the reviewed one. A row here is expensive —
 * it removes a definer from generator ownership — and needs a contract the rules
 * cannot express, not merely a nicer signature.
 */
export const HAND_WRITTEN_CONTENT_DEFINERS = new Map<string, HandWrittenDefiner>([
  [
    "situation_type",
    {
      reason:
        "`targetScope` is authored, emits nothing, and is carried on the returned item as the " +
        "situation target contract every `startSituation` call site is checked against " +
        "(src/situations.ts). The rules declare that contract nowhere, so no mechanical definer " +
        "can produce it.",
    },
  ],
]);

/**
 * Registries whose collection factory also offers a vanilla patch.
 *
 * A prefixed definition cannot collide with vanilla, but a patch is a whole-
 * object override whose load order and emission have to be verified per
 * registry — so `patchX` appears only where that evidence exists. The member
 * names are derived (`patchTechnology`, `ParsedTechnology`, `TechnologyPatch`);
 * the row is the permission.
 */
export const CONTENT_PATCH_REGISTRIES = new Map<string, string>([
  [
    "technology",
    "the only registry the vanilla loader parses and the patch resolver plans emission for " +
      "(src/resolver, src/vanilla) — verified in-game by the patches-that-provably-win calibration",
  ],
]);

export interface ContributionSink {
  /** The contribution method on the collection factory. */
  readonly method: string;
  /** The `ContributionItem` registry tag the fold merges under. */
  readonly sink: string;
  /** The ref registry whose ids the contribution lists. */
  readonly refRegistry: string;
  readonly reason: string;
}

/**
 * Registries that additionally contribute to a shared, non-id-keyed sink.
 *
 * A contribution has no id this mod owns and no author-named file: it is folded
 * into one additive `default = { ... }` block at a fixed path. Nothing in the
 * rules marks a registry as having one, so each is a reviewed row.
 */
export const CONTENT_CONTRIBUTION_SINKS = new Map<string, ContributionSink>([
  [
    "country_ship_of_size_limit",
    {
      method: "addShipOfSizeLimits",
      sink: "ship_of_size_limits",
      refRegistry: "country_ship_of_size_limit",
      reason:
        "`country_limits` reads one shared additive `default = { ship_of_size_limits = { ... } }`; " +
        "the listed limits are ids, not definitions this file owns.",
    },
  ],
]);

/**
 * Alias families the rule loader reads into a table beyond `trigger` and
 * `effect`.
 *
 * CWT declares roughly two dozen alias categories, and most of them are GUI or
 * graphics grammar with no bearing on the content registries the SDK exposes.
 * Sweeping them all in would cost parse time and, worse, invite the emitters to
 * guess at shapes nobody has read. So the loader reads a category only when a
 * content registry actually consumes it, and each row says which consumer.
 */
export const EXTRA_ALIAS_CATEGORIES = new Map<string, string>([
  [
    "pop_pre_trigger",
    "Seven plain bools consumed by `job.possible_pre_triggers` (and " +
      "pop_faction_type's can_join_pre_triggers). Every member is `bool`, so the " +
      "splice lowers as an ordinary struct.",
  ],
  [
    "colony_pre_trigger",
    "The colony-scoped twin of pop_pre_trigger, seven plain bools, consumed by " +
      "the planet/colony event `pre_triggers` blocks.",
  ],
  [
    "government_trigger",
    "The requirements DSL behind civic/origin `potential` and `possible`. Not a " +
      "`Trigger` — its members are a fixed value/OR/NOT/NOR clause template plus " +
      "self-recursive OR/AND/limit combinators, emitted by emit/alias-struct.ts.",
  ],
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
  "opinion_modifier.name",
  // All 3096 shipped static modifiers carry a localised name: the game shows
  // it wherever the modifier is applied, so an unnamed one is a visible bug.
  "static_modifier.name",
  "casus_belli.name",
  "war_goal.name",
  "agreement_preset.name",
  "bombardment_stance.name",
  "archaeological_site_type.name",
]);

/**
 * Fields the emitter can lower but that review has decided not to emit, with
 * the reason.
 *
 * Everything the emitter can lower is emitted, so this is the only way to keep
 * a field out of the authoring surface deliberately. It should stay nearly
 * empty: a field the emitter cannot lower is detected mechanically and belongs
 * in no list, and a field whose lowered type is wrong is better fixed than
 * hidden.
 */
export const CONTENT_DECLINED_FIELDS = new Map<string, string>([]);

export type ContentFieldShape =
  | "value"
  | "valueList"
  | "trigger"
  | "effect"
  | "economicResources"
  | "triggeredModifierBlock"
  | "modifierBlock"
  | "weightBlock"
  /**
   * Same runtime shape as `weightBlock` — `WeightBlockWithLoc<S>`, a
   * `WeightBlock` whose `Modifier` rows require `desc` — for
   * `modifier_rule_with_loc` splices, which the CWT source comment calls
   * "deliberately more restrictive because of what we can make good
   * tooltips with" than plain `modifier_rule`.
   */
  | "weightBlockWithLoc"
  /**
   * An anonymous block with no identity: `text = { trigger = { ... } }`
   * written N times, or a single fixed-shape block like
   * `forbidden_peace_offers = { demand_surrender = ... }`. Inferred from CWT
   * block structure like `economicResources`; requestable explicitly only
   * when the heuristic needs an assist.
   */
  | "struct"
  /**
   * A named, ordered collection whose name is both identity and localisation
   * key — the same distinction `name_field` draws for top-level registries,
   * one level down. See docs/roadmap.md's "Repeated-struct field shape".
   */
  | "repeatedStruct"
  /**
   * A block of `<weight> = <event>` rows under computed integer keys
   * (`random_events = { 100 = my_event.1  20 = 0 }`), with `0` as the
   * nothing-happens arm. The computed key is invisible to the ordinary field
   * model, so the shape must be requested.
   */
  | "weightedEvents"
  /**
   * A map keyed by engine names rather than by ids the mod invents:
   * `section_slots = { mid = { locator = ... } }`, from CWT's
   * `{ scalar = { ... } }`.
   *
   * CWT spells this identically to `repeatedStruct`'s "container" keying, and
   * the rules carry nothing that separates them — which is exactly why the
   * shape must be requested. The distinction is semantic and decided here,
   * once: a `stages` key is an id the mod owns, prefixed and localised, while
   * a `section_slots` key is `mid`, `bow`, or the integer `1`, a name the
   * engine and the ship models already agree on and that section templates
   * reference by `slot = "mid"`. Requesting `repeatedStruct` for one of these
   * would prefix `mid` out of existence and let JS reorder the numeric keys.
   */
  | "structMap"
  /**
   * The scalar-valued form of `structMap`: `min_upgrade_cost = { alloys = 20 }`
   * from CWT's `{ <resource> = float }`. Also the shape behind
   * `civic_or_origin.leader_background_job_weight` (`{ <job> = int }`).
   *
   * Computed keys are invisible to the ordinary field model, the same reason
   * `weightedEvents` must be requested.
   */
  | "scalarMap"
  /**
   * A field spliced from a non-trigger/effect CWT alias category emitted by
   * `emit/alias-struct.ts` — `government_trigger` is the only consumer so
   * far. Unlike the pure-splice categories `spliceCategory` finds on its own
   * (`trigger`, `effect`, `modifier_rule`), the category here sits alongside
   * ordinary named siblings (`potential = { text? always? alias_name[...] }`),
   * the same "combinator" shape the category's own self-recursive members
   * use — so the field lowers to that category's shared `<Name>Block`
   * interface rather than being auto-detected.
   */
  | "aliasStruct";

export interface ContentFieldOverride {
  /** Omitted when the row only renames the authoring member. */
  readonly shape?: ContentFieldShape;
  readonly quoted?: boolean;
  /** The alias category to splice in, when `shape` is `"aliasStruct"`. */
  readonly category?: string;
  /**
   * The scope this field's closures run in, when CWT declares none and the
   * mechanical fallback is wrong.
   *
   * An unannotated field lowers to `Trigger<ScopeName>` / `ModifierClosure<ScopeName>`
   * — "valid in every scope" — which is right when the scope genuinely varies
   * (a decision's own scope depends on its category) and wrong when the scope
   * is fixed but simply unannotated. The wrong case is invisible to the corpus
   * gate, which only checks whether a field is *present*, so it has to be
   * caught by reading real definitions.
   *
   * This asserts game semantics the rules do not state, so a row needs the
   * evidence in its reason, not a guess. An unknown scope name fails codegen
   * rather than silently widening.
   */
  readonly scope?: string;
  /**
   * Asserts that the key is written at most once, where CWT's cardinality says
   * otherwise and the corpus proves it wrong.
   *
   * `## cardinality = 0..inf` on a bare `bool` lowers to `boolean[]` — a field
   * whose only sensible authoring is one flag. Like {@link scope}, this states
   * game semantics the rules get wrong, so a row needs evidence: the arity
   * mismatches shape conformance reports are that evidence, and a row here
   * without one is a guess.
   */
  readonly arity?: "single";
  /**
   * Authoring member name, when the mechanically derived one collides with a
   * localisation slot: `desc = { trigger text }` (the repeated block form of
   * the `desc` key) is a different thing from the `desc` flavor-text member
   * the localisation table claims, and both must stay authorable.
   */
  readonly member?: string;
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
    "building.desc",
    {
      member: "conditionalDesc",
      reason:
        "The `desc` key's repeated trigger+text block form; the derived member collides with " +
        "the `desc` flavor-text localisation slot, and `triggeredDesc` is already the building's " +
        "own distinct triggered_desc key.",
    },
  ],
  [
    "tradition_category.desc",
    {
      member: "conditionalDesc",
      reason:
        "The `desc` key's repeated trigger+text block form; the derived member collides with " +
        "the `desc` flavor-text localisation slot. Named like building.desc for consistency.",
    },
  ],
  [
    "situation_type.desc",
    {
      shape: "struct",
      member: "conditionalDesc",
      reason:
        "The `desc` key's repeated trigger+text block form; the derived member collides with " +
        "the `desc` flavor-text localisation slot. Named like building.desc for consistency. " +
        "Unlike building's, situations' `desc` is also declared as a bare localisation scalar, " +
        "which the localisation slot already covers — the struct shape pins the block form so " +
        "first-wins picking cannot resurface the redundant scalar.",
    },
  ],
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
    "tradition.tradition_swap",
    {
      shape: "repeatedStruct",
      reason:
        "A tradition swap is a repeated-struct field: a named, ordered collection whose name " +
        "(name_field, one level down) is both identity and localization key.",
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
    "ascension_perk.tradition_swap",
    {
      shape: "repeatedStruct",
      reason:
        "An ascension perk swap is a repeated-struct field: a named, ordered collection whose " +
        "name (name_field, one level down) is both identity and localization key.",
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
    "decision.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "job.auto_generate_description",
    {
      arity: "single",
      reason:
        "CWT declares `cardinality = 0..inf` on a bare bool, which lowers to a nonsensical " +
        "`boolean[]`. All three shipped jobs that set it write one scalar `no`, and a repeated " +
        "flag would mean nothing to the game — an upstream authoring quirk, not a list field.",
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
    "casus_belli.proxy_war_resources",
    {
      shape: "economicResources",
      reason:
        "Same category-plus-economic_template-splice shape as job.resources, repeated 0..inf.",
    },
  ],
  [
    "situation_type.on_monthly.random_events",
    {
      shape: "weightedEvents",
      reason:
        "`int = <event.scopeless>` / `int = <event.situation>` computed keys: each row is a " +
        "weight keyed to the event it fires, `0` the nothing-happens arm — the shape situations " +
        "drive their monthly narrative with.",
    },
  ],
  [
    "situation_type.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "situation_type.target_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "situation_type.triggered_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_situation_clause combines a potential trigger with an open " +
        "modifier-name map, the same shape as the ordinary triggered_modifier_clause.",
    },
  ],
  [
    "situation_type.triggered_target_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_situation_clause combines a potential trigger with an open " +
        "modifier-name map, the same shape as the ordinary triggered_modifier_clause.",
    },
  ],
  [
    "situation_type.stages",
    {
      shape: "repeatedStruct",
      reason:
        "A keyed container (`stages = { stage_1 = { ... } } `): a named, ordered collection whose " +
        "key is both identity and localization key, per 99_README_SITUATIONS.txt.",
    },
  ],
  [
    "situation_type.approach",
    {
      shape: "repeatedStruct",
      reason:
        "Repeated siblings carrying a name field (`approach = { name = approach_a ... }`), the " +
        "same shape tradition_swap already exercises.",
    },
  ],
  [
    "civic_or_origin.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "civic_or_origin.multiply_by_habitability_effect_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "civic_or_origin.swap_type.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "civic_or_origin.potential",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "`potential = { text? always? alias_name[government_trigger] }` is the same " +
        "text/always-plus-splice shape government_trigger's own OR/AND/limit combinators use, " +
        "so it lowers onto the shared GovernmentTriggerBlock rather than a Trigger — the game " +
        "reads this as the requirements DSL, not a script condition tree.",
    },
  ],
  [
    "civic_or_origin.possible",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "Same shape and justification as civic_or_origin.potential — `possible` is the other " +
        "government_trigger consumer governments.cwt declares alongside it.",
    },
  ],
  [
    "civic_or_origin.leader_background_job_weight",
    {
      shape: "scalarMap",
      reason:
        "`{ <job> = int }` — a job-keyed weight map. Left on the machinery backlog when the " +
        "registry landed; ship_size.min_upgrade_cost is the same shape, so the second consumer " +
        "is what made a generic scalarMap worth building.",
    },
  ],
  [
    "ship_size.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "ship_size.ship_modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "ship_size.resources",
    {
      shape: "economicResources",
      reason: "Same category-plus-economic_template-splice shape as job.resources.",
    },
  ],
  [
    "ship_size.space_fauna_values.culling_value",
    {
      shape: "economicResources",
      reason:
        "The same economic block one level down, inside the space_fauna_values struct — " +
        "repeated 0..inf rather than singular.",
    },
  ],
  [
    "ship_size.section_slots",
    {
      shape: "structMap",
      reason:
        "The keys are engine names, not ids this mod owns: vanilla writes `mid`, `bow`, " +
        "`core`, `stern` and the integers 1-6, ship models expose them as locators, and " +
        'section templates reference them by `slot = "mid"`. Identical in CWT to a ' +
        "repeatedStruct container, which is why the distinction has to be declared here — " +
        "prefixing `mid` would break every reference to it. Slot order also carries no " +
        "meaning, unlike a situation's stages, so a Record is safe despite JS ordering " +
        "integer-like keys ahead of the rest.",
    },
  ],
  [
    "country_ship_of_size_limit.show",
    {
      scope: "country",
      reason:
        "CWT annotates no scope, so the mechanical reading is `Trigger<ScopeName>` — valid in " +
        "every scope — and the field is required, so every definition must carry one. All 7 " +
        "shipped entries write a country condition there (`has_technology`, `has_origin`), none " +
        "of which satisfies that type, and the field controls the country's naval-capacity " +
        "tooltip on a registry named country_ship_of_size_limit. Without this the field is " +
        "emitted but can hold nothing any real definition writes.",
    },
  ],
  [
    "ship_size.min_upgrade_cost",
    {
      shape: "scalarMap",
      reason:
        "`{ <resource> = float }` — a resource-keyed cost map, the same shape as " +
        "civic_or_origin.leader_background_job_weight.",
    },
  ],
  [
    "section_template.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "section_template.modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields. Vanilla " +
        "never writes this field, but the rules declare it authorable.",
    },
  ],
  [
    "section_template.ship_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields. Vanilla " +
        "never writes this field, but the rules declare it authorable.",
    },
  ],
  [
    "species_class.modifier",
    {
      shape: "modifierBlock",
      reason: "modifier_clause is an open modifier-name map with optional ancillary fields.",
    },
  ],
  [
    "species_class.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics.",
    },
  ],
  [
    "species_class.possible",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "`possible = { text? always? alias_name[government_trigger] }` is the same shape SDK-3 " +
        "landed for civic_or_origin.potential/.possible, so it lowers onto the shared " +
        "GovernmentTriggerBlock rather than a Trigger — the game reads this as the requirements " +
        "DSL against empire setup (species_class.possible gates country-scoped citizenship), not " +
        "a script condition tree.",
    },
  ],
  [
    "species_class.possible_secondary",
    {
      shape: "aliasStruct",
      category: "government_trigger",
      reason:
        "Same shape and justification as species_class.possible — possible_secondary is the " +
        "other government_trigger consumer species_consolidated.cwt declares alongside it.",
    },
  ],
]);

export interface RepeatedStructDefinition {
  readonly typeName: string;
  /**
   * "siblings" (shape 2 — `approach = { name = approach_a ... }` repeated):
   * the record key is written into `identityKey` inside each sibling block.
   * "container" (shape 1 — `stages = { stage_1 = { ... } }`): the record key
   * IS the inner block's key, and `identityKey` is unused. Defaults to
   * "siblings".
   */
  readonly keying?: "siblings" | "container";
  /** Required when `keying` is "siblings" (the default); unused for "container". */
  readonly identityKey?: string;
  /**
   * The vendored `type[...]` carrying the identity's localisation patterns
   * (`swapped_tradition` for `tradition.tradition_swap`). Omit when CWT
   * declares no such type — situations' `stages` and `approach` only type the
   * identity value itself as `localisation` inline — and the emitter falls
   * back to the same `$` required / `$_desc` optional convention those
   * vendored types themselves use.
   */
  readonly localisationType?: string;
}

export const REPEATED_STRUCT_DEFINITIONS = new Map<string, RepeatedStructDefinition>([
  [
    "tradition.tradition_swap",
    {
      typeName: "TraditionSwap",
      identityKey: "name",
      localisationType: "swapped_tradition",
    },
  ],
  [
    "ascension_perk.tradition_swap",
    {
      typeName: "AscensionPerkSwap",
      identityKey: "name",
      localisationType: "swapped_ascension_perk",
    },
  ],
  [
    "situation_type.stages",
    {
      typeName: "SituationStage",
      keying: "container",
    },
  ],
  [
    "situation_type.approach",
    {
      typeName: "SituationApproach",
      identityKey: "name",
    },
  ],
]);

export const REPEATED_STRUCT_FIELD_OVERRIDES = new Map<string, ContentFieldOverride>([
  [
    "tradition.tradition_swap.modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as its parent.",
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
    "situation_type.stages.modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as the top level's.",
    },
  ],
  [
    "situation_type.stages.target_modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as the top level's.",
    },
  ],
  [
    "situation_type.stages.triggered_modifier",
    {
      shape: "triggeredModifierBlock",
      reason: "Nested triggered_modifier_by_situation_clause is the same shape as the top level's.",
    },
  ],
  [
    "situation_type.stages.triggered_target_modifier",
    {
      shape: "triggeredModifierBlock",
      reason: "Nested triggered_modifier_by_situation_clause is the same shape as the top level's.",
    },
  ],
  [
    "situation_type.approach.modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as the top level's.",
    },
  ],
  [
    "situation_type.approach.target_modifier",
    {
      shape: "modifierBlock",
      reason: "Nested modifier_clause is the same open modifier-name map as the top level's.",
    },
  ],
  [
    "situation_type.approach.triggered_modifier",
    {
      shape: "triggeredModifierBlock",
      reason: "Nested triggered_modifier_by_situation_clause is the same shape as the top level's.",
    },
  ],
  [
    "situation_type.approach.triggered_target_modifier",
    {
      shape: "triggeredModifierBlock",
      reason: "Nested triggered_modifier_by_situation_clause is the same shape as the top level's.",
    },
  ],
  [
    "situation_type.approach.resources",
    {
      shape: "economicResources",
      reason:
        "economic_template is an open resource-name map nested under cost/produces/upkeep/logistics, " +
        "the same shape as job.resources.",
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
