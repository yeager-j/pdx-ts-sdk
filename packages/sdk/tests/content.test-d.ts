import { describe, expectTypeOf, it } from "vitest";

import { defineBuilding } from "../src/generated/content-definers.ts";
import {
  always,
  canGoMia,
  canJoinFactions,
  createMod,
  currentSituationApproach,
  currentStage,
  hasAuthority,
  hasCountryFlag,
  hasPlanetFlag,
  hasShipFlag,
  isAtWar,
  isCapital,
  isSiteLocked,
  makeScope,
  or,
  vanilla,
  type AgendaRef,
  type AgreementPresetRef,
  type ArchaeologicalSiteTypeRef,
  type AscensionPerkRef,
  type BombardmentStanceRef,
  type BuildingDef,
  type BuildingFields,
  type BuildingItem,
  type BuildingRef,
  type CasusBelliRef,
  type ComponentTemplateRef,
  type ComponentTemplateUtilityComponentTemplateRef,
  type ContentItem,
  type DecisionRef,
  type EconomicResourceBlock,
  type EconomicResourceBlockNoProduce,
  type EdictRef,
  type EventFleetRef,
  type GovernmentTriggerBlock,
  type JobRef,
  type ModifierClosure,
  type OpinionModifierRef,
  type ScopeRef,
  type ScriptValue,
  type SectionTemplateFields,
  type StrikeCraftComponentTemplateFields,
  type TechnologyRef,
  type TraditionSwapFields,
  type Trigger,
  type TriggeredModifier,
  type UtilityComponentTemplateFields,
  type WarGoalRef,
  type WeaponComponentTemplateFields,
} from "../src/index.ts";

const CONTENT_TYPES_CONFIG = {
  name: "Content types",
  prefix: "content_types",
  supportedVersion: "4.4.*",
} as const;
const defaultContentMod = createMod(CONTENT_TYPES_CONFIG);
const contentMod = createMod(CONTENT_TYPES_CONFIG, {
  ids: {
    ...defaultContentMod.ids,
    situationType: "situation",
    civicOrOrigin: "civic",
    solarSystemInitializer: "system",
    starbaseLevel: "starbase",
    utilityComponentTemplate: "util",
    weaponComponentTemplate: "weapon",
    strikeCraftComponentTemplate: "strike_craft",
    globalShipDesign: "ship_design",
  },
});
const legacyCountryLimitMod = createMod(CONTENT_TYPES_CONFIG, {
  ids: { ...defaultContentMod.ids, countryShipOfSizeLimit: "ship_of_size_limit" },
});
const originMod = createMod(CONTENT_TYPES_CONFIG, {
  ids: { ...defaultContentMod.ids, civicOrOrigin: "origin" },
});
const SDK45_CONFIG = { name: "SDK-45 types", prefix: "sdk45", supportedVersion: "4.4.*" } as const;
const defaultSdk45Mod = createMod(SDK45_CONFIG);
const sdk45Mod = createMod(SDK45_CONFIG, {
  ids: { ...defaultSdk45Mod.ids, weaponComponentTemplate: "weapon" },
});

