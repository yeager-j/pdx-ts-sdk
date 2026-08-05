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
 *
 * `hidden_trigger` is here for a plainer reason — it is declared in
 * `scope_links.cwt`, which this generator does not load *because* that file
 * also declares the combinators above. It shares their shape (a flat splice
 * that changes no scope), so `src/script/triggers.ts` writes it beside them, and
 * `hidden_effect` sits in HAND_WRITTEN_EFFECTS for the same reason. Both
 * appear in the drift baseline as documented-but-unruled, which is exactly
 * what they are.
 *
 * `current_situation_approach`, `current_stage`, and
 * `can_set_situation_approach` are here for a third reason (SDK-52): each is
 * an ordinary leaf condition — the rules describe it correctly, and a
 * mechanical `(value: SituationApproach | SituationStage): Trigger<"situation">`
 * would be a faithful reading — but the SDK's own `SituationTrigger` return
 * type (a `Trigger<"situation">` carrying the literal id as an optional
 * phantom brand, `src/script/triggers.ts`) is checked against `defineSituationType`'s
 * own declared `approach`/`stages` keys, a contract the rules have no way to
 * express. Skip-listing here keeps generation and the hand-written override in
 * `src/script/triggers.ts` from disagreeing about which one is the real export: only
 * the hand-written module ever supplies these three names now.
 */
export const HAND_WRITTEN_TRIGGERS = new Set([
  "and",
  "or",
  "not",
  "nand",
  "nor",
  "hidden_trigger",
  "current_situation_approach",
  "current_stage",
  "can_set_situation_approach",
]);

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
 * cannot type yet. All live in `src/script/effects/types.ts` as `StructuralEffects`.
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
  "hidden_effect",
]);

/**
 * The method names `src/script/effects/recorder.ts` hand-writes onto the scope
 * interfaces — `StructuralEffects` plus per-scope augmentations such as the
 * author-asserted `target` link. The scope-link pass must not emit a method by
 * any of these names: the generated interface member would merge with (or
 * shadow) the structural one and the runtime Proxy would dispatch the wrong
 * table. Update this list together with the `STRUCTURAL` table.
 */
