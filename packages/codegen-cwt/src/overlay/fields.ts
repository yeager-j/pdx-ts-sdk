/**
 * Content-field overlay rows: audited departures from a mechanical rules
 * reading that concern content-type fields — asset paths, widenings, declined
 * fields, scope parameters, and the per-field shape overrides — everything
 * `emit/content/content-type.ts`'s field lowering reads.
 *
 * See `./index.ts` for what this directory is and how a row here earns its
 * place.
 */

import type { ContentShape } from "../lower/content-shape.ts";
import type { AmbientScopeKey } from "../special-scope-paths.ts";

/**
 * The fields whose value is a path from the mod root, so a captured Asset can
 * stand in for the string (SDK-121).
 *
 * Audited rather than derived, because CWT does not draw the distinction that
 * matters here. `cwt/model.ts` lowers both `filepath` and `filename[dir]` to
 * one `filepath` rule type — correctly, since both are one string in the file —
 * but only the first is a path from the mod root. `filename[gfx/models]` is a
 * bare name the game resolves inside that directory, and vanilla writes it that
 * way (`texture_diffuse = "turret_object_diffuse.dds"`), so an `AssetFileItem`
 * lowering to its declared logical path would write a path the game cannot
 * follow. The four `model_mesh.meshsettings.texture_*` members are the only
 * `filename[dir]` fields in the vendored rules, and they are deliberately
 * absent below.
 *
 * Each row is one field the rules type bare `filepath` and vanilla writes as a
 * mod-root path. Every one is checked at generation time against its actual
 * declaration, so a row that stops being a `filepath` field fails codegen
 * rather than quietly widening a member.
 */
export const ASSET_PATH_FIELDS = new Map<string, string>([
  [
    "spriteType.textureFile",
    "interface/sprites.cwt declares `textureFile = filepath` with no directory; Stellaris 4.4.6 " +
      'writes mod-root paths such as "gfx/event_pictures/celestial_storm.dds". It is the field ' +
      "the whole Asset pipeline exists for — the image a sprite shows.",
  ],
  [
    "spriteType.masking_texture",
    "interface/sprites.cwt declares `masking_texture = filepath` with no directory; vanilla " +
      'writes "gfx/interface/contacts/Contacts_Background_Mask.dds" and kin — the same mod-root ' +
      "form as `textureFile`, for a second image file beside it.",
  ],
  [
    "spriteType.effectFile",
    "interface/sprites.cwt declares `effectFile = filepath` with no directory; vanilla writes " +
      '"gfx/FX/buttonstate.shader". A shader rather than an image, but the same kind of value: a ' +
      "file the mod may ship and address from its root.",
  ],
  [
    "spriteType.animation.animationmaskfile",
    "interface/sprites.cwt declares `animationmaskfile = filepath` with no directory inside the " +
      'sprite `animation` block; vanilla writes "gfx/cursors/crosshair_mask.dds".',
  ],
  [
    "spriteType.animation.animationtextureFile",
    "interface/sprites.cwt declares `animationtextureFile = filepath` with no directory, in the " +
      "same `animation` block and beside `animationmaskfile`. Stellaris 4.4.6 writes it zero " +
      "times, so the declaration is the whole evidence — which is the reason to include it: a " +
      "field with no shipped example is exactly the one an author has nothing to copy from.",
  ],
  [
    "pdxmesh.file",
    "gfx/model_entities.cwt declares `file = filepath` with no directory and the rule's own " +
      'comment gives the mod-root form ("gfx/models/shielded_planet.mesh"); vanilla writes ' +
      '"gfx/models/spacedust.mesh". It is the mesh a pdxmesh is.',
  ],
]);

/**
 * Consumer-facing descriptions for content fields whose CWT declarations do
 * not explain how an author should use them.
 *
 * These lines are appended to any rule-owned documentation. Keys use the same
 * `<registry>.<field>` path as the other field overlays, and the generation
 * audit rejects a row whose field no longer exists.
 */
