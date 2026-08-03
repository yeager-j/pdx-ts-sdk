import { describe, expectTypeOf, it } from "vitest";

import {
  addShipOfSizeLimits,
  always,
  canGoMia,
  canJoinFactions,
  collection,
  defineAgenda,
  defineAmbientObject,
  defineArchaeologicalSiteType,
  defineAscensionPerk,
  defineBombardmentStance,
  defineBuilding,
  defineCasusBelli,
  defineCivicOrOrigin,
  defineCouncilor,
  defineCountryShipOfSizeLimit,
  defineDecision,
  defineEconomicCategory,
  defineEdict,
  defineJob,
  defineOpinionModifier,
  defineScriptedModifier,
  defineSectionTemplate,
  defineShipSize,
  defineSituationType,
  defineSolarSystemInitializer,
  defineSpeciesClass,
  defineStarbaseLevel,
  defineStaticModifier,
  defineTradition,
  defineWarGoal,
  hasAuthority,
  hasCountryFlag,
  hasPlanetFlag,
  hasShipFlag,
  isCapital,
  type AgendaRef,
  type AgreementPresetRef,
  type ArchaeologicalSiteTypeRef,
  type AscensionPerkRef,
  type BombardmentStanceRef,
  type BuildingDef,
  type BuildingItem,
  type BuildingRef,
  type CasusBelliRef,
  type ContentItem,
  type DecisionRef,
  type EdictRef,
  type GovernmentTriggerBlock,
  type JobRef,
  type ModifierClosure,
  type OpinionModifierRef,
  type SectionTemplateFields,
  type TechnologyRef,
  type TraditionSwapFields,
  type Trigger,
  type WarGoalRef,
} from "../src/index.ts";