export const STRUCTURAL_EFFECT_METHODS = new Set([
  "if",
  "target",
  "hiddenEffect",
  "randomList",
  "lockedRandomList",
  "random",
  "whileLoop",
  "saveEventTargetAs",
  "saveGlobalEventTargetAs",
  "addResource",
  "run",
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
 * Registries whose `defineX` is re-exported from `src/content/situations.ts` instead of
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
        "(src/script/effects/situations.ts). The rules declare that contract nowhere, so no " +
        "mechanical definer " +
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
  [
    "planet_initializer",
    "The planet grammar `solar_system_initializer` splices unkeyed at its own top " +
      "level. One member, `planet`, whose declaration is a block that splices " +
      "`planet_initializer` and `moon_initializer` back into itself — so a system's " +
      "planets are anonymous, ordered and repeated, and nest without bound. Emitted " +
      "by emit/alias-splice.ts as `PlanetInitializerFields`, whose field table has to " +
      "be resolved through `registerAliasStructFields` at write time because it " +
      "refers to itself.",
  ],
  [
    "moon_initializer",
    "The moon half of the same grammar, spliced from inside `planet` and from inside " +
      "itself. One member, `moon`. Kept separate because CWT declares it separately, " +
      "and because a moon admits a strictly smaller body — no `namelist`, no " +
      "`satellite_naming_policy`, and no nested `planet`.",
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

export interface ConditionalLocalisation {
  /** The sibling boolean member that waives the slot when `true`. */
  readonly unless: string;
  readonly reason: string;
}

/**
 * Localisation slots the rules require *unless* the definition opts out —
 * distinct from {@link REQUIRED_LOCALISATION}'s always-on rows because a flat
 * `required: true` would reject every definition that legitimately omits the
 * slot.
 *
 * `swapped_tradition`/`swapped_ascension_perk` (traditions.cwt:14-46,
 * ascension_perks.cwt:15-...) declare `name = "$"` inside
 * `subtype[not_inheriting_name]`, which `cwt/rules.ts`'s `readLocalisation`
 * flattens away — it recurses into every `subtype[...]` and drops which one a
 * slot came from, the same way ordinary field flattening drops which subtype a
 * field came from (see `ship_size.modifier`'s overlay row). CWT's own
 * `## required` marker never applies here regardless, since the requirement
 * is conditional rather than unconditional. A real-install sweep of every
 * shipped `tradition_swap` found 131 of 195 blocks in the requiring subtype
 * (no `inherit_name = yes`), all 131 carrying a `name`; the same sweep found
 * 6 of 9 shipped ascension-perk swaps in the requiring subtype, all 6 naming
 * themselves. Nothing in the corpus omits the slot while requiring it, but
 * the SDK's own writer emits a raw key straight to the game with no warning
 * if an author does, which is the failure this row closes off.
 *
 * The key names the vendored localisation type carrying the slot
 * (`swapped_tradition`, `swapped_ascension_perk`) rather than the owning
 * registry, because that is what `content-type.ts`'s `localisationMembers`/
 * `localisationMetadata` are keyed on for a repeated-struct field's own
 * `type[...]`.
 */
export const CONDITIONALLY_REQUIRED_LOCALISATION = new Map<string, ConditionalLocalisation>([
  [
    "swapped_tradition.name",
    {
      unless: "inheritName",
      reason:
        "traditions.cwt's type[swapped_tradition] requires name unless " +
        "subtype[not_inheriting_name] does not apply, i.e. unless inherit_name = yes.",
    },
  ],
  [
    "swapped_ascension_perk.name",
    {
      unless: "inheritName",
      reason:
        "ascension_perks.cwt's type[swapped_ascension_perk] requires name unless " +
        "subtype[not_inheriting_name] does not apply, i.e. unless inherit_name = yes — the same " +
        "shape as swapped_tradition.name.",
    },
  ],
]);

export interface SyntheticLocalisation {
  /** The `$`-bearing pattern to synthesize, e.g. `"$_desc"`. */
  readonly pattern: string;
  /**
   * The renamed raw-key body member (a `CONTENT_FIELD_OVERRIDES` `member`)
   * that the vendored rules' bare pointer (`desc = desc`) actually reads at
   * runtime. A synthetic slot only gives an author a real text-authoring
   * path; the game still resolves the display text through that pointer, so
   * `ContentAuthoring.define` sets this member to the synthesized slot's
   * computed key whenever the slot's text is present and the author has not
   * already written the pointer themselves — otherwise the text lands in
   * localisation with nothing in the definition body pointing at it, the
   * same silent failure this whole table exists to close.
   */
  readonly pointerMember: string;
  readonly reason: string;
}

/**
 * A localisation slot the rules never declare at all, added because the
 * registry needs the same real, auto-keyed authoring path a sibling registry
 * gets for free from the rules.
 *
 * `archaeological_site_type` is the case this exists for (SDK-50).
 * `type[archaeological_site_type].localisation` (archaeology.cwt:5-8) declares
 * only `name = "$"` and `desc = desc` — a bare pointer with no `$`, meaning
 * `planLocalisation` excludes it outright (same rule SDK-44's `name = name`
 * fix relies on) and the registry ends up with *no* slot where an author can
 * write real flavor text and get a generated key. The body's own `desc` field
 * (`archaeology.cwt:44`, dual with the `triggered_desc_clause` block form,
 * renamed to `conditionalDesc` by the `CONTENT_FIELD_OVERRIDES` row beside
 * this one) is `conversion: "identity"` either way its dual resolves — a raw
 * key, never auto-generated — so writing English into it is accepted and
 * silently wrong: no warning, no error, the game shows the literal string.
 * `situation_type`, by contrast, needs no such row: situations.cwt:17 already
 * declares `desc = "$_desc"` *alongside* the same bare `desc = desc` pointer
 * (:18), so the real slot already exists there and the pointer simply loses
 * the member-name collision — evidence this is a genuine asymmetry in the
 * vendored rules, not a design position the SDK is second-guessing.
 *
 * A row here does not claim the game reads a `<id>_desc` key today — it adds
 * one, matching the convention every other `desc`-bearing registry in
 * {@link REQUIRED_LOCALISATION}'s neighborhood already follows, and gives
 * `conditionalDesc`'s raw-key arms (the top-level scalar and
 * `ArchaeologicalSiteTypeDesc.text`) a genuine optional escape hatch instead
 * of being the only route.
 *
 * A generated key is only half the fix: `type[archaeological_site_type]`
 * reads that text through the body's own `desc` pointer (renamed
 * `conditionalDesc`, per the `CONTENT_FIELD_OVERRIDES` row beside this one),
 * so a definition that sets only the synthetic `desc` member and never
 * touches `conditionalDesc` would populate the `.yml` with real text and
 * emit no `desc = <id>_desc` anywhere in its own body — reachable nowhere in
 * game, the identical silent failure this table exists to close, one step
 * removed. `pointerMember` is what closes that: `ContentAuthoring.define`
 * defaults it to the synthesized key whenever the text member is set and the
 * author has not written the pointer themselves.
 */
export const SYNTHETIC_LOCALISATION = new Map<string, SyntheticLocalisation>([
  [
    "archaeological_site_type.desc",
    {
      pattern: "$_desc",
      pointerMember: "conditionalDesc",
      reason:
        "archaeology.cwt declares no `$`-bearing pattern for desc at all (only the excluded " +
        'bare pointer `desc = desc`), unlike situation_type\'s `desc = "$_desc"` sitting beside ' +
        "its own identical pointer — so archaeological_site_type has no real flavor-text slot " +
        "without this row. See SDK-50.",
    },
  ],
]);

/**
 * Fields the emitter can lower but that review has decided not to emit, with
 * the reason.
 *
 * Everything the emitter can lower is emitted, so this is the only way to keep
 * a field out of the authoring surface deliberately. It should stay nearly
 * empty: a field the emitter cannot lower is detected mechanically and belongs
 * in no list, and a field whose lowered type is wrong is better fixed than
 * hidden. That bar does not cover every row that could ever land here —
 * `change_orbit` (SDK-30) is the one case it was never meant to: not a field
 * whose *lowered shape* is wrong, but a second spelling of a capability the
 * SDK already emits correctly (see the entry below), so declining it
 * withholds nothing an author cannot already do. A future row needs the same
 * property — a genuine second spelling of existing capability, not a
 * shape the emitter merely lowers badly — to clear this bar.
 */
export const CONTENT_DECLINED_FIELDS = new Map<string, string>([
  [
    "solar_system_initializer.change_orbit",
    "At the top level, change_orbit is positional sugar: written between two `planet` blocks, " +
      "it advances the orbit cursor for the planets that follow it, so its position among them " +
      "is the geometry. `changeOrbit?: number[]` collects every value into one array field with " +
      "one fixed emission slot, which cannot represent that position — 288 of 355 shipped " +
      "top-level initializer blocks interleave `change_orbit` between `planet` blocks, and the " +
      "SDK silently emitted every one of them after every planet, where none of them shift " +
      'anything. Nothing is lost by declining it: `class: "none", orbitDistance: n` on the ' +
      "next `planet` block (a real `PlanetInitializerFields`, `none` is in `SolarSysInitPlanetClass`) " +
      "already types and emits the same geometry, in the position that matters, with no runtime " +
      "shape needed for a spelling the game already documents as sugar.",
  ],
  [
    "planet_initializer.change_orbit",
    "The moon-level twin of the row above, inside one planet's own `moon` list: " +
      "`alias[planet_initializer:planet]`'s own change_orbit (cardinality 0..1, singular — at " +
      "most one cursor jump per planet, unlike the top level's repeatable one) advances the " +
      "orbit cursor for the moons that follow it within that planet, so where it is *written* " +
      "among that planet's `moon` blocks is still the geometry, same as the top level. " +
      "`changeOrbit?: number` collapses it to one fixed-position field just the same. The long " +
      'form (`class: "none", orbitDistance: n` on the next `moon` block) already types and ' +
      "emits it correctly positioned.",
  ],
  [
    "moon_initializer.change_orbit",
    "The same field one level further down, inside a moon's own nested `moon` list (moons nest " +
      "without bound per EXTRA_ALIAS_CATEGORIES). `alias[moon_initializer:moon]`'s own " +
      "change_orbit is the identical singular, positional-sugar shape as " +
      "`planet_initializer.change_orbit` above, declined for the same reason.",
  ],
]);

export interface ContentScopeParameter {
  /** Every scope a definition may declare, canonical names. */
  readonly scopes: readonly string[];
  /** The scope a definition that declares none runs in. */
  readonly fallback: string;
  readonly reason: string;
}

/**
 * Registries whose unpinned field scopes are a property of the *definition*
 * rather than a constant the rules could state.
 *
 * The `scope` assertion fixes a field CWT failed to annotate. This is the case
 * where CWT annotates `this = any` and is **right**: a decision taken on a
 * nomadic ship colony really is ship-scoped and one taken on a planet really is
 * planet-scoped, and the rules say so in a comment. The trouble is that
 * `Trigger<S>` is contravariant, so "valid in every scope" as a field type
 * admits only rules legal in every scope — leaving the field emitted, required,
 * and unfillable. See `docs/roadmap.md`'s "Per-definition field scopes".
 *
 * A row turns every field the registry left unpinned into `Trigger<NoInfer<S>>`
 * and adds one authoring member, `scope`, that names S and emits nothing. It
 * also introduces a public `<Registry>Scope` union, which has to be re-exported
 * from `src/index.ts` by hand — nothing else makes a consumer able to name the
 * type its own helpers need. It needs the same evidence a `scope` assertion does — the scopes listed are the
 * ones real definitions are written against, and shape conformance checks that
 * the set covers what the corpus writes rather than taking the row's word.
 */
export const CONTENT_SCOPE_PARAMETERS = new Map<string, ContentScopeParameter>([
  [
    "decision",
    {
      scopes: ["planet", "ship"],
      fallback: "planet",
      reason:
        "decisions.cwt annotates the body `this = any` and explains why: on a nomadic ship " +
        "colony a decision is ship-scoped, on a planet planet-scoped. Every non-universal " +
        "condition across all 111 shipped decisions is planet-valid — none writes a country-only " +
        "condition directly, they navigate through `owner` — so `planet` is the fallback and " +
        "`ship` the case that has to be declared.",
    },
  ],
]);

export type ContentFieldShape =
  | "value"
  | "valueList"
  | "trigger"
  | "effect"
  | "economicResources"
  /**
   * The same `economicResources` shape, minus the `produces` arm — for a
   * field CWT splices from `economic_template_no_produce` rather than plain
   * `economic_template`. Lowers to `EconomicResourceBlockNoProduce<S>`
   * (`Omit<EconomicResourceBlock<S>, "produces">`) and the writer iterates a
   * `produces`-free operation list, so the illegal arm is unwritable and
   * unemittable rather than merely undocumented.
   *
   * `economic_template_no_produce` is spliced at three sites in the vendored
   * rules: `weapon_component_template` and `strike_craft_component_template`
   * (`components.cwt:189`, `:338`), and `espionage_operation.resources`
   * (`espionage.cwt:113`, not yet an exposed registry) — genuinely reusable,
   * not a two-registry special case.
   */
  | "economicResourcesNoProduce"
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
   * A trigger or weight-block field CWT annotates with no scope lowers to
   * `Trigger<never>` / `WeightBlock<never>` — unchecked, since `Trigger<in S>`
   * is contravariant and `never` is the top of that lattice — which is right
   * when the scope genuinely varies (a decision's own scope depends on its
   * category, see `CONTENT_SCOPE_PARAMETERS`) and leaves real checking on the
   * table when the scope is fixed but simply unannotated. A `scope` row here
   * buys that checking back for one field. `ModifierClosure` fields keep the
   * separate `ScopeName` sentinel `emit/fields.ts`'s `contravariantScopeType`
   * does not touch, since an unpinned modifier closure already resolves to a
   * real, writable recorder.
   *
   * This asserts game semantics the rules do not state, so a row needs the
   * evidence in its reason, not a guess: shape conformance's `scope` mismatch
   * kind (`corpus.ts`) walks every real definition's keys under this field and
   * reports any the asserted scope rejects. An unknown scope name fails
   * codegen rather than silently widening.
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
    "archaeological_site_type.desc",
    {
      member: "conditionalDesc",
      reason:
        "The dual of the bare identity-conversion scalar and the desc key's repeated " +
        "trigger+text block form (both raw-key arms, archaeology.cwt:44+48); renamed so it does " +
        "not collide with the desc flavor-text localisation slot SYNTHETIC_LOCALISATION adds " +
        "(SDK-50). Named like building.desc for consistency.",
    },
  ],
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
    "building.triggered_planet_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map " +
        "(buildings.cwt:227). Found via the SDK-39 sweep: 672 shipped buildings write this key " +
        "and the row was missing, so the writer silently dropped it. building's sibling triggered_* " +
        "fields (triggered_planet_pop_group_modifier_for_species/_for_all, triggered_country_modifier, " +
        "triggered_army_modifier) splice the by_pop_group/by_planet clause variants instead of plain " +
        "triggered_modifier_clause; SDK-56 gives all four their own rows below, each against its " +
        "own clause — SDK-56's initial evidence sweep missed for_species (it credited the row to " +
        "job.triggered_planet_pop_group_modifier_for_species, a different registry with the same " +
        "field name), caught in review and folded in rather than left for another follow-up.",
    },
  ],
  [
    "building.triggered_planet_pop_group_modifier_for_species",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_pop_group_clause (aliases.cwt:73) is the pop_group-scoped variant " +
        "of triggered_modifier_clause — identical potential/modifier/description/mult/multiplier " +
        "template, plus one field (divide_over_pop_groups) TriggeredModifier does not model — the " +
        "same clause and the same shape job.triggered_planet_pop_group_modifier_for_species " +
        "(SDK-39) already uses for that trade. SDK-56: 2 shipped buildings write this key " +
        "(both in building_clone_army_clone_vat, common/buildings/01_pop_assembly_buildings.txt) " +
        "and the row was missing, so the writer silently dropped it in full. Neither shipped use " +
        "writes divide_over_pop_groups, so reusing triggeredModifierBlock here drops nothing real " +
        "yet — same as the job row's own justification — but the field stays unauthorable if a " +
        "future building ever does write it. Checked separately for the potential-vs-modifier " +
        "scope split a bug bash caught on the sibling by_planet_clause rows below: this field's own " +
        "`## replace_scopes = { this = pop_group root = pop_group }` (buildings.cwt:220-221) happens " +
        "to equal by_pop_group_clause's own `potential` push_scope (pop_group, aliases.cwt:74) — so " +
        'TriggeredModifier<"pop_group"> is correct for both halves here. That equality is not ' +
        "structural to the clause: common/specimens.cwt:37 splices the same by_pop_group_clause " +
        "under a field named triggered_country_modifier, which would NOT get a free pass the way " +
        "this one does. Re-check this note if this field's own replace_scopes ever changes.",
    },
  ],
  [
    "building.country_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(buildings.cwt:212), the same shape building.planet_modifier already uses. SDK-56: 35 " +
        "shipped buildings write this key and the row was missing, so the writer silently " +
        "dropped it.",
    },
  ],
  [
    "building.army_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(buildings.cwt:215), the same shape building.planet_modifier/country_modifier already " +
        "use. SDK-56: zero shipped buildings write this key, but the modifierBlock shape is " +
        "already corpus-proven via those siblings on the same registry splicing the identical " +
        "clause, and leaving a mechanically identical field silently unauthorable is the exact " +
        "defect this ticket closes for its sibling fields — added for consistency rather than " +
        "declined for lack of its own precedent.",
    },
  ],
  [
    "building.system_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(buildings.cwt:218), the same shape building.planet_modifier/country_modifier already " +
        "use. SDK-56: 1 shipped building writes this key and the row was missing, so the writer " +
        "silently dropped it.",
    },
  ],
  [
    "building.triggered_planet_pop_group_modifier_for_all",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_planet_clause (aliases.cwt:113) reuses building.triggered_planet_modifier's " +
        "triggeredModifierBlock shape (buildings.cwt:224). SDK-56: 5 shipped buildings write this " +
        "key and the row was missing, so the writer silently dropped it. KNOWN MIS-SCOPED " +
        "POTENTIAL, caught in bug-bash review (not fixed here — see triggered_country_modifier's " +
        "reason below for the full account): by_planet_clause's own `potential` field carries " +
        "`## push_scope = planet` (aliases.cwt:114-115), while this field's own " +
        "`## replace_scopes = { this = pop_group root = pop_group }` (buildings.cwt:223-224) governs " +
        'the modifier half. TriggeredModifier<"pop_group"> gives both halves the field\'s pop_group ' +
        "scope, which is right for `modifiers` and wrong for `when`: `when` should type as " +
        'Trigger<"planet">, matching the planet the building sits on, not the pop_group the ' +
        "modifier targets.",
    },
  ],
  [
    "building.triggered_country_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_planet_clause (aliases.cwt:113) reuses building.triggered_planet_modifier's " +
        "triggeredModifierBlock shape (buildings.cwt:230). SDK-56: 114 shipped buildings write this " +
        "key — the largest single silently-dropped field the sweep found — and the row was missing, " +
        "so the writer silently dropped it in full.\n\n" +
        "KNOWN MIS-SCOPED POTENTIAL, caught in bug-bash review and left unfixed pending a dedicated " +
        "follow-up (filed separately; not built into this seven-row overlay PR). " +
        "triggered_modifier_by_planet_clause's own `potential` field carries `## push_scope = planet` " +
        "(aliases.cwt:114-115), independent of whatever scope the splicing field itself declares. " +
        "This field's own `## replace_scopes = { this = country root = country }` " +
        "(buildings.cwt:229-230) governs the *modifier* half correctly (country is right: 114 real " +
        "buildings write country-scoped modifier names here). But TriggeredModifierBlock's single " +
        'scope parameter also gives `when` that same "country" scope, when the rules say `when` ' +
        'runs at "planet" (the planet the building sits on) instead. In practice: a real, ' +
        "game-legal potential like `isCapital()` (planet/colony-scoped) is REJECTED by the current " +
        '`TriggeredModifier<"country">` type, while a country-only condition like `hasAuthority(...)` ' +
        "is ACCEPTED and would emit a `potential` block the game evaluates in planet scope — silently " +
        "wrong in the accepting direction too, not just the rejecting one. The three building rows " +
        "splicing by_planet_clause (this one, triggered_army_modifier, " +
        "triggered_planet_pop_group_modifier_for_all) all carry this same defect, as does every " +
        "other triggeredModifierBlock row whose splice pushes a different scope onto `potential` " +
        "than its own field declares for the modifier (situation_type's six triggered_modifier / " +
        "triggered_target_modifier rows, pre-existing on main, splice " +
        "triggered_modifier_by_situation_clause the same way). Fixing it needs a second scope " +
        "parameter on the hand-written TriggeredModifier<S> (packages/sdk/src/content.ts) plus new " +
        "emitter capability to resolve a spliced alias's own nested-field scope rather than reusing " +
        "the splicing field's scope wholesale — real, shared-type-touching machinery, not a per-row " +
        "assertion, and out of scope for this PR by design.",
    },
  ],
  [
    "building.triggered_army_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_planet_clause (aliases.cwt:113) reuses building.triggered_planet_modifier's " +
        "triggeredModifierBlock shape (buildings.cwt:233). SDK-56: zero shipped buildings write this " +
        "key, but the shape is already corpus-proven via its siblings splicing the identical " +
        "by_planet clause on the same registry — added for consistency rather than declined for " +
        "lack of its own precedent. KNOWN MIS-SCOPED POTENTIAL, the same defect as " +
        "triggered_country_modifier above (see that row's reason for the full account): `when` " +
        'should type as Trigger<"planet"> (aliases.cwt:114-115\'s push_scope on `potential`), not ' +
        'Trigger<"army">, which TriggeredModifier<"army">\'s single scope parameter currently ' +
        "forces on both halves.",
    },
  ],
  [
    "tradition.triggered_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map " +
        "(traditions.cwt:70), the same shape ascension_perk.triggered_modifier already uses. Found " +
        "via SDK-39: the row was missing so the writer silently dropped the field even though 30 " +
        "shipped traditions/swaps write it.",
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
      member: "conditionalDesc",
      reason:
        "The `desc` key's repeated trigger+text block form; the derived member collides with " +
        "the `desc` flavor-text localisation slot. Named like building.desc for consistency. " +
        "Unlike building's, situations' `desc` is also declared as a bare localisation scalar, " +
        "which shipped situations do write — so the field duals, and the row no longer pins the " +
        "block form. It pinned it when first-wins picking could only keep one arm.",
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
    "ship_size.graphical_culture",
    {
      arity: "single",
      reason:
        "Both declarations — the `<graphical_culture>` list and the bare bool — carry " +
        "`cardinality = 0..2`, which reads as `at most one of each form` rather than `write it " +
        "twice`: no shipped ship size writes the key more than once in 263 definitions. Taken " +
        "literally it makes both arms arrays, which is indistinguishable at the authoring member " +
        "and blocks the dual lowering the two declarations exist to produce.",
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
    "job.triggered_planet_pop_group_modifier_for_species",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_by_pop_group_clause (pop_jobs.cwt:205) is the pop_group-scoped " +
        "variant of triggered_modifier_clause: identical potential/modifier/description/mult/" +
        "multiplier template, plus one field (divide_over_pop_groups) TriggeredModifier does not " +
        "model. Found via the SDK-39 sweep: 7 shipped jobs write this key and the row was missing, " +
        "so it was silently dropped in full. Reusing the plain triggeredModifierBlock shape drops " +
        "only divide_over_pop_groups, which zero shipped jobs write.",
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
    "civic_or_origin.swap_type.trigger",
    {
      scope: "country",
      reason:
        "CWT annotates no scope, so the clause lowered to `Trigger<ScopeName>` — legal in every " +
        "scope, therefore writable in none. The rules state the scope in prose instead: " +
        'governments.cwt:403-404 says "In empire creation / galaxy setup, this has no scope. ' +
        'During the game ... it is set to country scope." The corpus agrees — every key the ' +
        "unscoped type rejected (has_civic, has_country_flag, has_origin, has_trait, " +
        "has_valid_civic, is_nomadic) is country-scope. The setup phase's empty scope is not a " +
        "second scope to express: `is_scope_valid` guards it from inside the clause, as " +
        "civic_devouring_swarm does.",
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
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields. Lowers to " +
        'ModifierClosure<"starbase">, the scope of the first-declared arm (ship_sizes.cwt:107-116 ' +
        "declares this field twice, once per mutually exclusive subtype, this=starbase and " +
        "this=ship) — first-declared-wins is a codegen artifact (flatten/mergeByName/pickOrdinary), " +
        "not a claim that starbase is the intended scope. SDK-45 investigated pinning `scope: " +
        '"ship"` instead (the more common case: 278 of 319 shipped ship sizes are !starbase) and ' +
        "found the opposite fix is also wrong by corpus evidence: all 41 starbase-subtype ship " +
        "sizes write starbase-only modifier names (starbase_building_capacity_add and siblings) " +
        'that ModifierClosure<"ship"> cannot express, so `scope: "ship"` would newly break real ' +
        "vanilla content. Neither fixed scope is correct — the field genuinely needs two, selected " +
        "by which subtype the definition declares — and no `CONTENT_FIELD_OVERRIDES.scope` row can " +
        "express that; it needs a subtype-conditional lowering (a `lowerScopeUnion` beside " +
        "`lowerDual`/`lowerScalarUnion` in emit/fields.ts) that does not exist yet. Left unchanged " +
        "pending that work. Also: corpus-conformance's scope-mismatch check only gates fields whose " +
        "`field.clause` is set (trigger/effect shapes), so this mispin is invisible to that gate " +
        "regardless of which scope is pinned here.",
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
    "solar_system_initializer.usage_odds",
    {
      scope: "system",
      reason:
        "CWT annotates no scope on this `alias_name[modifier_rule]` splice, so an unannotated " +
        "reading leaves its `when` rows unchecked. 155 of the 360 shipped `solar_system_initializer` " +
        "definitions write a weighted `usage_odds` with a real condition, every one of them " +
        "system-scoped (`has_star_flag`, `is_fe_cluster`, `is_bottleneck_system`, `has_distar`, " +
        "`is_in_cluster`, `has_leviathans`, plus system-scope iterators like `any_system` and " +
        "`any_neighbor_system`), and the game's own " +
        "common/solar_system_initializers/example.txt:32 comments its own `usage_odds` example " +
        "`# this = galactic_object (star) scope`. `solar_system_initializer` itself has no " +
        "body-level push_scope, unlike sibling registries that splice the same weight-block " +
        "grammar with one, which is why this field alone needs the assertion.",
    },
  ],
  [
    "tradition_category.desc.trigger",
    {
      scope: "country",
      reason:
        "`desc`'s `triggered_desc_clause` splice (aliases.cwt) annotates no scope for its nested " +
        "`trigger` field, and `tradition_category` itself has no body-level push_scope to fall " +
        "back on — unlike `building`, which push_scopes `colony` before splicing the same clause " +
        "for its own `desc`. All 25 shipped tradition categories that write a `desc.trigger` " +
        "condition write a country one (`is_machine_empire`, `is_regular_empire`, " +
        "`is_hive_empire`, `is_gestalt`, `is_nomadic`, `has_void_dweller_origin`), matching the " +
        "sibling `potential` field's explicit `## replace_scopes = { this = country }` two fields " +
        "down in the same type body.",
    },
  ],
  // The four rows below are all one defect, twice per alias category. CWT
  // declares each of these keys as a scalar and as a `{ min max }` block and
  // annotates *both* `cardinality = 0..inf`, so both arms author as arrays,
  // `lowerDual` cannot tell them apart, and the field collapses to whichever
  // arm is declared first. The corpus contradicts that collapse outright, and
  // the repetition CWT claims is one upstream copy-paste per ~2,000 blocks.
  [
    "planet_initializer.orbit_angle",
    {
      arity: "single",
      reason:
        'Collapses to `"random"[]` against 805 of the 1,803 shipped planets that write the ' +
        "`{ min max }` block. Exactly one planet block in 2,031 repeats the key, and it is a " +
        "quirk rather than a list: fallen_empire_initializers.txt's The Preserve writes " +
        "`orbit_angle = { min = 90 max = 270 }` and then `orbit_angle = 60`, contradicting " +
        "itself for the game to resolve last-wins. Same shape as job.auto_generate_description.",
    },
  ],
  [
    "planet_initializer.size",
    {
      arity: "single",
      reason:
        "Collapses to `number[]` against 470 of the 1,337 shipped planets that write " +
        "`{ min max }`. The one block in 2,031 that repeats it — special_system_initializers' " +
        "Hillos B, `size = 15` then `size = { min = 5 max = 10 }` — is the same self-" +
        "contradicting copy-paste, not a planet with two sizes.",
    },
  ],
  [
    "moon_initializer.orbit_angle",
    {
      arity: "single",
      reason:
        "The same declaration one level down, and the corpus leans harder: 417 of the 604 " +
        "shipped moons that set it write the block form. No moon block repeats the key.",
    },
  ],
  [
    "moon_initializer.size",
    {
      arity: "single",
      reason:
        "As planet_initializer.size: 79 of the 358 shipped moons that set it write " +
        "`{ min max }`, and no moon block repeats the key.",
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
  // The three rows below are one finding, once per registry that splices the
  // AI's design-weight grammar. CWT annotates no scope on `ai_weight`, so its
  // `modifier` rows lowered to `Trigger<never>` — writable but unchecked, and
  // measured by the corpus gate as admitting only universally legal
  // conditions. That the silence is an omission rather than a claim is visible
  // in the rules themselves: components.cwt:176-181 carries
  // `## replace_scopes = { root = country this = country }` on
  // `valid_for_country` and nothing at all on the `ai_weight` declared three
  // lines below it. Which scope it omitted is what the corpus settles — across
  // all three registries, every per-definition condition set that any rule
  // constrains intersects to exactly `country`, and no definition mixes
  // scopes; what is left over is combinators and scope links (`OR`, `NOT`,
  // `NOR`, `owner`, `from`), which constrain nothing either way.
  [
    "section_template.ai_weight",
    {
      scope: "country",
      reason:
        "64 of 482 shipped section templates gate their design weight, on country conditions " +
        "throughout (`is_ai`, `has_technology`, `is_preferred_weapons`). See the note above for " +
        "why the rules' silence here is an omission rather than a contrary claim.",
    },
  ],
  [
    "utility_component_template.ai_weight",
    {
      scope: "country",
      reason:
        "253 of 848 shipped utility components gate their design weight, on country conditions " +
        "throughout (`has_country_resource`, `has_monthly_income`, `has_policy_flag`, `is_ai`, " +
        "`is_country_type`, `is_preferred_weapons`). See the note above.",
    },
  ],
  [
    "weapon_component_template.ai_weight",
    {
      scope: "country",
      reason:
        "324 of 591 shipped weapon components gate their design weight, on country conditions " +
        "throughout (`has_ascension_perk`, `has_country_flag`, `is_ai`). See the note above.",
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
  // component_template (SDK-31): none of the three subtypes had a single field
  // override before this cluster landed, so a ported SMALL_SHIELD_1 occupied a
  // slot, cost nothing, and granted nothing — resources and modifier were
  // present in components.cwt but absent from CONTENT_FIELD_OVERRIDES, so the
  // writer, which only emits declared ContentField[] members, silently dropped
  // both. 1,193 of 1,500 vanilla component templates write a top-level
  // resources, 355 write modifier. weapon_component_template and
  // strike_craft_component_template splice economic_template_no_produce
  // (components.cwt:189, :338) rather than plain economic_template
  // (components.cwt:405) — `produces` is not game-legal there — so their
  // `resources` rows below use `economicResourcesNoProduce`
  // (`EconomicResourceBlockNoProduce<S>`) rather than `economicResources`:
  // `produces` does not type-check on either row, and the writer's
  // `economicResourceBlock` iterates a `produces`-free operation list for
  // this shape regardless of what a cast forces past the type, so it is
  // unemittable there even so. utility_component_template splices plain
  // economic_template (components.cwt:405), where `produces` is genuinely
  // legal, so its own `resources` row below keeps `economicResources`.
  [
    "weapon_component_template.resources",
    {
      shape: "economicResourcesNoProduce",
      reason:
        "Same category-plus-economic_template_no_produce-splice shape as " +
        "espionage_operation.resources (espionage.cwt:113), repeated 0..inf " +
        "(components.cwt:184-190) — `produces` is not game-legal on this splice, unlike " +
        "job.resources' plain economic_template.",
    },
  ],
  [
    "weapon_component_template.modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:205-207).",
    },
  ],
  [
    "weapon_component_template.ship_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:208-210).",
    },
  ],
  [
    "weapon_component_template.ship_design_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:211-213).",
    },
  ],
  [
    "weapon_component_template.triggered_ship_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map, " +
        "repeated 0..inf (components.cwt:215-217).",
    },
  ],
  [
    "weapon_component_template.triggered_ship_design_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map, " +
        "repeated 0..inf (components.cwt:218-220).",
    },
  ],
  [
    "strike_craft_component_template.resources",
    {
      shape: "economicResourcesNoProduce",
      reason:
        "Same category-plus-economic_template_no_produce-splice shape as " +
        "weapon_component_template.resources above, repeated 0..inf (components.cwt:333-339) " +
        "— `produces` is not game-legal on this splice.",
    },
  ],
  [
    "strike_craft_component_template.ship_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:341-343). This subtype declares no modifier, ship_design_modifier, " +
        "triggered_ship_modifier, or triggered_ship_design_modifier — only ship_modifier.",
    },
  ],
  [
    "utility_component_template.resources",
    {
      shape: "economicResources",
      reason:
        "Same category-plus-economic_template-splice shape as job.resources, repeated 0..inf " +
        "(components.cwt:400-406). Spliced category is plain economic_template, so `produces` " +
        "is genuinely authorable here — no caveat, unlike the weapon/strike-craft rows above.",
    },
  ],
  [
    "utility_component_template.modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:420-422).",
    },
  ],
  [
    "utility_component_template.friendly_aura.modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:490-491), the same declaration as utility_component_template.modifier " +
        "one level up. 30 shipped definitions write it; without the row the aura struct lowers " +
        "with the field reported unsupported.",
    },
  ],
  [
    "utility_component_template.hostile_aura.modifier",
    {
      shape: "modifierBlock",
      reason:
        "The hostile twin of the friendly_aura row above, declared identically " +
        "(components.cwt:527-528). 22 shipped definitions write it — below the presence floor, " +
        "but the same fix and the same declaration.",
    },
  ],
  [
    "utility_component_template.ship_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:423-425).",
    },
  ],
  [
    "utility_component_template.ship_design_modifier",
    {
      shape: "modifierBlock",
      reason:
        "modifier_clause is an open modifier-name map with optional ancillary fields " +
        "(components.cwt:426-428).",
    },
  ],
  [
    "utility_component_template.triggered_ship_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map, " +
        "repeated 0..inf (components.cwt:430-432).",
    },
  ],
  [
    "utility_component_template.triggered_ship_design_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "triggered_modifier_clause combines a potential trigger with an open modifier-name map, " +
        "repeated 0..inf (components.cwt:433-435).",
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
    "tradition.tradition_swap.triggered_modifier",
    {
      shape: "triggeredModifierBlock",
      reason:
        "Nested triggered_modifier_clause (traditions.cwt:126) is the same shape as the top " +
        "level's tradition.triggered_modifier — combines a potential trigger with an open " +
        "modifier-name map. Found via the SDK-39 sweep alongside its top-level sibling.",
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