export const CONTENT_FIELD_DOCS = new Map<string, readonly string[]>([
  [
    "ascension_perk_category.ascension_perks",
    ["Ascension perks that belong to this category; emitted list order is preserved."],
  ],
  ["resource.tradable", ["Whether the resource participates in resource-trading behavior."]],
  ["resource.category", ["Built-in resource group the game uses for this definition."]],
  [
    "resource.dynamic_capacity",
    ["Country-scoped weight block that calculates a dynamic storage capacity."],
  ],
  ["resource.intangible_weight", ["Weight used when the game evaluates intangible resources."]],
  ["resource.deficit_modifier", ["Static modifier applied by the resource's deficit behavior."]],
  ["resource.deficit_situation", ["Situation started by the resource's deficit behavior."]],
  [
    "resource.deficit_trade_conversion_mult",
    ["Multiplier applied when deficit behavior converts trade."],
  ],
  ["resource.culling_conversion_value", ["Conversion value used by resource-culling systems."]],
  ["resource.prerequisites", ["Flat list of technologies required by this resource."]],
  [
    "resource.visibility_prerequisite",
    ["Country condition that must pass before the resource is visible."],
  ],
  [
    "resource.ai_weight",
    [
      "One of the two country-scoped AI weights used by resource logic.",
      "Stellaris does not document how it differs from `aiWants`.",
    ],
  ],
  ["resource.tooltip_decimals", ["Number of decimal places shown in resource tooltips."]],
  [
    "resource.ai_wants",
    [
      "One of the two country-scoped AI weights used by resource logic.",
      "Stellaris does not document how it differs from `aiWeight`.",
    ],
  ],
  ["mission_category.is_contract", ["Whether this is a contract category."]],
  [
    "mission.counter.max",
    ["Maximum counter value shown in the mission's localized counter display."],
  ],
  [
    "resource.tradable_in_market",
    ["Country condition that gates whether the resource can be traded on the market."],
  ],
  [
    "crisis_path.crisis_currency",
    [
      "Resource that tracks progress along this crisis path.",
      "A resource defined by this mod comes with the Ambition UI text the game keys from its id.",
    ],
  ],
  [
    "crisis_path.levels",
    ["Crisis levels in progression order; align the order with their currency thresholds."],
  ],
  ["crisis_path.objectives", ["Objectives available to this crisis progression path."]],
  ["crisis_level.allow", ["Country condition that must pass before this crisis level may unlock."]],
  [
    "crisis_level.required_crisis_currency",
    ["Crisis-currency amount required to reach this level."],
  ],
  ["crisis_level.perks", ["Menace perks granted when this crisis level unlocks."]],
  ["crisis_level.on_unlock", ["Country effects run when this crisis level unlocks."]],
  [
    "crisis_objective.potential",
    ["Daily country condition that controls whether this objective is currently available."],
  ],
  ["crisis_objective.reward", ["Weight block that calculates the reward for completion."]],
  [
    "crisis_objective.recurring",
    ["Whether the objective may grant its reward again after completion."],
  ],
  ["menace_perk.portrait", ["GFX sprite displayed for this menace perk."]],
  ["menace_perk.modifier", ["Continuing country modifiers granted by this menace perk."]],
  ["menace_perk.on_unlock", ["Country effects run when this menace perk is granted."]],
]);