describe("generated content authoring types", () => {
  it("does not invent a category field on traditions", () => {
    defineTradition({
      id: "content_types_tradition_without_category",
      name: "No synthetic membership",
      // @ts-expect-error — membership belongs to TraditionCategoryDef.traditions
      category: "content_types_tradition_category_x",
    });
  });

  it("carries inherited and explicit trigger scopes", () => {
    defineBuilding({
      id: "content_types_building_x",
      name: "X",
      allow: isCapital(),
      // @ts-expect-error — a country-only condition is not valid in colony scope
      potential: hasCountryFlag("country_only"),
    });
    defineTradition({
      id: "content_types_tradition_scoped",
      name: "X",
      possible: hasAuthority("auth_democratic"),
      // @ts-expect-error — tradition weights and conditions run in country scope
      aiWeight: { modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }] },
    });
    defineAgenda({
      id: "content_types_agenda_scoped",
      name: "X",
      agendaCost: 100,
      effect: (country) => {
        country.setCountryFlag("country_only");
        // @ts-expect-error — agenda effects run in country, not planet, scope
        country.setPlanetFlag("planet_only");
      },
    });
    defineAscensionPerk({
      id: "content_types_ascension_perk_scoped",
      name: "X",
      potential: hasAuthority("auth_democratic"),
      // @ts-expect-error — ascension perk conditions run in country scope
      possible: hasPlanetFlag("planet_only"),
      onEnabled: (country) => {
        country.setCountryFlag("country_only");
        // @ts-expect-error — ascension perk effects run in country, not planet, scope
        country.setPlanetFlag("planet_only");
      },
      triggeredModifier: [
        {
          // @ts-expect-error — ascension perk triggered modifiers run in country scope
          when: hasPlanetFlag("planet_only"),
          modifiers: (m) => m.country.unity.produces.mult(0.1),
        },
      ],
      traditionSwap: {
        content_types_ascension_perk_swap_scoped: {
          name: "X",
          onEnabled: (country) => {
            // @ts-expect-error — ascension perk swap effects also run in country scope
            country.setPlanetFlag("planet_only");
          },
        },
      },
    });
    defineEdict({
      id: "content_types_edict_scoped",
      name: "X",
      length: 360,
      icon: "GFX_edict_x",
      resources: [
        {
          upkeep: {
            amounts: { unity: 1 },
            when: hasAuthority("auth_democratic"),
            // @ts-expect-error — resource amounts are numeric script assignments
            mult: "twice",
          },
        },
      ],
      triggeredCountryModifier: [
        {
          // @ts-expect-error — edict triggered modifiers run in country scope
          when: hasPlanetFlag("planet_only"),
          modifiers: (m) => m.country.naval.cap.mult(0.1),
        },
      ],
      effect: (country) => {
        // @ts-expect-error — edict effects run in country, not planet, scope
        country.setPlanetFlag("planet_only");
      },
    });
    defineDecision({
      id: "content_types_decision_scoped",
      name: "X",
      effect: () => {},
      showTechUnlockIf: hasAuthority("auth_democratic"),
    });
    // A decision's own clauses take the scope the *definition* declares, since
    // CWT scopes the body `this = any` and means it. Unstated, that is `planet`
    // — the scope every one of the 111 shipped decisions is written against.
    defineDecision({
      id: "content_types_decision_default_scope",
      name: "X",
      potential: isCapital(),
      effect: (planet) => planet.setPlanetFlag("content_types_planet_only"),
    });
    defineDecision({
      id: "content_types_decision_ship_scope",
      name: "X",
      scope: "ship",
      potential: hasShipFlag("content_types_ship_only"),
      effect: (ship) => ship.setShipFlag("content_types_ship_only"),
    });
    defineDecision({
      id: "content_types_decision_wrong_scope",
      name: "X",
      scope: "ship",
      // @ts-expect-error — this decision declared ship scope, so a planet
      // condition no longer type-checks in it
      potential: hasPlanetFlag("content_types_planet_only"),
      effect: () => {},
    });
    defineDecision({
      id: "content_types_decision_unknown_scope",
      name: "X",
      // @ts-expect-error — the parameter is the registry's declared set, not
      // every scope the game has
      scope: "country",
      effect: () => {},
    });
    defineJob({
      id: "content_types_job_scoped",
      name: "X",
      possible: canJoinFactions(),
      countryModifier: (m) => {
        m.country.unity.produces.mult(0.05);
      },
      planetModifier: (m) => {
        // @ts-expect-error — federation-only modifier in colony scope
        m.cohesion.ethics.penalty.mult(0.1);
      },
      triggeredCountryModifier: [
        {
          // @ts-expect-error — job triggered country modifiers run in country scope
          when: hasPlanetFlag("planet_only"),
          modifiers: (m) => m.country.unity.produces.mult(0.05),
        },
      ],
    });
    defineOpinionModifier({
      id: "content_types_opinion_modifier_scoped",
      name: "X",
      opinion: {
        base: 10,
        // @ts-expect-error — opinion modifiers run in country scope
        modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }],
      },
      // @ts-expect-error — the opinion modifier's own trigger runs in country scope
      trigger: hasPlanetFlag("planet_only"),
    });
    defineCasusBelli({
      id: "content_types_casus_belli_scoped",
      name: "X",
      showNotification: true,
      // @ts-expect-error — casus belli triggers run in country scope
      potential: hasPlanetFlag("planet_only"),
    });
    defineWarGoal({
      id: "content_types_war_goal_scoped",
      name: "X",
      casusBelli: "some_casus_belli",
      // @ts-expect-error — war goal ai_weight gates run in country scope
      aiWeight: { modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }] },
    });
    defineBombardmentStance({
      id: "content_types_bombardment_stance_scoped",
      name: "X",
      // @ts-expect-error — bombardment stance triggers run in fleet scope
      trigger: hasCountryFlag("country_only"),
      default: false,
      aiWeight: { base: 1 },
    });
    defineArchaeologicalSiteType({
      id: "content_types_archaeological_site_type_scoped",
      name: "X",
      stages: 1,
      allow: canGoMia(),
      visible: hasAuthority("auth_democratic"),
      onRollFailed: () => {},
      weight: {
        base: 1,
        // @ts-expect-error — archaeological site weight gates run in planet scope
        modifiers: [{ factor: 2, when: hasCountryFlag("country_only") }],
      },
    });
  });

  it("keeps subtype fields optional rather than introducing a union", () => {
    defineBuilding({
      id: "content_types_building_capital_tier",
      name: "X",
      capitalTier: 2,
    });
    defineEdict({
      id: "content_types_edict_wartime",
      name: "X",
      length: 360,
      icon: "GFX_edict_x",
      // @ts-expect-error — the wartime subtype marker can only be enabled
      isWartimeEdict: false,
    });
  });

  it("rejects only what the emitter cannot express", () => {
    // `onEnabled` used to be rejected because no one had added it to a curated
    // list. It lowers cleanly and is now part of the surface. What stays out is
    // what the emitter genuinely cannot lower.
    defineTradition({
      id: "content_types_tradition_effect",
      name: "X",
      onEnabled: () => {},
    });
    defineJob({
      id: "content_types_job_unlowerable",
      name: "X",
      // @ts-expect-error — swappable_data's own `default` sub-struct is required
      swappableData: {},
    });
    defineJob({
      id: "content_types_job_swappable_data",
      name: "X",
      // The struct field shape now expresses swappable_data's two-level nesting:
      // a required `default` struct plus a repeated `swap_type` struct list.
      swappableData: {
        default: { desc: "content_types_job_swappable_default_desc" },
        swapType: [{ trigger: isCapital(), weight: 1 }],
      },
    });
    defineAgenda({
      id: "content_types_agenda_localisation_alias",
      name: "X",
      agendaCost: 100,
      // @ts-expect-error — duplicate CWT localization aliases collapse to the canonical name slot
      councilAgendaName: "Duplicate",
    });
  });

  it("types an all-scalar alias splice as named booleans", () => {
    // possible_pre_triggers admits exactly the seven pop_pre_trigger members,
    // each a bool — not a Trigger, and not an open record.
    defineJob({
      id: "content_types_job_pre_triggers",
      name: "X",
      possiblePreTriggers: { hasOwner: true, isSapient: false, isRobotic: true },
    });
    defineJob({
      id: "content_types_job_pre_triggers_bad_value",
      name: "X",
      // @ts-expect-error — every pop_pre_trigger member is a bool
      possiblePreTriggers: { hasOwner: "yes" },
    });
    defineJob({
      id: "content_types_job_pre_triggers_unknown",
      name: "X",
      // @ts-expect-error — the category is closed; `is_ai` belongs to colony_pre_trigger
      possiblePreTriggers: { isAi: true },
    });
  });

  it("restricts scripted modifier category to the generated enum", () => {
    defineScriptedModifier({
      id: "content_types_scripted_modifier_category",
      category: "planet",
      // @ts-expect-error — category is drawn from enum[scripted_modifier_category], not a free string
      icon: 5,
    });
    defineScriptedModifier({
      id: "content_types_scripted_modifier_bad",
      // @ts-expect-error — an unknown category value is not a member of ScriptedModifierCategory
      category: "nonsense",
    });
  });

  it("records any scope's modifier path in a static modifier's unkeyed splice", () => {
    // static_modifier's body is the modifier grammar itself and CWT pins no
    // scope to it, so the recorder has to admit every scope's paths. The
    // distributed reading would be a union of every per-scope recorder with no
    // member in common — not even `raw`, whose name parameter would intersect
    // to `never`.
    defineStaticModifier({
      id: "content_types_static_modifier_any_scope",
      name: "X",
      modifiers: (m) => {
        m.country.unity.produces.mult(0.1);
        m.planet.jobs.alloys.produces.mult(0.1);
        m.raw("ship_weapon_damage", 0.1);
        m.unchecked("othermod_invented_mult", 0.1);
      },
    });
    defineStaticModifier({
      id: "content_types_static_modifier_bad_path",
      name: "X",
      // @ts-expect-error — a typo in any path segment is still a compile error
      modifiers: (m) => m.country.unity.produses.mult(0.1),
    });
    defineStaticModifier({
      id: "content_types_static_modifier_bad_raw",
      name: "X",
      // @ts-expect-error — raw() is checked against every known modifier name
      modifiers: (m) => m.raw("not_a_real_modifier_name", 0.1),
    });
    // A scoped modifier field keeps its own narrower recorder: widening the
    // unconstrained case must not widen the constrained ones with it.
    defineTradition({
      id: "content_types_tradition_scoped_modifier",
      name: "X",
      // @ts-expect-error — cohesion applies in federation scope, not country
      modifier: (m) => m.cohesion.ethics.penalty.mult(0.1),
    });
  });

  it("admits either arm of a dual declaration, and nothing else", () => {
    // A dual's member is the union of what CWT declares, so both forms compile
    // and a third does not. Type-level evidence matters more here than for most
    // shapes: the writer dispatches on the value's runtime form, so a value the
    // types let through but no arm accepts would throw at render time.
    defineShipSize({
      id: "content_types_ship_size_dual_list",
      name: "X",
      class: "shipclass_military",
      constructionType: ["starbase_shipyard", "starbase_beastport"],
    });
    defineShipSize({
      id: "content_types_ship_size_dual_scalar",
      name: "X",
      class: "shipclass_military",
      constructionType: "starbase_shipyard",
    });
    defineShipSize({
      id: "content_types_ship_size_dual_bad",
      name: "X",
      class: "shipclass_military",
      // @ts-expect-error — neither arm is a block: the key takes a value_set
      // member or a list of them.
      constructionType: { base: 1 },
    });
    defineStarbaseLevel({
      id: "content_types_starbase_dual_scalar",
      shipSize: "ship_size_starbase_i",
      picture: "GFX_starbase_background_outpost",
    });
    defineStarbaseLevel({
      id: "content_types_starbase_dual_block",
      shipSize: "ship_size_starbase_i",
      picture: { trigger: always(), picture: "GFX_starbase_background_outpost" },
    });
    defineStarbaseLevel({
      id: "content_types_starbase_dual_bad",
      shipSize: "ship_size_starbase_i",
      // @ts-expect-error — the block arm's own fields are still typed
      picture: { picture: 5 },
    });
  });

  it("types an engine-keyed map without imposing an id on its keys", () => {
    // A structMap key is a plain engine name and its values still get their
    // full struct type. A repeated-struct record key is an id the mod owns,
    // but it is typed `string` all the same — see the sibling case below.
    defineShipSize({
      id: "content_types_ship_size_x",
      name: "X",
      class: "shipclass_military",
      sectionSlots: {
        mid: { locator: ["part1"] },
        "1": { locator: ["part2"] },
      },
      minUpgradeCost: { alloys: 20 },
    });
    defineShipSize({
      id: "content_types_ship_size_bad_slot",
      name: "X",
      class: "shipclass_military",
      // @ts-expect-error — the slot's own fields are still typed
      sectionSlots: { mid: { locator: 5 } },
    });
    defineShipSize({
      id: "content_types_ship_size_bad_cost",
      name: "X",
      class: "shipclass_military",
      // @ts-expect-error — a scalarMap's values are numbers, not blocks
      minUpgradeCost: { alloys: { base: 20 } },
    });
    // A repeated-struct record key is `string`, not the definition's own id
    // type: a nested id is its own name, unrelated to its owner's. Typing the
    // record by the owner's `Id` only ever looked sound because both sides
    // were the same wide `PrefixedId<P>` pattern under the class API; against
    // the literal id the factory definers preserve, it demanded every swap key
    // equal the tradition's id. The prefix rule on these keys is enforced at
    // define time instead — tests/content.test.ts pins the throw.
    defineTradition({
      id: "content_types_tradition_nested_key",
      name: "X",
      traditionSwap: { othermod_swap: { name: "Accepted by the type, rejected at define" } },
    });
    expectTypeOf<
      NonNullable<Parameters<typeof defineTradition>[0]["traditionSwap"]>
    >().toEqualTypeOf<Readonly<Record<string, TraditionSwapFields>>>();
  });

  it("keeps content reference brands distinct", () => {
    const buildingRef: BuildingRef = { id: "content_types_building_brand" };
    // @ts-expect-error — a building reference is not a technology reference
    const technology: TechnologyRef = buildingRef;
    void technology;
  });

  it("types a definer's return as its own registry's content item, branded", () => {
    // The class API's answer to "what did I just define" was `DefinedBuilding`,
    // a branded `TypedRef`. The pure API's is the collection's element type —
    // and it extends `TypedRef<"building">`, so the registry name lives in the
    // phantom brand as well as the runtime `type` field. Without the brand an
    // item was structurally assignable to *every* `TypedRef`, because the brand
    // is optional; carrying it is what makes the mismatch a conflict.
    const building = defineBuilding({
      id: "content_types_building_brand_item",
      name: "X",
    });
    expectTypeOf(building).toEqualTypeOf<
      ContentItem<"building", BuildingDef<"content_types_building_brand_item">>
    >();
    expectTypeOf(collection<BuildingItem>(undefined, [building]).items).toEqualTypeOf<
      readonly BuildingItem[]
    >();
    // Its own registry's reference fields still take it directly.
    const own: BuildingRef = building;
    void own;
    // @ts-expect-error — a defined building is not a technology reference
    const crossRegistry: TechnologyRef = building;
    void crossRegistry;
  });

  it("scopes situations' repeated-struct fields per their own push_scope, not the body default", () => {
    // situation_type's body defaults every unmarked field to "situation"
    // scope, but potential replace_scopes to "country" at the top level while
    // staying "situation" inside both stages ("container" keying) and
    // approach ("siblings" keying) — so a country-scoped trigger fits the top
    // level but not either nested field. Both keyings need their own check,
    // not just the top level.
    defineSituationType({
      id: "content_types_situation_scoped",
      name: "X",
      monthlyProgress: { base: 1 },
      // Valid here — potential replace_scopes to country.
      potential: hasAuthority("auth_democratic"),
      stages: {
        content_types_situation_scoped_stage: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // @ts-expect-error — stage potential runs in situation scope, not country
          potential: hasAuthority("auth_democratic"),
        },
      },
      approach: {
        content_types_situation_scoped_approach: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // @ts-expect-error — approach allow runs in situation scope, not country
          allow: hasAuthority("auth_democratic"),
        },
      },
    });
  });

  it("keeps modifier recorders numeric and weight conditions scoped", () => {
    defineTradition({
      id: "content_types_tradition_modifier",
      name: "X",
      modifier: (m) => {
        m.planet.pop.assembly.mult(0.1);
        // @ts-expect-error — modifier values serialize as numeric assignments
        m.pop.happiness("high");
      },
    });
    expectTypeOf(hasAuthority("auth_democratic")).toExtend<Trigger<"country">>();
  });

  it("types civic_or_origin's potential/possible as the government_trigger DSL, not a Trigger", () => {
    defineCivicOrOrigin({
      id: "content_types_civic_dsl",
      name: "X",
      // The requirements DSL: a plain object, matched against empire setup —
      // not a script condition tree.
      potential: { authority: { value: "auth_democratic" } },
      possible: { or: [{ civics: { value: "content_types_civic_other" } }] },
    });
    defineCivicOrOrigin({
      id: "content_types_civic_dsl_rejects_trigger",
      name: "X",
      // @ts-expect-error — a Trigger is not a GovernmentTriggerBlock; the game
      // does not read potential/possible as script conditions.
      potential: hasAuthority("auth_democratic"),
    });
    // Every domain member (authority, civics, ethics, ...) shares one clause
    // template, differing only in which content type `value` references.
    const block: GovernmentTriggerBlock = {
      authority: { value: "auth_democratic" },
      civics: { or: [{ values: ["some_civic"] }] },
    };
    void block;
  });

  it("keeps civic_or_origin's playable/ai_playable pinned to no_scope", () => {
    defineCivicOrOrigin({
      id: "content_types_civic_no_scope",
      name: "X",
      playable: always(),
      // @ts-expect-error — playable replace_scopes to no_scope; a country-only
      // condition like hasAuthority does not hold there.
      aiPlayable: hasAuthority("auth_democratic"),
    });
  });

  it("keeps councilor's country and leader scope triggers distinct", () => {
    defineCouncilor({
      id: "content_types_councilor_scoped",
      name: "X",
      leaderClass: ["leader_class_official"],
      possible: hasAuthority("auth_democratic"),
      // @ts-expect-error — is_leader_possible runs in leader scope, not country
      isLeaderPossible: hasAuthority("auth_democratic"),
    });
  });

  it("restricts economic_category's modifier_category to the generated enum", () => {
    defineEconomicCategory({
      id: "content_types_economic_category_x",
      modifierCategory: "economic_unit",
    });
    defineEconomicCategory({
      id: "content_types_economic_category_bad",
      // @ts-expect-error — modifier_category is drawn from enum[scripted_modifier_category]
      modifierCategory: "nonsense",
    });
  });

  it("requires an entity on ambient_object but leaves name/description optional", () => {
    defineAmbientObject({
      id: "content_types_ambient_object_x",
      entity: "some_entity",
    });
    // @ts-expect-error — entity has no default and must be supplied
    defineAmbientObject({
      id: "content_types_ambient_object_missing_entity",
    });
  });

  it("pins section_template's modifier/ship_modifier to ship scope", () => {
    // Both fields carry `## replace_scopes = { this = ship root = ship }` and
    // no scope-parameterized generic — the generated shape is exactly
    // ModifierClosure<"ship">, not the wider ScopeName civic_or_origin's own
    // (unscoped) swap_type.modifier needs.
    expectTypeOf<SectionTemplateFields["modifier"]>().toEqualTypeOf<
      ModifierClosure<"ship"> | undefined
    >();
    expectTypeOf<SectionTemplateFields["shipModifier"]>().toEqualTypeOf<
      ModifierClosure<"ship"> | undefined
    >();
    defineSectionTemplate({
      id: "content_types_section_template_x",
      entity: "some_entity",
      modifier: (m) => m.unchecked("ship_hull_add", 10),
    });
  });

  it("pins starbase_level's upgrade/downgrade triggers to starbase scope", () => {
    defineStarbaseLevel({
      id: "content_types_starbase_level_x",
      shipSize: "ship_size_starbase_i",
      upgradePossible: always(),
      // @ts-expect-error — upgrade_possible replace_scopes to starbase; a
      // country-only condition like hasAuthority does not hold there.
      downgradePotential: hasAuthority("auth_democratic"),
    });
  });

  it("types species_class's possible/possible_secondary as the government_trigger DSL, not a Trigger", () => {
    defineSpeciesClass({
      id: "content_types_species_class_dsl",
      name: "X",
      possible: { authority: { value: "auth_democratic" } },
      possibleSecondary: { or: [{ ethics: { value: "ethic_xenophile" } }] },
    });
    defineSpeciesClass({
      id: "content_types_species_class_dsl_rejects_trigger",
      name: "X",
      // @ts-expect-error — a Trigger is not a GovernmentTriggerBlock; the game
      // does not read possible/possible_secondary as script conditions.
      possible: hasAuthority("auth_democratic"),
    });
  });

  it("keeps species_class's playable scope-agnostic like tradition_swap's trigger", () => {
    // No `## replace_scopes` on playable, so it stays Trigger<ScopeName> —
    // only a universal trigger like always() type-checks.
    defineSpeciesClass({
      id: "content_types_species_class_playable",
      name: "X",
      playable: always(),
    });
    defineSpeciesClass({
      id: "content_types_species_class_playable_rejects_country_only",
      name: "X",
      // @ts-expect-error — hasAuthority only holds in country scope, not
      // every scope playable's ScopeName type demands.
      playable: hasAuthority("auth_democratic"),
    });
  });

  it("brands country_ship_of_size_limit.ship_types on the ship_size registry, not just any content ref", () => {
    // `<ship_size>` in the CWT body — a defined ship_size or a raw vanilla
    // string both work, same widening every other branded-ref list gets.
    const shipSize = defineShipSize({
      id: "content_types_ship_size_for_limit",
      name: "X",
      class: "shipclass_military",
    });
    defineCountryShipOfSizeLimit({
      id: "content_types_ship_of_size_limit_x",
      shipTypes: [shipSize, "ship_size_titan"],
      base: 80,
      show: always(),
    });
    const wrongBrand: TechnologyRef = { id: "tech_lasers_1" } as TechnologyRef;
    defineCountryShipOfSizeLimit({
      id: "content_types_ship_of_size_limit_bad_ref",
      // @ts-expect-error — a TechnologyRef is not a ShipSizeRef; the two
      // brands must not be interchangeable even though both widen with string.
      shipTypes: [wrongBrand],
      base: 80,
      show: always(),
    });
  });

  it("scopes the ship-of-size limit's show clause to country", () => {
    // The overlay asserts the scope CWT omits. Without it `show` is
    // Trigger<ScopeName> — required, and unable to hold the country condition
    // every shipped entry writes.
    const limit = defineCountryShipOfSizeLimit({
      id: "content_types_ship_of_size_limit_scoped",
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: hasAuthority("auth_democratic"),
    });
    defineCountryShipOfSizeLimit({
      id: "content_types_ship_of_size_limit_wrong_scope",
      shipTypes: ["ship_size_titan"],
      base: 80,
      // @ts-expect-error — the clause runs in country scope, not planet
      show: hasPlanetFlag("planet_only"),
    });
    // The ownership limit takes definitions or raw ids, and never an id of
    // its own — the engine owns that key.
    addShipOfSizeLimits([limit, "some_other_mods_limit"]);
    const wrongRegistry = defineBuilding({
      id: "content_types_ship_of_size_limit_wrong_registry",
      name: "X",
    });
    // @ts-expect-error — a definition from another registry is rejected: items
    // carry their registry's brand, so this needs no hand-branded stand-in.
    addShipOfSizeLimits([wrongRegistry]);
  });

  it("types a solar system initializer's planet tree recursively", () => {
    const outpost = defineSolarSystemInitializer({
      id: "content_types_system_outpost",
      class: "sc_g",
    });
    // The literal id survives the definer, the same as every other registry.
    expectTypeOf(outpost.id).toEqualTypeOf<"content_types_system_outpost">();
    defineSolarSystemInitializer({
      id: "content_types_system_deep",
      class: "sc_g",
      // Four levels, alternating both arms of the mutual recursion: the
      // interfaces refer to each other by name, so depth is unbounded.
      planet: [{ planet: [{ moon: [{ moon: [{ size: 4 }] }] }] }],
      // A branded ref into this registry's own reference field, and a raw
      // vanilla id beside it.
      neighborSystem: [{ initializer: outpost }, { initializer: "sol_system_initializer" }],
    });
  });

  it("keeps the planet and moon bodies distinct, and the registry's refs branded", () => {
    const outpost = defineSolarSystemInitializer({
      id: "content_types_system_for_refs",
      class: "sc_g",
    });
    defineSolarSystemInitializer({
      id: "content_types_system_bad_moon",
      class: "sc_g",
      // @ts-expect-error — CWT declares no nested `planet` inside `moon`, so a
      // moon cannot carry planets even though a planet can carry moons.
      planet: [{ moon: [{ planet: [{ size: 4 }] }] }],
    });
    const wrongRegistry = defineBuilding({
      id: "content_types_system_wrong_registry",
      name: "X",
    });
    defineSolarSystemInitializer({
      id: "content_types_system_wrong_ref",
      class: "sc_g",
      // @ts-expect-error — a BuildingRef is not a SolarSystemInitializerRef.
      neighborSystem: [{ initializer: wrongRegistry }],
    });
    // A system flows into another registry's field that names this one:
    // governments.cwt types civic/origin `initializers` as
    // `<solar_system_initializer>`.
    defineCivicOrOrigin({
      id: "content_types_origin_with_system",
      name: "X",
      initializers: [outpost],
    });
  });

  it("scopes a solar system initializer's effect clauses by depth", () => {
    defineSolarSystemInitializer({
      id: "content_types_system_scopes",
      class: "sc_g",
      // The top-level clause runs in the system (galactic_object) scope...
      initEffect: (system) => {
        system.setStarFlag("content_types_flag");
      },
      planet: [
        {
          // ...and a planet's own runs in planet scope, from the nested
          // `## replace_scopes = { this = planet }` rather than any overlay row.
          initEffect: (planet) => {
            planet.setCapital(true);
          },
        },
      ],
    });
  });
});