describe("generated content authoring types", () => {
  it("does not invent a category field on traditions", () => {
    contentMod.tradition("without_category", {
      name: "No synthetic membership",
      // @ts-expect-error — membership belongs to TraditionCategoryDef.traditions
      category: "content_types_tradition_category_x",
    });
  });

  it("carries inherited and explicit trigger scopes", () => {
    contentMod.building("x", {
      name: "X",
      allow: isCapital(),
      // @ts-expect-error — a country-only condition is not valid in colony scope
      potential: hasCountryFlag("country_only"),
    });
    contentMod.tradition("scoped", {
      name: "X",
      possible: hasAuthority("auth_democratic"),
      // @ts-expect-error — tradition weights and conditions run in country scope
      aiWeight: { modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }] },
    });
    contentMod.agenda("scoped", {
      name: "X",
      agendaCost: 100,
      effect: (country) => {
        country.setCountryFlag("country_only");
        // @ts-expect-error — agenda effects run in country, not planet, scope
        country.setPlanetFlag("planet_only");
      },
    });
    contentMod.ascensionPerk("scoped", {
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
    contentMod.edict("scoped", {
      name: "X",
      length: 360,
      icon: "GFX_edict_x",
      resources: [
        {
          upkeep: {
            amounts: { unity: 1 },
            when: hasAuthority("auth_democratic"),
            // `mult` is `modifier_rule.cwt`'s `value_field` (widenedLowering),
            // so a scripted-variable string like this one is a legitimate
            // form, not an error — see the dedicated ScriptValue coverage
            // below for the still-rejected shapes.
            mult: "some_scripted_variable",
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
    contentMod.decision("scoped", {
      name: "X",
      effect: () => {},
      showTechUnlockIf: hasAuthority("auth_democratic"),
    });
    // A decision's own clauses take the scope the *definition* declares, since
    // CWT scopes the body `this = any` and means it. Unstated, that is `planet`
    // — the scope every one of the 111 shipped decisions is written against.
    contentMod.decision("default_scope", {
      name: "X",
      potential: isCapital(),
      effect: (planet) => planet.setPlanetFlag("content_types_planet_only"),
    });
    contentMod.decision("ship_scope", {
      name: "X",
      scope: "ship",
      potential: hasShipFlag("content_types_ship_only"),
      effect: (ship) => ship.setShipFlag("content_types_ship_only"),
    });
    contentMod.decision("wrong_scope", {
      name: "X",
      scope: "ship",
      // @ts-expect-error — this decision declared ship scope, so a planet
      // condition no longer type-checks in it
      potential: hasPlanetFlag("content_types_planet_only"),
      effect: () => {},
    });
    contentMod.decision("unknown_scope", {
      name: "X",
      // @ts-expect-error — the parameter is the registry's declared set, not
      // every scope the game has
      scope: "country",
      effect: () => {},
    });
    contentMod.job("scoped", {
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
    contentMod.opinionModifier("scoped", {
      name: "X",
      opinion: {
        base: 10,
        // @ts-expect-error — opinion modifiers run in country scope
        modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }],
      },
      // @ts-expect-error — the opinion modifier's own trigger runs in country scope
      trigger: hasPlanetFlag("planet_only"),
    });
    contentMod.casusBelli("scoped", {
      name: "X",
      showNotification: true,
      // @ts-expect-error — casus belli triggers run in country scope
      potential: hasPlanetFlag("planet_only"),
    });
    contentMod.warGoal("scoped", {
      name: "X",
      casusBelli: "some_casus_belli",
      // @ts-expect-error — war goal ai_weight gates run in country scope
      aiWeight: { modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }] },
    });
    contentMod.bombardmentStance("scoped", {
      name: "X",
      // @ts-expect-error — bombardment stance triggers run in fleet scope
      trigger: hasCountryFlag("country_only"),
      default: false,
      aiWeight: { base: 1 },
    });
    contentMod.archaeologicalSiteType("scoped", {
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

  it("hands an effect block the FROM its rules declare, at that scope", () => {
    // `on_roll_failed` runs with this=fleet and from=archaeological site, and
    // the common vanilla shape for it is a `from = { ... }` block. Without a
    // typed ctx the author has no way to name FROM at all.
    contentMod.archaeologicalSiteType("from", {
      name: "X",
      stages: 1,
      allow: canGoMia(),
      visible: hasAuthority("auth_democratic"),
      onRollFailed: (fleet, ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"archaeological_site">>();
        ctx.from.effects((site) => {
          site.addExpeditionLogEntry({ title: "The dig fails." });
        });
      },
      onCreate: (site, ctx) => {
        // Same registry, and CWT gives this one a `push_scope` with no FROM:
        // the ctx is still there, and reading FROM through it does not compile.
        site.addExpeditionLogEntry({ title: "The dig begins." });
        // @ts-expect-error — on_create declares no FROM; ctx.from is an inert sentinel
        ctx.from.effects(() => {});
      },
    });
  });

  it("offers a declarative field the same FROM, as a closure form", () => {
    // A trigger is a value, so a FROM-bearing trigger field takes either the
    // value or a closure that produces it — the closure being the only place
    // an argument list exists to hand FROM to.
    contentMod.archaeologicalSiteType("trigger_from", {
      name: "X",
      stages: 1,
      allow: (ctx) => ctx.from.trigger(isSiteLocked()),
      // The plain form is untouched: a condition with no FROM to name has no
      // reason to grow a closure around it.
      visible: hasAuthority("auth_democratic"),
      onRollFailed: () => {},
    });
    contentMod.archaeologicalSiteType("trigger_scope", {
      name: "X",
      stages: 1,
      // @ts-expect-error — FROM is the archaeological site here, not a country
      allow: (ctx) => ctx.from.trigger(hasCountryFlag("country_only")),
      visible: hasAuthority("auth_democratic"),
      onRollFailed: () => {},
    });
    contentMod.archaeologicalSiteType("trigger_plain_scope", {
      name: "X",
      stages: 1,
      // @ts-expect-error — and the closure form does not weaken the plain one:
      // a trigger's own scope is still checked against the field
      allow: hasCountryFlag("country_only"),
      visible: hasAuthority("auth_democratic"),
      onRollFailed: () => {},
    });
    contentMod.warGoal("weight_from", {
      name: "X",
      casusBelli: "cb_humiliation",
      // A weight block's rows are conditions too, so the same form covers them.
      aiWeight: (ctx) => ({
        base: 10,
        modifiers: [{ factor: 2, when: ctx.from.trigger(isAtWar()) }],
      }),
    });
  });

  it("scopes an effect block's FROM per registry, not per SDK convention", () => {
    // A war goal's FROM is the targeted country, so the ref lands in country
    // scope — the type follows each registry's own rules rather than a shared
    // guess about what FROM tends to be.
    contentMod.warGoal("from", {
      name: "X",
      casusBelli: "cb_humiliation",
      onAccept: (country, ctx) => {
        ctx.from.effects((target) => {
          target.setCountryFlag("content_types_war_goal_accepted");
          // @ts-expect-error — FROM is a country here, not a planet
          target.setPlanetFlag("planet_only");
        });
      },
    });
  });

  it("keeps subtype fields optional rather than introducing a union", () => {
    contentMod.building("capital_tier", {
      name: "X",
      capitalTier: 2,
    });
    contentMod.edict("wartime", {
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
    contentMod.tradition("effect", {
      name: "X",
      onEnabled: () => {},
    });
    contentMod.job("unlowerable", {
      name: "X",
      // @ts-expect-error — swappable_data's own `default` sub-struct is required
      swappableData: {},
    });
    contentMod.job("swappable_data", {
      name: "X",
      // The struct field shape now expresses swappable_data's two-level nesting:
      // a required `default` struct plus a repeated `swap_type` struct list.
      swappableData: {
        default: { desc: "content_types_job_swappable_default_desc" },
        swapType: [{ trigger: isCapital(), weight: 1 }],
      },
    });
    contentMod.agenda("localisation_alias", {
      name: "X",
      agendaCost: 100,
      // @ts-expect-error — duplicate CWT localization aliases collapse to the canonical name slot
      councilAgendaName: "Duplicate",
    });
  });

  it("types an all-scalar alias splice as named booleans", () => {
    // possible_pre_triggers admits exactly the seven pop_pre_trigger members,
    // each a bool — not a Trigger, and not an open record.
    contentMod.job("pre_triggers", {
      name: "X",
      possiblePreTriggers: { hasOwner: true, isSapient: false, isRobotic: true },
    });
    contentMod.job("pre_triggers_bad_value", {
      name: "X",
      // @ts-expect-error — every pop_pre_trigger member is a bool
      possiblePreTriggers: { hasOwner: "yes" },
    });
    contentMod.job("pre_triggers_unknown", {
      name: "X",
      // @ts-expect-error — the category is closed; `is_ai` belongs to colony_pre_trigger
      possiblePreTriggers: { isAi: true },
    });
  });

  it("restricts scripted modifier category to the generated enum", () => {
    contentMod.scriptedModifier("category", {
      category: "planet",
      // @ts-expect-error — category is drawn from enum[scripted_modifier_category], not a free string
      icon: 5,
    });
    contentMod.scriptedModifier("bad", {
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
    contentMod.staticModifier("any_scope", {
      name: "X",
      modifiers: (m) => {
        m.country.unity.produces.mult(0.1);
        m.planet.jobs.alloys.produces.mult(0.1);
        m.raw("ship_weapon_damage", 0.1);
        m.unchecked("othermod_invented_mult", 0.1);
      },
    });
    contentMod.staticModifier("bad_path", {
      name: "X",
      // @ts-expect-error — a typo in any path segment is still a compile error
      modifiers: (m) => m.country.unity.produses.mult(0.1),
    });
    contentMod.staticModifier("bad_raw", {
      name: "X",
      // @ts-expect-error — raw() is checked against every known modifier name
      modifiers: (m) => m.raw("not_a_real_modifier_name", 0.1),
    });
    // A scoped modifier field keeps its own narrower recorder: widening the
    // unconstrained case must not widen the constrained ones with it.
    contentMod.tradition("scoped_modifier", {
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
    contentMod.shipSize("dual_list", {
      name: "X",
      class: "shipclass_military",
      constructionType: ["starbase_shipyard", "starbase_beastport"],
    });
    contentMod.shipSize("dual_scalar", {
      name: "X",
      class: "shipclass_military",
      constructionType: "starbase_shipyard",
    });
    contentMod.shipSize("dual_bad", {
      name: "X",
      class: "shipclass_military",
      // @ts-expect-error — neither arm is a block: the key takes a value_set
      // member or a list of them.
      constructionType: { base: 1 },
    });
    contentMod.starbaseLevel("dual_scalar", {
      shipSize: "ship_size_starbase_i",
      picture: "GFX_starbase_background_outpost",
    });
    contentMod.starbaseLevel("dual_block", {
      shipSize: "ship_size_starbase_i",
      picture: { trigger: always(), picture: "GFX_starbase_background_outpost" },
    });
    contentMod.starbaseLevel("dual_bad", {
      shipSize: "ship_size_starbase_i",
      // @ts-expect-error — the block arm's own fields are still typed
      picture: { picture: 5 },
    });
  });

  it("types an engine-keyed map without imposing an id on its keys", () => {
    // A structMap key is a plain engine name and its values still get their
    // full struct type. A repeated-struct record key is an id the mod owns,
    // but it is typed `string` all the same — see the sibling case below.
    contentMod.shipSize("x", {
      name: "X",
      class: "shipclass_military",
      sectionSlots: {
        mid: { locator: ["part1"] },
        "1": { locator: ["part2"] },
      },
      minUpgradeCost: { alloys: 20 },
    });
    contentMod.shipSize("bad_slot", {
      name: "X",
      class: "shipclass_military",
      // @ts-expect-error — the slot's own fields are still typed
      sectionSlots: { mid: { locator: 5 } },
    });
    contentMod.shipSize("bad_cost", {
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
    contentMod.tradition("nested_key", {
      name: "X",
      traditionSwap: { othermod_swap: { name: "Accepted by the type, rejected at define" } },
    });
    expectTypeOf<
      NonNullable<Parameters<typeof contentMod.tradition>[1]["traditionSwap"]>
    >().toEqualTypeOf<Readonly<Record<string, TraditionSwapFields>>>();
  });

  it("keeps content reference brands distinct", () => {
    const buildingRef: BuildingRef = { id: "content_types_building_brand" };
    // @ts-expect-error — a building reference is not a technology reference
    const technology: TechnologyRef = buildingRef;
    void technology;
  });

  it("brands a defined event by its scope, so an event reference is checked too", () => {
    // An event carried no brand at all, and `TypedRef`'s is optional — so an
    // event was structurally a reference for *every* registry. A country event
    // satisfied an archaeology stage's `<event.fleet>`, and a `<technology>`
    // field just as readily. The game would have refused both.
    const events = contentMod.namespace("event_brand");
    const fleetEvent = events.fleet(1, { isTriggeredOnly: true });
    const countryEvent = events.country(2, { isTriggeredOnly: true });

    const fleetRef: EventFleetRef = fleetEvent;
    void fleetRef;
    // @ts-expect-error — a stage's event is <event.fleet>; a country event is not one
    const wrongScope: EventFleetRef = countryEvent;
    void wrongScope;
    // @ts-expect-error — nor is an event a reference into some unrelated registry
    const wrongRegistry: TechnologyRef = countryEvent;
    void wrongRegistry;

    contentMod.archaeologicalSiteType("stage_event", {
      name: "X",
      stages: 1,
      allow: canGoMia(),
      visible: hasAuthority("auth_democratic"),
      onRollFailed: () => {},
      stage: [
        { difficulty: 1, icon: "GFX_x", event: fleetEvent },
        // @ts-expect-error — the reported bug: a country event in a fleet event's field
        { difficulty: 2, icon: "GFX_x", event: countryEvent },
      ],
    });
  });

  it("brands a registry split off a shared CWT type by the reference the rules use", () => {
    // Three registries share `type[component_template]`, one per subtype, so
    // the SDK names them after the subtype and the rules refer to them as
    // `<component_template.utility_component_template>`. Branding a definition
    // with the SDK's own registry name — a name no rule uses — left it unable
    // to reach any field that references one, in either form.
    const util = contentMod.utilityComponentTemplate("component", {
      icon: "GFX_x",
      power: -10,
    });
    const weapon = contentMod.weaponComponentTemplate("component", {
      icon: "GFX_x",
    });

    const unqualified: ComponentTemplateRef = util;
    const qualified: ComponentTemplateUtilityComponentTemplateRef = util;
    void unqualified;
    void qualified;
    // @ts-expect-error — the subtypes stay distinct: a weapon is not a utility component
    const wrongSubtype: ComponentTemplateUtilityComponentTemplateRef = weapon;
    void wrongSubtype;
    // @ts-expect-error — nor does the shared CWT type make it some other registry
    const wrongRegistry: TechnologyRef = util;
    void wrongRegistry;

    // A vanilla id is the same kind of thing, so it wears the same brand.
    const fromVanilla: ComponentTemplateUtilityComponentTemplateRef =
      vanilla.utilityComponentTemplate("SHIELD_1");
    void fromVanilla;

    contentMod.globalShipDesign("components", {
      shipSize: "ship_size_corvette",
      growthStages: [{ shipSize: "ship_size_corvette", requiredComponent: [util] }],
    });
  });

  it("authors component template resources/modifier, SMALL_SHIELD_1's missing fields (componentTemplateResources)", () => {
    // SDK-31: utility_component_template.resources/modifier carry
    // `## replace_scopes = { this = ship root = ship }`
    // (weapon/ship_design_modifier: `{ this = design root = design }`), so
    // the generated shape is exactly ModifierClosure<"ship">/<"design">, the
    // same per-field scope pinning section_template's modifier/ship_modifier
    // already exercises just above.
    expectTypeOf<UtilityComponentTemplateFields["resources"]>().toEqualTypeOf<
      EconomicResourceBlock<"ship">[] | undefined
    >();
    expectTypeOf<UtilityComponentTemplateFields["modifier"]>().toEqualTypeOf<
      ModifierClosure<"ship"> | undefined
    >();
    expectTypeOf<UtilityComponentTemplateFields["shipDesignModifier"]>().toEqualTypeOf<
      ModifierClosure<"design"> | undefined
    >();
    expectTypeOf<UtilityComponentTemplateFields["triggeredShipModifier"]>().toEqualTypeOf<
      TriggeredModifier<"ship">[] | undefined
    >();
    // weapon/strike-craft splice economic_template_no_produce, not plain
    // economic_template (components.cwt:189, :338 vs :405), so their
    // resources arm is EconomicResourceBlockNoProduce rather than
    // EconomicResourceBlock — no `produces` member at all.
    expectTypeOf<WeaponComponentTemplateFields["resources"]>().toEqualTypeOf<
      EconomicResourceBlockNoProduce<"ship">[] | undefined
    >();
    expectTypeOf<WeaponComponentTemplateFields["modifier"]>().toEqualTypeOf<
      ModifierClosure<"ship"> | undefined
    >();
    // strike_craft_component_template declares only resources and
    // ship_modifier (components.cwt:332-343) — no modifier of its own.
    expectTypeOf<StrikeCraftComponentTemplateFields["shipModifier"]>().toEqualTypeOf<
      ModifierClosure<"ship"> | undefined
    >();
    expectTypeOf<StrikeCraftComponentTemplateFields["resources"]>().toEqualTypeOf<
      EconomicResourceBlockNoProduce<"ship">[] | undefined
    >();

    // A ported SMALL_SHIELD_1: before this cluster, both fields below
    // type-checked as extra properties (Fields interfaces are not `exact`,
    // so an author never got a compile error) and were silently dropped by
    // the writer, which only iterates the declared ContentField[]. Now they
    // are real, declared members.
    contentMod.utilityComponentTemplate("small_shield", {
      icon: "GFX_shield",
      power: 5,
      size: "small",
      resources: [{ category: "ship_components", cost: { amounts: { alloys: 20 } } }],
      modifier: (m) => m.unchecked("ship_shield_hit_points_add", 200),
    });

    // Utility splices plain economic_template, so `produces` is genuinely
    // legal there and stays authorable.
    contentMod.utilityComponentTemplate("utility_produces", {
      icon: "GFX_x",
      resources: [{ category: "ship_components", produces: { amounts: { energy: 1 } } }],
    });

    contentMod.weaponComponentTemplate("resources", {
      icon: "GFX_x",
      resources: [{ category: "ship_weapon_components", cost: { amounts: { alloys: 10 } } }],
      shipModifier: (m) => m.unchecked("ship_weapon_damage_mult", 0.1),
      shipDesignModifier: (m) => m.unchecked("design_ship_weapon_damage_mult", 0.1),
    });

    // The produces question (SDK-31 constraint (a), closed by the
    // EconomicResourceBlockNoProduce follow-up): weapon/strike-craft splice
    // economic_template_no_produce in CWT, so `produces` is not game-legal on
    // either, and it no longer type-checks on either registry's resources.
    contentMod.weaponComponentTemplate("produces_illegal", {
      icon: "GFX_x",
      resources: [
        {
          category: "ship_weapon_components",
          // @ts-expect-error — weapon_component_template splices economic_template_no_produce
          produces: { amounts: { alloys: 1 } },
        },
      ],
    });

    contentMod.strikeCraftComponentTemplate("resources", {
      icon: "GFX_x",
      resources: [{ category: "ship_components", cost: { amounts: { alloys: 15 } } }],
      shipModifier: (m) => m.unchecked("ship_hull_add", 10),
      // @ts-expect-error — strike_craft_component_template declares no modifier of its own
      modifier: (m) => m.unchecked("ship_hull_add", 10),
    });

    contentMod.strikeCraftComponentTemplate("produces_illegal", {
      icon: "GFX_x",
      resources: [
        {
          category: "ship_components",
          // @ts-expect-error — strike_craft_component_template splices economic_template_no_produce
          produces: { amounts: { alloys: 1 } },
        },
      ],
    });
  });

  it("widens EconomicResourceBlock.category to the generated EconomicCategoryRef (sdk45EconomicCategoryRef)", () => {
    // SDK-45: `category` was hand-written as `TypedRef<"economic_category">`
    // while every generated helper (and every other cross-content reference
    // field) produces the wider `EconomicCategoryRef`, so a checked
    // `vanilla.economicCategory(...)` call did not type-check into it.
    sdk45Mod.edict("economic_category_ref", {
      name: "Sdk45 Edict",
      length: 30,
      icon: "GFX_x",
      resources: [
        { category: vanilla.economicCategory("ships"), cost: { amounts: { alloys: 1 } } },
      ],
    });
    // EconomicResourceBlockNoProduce is Omit<EconomicResourceBlock, "produces">,
    // so the fix on the base interface propagates automatically — no separate
    // row needed for weapon/strike-craft's own resources field.
    sdk45Mod.weaponComponentTemplate("economic_category_ref", {
      icon: "GFX_x",
      resources: [
        { category: vanilla.economicCategory("ships"), cost: { amounts: { alloys: 1 } } },
      ],
    });
  });

  it("brands an event by its CWT subtype, which is not always its scope", () => {
    // `observer_event` is subtype `observer` in country scope, and
    // `cosmic_storm_event` is subtype `cosmic_storm` in storm scope. Branding
    // by the scope would call an observer event an `<event.country>` — a
    // reference the rules never write for it — and let an ordinary country
    // event be fired as one, which is a different event type to the game.
    const events = contentMod.namespace("event_kind");
    const observer = events.observer(1, { isTriggeredOnly: true });
    const country = events.country(2, { isTriggeredOnly: true });
    const scope = makeScope<"country">([]);

    scope.observerEvent({ id: observer });
    scope.countryEvent({ id: country });
    // @ts-expect-error — an observer event is not what `country_event` fires
    scope.countryEvent({ id: observer });
    // @ts-expect-error — nor is a country event what `observer_event` fires
    scope.observerEvent({ id: country });
  });

  it("lets an unqualified reference field take any of that type's subtypes", () => {
    // `set_next_astral_rift_event` takes `<event>` — the whole type, subtypes
    // included — so an event of any scope satisfies it. The relation runs only
    // that way: an `<event.fleet>` field still refuses a bare `<event>`, which
    // proves nothing about which subtype it is (covered by the case above).
    const events = contentMod.namespace("event_any");
    const astralRiftEvent = events.astralRift(1, { isTriggeredOnly: true });
    const fleetEvent = events.fleet(2, { isTriggeredOnly: true });
    const rift = makeScope<"astral_rift">([]);

    rift.setNextAstralRiftEvent({ id: astralRiftEvent, onRollFailed: fleetEvent });
    rift.setNextAstralRiftEvent({ id: "vanilla_rift.1" });
  });

  it("types a definer's return as its own registry's content item, branded", () => {
    // The class API's answer to "what did I just define" was `DefinedBuilding`,
    // a branded `TypedRef`. The pure API's is the collection's element type —
    // and it extends `TypedRef<"building">`, so the registry name lives in the
    // phantom brand as well as the runtime `type` field. Without the brand an
    // item was structurally assignable to *every* `TypedRef`, because the brand
    // is optional; carrying it is what makes the mismatch a conflict.
    const building = contentMod.building("brand_item", {
      name: "X",
    });
    expectTypeOf(building).toEqualTypeOf<
      ContentItem<"building", BuildingDef<"content_types_building_brand_item">>
    >();
    expectTypeOf(contentMod.feature<BuildingItem>(undefined, [building]).items).toEqualTypeOf<
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
    contentMod.situationType("scoped", {
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

  it("checks situationApproach/situationStage ids against this same definition's own declared keys (SDK-52)", () => {
    // The id `currentSituationApproach`/`currentStage` names is declared a few
    // lines away in the same object literal that uses it — checked here
    // because both fields below assign the value straight to `allow`/
    // `potential`, the boundary `defineSituationType` can actually reach.
    contentMod.situationType("approach_checked", {
      name: "X",
      monthlyProgress: { base: 1 },
      stages: {
        content_types_situation_approach_stage_calm: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // Valid — this approach id is declared below, in this same call's `approach`.
          potential: currentSituationApproach("content_types_situation_approach_calm"),
        },
        content_types_situation_approach_stage_typo: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // @ts-expect-error — misspelled: not one of this situation's own approach ids
          potential: currentSituationApproach("content_types_situation_approach_calmm"),
        },
      },
      approach: {
        content_types_situation_approach_calm: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // Valid — this stage id is declared above, in this same call's `stages`.
          allow: currentStage("content_types_situation_approach_stage_calm"),
        },
        content_types_situation_approach_aggressive: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // @ts-expect-error — misspelled: not one of this situation's own stage ids
          allow: currentStage("content_types_situation_approach_stage_typoo"),
        },
      },
    });
  });

  it("does not let one situation's approach id satisfy an unrelated situation's check (SDK-52)", () => {
    contentMod.situationType("approach_other", {
      name: "X",
      monthlyProgress: { base: 1 },
      approach: {
        content_types_situation_approach_other_calm: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
        },
      },
    });
    contentMod.situationType("approach_self", {
      name: "X",
      monthlyProgress: { base: 1 },
      approach: {
        content_types_situation_approach_self_calm: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
        },
      },
      // @ts-expect-error — this approach id belongs to a different situation's own approach set
      abortTrigger: currentSituationApproach("content_types_situation_approach_other_calm"),
    });
  });

  it("degrades to unchecked once an approach id is composed inside a combinator (SDK-52)", () => {
    // The checking boundary: real vanilla `current_situation_approach` usage
    // is near-universally wrapped in a combinator (`and`/`or`/`not`) or
    // written inside an effect closure's `scope.if(...)`, neither of which
    // can thread a phantom brand through arbitrary composition. A misspelled
    // id there still type-checks — degrading to unchecked, the same as an id
    // whose situation identity genuinely is not known elsewhere in the SDK —
    // rather than failing in a way that would make this previously-writable
    // field unwritable (SDK-33).
    contentMod.situationType("approach_boundary", {
      name: "X",
      monthlyProgress: { base: 1 },
      approach: {
        content_types_situation_approach_boundary_calm: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          allow: or(currentSituationApproach("this_id_names_nothing_declared_anywhere")),
        },
      },
    });
  });

  it("rejects a literal reference into a side of the definition that declares nothing at all (SDK-52)", () => {
    // Approach/Stage default to `never`, not `string`: omitting `approach` or
    // `stages` entirely declares an empty set, and nothing is a member of
    // `never` — so a direct literal reference into the missing side is
    // rejected, the mirror image of the typo case above. Plain and
    // combinator-produced (unbranded) triggers still flow regardless, since
    // both phantom brands stay optional — confirmed at the end of this test.
    contentMod.situationType("approach_only", {
      name: "X",
      monthlyProgress: { base: 1 },
      approach: {
        content_types_situation_approach_only_calm: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // @ts-expect-error — no `stages` declared anywhere in this definition
          allow: currentStage("no_stage_could_ever_satisfy_this"),
        },
      },
    });

    contentMod.situationType("stage_only", {
      name: "X",
      monthlyProgress: { base: 1 },
      stages: {
        content_types_situation_stage_only_stage: {
          name: "X",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
          // @ts-expect-error — no `approach` declared anywhere in this definition
          potential: currentSituationApproach("no_approach_could_ever_satisfy_this"),
        },
      },
      // @ts-expect-error — same, at the top-level abortTrigger position
      abortTrigger: currentSituationApproach("still_no_approach_declared"),
    });

    // Plain/combinator triggers still type-check with neither side declared —
    // the `never` default narrows only the direct-literal path, not the
    // graceful-degradation boundary itself.
    contentMod.situationType("neither_declared", {
      name: "X",
      monthlyProgress: { base: 1 },
      abortTrigger: or(always(), always()),
    });
  });

  it("keeps modifier recorders numeric and weight conditions scoped", () => {
    contentMod.tradition("modifier", {
      name: "X",
      modifier: (m) => {
        m.planet.pop.assembly.mult(0.1);
        // @ts-expect-error — modifier values serialize as numeric assignments
        m.pop.happiness("high");
      },
    });
    expectTypeOf(hasAuthority("auth_democratic")).toExtend<Trigger<"country">>();
  });

  it("widens WeightBlock to top-level operations and a complex_trigger_modifier row (SDK-35, SDK-36)", () => {
    // SDK-35: a `complex_maths_enum` operation (`factor` here) is legal
    // directly on the block, sibling to `base`, not only inside a `modifier`
    // row.
    contentMod.tradition("weight_operation", {
      name: "X",
      aiWeight: { factor: 5000 },
    });
    // SDK-36: a complex_trigger_modifier row (no `when`) sits in the same
    // `modifiers` array as an ordinary Modifier row (which has `when` but no
    // `trigger`/`mode`).
    contentMod.solarSystemInitializer("complex_trigger_modifier", {
      class: "sc_g",
      usageOdds: {
        base: 1,
        modifiers: [
          { factor: 0, when: always() },
          {
            trigger: "check_galaxy_setup_value",
            parameters: { setting: "habitable_worlds_scale" },
            mode: "factor",
          },
        ],
      },
    });
    // `factor` alone is a legal Modifier row: `when` is optional, matching both
    // `modifier_rule.cwt` (which requires none of a row's members) and the 21
    // ungated rows the game ships. It is a Modifier rather than an ambiguous
    // row — `isComplexTriggerModifier` reads the absent `trigger`, not `when`.
    contentMod.tradition("weight_row_shape", {
      name: "X",
      aiWeight: {
        modifiers: [{ factor: 2 }],
      },
    });
    // A complex_trigger_modifier's own `potential` gate is checked exactly
    // like a Modifier's `when` — archaeological site weight runs in planet
    // scope, so a country-scoped potential does not compile.
    contentMod.archaeologicalSiteType("complex_trigger_modifier", {
      name: "X",
      stages: 1,
      allow: canGoMia(),
      visible: hasAuthority("auth_democratic"),
      onRollFailed: () => {},
      weight: {
        base: 1,
        modifiers: [
          {
            trigger: "some_scripted_trigger",
            mode: "factor",
            potential: hasPlanetFlag("content_types_planet_only"),
          },
          {
            trigger: "some_scripted_trigger",
            mode: "factor",
            // @ts-expect-error — archaeological site weight gates run in planet scope
            potential: hasCountryFlag("country_only"),
          },
        ],
      },
    });
  });

  it("keeps a WeightBlock row from satisfying both Modifier and ComplexTriggerModifier at once (bug bash #16 finding 4)", () => {
    // A value with both `when` (Modifier's required member) and
    // `trigger`/`mode` (ComplexTriggerModifier's) would otherwise be
    // structurally assignable to a `Modifier` row — TypeScript's excess
    // property check does not fire across a union, so `trigger`/`mode`
    // being known keys on the *other* arm was enough to let them ride along
    // silently, and `isComplexTriggerModifier`'s presence check would then
    // classify the value as a ComplexTriggerModifier and drop `factor`/`when`
    // entirely. `ExclusiveModifierRow`/`ExclusiveComplexTriggerModifierRow`
    // forbid each other's characteristic members so this is a compile error
    // for both a fresh literal and a value stored in a variable first —
    // the excess-property check only ever covered the first case.
    contentMod.tradition("weight_row_hybrid_literal", {
      name: "X",
      aiWeight: {
        modifiers: [
          // @ts-expect-error — has both Modifier's `when` and
          // ComplexTriggerModifier's `trigger`/`mode`
          { factor: 2, when: always(), trigger: "x", mode: "factor" },
        ],
      },
    });
    // The same object, but assigned to a variable first — no fresh-literal
    // excess-property check applies here at all, so this is the case a mere
    // `Omit`-based exclusion (rather than an explicit `?: never` forbid)
    // would have missed.
    const hybridRow = { factor: 2, when: always(), trigger: "x", mode: "factor" as const };
    contentMod.tradition("weight_row_hybrid_variable", {
      name: "X",
      aiWeight: {
        // @ts-expect-error — same hybrid shape, reached through a variable
        modifiers: [hybridRow],
      },
    });
  });

  it("keeps WeightBlockWithLoc as restrictive as modifier_rule_with_loc, not as wide as plain WeightBlock (bug bash #16 finding 1)", () => {
    // modifier_rule_with_loc.cwt:56-58 admits only base/add/factor at the top
    // level — not weight/subtract/mult/multiplier/divide/min/max, which
    // plain modifier_rule.cwt:1-3 does allow. situation_type.monthly_progress
    // is the one WeightBlockWithLoc consumer.
    contentMod.situationType("weight_with_loc_operation", {
      name: "X",
      monthlyProgress: {
        base: 1,
        add: 2,
        factor: 3,
        // @ts-expect-error — `weight` is not in modifier_rule_with_loc's
        // top-level base/add/factor set, only in plain modifier_rule's.
        weight: 4,
      },
    });
    contentMod.situationType("weight_with_loc_operation_2", {
      name: "X",
      monthlyProgress: {
        base: 1,
        // @ts-expect-error — same for `subtract`.
        subtract: 4,
      },
    });
    // A Modifier row's own members stay the full set either way —
    // modifier_rule_with_loc.cwt:59-66 still splices the whole
    // complex_maths_enum inside a `modifier` row, just one member at a time
    // (a cardinality TypeScript does not model, matching plain modifier_rule
    // rows too) — only the block's own top-level operations narrow.
    contentMod.situationType("weight_with_loc_row", {
      name: "X",
      monthlyProgress: {
        base: 1,
        modifiers: [{ mult: 1.5, desc: "d", when: always() }],
      },
    });
    // modifier_rule.cwt:67-81's with-loc complex_trigger_modifier drops
    // divide/min_value/max_value (the plain alias's :32-53 keeps them) and
    // requires desc (no cardinality marker on that field, unlike every other
    // optional one in the same block).
    contentMod.situationType("weight_with_loc_ctm_divide", {
      name: "X",
      monthlyProgress: {
        base: 1,
        modifiers: [
          // @ts-expect-error — `divide` is not in the with-loc row.
          {
            trigger: "some_scripted_trigger",
            mode: "factor",
            desc: "d",
            divide: 2,
          },
        ],
      },
    });
    contentMod.situationType("weight_with_loc_ctm_no_desc", {
      name: "X",
      monthlyProgress: {
        base: 1,
        modifiers: [
          // @ts-expect-error — `desc` is required on a with-loc
          // complex_trigger_modifier row, unlike the plain alias's.
          { trigger: "some_scripted_trigger", mode: "factor" },
        ],
      },
    });
    // The legal with-loc complex_trigger_modifier shape: mult/multiplier and
    // a required desc.
    contentMod.situationType("weight_with_loc_ctm_legal", {
      name: "X",
      monthlyProgress: {
        base: 1,
        modifiers: [{ trigger: "some_scripted_trigger", mode: "factor", mult: 2, desc: "d" }],
      },
    });
  });

  it("types civic_or_origin's potential/possible as the government_trigger DSL, not a Trigger", () => {
    contentMod.civicOrOrigin("dsl", {
      name: "X",
      // The requirements DSL: a plain object, matched against empire setup —
      // not a script condition tree.
      potential: { authority: { value: "auth_democratic" } },
      possible: { orGroups: [{ civics: { value: "content_types_civic_other" } }] },
    });
    contentMod.civicOrOrigin("dsl_rejects_trigger", {
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

  it("threads civic_or_origin.modification's container-level replace_scopes down to add/remove (containerScope, SDK-34)", () => {
    // governments.cwt's `modification` block itself carries
    // `## replace_scopes = { this = country root = country }`; `add`/`remove`
    // carry no scope annotation of their own. Before SDK-34, `structShape`
    // recursed into a container's own fields with the same `ctx` the
    // container was reached with, so that annotation never reached `add`/
    // `remove` — SDK-33's `containerScopeLost` guard only kept the gap from
    // being misread as "unannotated", leaving both at the unwritable
    // `Trigger<ScopeName>`. Now the container's scope is folded into the
    // child `ctx` (`containerContext`/`pushedScope`), so `add`/`remove` are
    // `Trigger<"country">`: writable by a country-scoped condition, and a
    // planet-only one is rejected exactly as the game would reject it.
    contentMod.civicOrOrigin("modification_container_scope_universal", {
      name: "X",
      modification: { add: always() },
    });
    contentMod.civicOrOrigin("modification_container_scope_country", {
      name: "X",
      // hasCountryFlag is Trigger<"country"> — the payoff: unwritable before
      // SDK-34, when the field was still Trigger<ScopeName>.
      modification: { add: hasCountryFlag("some_flag"), remove: hasCountryFlag("other_flag") },
    });
    contentMod.civicOrOrigin("modification_container_scope_rejects_planet_only", {
      name: "X",
      modification: {
        // @ts-expect-error — hasPlanetFlag is Trigger<"planet">, not
        // "country"; modification.add must reject a scope the container's
        // own replace_scopes did not name.
        add: hasPlanetFlag("some_flag"),
      },
    });
  });

  it("keeps civic_or_origin's playable/ai_playable pinned to no_scope", () => {
    contentMod.civicOrOrigin("no_scope", {
      name: "X",
      playable: always(),
      // @ts-expect-error — playable replace_scopes to no_scope; a country-only
      // condition like hasAuthority does not hold there.
      aiPlayable: hasAuthority("auth_democratic"),
    });
  });

  it("keeps councilor's country and leader scope triggers distinct", () => {
    contentMod.councilor("scoped", {
      name: "X",
      leaderClass: ["leader_class_official"],
      possible: hasAuthority("auth_democratic"),
      // @ts-expect-error — is_leader_possible runs in leader scope, not country
      isLeaderPossible: hasAuthority("auth_democratic"),
    });
  });

  it("restricts economic_category's modifier_category to the generated enum", () => {
    contentMod.economicCategory("x", {
      modifierCategory: "economic_unit",
    });
    contentMod.economicCategory("bad", {
      // @ts-expect-error — modifier_category is drawn from enum[scripted_modifier_category]
      modifierCategory: "nonsense",
    });
  });

  it("requires an entity on ambient_object but leaves name/description optional", () => {
    contentMod.ambientObject("x", {
      entity: "some_entity",
    });
    // @ts-expect-error — entity has no default and must be supplied
    contentMod.ambientObject("missing_entity", {});
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
    contentMod.sectionTemplate("x", {
      entity: "some_entity",
      modifier: (m) => m.unchecked("ship_hull_add", 10),
    });
  });

  it("pins building's plain and triggered modifier fields to their own replace_scopes, not the body's colony scope (buildingModifiers, SDK-56)", () => {
    // Each field carries its own `## replace_scopes` in buildings.cwt
    // (country_modifier:212, army_modifier:215, system_modifier:218,
    // triggered_country_modifier:230, triggered_army_modifier:233,
    // triggered_planet_pop_group_modifier_for_all:224) — distinct from
    // building's own body scope (colony) and from each other. This is the
    // trap the ticket called out: these six are not one shape copied six
    // times, and neither is their scope.
    expectTypeOf<BuildingFields["countryModifier"]>().toEqualTypeOf<
      ModifierClosure<"country"> | undefined
    >();
    expectTypeOf<BuildingFields["armyModifier"]>().toEqualTypeOf<
      ModifierClosure<"army"> | undefined
    >();
    expectTypeOf<BuildingFields["systemModifier"]>().toEqualTypeOf<
      ModifierClosure<"system"> | undefined
    >();
    expectTypeOf<BuildingFields["triggeredCountryModifier"]>().toEqualTypeOf<
      TriggeredModifier<"country">[] | undefined
    >();
    expectTypeOf<BuildingFields["triggeredArmyModifier"]>().toEqualTypeOf<
      TriggeredModifier<"army">[] | undefined
    >();
    expectTypeOf<BuildingFields["triggeredPlanetPopGroupModifierForAll"]>().toEqualTypeOf<
      TriggeredModifier<"pop_group">[] | undefined
    >();
    // The seventh field caught in review: a different clause
    // (triggered_modifier_by_pop_group_clause, not by_planet_clause) but the
    // same pop_group scope and the same TriggeredModifier shape as its
    // _for_all sibling — the clause difference is in an extra field
    // (divide_over_pop_groups) the shape doesn't model, not in scope.
    expectTypeOf<BuildingFields["triggeredPlanetPopGroupModifierForSpecies"]>().toEqualTypeOf<
      TriggeredModifier<"pop_group">[] | undefined
    >();

    // KNOWN BUG (bug-bash finding, documented in overlay.ts's
    // building.triggered_country_modifier reason, not fixed here):
    // triggered_country_modifier splices triggered_modifier_by_planet_clause,
    // whose own `potential` field pushes to PLANET scope (aliases.cwt:114-115)
    // — independent of this field's own `## replace_scopes = { this = country
    // ... }` (buildings.cwt:229-230), which governs only the *modifier* half.
    // TriggeredModifier<"country">'s single scope parameter cannot represent
    // that split, so hasAuthority() (country-scoped) below type-checks as a
    // valid `when` even though the rules license only a planet-scope
    // condition there — the accepting half of the same bug isCapital()'s
    // rejection above demonstrates. Both directions need the same fix: a
    // second, independent scope parameter on TriggeredModifier<S>.
    contentMod.building("modifier_potential_scope_hole", {
      name: "X",
      triggeredCountryModifier: [
        {
          when: hasAuthority("auth_democratic"),
          modifiers: (m) => m.raw("country_edict_fund_add", 10),
        },
      ],
    });

    contentMod.building("modifier_scopes", {
      name: "X",
      armyModifier: (m) => {
        m.raw("armies_cost_mult", -0.1);
        // @ts-expect-error — country_edict_fund_add is colony/country/
        // federation scoped (aliases.cwt via modifiers.ts), not army
        m.raw("country_edict_fund_add", 50);
      },
      systemModifier: (m) => {
        m.raw("system_storm_influence_add", 1);
        // @ts-expect-error — same country-only field, rejected in system
        // scope too
        m.raw("country_edict_fund_add", 50);
      },
      triggeredArmyModifier: [
        {
          // @ts-expect-error — KNOWN BUG, pinned rather than endorsed (see
          // building.triggered_army_modifier's overlay.ts reason and
          // building.triggered_country_modifier's for the full account): the
          // rules push `potential` to planet scope here
          // (aliases.cwt:114-115), not army — so isCapital() (a real,
          // legal planet-scope condition) is wrongly rejected by
          // TriggeredModifier<"army">'s single scope parameter, and an
          // army-scoped condition the rules do NOT license for `potential`
          // would be wrongly accepted in its place. Fixing the type to
          // reject correctly (and accept isCapital() here) needs a second,
          // independent scope parameter on TriggeredModifier<S> — tracked
          // separately, not built into this PR.
          when: isCapital(),
          modifiers: (m) => m.raw("armies_cost_mult", -0.05),
        },
      ],
      triggeredPlanetPopGroupModifierForSpecies: [
        {
          when: always(),
          modifiers: (m) => m.pop.happiness(0.1),
        },
      ],
    });
  });

  it("pins starbase_level's upgrade/downgrade triggers to starbase scope", () => {
    contentMod.starbaseLevel("x", {
      shipSize: "ship_size_starbase_i",
      upgradePossible: always(),
      // @ts-expect-error — upgrade_possible replace_scopes to starbase; a
      // country-only condition like hasAuthority does not hold there.
      downgradePotential: hasAuthority("auth_democratic"),
    });
  });

  it("types species_class's possible/possible_secondary as the government_trigger DSL, not a Trigger", () => {
    contentMod.speciesClass("dsl", {
      name: "X",
      possible: { authority: { value: "auth_democratic" } },
      possibleSecondary: { orGroups: [{ ethics: { value: "ethic_xenophile" } }] },
    });
    contentMod.speciesClass("dsl_rejects_trigger", {
      name: "X",
      // @ts-expect-error — a Trigger is not a GovernmentTriggerBlock; the game
      // does not read possible/possible_secondary as script conditions.
      possible: hasAuthority("auth_democratic"),
    });
  });

  it("widens species_class's unpinned playable to accept a real trigger (widenedLowering)", () => {
    // No `## replace_scopes` on `playable`, so before the widened lowering it
    // fell back to `Trigger<ScopeName>` — contravariant, so "valid in every
    // scope" as a type argument admitted only rules legal in every scope,
    // leaving only a universal trigger like always() writable. It now falls
    // back to `Trigger<never>`, the top of that contravariant lattice, so a
    // real single-scope trigger like hasAuthority (country-only) type-checks
    // too — the field went from "unwritable by anything but always()" to
    // "unchecked", matching what "the rules did not say" should mean.
    contentMod.speciesClass("playable", {
      name: "X",
      playable: always(),
    });
    contentMod.speciesClass("playable_widened", {
      name: "X",
      playable: hasAuthority("auth_democratic"),
    });
  });

  it("widens value_field fields to ScriptValue, a number still assigning unchanged (widenedLowering)", () => {
    // country_ship_of_size_limit.base is `country_limits.cwt`'s `value_field`,
    // not `float` — SDK-47's fix. `ScriptValue` accepts a plain number (the
    // "no churn on existing call sites" property the ticket requires) and a
    // scripted-variable/`value:<script_value>`/`trigger:<name>` string, which
    // plain `number` could not express at all. A boolean satisfies neither
    // arm and stays a compile error.
    expectTypeOf<number>().toExtend<ScriptValue>();
    expectTypeOf<"value:my_script_value">().toExtend<ScriptValue>();
    contentMod.countryShipOfSizeLimit("script_value_number", {
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: always(),
    });
    contentMod.countryShipOfSizeLimit("script_value_string", {
      shipTypes: ["ship_size_titan"],
      base: "value:my_script_value",
      show: always(),
    });
    contentMod.countryShipOfSizeLimit("script_value_rejects_boolean", {
      shipTypes: ["ship_size_titan"],
      // @ts-expect-error — a boolean satisfies neither ScriptValue's number
      // nor its (branded) string arm.
      base: true,
      show: always(),
    });
  });

  it("brands country_ship_of_size_limit.ship_types on the ship_size registry, not just any content ref", () => {
    // `<ship_size>` in the CWT body — a defined ship_size or a raw vanilla
    // string both work, same widening every other branded-ref list gets.
    const shipSize = contentMod.shipSize("for_limit", {
      name: "X",
      class: "shipclass_military",
    });
    legacyCountryLimitMod.countryShipOfSizeLimit("x", {
      shipTypes: [shipSize, "ship_size_titan"],
      base: 80,
      show: always(),
    });
    const wrongBrand: TechnologyRef = { id: "tech_lasers_1" } as TechnologyRef;
    legacyCountryLimitMod.countryShipOfSizeLimit("bad_ref", {
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
    const limit = legacyCountryLimitMod.countryShipOfSizeLimit("scoped", {
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: hasAuthority("auth_democratic"),
    });
    legacyCountryLimitMod.countryShipOfSizeLimit("wrong_scope", {
      shipTypes: ["ship_size_titan"],
      base: 80,
      // @ts-expect-error — the clause runs in country scope, not planet
      show: hasPlanetFlag("planet_only"),
    });
    // The ownership limit takes definitions or raw ids, and never an id of
    // its own — the engine owns that key.
    contentMod.addShipOfSizeLimits([limit, "some_other_mods_limit"]);
    const wrongRegistry = defineBuilding({
      id: "content_types_ship_of_size_limit_wrong_registry",
      name: "X",
    });
    // @ts-expect-error — a definition from another registry is rejected: items
    // carry their registry's brand, so this needs no hand-branded stand-in.
    contentMod.addShipOfSizeLimits([wrongRegistry]);
  });

  it("types a solar system initializer's planet tree recursively", () => {
    const outpost = contentMod.solarSystemInitializer("outpost", {
      class: "sc_g",
    });
    // The literal id survives the definer, the same as every other registry.
    expectTypeOf(outpost.id).toEqualTypeOf<"content_types_system_outpost">();
    contentMod.solarSystemInitializer("deep", {
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
    const outpost = contentMod.solarSystemInitializer("for_refs", {
      class: "sc_g",
    });
    contentMod.solarSystemInitializer("bad_moon", {
      class: "sc_g",
      // @ts-expect-error — CWT declares no nested `planet` inside `moon`, so a
      // moon cannot carry planets even though a planet can carry moons.
      planet: [{ moon: [{ planet: [{ size: 4 }] }] }],
    });
    const wrongRegistry = defineBuilding({
      id: "content_types_system_wrong_registry",
      name: "X",
    });
    contentMod.solarSystemInitializer("wrong_ref", {
      class: "sc_g",
      // @ts-expect-error — a BuildingRef is not a SolarSystemInitializerRef.
      neighborSystem: [{ initializer: wrongRegistry }],
    });
    // A system flows into another registry's field that names this one:
    // governments.cwt types civic/origin `initializers` as
    // `<solar_system_initializer>`.
    originMod.civicOrOrigin("with_system", {
      name: "X",
      initializers: [outpost],
    });
  });

  it("scopes a solar system initializer's effect clauses by depth", () => {
    contentMod.solarSystemInitializer("scopes", {
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