/** An extra authoring form accepted in addition to a field's mechanically derived type. */
export interface FieldWidening {
  /** Appended to the mechanically derived type. */
  readonly extraType: string;
  /**
   * `KNOWN_SYMBOLS` names {@link FieldWidening.extraType} spells that the
   * field's own lowering does not already bring in, so the generated module
   * imports them.
   *
   * The row states them rather than the emitter reading them out of the text:
   * `extraType` is free-form TypeScript this table writes, and the emitter that
   * splices it has no other way to know what it names. A name the emitter
   * cannot resolve fails codegen; a name nothing needs fails the emitted file's
   * unused-import check.
   */
  readonly symbols?: readonly string[];
  /** Audited evidence that the extra form emits the field correctly. */
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
  [
    "pdxmesh.meshsettings.shader",
    {
      extraType: "string",
      reason:
        "model_entities.cwt declares `shader = $shader_effect`, which is the config's own " +
        "marker for a name defined in a `.shader` file rather than a value domain — the same " +
        "spelling `section_templates.cwt` uses for `$mesh_locator`. Read as a value it is a " +
        "one-member literal union nothing can satisfy, so without this the field is present " +
        "and unfillable: Stellaris 4.4.6 writes 47 distinct real shader names " +
        "(`PdxMeshShip`, `PdxMeshPlanetEmissive`, `AlphaBlendNoDepth`, …) across 2,980 of " +
        "3,257 meshes, and none of them is `$shader_effect`. There is no id set to check " +
        "against — `.shader` files are opaque to the SDK — so the widening is to `string`.",
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

/**
 * Defines a registry-level scope parameter for fields whose scope varies by definition.
 * The emitter derives the synthetic authoring member and callback scopes from this schema.
 */
export interface ContentScopeParameter {
  /** Every scope a definition may declare, or the effect whose receiving scopes are authoritative. */
  readonly scopes: readonly string[] | { readonly effect: string };
  /** CWT's common scope to narrow to the definition's concrete parameter. Defaults to `any`. */
  readonly mechanicalScope?: string;
  /** The scope a definition that declares none runs in. Required unless the declaration is required. */
  readonly fallback?: string;
  /** Customizes the synthetic scope declaration and optionally preserves it as a contract witness. */
  readonly authoringMember?: {
    /** Authoring member that names the definition's scope. */
    readonly member: string;
    /** Whether every authored definition must state the member. */
    readonly required: boolean;
    /** Whether the returned item carries the declaration beside its erased def. */
    readonly carriesWitness: boolean;
    /** Consumer-facing description of the declared scope. */
    readonly docs: readonly string[];
  } | null;
  /** A game field that selects the scope instead of a synthetic `scope` member. */
  readonly selector?: {
    /** Authoring member that carries the game's scope selector. */
    readonly member: string;
    /** Members the selected scope is the `this` of. */
    readonly scopedMembers: readonly string[];
    /**
     * Members the selected scope is the FROM of, their `this` being the
     * registry's own fallback. The same selector read the other way round: a
     * callback the game runs one scope out from the object it is about still
     * hands that object over, and FROM is the slot it arrives in.
     *
     * Needs the evidence a {@link ContentFieldOverride.scope} row needs, and
     * from the same distance: the corpus can show a FROM being navigated but
     * never contradicts an over-narrow one, so a row states which shipped
     * definitions read FROM and as what.
     */
    readonly fromMembers?: readonly string[];
    /** Public type name emitted for the selector values. */
    readonly typeName: string;
    /** Selector value used when the definition omits the member. */
    readonly fallback: string;
    /** Maps each admitted selector value to its canonical callback scope. */
    readonly scopes: Readonly<Record<string, string>>;
  };
  /**
   * A FROM the *call site* chooses, declared once on the definition.
   *
   * The selector above reads a FROM off a field the definition already has.
   * This is the case where nothing on the definition decides it: the scope
   * arrives as an argument of the effect that starts the thing, so the rules
   * can only say which scopes are admissible — the `scopes.cwt` group named
   * here — and never which one a given definition gets.
   *
   * A row emits one synthetic member (naming the scope, emitting nothing, on
   * `scope`'s terms), types FROM in the listed members from it, and carries the
   * declaration on the returned item so the call site can be checked against
   * it. That last part is what keeps this from being a comment the author
   * writes and nothing verifies, and it is why a row needs a hand-written
   * overload on the starting effect (see {@link EFFECT_EXTENSION_SEAMS}) rather
   * than being free.
   *
   * Undeclared stays the default: the member is optional, and a definition that
   * omits it reads no FROM and has its call sites unchecked, exactly as before
   * the row existed. That is also the only shape available to a definition
   * whose starting effect is called *without* the argument — the scope then
   * defaults to the caller's, which no signature on a universally-valid effect
   * can see. Like `<Registry>Scope` above, the emitted union has to be
   * re-exported from `packages/sdk/src/index.ts` by hand for a consumer to name
   * it.
   */
  readonly declaredFrom?: {
    /** The synthetic authoring member that names the scope. */
    readonly member: string;
    /**
     * The `scopes.cwt` scope group the declaration may name. Checked against
     * the group `effect`.`argument` is actually declared with, so a rules bump
     * that retypes the argument fails codegen rather than leaving the
     * declaration and the signature it is checked against disagreeing.
     */
    readonly scopeGroup: string;
    /** Members and ambient slots that receive the declared scope. */
    readonly members: Readonly<Record<string, AmbientScopeKey>>;
    /**
     * The subtype whose definitions may declare the scope, when only one
     * may. Every other subtype arm fixes the declaration to `undefined`, so
     * a definition outside that subtype cannot type an ambient scope the game
     * never hands it. The subtype must be one the registry emits as an arm.
     */
    readonly subtype?: string;
    /** The effect whose argument the scope actually is, and that argument. */
    readonly effect: string;
    /** Effect argument that supplies the declared FROM scope. */
    readonly argument: string;
    /** Audited evidence for exposing the call-site-selected FROM scope. */
    readonly reason: string;
  };
  /** Audited evidence for the registry's scope choices and fallback. */
  readonly reason: string;
}

/**
 * Registries whose unpinned field scopes are a property of the *definition*
 * rather than a constant the rules could state.
 *
 * The `scope` assertion fixes one field CWT failed to annotate. This is the
 * registry-level case where CWT can state only an open scope or a common parent:
 * a decision taken on a nomadic ship colony really is ship-scoped and one taken
 * on a planet really is planet-scoped. The trouble is that `Trigger<S>` is
 * contravariant, so the wider mechanical type loses the concrete APIs each
 * definition is allowed to use.
 *
 * A row turns every field the registry left unpinned into `Trigger<NoInfer<S>>`
 * and adds one authoring member, `scope`, that names S and emits nothing. It
 * also introduces a public `<Registry>Scope` union, which has to be re-exported
 * from `packages/sdk/src/index.ts` by hand — nothing else makes a consumer able
 * to name the type its own helpers need. It needs the same evidence a `scope`
 * assertion does — the scopes listed are the ones real definitions are written
 * against, and shape conformance checks that the set covers what the corpus
 * writes rather than taking the row's word.
 */
export const CONTENT_SCOPE_PARAMETERS = new Map<string, ContentScopeParameter>([
  [
    "decision",
    {
      scopes: ["planet", "ship"],
      mechanicalScope: "carrier",
      fallback: "planet",
      authoringMember: {
        member: "scope",
        required: false,
        carriesWitness: false,
        docs: [
          "The concrete scope this definition's own clauses run in.",
          "",
          "Emits nothing. The rules expose only their common `carrier` parent.",
        ],
      },
      reason:
        "decisions.cwt annotates the body with the common `carrier` parent: on a nomadic ship " +
        "colony a decision is concretely ship-scoped, on a planet planet-scoped. Every non-universal " +
        "condition across all 111 shipped decisions is planet-valid — none writes a country-only " +
        "condition directly, they navigate through `owner` — so `planet` is the fallback and " +
        "`ship` the case that has to be declared.",
    },
  ],
  [
    "static_modifier",
    {
      scopes: { effect: "add_modifier" },
      authoringMember: {
        member: "hostScope",
        required: true,
        carriesWitness: true,
        docs: [
          "The one scope whose objects may hold this modifier.",
          "",
          "Emits nothing. Propagated rows may affect objects below this host without",
          "making those objects valid hosts themselves.",
        ],
      },
      reason:
        "SDK-229: a static modifier's host is author intent that CWT does not state. The " +
        "add_modifier receiving scopes define the supported host universe, while the required " +
        "hostScope declaration selects one host, narrows the modifier recorder, and rides on the " +
        "returned item so executing consumers can check it.",
    },
  ],
  [
    "special_project",
    {
      scopes: ["country", "planet", "ship", "carrier"],
      fallback: "country",
      selector: {
        member: "eventScope",
        scopedMembers: ["onSuccess", "onProgress25", "onProgress50", "onProgress75", "onStart"],
        fromMembers: ["failTrigger", "abortTrigger", "onFail", "onCancel"],
        typeName: "SpEventScope",
        fallback: "country_event",
        scopes: {
          country_event: "country",
          planet_event: "planet",
          ship_event: "ship",
          carrier_event: "carrier",
        },
      },
      declaredFrom: {
        member: "locationScope",
        scopeGroup: "spatial_object",
        members: {
          onSuccess: "from",
          onProgress25: "from",
          onProgress50: "from",
          onProgress75: "from",
          onStart: "from",
        },
        effect: "enable_special_project",
        argument: "location",
        reason:
          "The success callbacks run with FROM = the `location` handed to " +
          "enable_special_project, which the game's own documentation.txt calls 'location " +
          "scope, if set (usually a planet)'. Nothing on the definition decides it: " +
          "effects.cwt types the argument `scope_group[spatial_object]`, and of vanilla's 735 " +
          "enable_special_project calls the 660 that set `location` pass `this` (395), " +
          "`capital_scope` (40), `from` (33), `root` (17), `this.star`, `solar_system.star`, " +
          "`capital_scope.solar_system.starbase` and ~90 distinct event targets — planets, " +
          "ships, fleets, stars and ambient objects. The corpus reads FROM as each of those in " +
          "on_success: `is_colony` on VULTAUM_HOMEWORLD_PROJECT (planet), `set_fleet_flag` on " +
          "HIDDEN_CUTHOLOID_ATTACK_PROJECT (fleet), `country_event` on the PROSPECTORIUM " +
          "projects (country). No constant covers that, so the definition declares which one " +
          "it is written for and enableSpecialProject is checked against the declaration.",
      },
      reason:
        "special_projects.cwt leaves the event-dependent clauses unpinned: a project may run " +
        "against country, planet, ship, or carrier event scope. The corpus records all four " +
        "across on_success/on_progress/on_start, while its AI and cost weights are country " +
        "conditions. event_scope is the engine's authoritative selector for the callback context, " +
        "so the generated callback scope is derived from it rather than author-declared. " +
        "The four country-scoped callbacks read the same selector as FROM: the game's own " +
        "common/special_projects/documentation.txt states, for on_fail/on_cancel/abort_trigger/" +
        "fail_trigger alike, THIS = country, FROM = project scope (matching event_scope, and " +
        "'might not exist'), FROMFROM = location — and special_projects.cwt says the same for " +
        "fail_trigger and abort_trigger. The corpus writes that two-level shape: the ship_event " +
        "projects trojan_asteroid_project and molluscoid_miners_project_1 " +
        "(00_projects_distant_stars.txt) reach the location through FROMFROM " +
        "(`fromfrom.solar_system`) in abort_trigger while FROM stays the project's own scope, and " +
        "OPEN_SEED_PODS_PROJECT (00_projects_plantoids.txt, planet_event) navigates " +
        "`from = { colonizable_planet has_modifier }` in abort_trigger and its location through " +
        "FROMFROM in on_cancel. One shipped block disagrees — SHIELD_PRIMITIVE_PLANET_PROJECT " +
        "(00_projects_first_contact_dlc.txt) is country_event and writes planet conditions under " +
        "FROM in abort_trigger — which is the degenerate case the documentation flags: with the " +
        "project scope a country it is already THIS, and that block is malformed anyway (an OR " +
        "of a single NOT of two members). FROMFROM has no slot in the emitted contract, so the " +
        "location stays unreachable in these four; on_success's own FROM is the location and is " +
        "not assertable at all, since enable_special_project takes it as any of fourteen " +
        "scope_group[spatial_object] scopes and vanilla's 660 call sites that set it range over " +
        "planets, ships, fleets, systems, starbases and ambient objects.",
    },
  ],
  [
    "mission",
    {
      scopes: ["country"],
      fallback: "country",
      authoringMember: null,
      declaredFrom: {
        member: "locationScope",
        scopeGroup: "spatial_object",
        members: {
          potentialOperator: "from",
          possibleOperator: "from",
          abortTrigger: "fromfrom",
          onCancel: "fromfrom",
          onStart: "fromfrom",
          onSuccess: "fromfrom",
          onStop: "fromfrom",
          issuedAbortTrigger: "fromfrom",
          onIssue: "fromfrom",
          onAccept: "fromfrom",
          aiWeight: "from",
        },
        subtype: "contract",
        effect: "issue_contract",
        argument: "location",
        reason:
          "A contract's location is selected by issue_contract.location. The contract callbacks " +
          "and the effect both declare it as scope_group[spatial_object], so the authored " +
          "declaration chooses one supported spatial scope and the checked overload requires " +
          "that same scope at call sites. Only contracts declare it: 99_README_MISSIONS.txt " +
          "calls FROMFROM the contract location, and of the three ordinary Stellaris 4.4.6 " +
          "missions with `location = yes`, none reads FROMFROM in any callback.",
      },
      reason:
        "Mission callbacks run in country scope. Contract callbacks additionally receive the " +
        "location selected by issue_contract as FROM or FROMFROM; that location varies per " +
        "definition and must be declared to make its ambient reference authorable.",
    },
  ],
]);

/**
 * Supported writer shapes that an audited field override may select.
 * Each value names an existing generic lowering; rows must not introduce registry-specific shapes.
 */
export type ContentFieldShape = Extract<
  ContentShape,
  | "value"
  | "valueList"
  | "trigger"
  | "effect"
  | "economicResources"
  /**
   * A repeated resource-name operation with one condition sibling and the
   * complex maths operations alongside it: `ai_resource_production = {
   * <resource> = float trigger = { ... } mult = value }`.
   *
   * This is deliberately distinct from `economicResources`: the latter owns
   * a named collection of cost/production/upkeep/logistics operations, while
   * this shape is itself one such operation. Both use the shared
   * `EconomicResourceOperation<S>` contract at runtime.
   */
  | "economicResourceOperation"
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
   * one level down.
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
   * `emit/content/alias-struct.ts` — `government_trigger` is the only consumer so
   * far. Unlike the pure-splice categories `spliceCategory` finds on its own
   * (`trigger`, `effect`, `modifier_rule`), the category here sits alongside
   * ordinary named siblings (`potential = { text? always? alias_name[...] }`),
   * the same "combinator" shape the category's own self-recursive members
   * use — so the field lowers to that category's shared `<Name>Block`
   * interface rather than being auto-detected.
   */
  | "aliasStruct"
>;

/**
 * An audited correction to the mechanical lowering of one content field.
 * A row changes only the properties it supplies and records evidence for the departure.
 */
export interface ContentFieldOverride {
  /** Omitted when the row only renames the authoring member. */
  readonly shape?: ContentFieldShape;
  /** Emits scalar values with explicit quotes when the serialized contract requires them. */
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
   * separate `ScopeName` sentinel `emit/scope-context.ts`'s `contravariantScopeType`
   * does not touch, since an unpinned modifier closure already resolves to a
   * real, writable recorder.
   *
   * This asserts game semantics the rules do not state, so a row needs the
   * evidence in its reason, not a guess: shape conformance's `scope` mismatch
   * kind (`corpus/`) walks every real definition's keys under this field and
   * reports any the asserted scope rejects. An unknown scope name fails
   * codegen rather than silently widening.
   */
  readonly scope?: string;
  /**
   * Corrects named ambient slots that CWT omits or misspells while keeping the
   * field's own execution scope unchanged.
   */
  readonly ambient?: Readonly<Partial<Record<AmbientScopeKey, string>>>;
  /**
   * Asserts how often the key may be written, where CWT's cardinality says
   * otherwise and the corpus proves it wrong. Like {@link scope}, this states
   * game semantics the rules get wrong, so a row needs evidence and a row
   * without one is a guess.
   *
   * `"single"` narrows: `## cardinality = 0..inf` on a bare `bool` lowers to
   * `boolean[]`, a field whose only sensible authoring is one flag.
   *
   * `"repeated"` widens, and is the harder direction to catch. A field CWT
   * declares `0..1` lowers to a singular member, so a second block the game
   * writes is not merely awkward to author — it is unwritable, and the
   * definition cannot be reproduced at all. Shape conformance does not find
   * these on its own: `corpus/` reports an `arity` mismatch only when the
   * SDK lowered a list the corpus never repeats, never the reverse, so the
   * evidence for a `"repeated"` row is the fixture's own `repeated` count
   * (`packages/sdk/tests/fixtures/corpus/<registry>.json`) read directly.
   */
  readonly arity?: "single" | "repeated";
  /**
   * Makes the authored member optional when the CWT cardinality is known to
   * overstate its presence. This is evidence-backed like `scope` and `arity`:
   * the override corrects one generated optionality decision at its source,
   * rather than each registry growing its own exception.
   */
  readonly optional?: true;
  /**
   * Declares that a `structMap`'s keys are the very localisation keys the game
   * shows its entries under, so each entry gains an optional `name` display-text
   * member registered under the entry's own map key.
   *
   * Only for a map whose keys the game displays. Most engine-keyed maps name
   * something the engine reads and never shows (a ship size's `section_slots`),
   * and a `name` member there would write text nothing renders — so a row needs
   * both the CWT declaration and a shipped localisation entry as evidence.
   */
  readonly mapKeyLocalisation?: true;
  /** Public name for a nested struct the mechanical path-derived name misstates. */
  readonly nestedTypeName?: string;
  /** Consumer-facing description emitted above a named nested struct. */
  readonly nestedTypeDocs?: readonly string[];
  /** Replaces the public authoring type without changing the field's runtime lowering. */
  readonly authoringType?: {
    /** TypeScript type emitted for the authoring member. */
    readonly type: string;
    /** Extra type-only imports required by {@link type}. */
    readonly imports: readonly {
      /** Module path written into the generated file. */
      readonly module: string;
      /** Exported type name referenced by {@link type}. */
      readonly name: string;
    }[];
  };
  /**
   * Grafts a family of localization keys onto an id-valued field: the text the
   * game derives from the id this field *references*, which the referenced
   * definition cannot supply on its own (SDK-304).
   *
   * The name is one the SDK's `LOCALIZATION_KEY_FAMILIES` carries, and it
   * reaches the runtime as `localizationFamily` on the emitted descriptor.
   * `authoringType` is required alongside it and codegen fails without one:
   * the graft is a pair of claims — the member accepts a role bundle, and the
   * walk knows what to do with one — and a row making only the second would
   * emit a member no author can fill, while a row making only the first would
   * accept a bundle nothing registers, losing the text silently.
   *
   * `localisation` blocks describe the definition they sit on and carry no
   * conditionality on an inbound reference, so no reading of the rules can
   * produce this; a row states game behaviour measured against the install,
   * and belongs with that measurement recorded beside the family table.
   */
  readonly localizationFamily?: string;
  /**
   * Lowers a `<type>` reference to a bare, unchecked `string`.
   *
   * The rules reference types the SDK has no registry for and never will:
   * `pdxparticle.type` points at a `<particle_type>`, whose definitions live in
   * `gfx/particles/*.asset` files the SDK models as opaque Assets. Left alone
   * that field lowers to `ParticleTypeRef | string` — a union whose checked arm
   * nothing can ever produce, so it is `string` wearing a type nobody can
   * satisfy, plus a `refTypes` entry sending the fold looking for a registry
   * that does not exist. This says so outright: the member is `string`, the
   * metadata carries no `refTypes`, and the generated doc says where the real
   * ids live and that they are not checked.
   *
   * Deliberately narrow. Codegen fails unless the field's every declaration is
   * a plain `<type>` reference, because the lever must weaken exactly that one
   * check and never quietly erase a shape, an enum, or a closed union along
   * with it.
   */
  readonly uncheckedString?: true;
  /**
   * A field CWT types `localisation` that is really the nested definition's
   * own *identity*, not a pointer at a key.
   *
   * The game derives the display key from the id, so the two coincide in the
   * file and CWT can only spell that as `localisation`. They are not the same
   * thing here: other definitions name a swap by this exact string, the fold
   * registers it as a nested id, and minting a key from display text would
   * both break those references and put prose where an id belongs. A row
   * lowers the localisation arm as the plain scalar it functionally is, which
   * keeps the member a bare id and leaves the swap's own text to the
   * localisation slot that already covers it.
   */
  readonly identityName?: true;
  /** Audited evidence for every correction supplied by the row. */
  readonly reason: string;
}

/**
 * Lowerings that cannot be inferred solely from the CWT value type.
 *
 * Weight blocks contain alias splices rather than ordinary fields. The quoted
 * technology prerequisite list preserves the SDK's existing byte contract.
 * Tradition swaps are nested definitions with their own localization identity.
 *
 * Modifier blocks used to be here too, 85 rows of them. They are not any more:
 * a field that splices `modifier_clause`, a `triggered_modifier*_clause` or an
 * `economic_template` carries the clause's name into the expanded block, and
 * `lower/rule-shapes.ts`'s `CLAUSE_SHAPES` reads the shape off it (SDK-142). A row
 * here still wins over that, so this table remains the place to say the
 * derivation is wrong for one field — but restating what the clause already
 * says is no longer one of its jobs.
 */
export const CONTENT_FIELD_OVERRIDES = new Map<string, ContentFieldOverride>([
  [
    "ship_size.ship_category",
    {
      optional: true,
      reason:
        "`subtype[space_fauna]` declares it required, but 11 of Stellaris 4.4.6's 63 space-fauna " +
        "ship sizes omit it. The arm's own members stay a union; only the requirement is dropped.",
    },
  ],
  [
    "ship_size.mutation_components_size",
    {
      optional: true,
      reason:
        "`subtype[space_fauna]` declares it required, but 46 of Stellaris 4.4.6's 63 space-fauna " +
        "ship sizes omit it.",
    },
  ],
  [
    "ship_size.space_fauna_values",
    {
      optional: true,
      reason:
        "`subtype[space_fauna]` declares it required, but 25 of Stellaris 4.4.6's 63 space-fauna " +
        "ship sizes omit it.",
    },
  ],
  [
    "crisis_path.crisis_currency",
    {
      localizationFamily: "crisis_currency",
      authoringType: {
        type: "CrisisCurrencyRole",
        imports: [{ module: "../content/localization-families.ts", name: "CrisisCurrencyRole" }],
      },
      reason:
        "SDK-304: the Ambition UI builds 16 required text keys from the id this field names, " +
        "measured against Stellaris 4.4.6's menace_* and integrity_* entries. The referenced " +
        "resource cannot supply them — the family exists because of this reference, and the " +
        "same resource used outside a crisis path needs none of it — and `localisation` " +
        "blocks have no inbound-reference conditionality to say so. Bundling the text with " +
        "the reference makes a mod-defined currency's family required by type rather than " +
        "checked after the fact; a vanilla or third-party reference stays bare.",
    },
  ],
  [
    "agenda.finish_modifier",
    {
      authoringType: {
        type: '(StaticModifierRef & { readonly hostScope?: never }) | StaticModifierHostContract<"country"> | string',
        imports: [
          {
            module: "../script/effects/static-modifiers.ts",
            name: "StaticModifierHostContract",
          },
        ],
      },
      reason:
        "SDK-229: council agendas execute in country scope, so an SDK-authored finish modifier " +
        "must carry a country host witness. Plain refs and strings remain unchecked fallbacks.",
    },
  ],
  [
    "decision.custom_tooltip",
    {
      optional: true,
      reason:
        "decisions.cwt omits a cardinality annotation, but Stellaris 4.4.6 writes this block " +
        "in only 4 of 111 shipped decisions. It is an optional tooltip override, not a required " +
        "part of every decision (SDK-84 corpus evidence).",
    },
  ],
  [
    "event_chain.counter",
    {
      shape: "structMap",
      nestedTypeName: "EventChainCounterDefinition",
      mapKeyLocalisation: true,
      reason:
        "Each counter name is an engine-visible key inside one event chain, with an optional " +
        "localisation.max block beneath it. CWT expresses that as an enum-keyed block, which is " +
        "the same engine-keyed map shape structMap already lowers for section_slots: counter " +
        "names are not content ids, take no mod prefix, and have no meaningful order. " +
        "The key is displayed, not merely read: event_chains.cwt:31-37 types the wildcard key " +
        "`localisation`, and Stellaris 4.4.6 defines every shipped counter name as a " +
        'localisation key — `ancient_ward_upgraded: "Building Upgraded"` and ' +
        "`reckoning_consumed_worlds` both sit in shroud_l_english.yml against the counters " +
        "00_event_chains_shroud.txt declares. So the entry takes a `name` display-text member " +
        "keyed by the map key itself (SDK-303).",
    },
  ],
  [
    "mission.counter",
    {
      shape: "structMap",
      nestedTypeName: "MissionCounterDefinition",
      nestedTypeDocs: ["One named counter definition for a mission."],
      mapKeyLocalisation: true,
      reason:
        "Mission counters have the same enum-keyed map shape as event-chain counters: each " +
        "engine-visible counter name owns an optional localisation.max block. CWT declares the " +
        "same nested shape at missions.cwt:146-152 — wildcard key typed `localisation`, exactly " +
        "as event_chains.cwt declares it — and the Stellaris 4.4.6 corpus records 51 missions " +
        "that use it. Counter names are not content ids, take no mod prefix, and have no " +
        "meaningful order, but they are displayed, so the entry takes a `name` display-text " +
        "member keyed by the map key itself (SDK-303).",
    },
  ],
  [
    "mission.sound",
    {
      optional: true,
      reason:
        "missions.cwt:245 calls this field optional and says it defaults to yes, while the " +
        "missing cardinality annotation would otherwise require an author to restate the default.",
    },
  ],
  [
    "mission.potential_operator",
    {
      ambient: { fromfrom: "country" },
      reason:
        "missions.cwt documents FROMFROM as the issuer country but omits it from the adjacent " +
        "replace_scopes declaration. Every shipped operator condition uses that issuer contract.",
    },
  ],
  [
    "mission.possible_operator",
    {
      ambient: { fromfrom: "country" },
      reason:
        "The possible-operator block has the same documented issuer-country FROMFROM as " +
        "potential_operator and the same omission in its replace_scopes declaration.",
    },
  ],
  [
    "relic.ai_weight",
    {
      scope: "country",
      reason:
        "CWT omits a scope for this weight block, but all 56 Stellaris 4.4.6 relic weights " +
        "use country triggers such as has_origin, has_resource, is_at_war, and " +
        "count_owned_leader. Relic activation already runs in country scope.",
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
    "technology.mod_weight_if_group_picked",
    {
      shape: "scalarMap",
      arity: "single",
      reason:
        "The rules declare the outer key 0..inf, but Stellaris 4.4.6 writes exactly one " +
        "block in each of 34 definitions (no repeated outer blocks), with one empty block and " +
        "33 inner rows. A single map is the sensible authoring contract and keeps the member " +
        "type, metadata, and scalarMap writer aligned. Inner keys are open " +
        "value[tech_weight_group] names (repeatable and deposit_blockers in this corpus), so " +
        "the map stays keyed by string rather than a closed union.",
    },
  ],
  [
    "technology.prereqfor_desc",
    {
      arity: "repeated",
      reason:
        "CWT declares `## cardinality = 0..1` (technologies_consolidated.cwt:241) and the " +
        "corpus contradicts it: tech_gene_expressions writes two prereqfor_desc blocks, one " +
        "per unlock tooltip, which the fixture records as `repeated: 1` of 125. The block " +
        "itself lowers with no shape row — the enum-keyed entry declaration expands to one " +
        "member per `enum[prereq_for_category]` value on its own (SDK-64) — so this row " +
        "asserts only the arity the rules get wrong.",
    },
  ],
  [
    "technology.technology_swap.name",
    {
      identityName: true,
      reason:
        "SDK-308: a technology swap's `name` is the swap's id. `SWAP_IDENTITIES` keys the " +
        "technology registry's swaps by this member, the fold registers each one as a nested " +
        "definition id, and another definition names the swap by that exact string. The game " +
        "then derives the swap's display key from the same id, which is the only reason CWT " +
        "types it `localisation`; the swap's own text is authored through the localisation " +
        "slot that pattern already generates.",
    },
  ],
  [
    "civic_or_origin.swap_type.name",
    {
      identityName: true,
      reason:
        "SDK-308: the same identity, one registry over — `SWAP_IDENTITIES` keys " +
        "civic_or_origin's swaps by `swap_type.name`, so the member is the id other " +
        "definitions reference and not a key pointer.",
    },
  ],
  [
    "job.swappable_data.swap_type.name",
    {
      identityName: true,
      reason:
        "SDK-308: the same identity again, and CWT spells this one `localisation | <job>` — " +
        "the reference arm is the swap standing in for an existing job, which makes it plainer " +
        "still that the member names a definition rather than a display key.",
    },
  ],
  [
    "technology.technology_swap.prereqfor_desc",
    {
      arity: "repeated",
      reason:
        "The same declaration one level down (technologies_consolidated.cwt:164-172), with the " +
        "same `## cardinality = 0..1` and the same contradiction: the fixture records " +
        "`repeated: 2` of 28 technology_swap blocks writing theirs twice (SDK-64).",
    },
  ],
  [
    "building.ai_resource_production",
    {
      shape: "economicResourceOperation",
      reason:
        "buildings.cwt:269-276 declares one repeated operation directly: an open <resource> " +
        "numeric map, optional trigger_clause, and complex_maths_enum value fields. The 4.4.6 " +
        "install writes 60 blocks across 39 buildings; 12 definitions repeat it (1x27, 2x6, " +
        "3x3, 4x3), with no direct inner-key repeats. This is the reusable operation contract " +
        "already used by economic_template, not a building-specific map.",
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
    "ascension_perk.tradition_swap",
    {
      shape: "repeatedStruct",
      reason:
        "An ascension perk swap is a repeated-struct field: a named, ordered collection whose " +
        "name (name_field, one level down) is both identity and localization key.",
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
        "emitted but can hold nothing any real definition writes. Left here rather than pushed " +
        "upstream with SDK-85's other scope annotations: the evidence is the corpus alone — " +
        "neither the rules nor the game's documentation says which scope this trigger runs in — " +
        "which is a weaker footing than a sibling field already carrying the annotation.",
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
  // The last surviving component_template row. SDK-31 gave the three registries
  // a cluster of fourteen — `resources`, `modifier` and their siblings, absent
  // here and therefore silently dropped by the writer, which is why a ported
  // SMALL_SHIELD_1 occupied a slot, cost nothing and granted nothing. Every one
  // of those fourteen was naming the clause its declaration already splices, so
  // SDK-142 derives them and they are gone, the per-registry
  // economic_template vs economic_template_no_produce split included: the
  // splice's own category picks `economicResources` or
  // `economicResourcesNoProduce`, over the arm SDK-85's subtype partition
  // leaves in this registry's body rather than over a group led by whichever
  // subtype declared the name first.
  [
    "weapon_component_template.target_weights",
    {
      shape: "scalarMap",
      reason:
        "An open scalar-keyed map of floats (`scalar = float`) from components.cwt:274-277. " +
        "Stellaris 4.4.6 writes 25 definitions / 25 blocks, 149 numeric inner rows, 0 outer " +
        "repeats, 0 duplicate inner keys, and 18 open scalar keys. The rules name a scalar " +
        "key rather than a closed enum, so keys remain string. A read-only whole-vendor scan " +
        "found 36 structurally similar computed-key scalar declarations with mixed boolean, " +
        "reference, string, and weighted-event semantics; this explicit row is intentionally " +
        "limited to weapon target_weights and does not infer utility or strike-craft paths.",
    },
  ],
  [
    "megastructure.triggered_country_modifier",
    {
      arity: "repeated",
      reason:
        "megastructures.cwt:221-223 declares the key `## cardinality = 0..1`, and the shipped " +
        "data says otherwise: the corpus fixture records `repeated: 1` of the 1 definition that " +
        "writes it (packages/sdk/tests/fixtures/corpus/megastructure.json), which is " +
        "22_shroud_seal.txt's `shroud_seal` writing two blocks — one gating " +
        "country_naval_cap_add on a relic, the second gating shroud_storm_repelling on a " +
        "technology. Two potentials cannot merge into one block, so the singular member the " +
        "rules imply leaves the second one unwritable rather than merely awkward.",
    },
  ],
  [
    "pdxparticle.type",
    {
      uncheckedString: true,
      reason:
        "particles.cwt declares `type = <particle_type>`, and `type[particle_type]` is the " +
        "`.asset` half of gfx/particles — 1,089 files holding 1,108 `particle = { name " +
        "subsystem ... }` definitions of emitter geometry, textures and shaders. The SDK " +
        "carries `.asset` files as opaque Assets and will not manifest a registry for them, " +
        "so `ParticleTypeRef` is a brand nothing can ever mint: the field is `string` either " +
        "way, and saying so drops a refTypes entry that would send the fold looking for a " +
        "registry that does not exist. All 1,740 shipped pdxparticles write it.",
    },
  ],
  [
    "pdxmesh.animation.type",
    {
      uncheckedString: true,
      reason:
        "The same shape one level down: model_entities.cwt declares `type = <model_animation>` " +
        "and `type[model_animation]` is the `.asset` half of gfx/models, opaque to the SDK for " +
        "the same reason. 3,087 of 3,257 shipped meshes write an animation block.",
    },
  ],
]);

/**
 * Names and identifies the nested definition emitted for a repeated-struct field.
 * The emitter derives keying and localisation from this metadata and the field's CWT declaration.
 */
export interface RepeatedStructDefinition {
  /** Public TypeScript name for one nested definition. */
  readonly typeName: string;
  /**
   * The body field carrying the record key, for a struct whose entries are
   * repeated sibling blocks (shape 2 — `approach = { name = approach_a ... }`).
   *
   * Only for a struct CWT gives no `type[...]` of its own. A struct that names
   * a {@link localisationType} inherits that type's `name_field`, which is the
   * same statement, and a container-keyed struct (shape 1 —
   * `stages = { stage_1 = { ... } }`) has no such field at all: the emitter
   * reads the keying off the declaration's own shape.
   */
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

/** Repeated-struct fields whose nested definitions need stable public type names. */
export const REPEATED_STRUCT_DEFINITIONS = new Map<string, RepeatedStructDefinition>([
  [
    "tradition.tradition_swap",
    { typeName: "TraditionSwap", localisationType: "swapped_tradition" },
  ],
  [
    "ascension_perk.tradition_swap",
    { typeName: "AscensionPerkSwap", localisationType: "swapped_ascension_perk" },
  ],
  ["situation_type.stages", { typeName: "SituationStage" }],
  // `approach` is the one row whose identity key stays hand-written.
  // situations.cwt declares no `type[...]` for it, so there is no `name_field`
  // to read it off the way tradition_swap reads its own off
  // `type[swapped_tradition]`. The only upstream statement is
  // `complex_enum[situation_approach]` (situations.cwt:284-291), whose `name`
  // body — `approach = { name = enum_name }` — says where the enum harvests its
  // values from, and `readEnums` keeps only an enum's scalar values and drops a
  // complex_enum's body outright, so the parsed model does not carry it.
  ["situation_type.approach", { typeName: "SituationApproach", identityKey: "name" }],
]);
