import { describe, expectTypeOf, it } from "vitest";

import type { CrisisCurrencyFamilyShape } from "../src/content/localization-families.ts";
import { defineBuilding } from "../src/generated/content-definers.ts";
import { createMod, type ContentItem } from "../src/index.ts";
import { anyOf } from "../src/installation/index.ts";
// The generated patch members are spelled in terms of `PatchInput`, which the
// package does not re-export — a consumer never names it, but pinning a member
// against its exact type does.
import type { PatchInput } from "../src/installation/vanilla/patch.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
import { makeScope } from "../src/internals.ts";
import {
  always,
  canGoMia,
  canJoinFactions,
  currentSituationApproach,
  currentStage,
  external,
  hasAuthority,
  hasCompletedEventChainCounter,
  hasCountryFlag,
  hasModifier,
  hasPlanetFlag,
  hasShipFlag,
  hasStageModifier,
  isAtWar,
  isCapital,
  isSiteLocked,
  or,
  vanilla,
  type AgendaRef,
  type AgreementPresetRef,
  type ArchaeologicalSiteTypeRef,
  type AscensionPerkCategoryDef,
  type AscensionPerkCategoryFields,
  type AscensionPerkCategoryItem,
  type AscensionPerkCategoryPatch,
  type AscensionPerkCategoryRef,
  type AscensionPerkRef,
  type BombardmentStanceRef,
  type BuildingDef,
  type BuildingFields,
  type BuildingItem,
  type BuildingPatch,
  type BuildingRef,
  type CasusBelliRef,
  type ComponentTemplateRef,
  type ComponentTemplateUtilityComponentTemplateRef,
  type CrisisCurrencyLocalization,
  type CrisisCurrencyRole,
  type CrisisLevelDef,
  type CrisisLevelFields,
  type CrisisLevelItem,
  type CrisisLevelRef,
  type CrisisObjectiveDef,
  type CrisisObjectiveFields,
  type CrisisObjectiveItem,
  type CrisisObjectiveRef,
  type CrisisPathDef,
  type CrisisPathFields,
  type CrisisPathItem,
  type CrisisPathRef,
  type DecisionRef,
  type EconomicResourceBlock,
  type EconomicResourceBlockNoProduce,
  type EconomicResourceOperation,
  type EdictRef,
  type EventChainCounterOf,
  type EventChainRef,
  type EventFleetRef,
  type GovernmentTriggerBlock,
  type JobRef,
  type LocalizationInput,
  type LocalizationRef,
  type LocalizedText,
  type MegastructureFields,
  type MegastructurePatch,
  type MenacePerkDef,
  type MenacePerkFields,
  type MenacePerkItem,
  type MenacePerkRef,
  type MissionCategoryRef,
  type MissionCounterDefinition,
  type MissionFields,
  type MissionRef,
  type ModelAnimation,
  type ModelMeshRef,
  type ModifierClosure,
  type OpinionModifierRef,
  type ParticleRef,
  type PdxmeshFields,
  type PdxparticleFields,
  type PrereqForCategory,
  type RelicRef,
  type ResourceDef,
  type ResourceFields,
  type ResourceItem,
  type ResourceRef,
  type ScopeName,
  type ScopeRef,
  type ScriptValue,
  type SectionTemplateFields,
  type SituationApproach,
  type SituationApproachFields,
  type SituationStageFields,
  type SituationTypeFields,
  type SpecialProjectRef,
  type SpriteRef,
  type StaticModifierItem,
  type StrikeCraftComponentTemplateFields,
  type TechnologyFields,
  type TechnologyPatch,
  type TechnologyRef,
  type TraditionSwapFields,
  type Trigger,
  type TriggeredModifier,
  type UndeclaredAmbientScope,
  type UtilityComponentTemplateFields,
  type WarGoalRef,
  type WeaponComponentTemplateFields,
  type WithFrom,
} from "../src/stellaris.ts";

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
/** Every required member of the crisis-currency family, and none of the optional one. */
const crisisCurrencyText = {
  name: "Crisis Currency:",
  value: "$VAL|0$",
  currentValue: "Current Value: $VALUE|0$",
  gaining: "Complete Crisis Objectives to gain more.",
  crisisObjective: "Crisis Objectives",
  crisisObjectiveGained: "Crisis Currency gained",
  crisisObjectiveProgress: "We have gained $AMOUNT$ from this Crisis Objective.",
  crisisObjectiveReward: "$REWARD$",
  crisisLevelLocked: "Required to unlock this level:",
  crisisLevelUnlocked: "At $LEVEL$, you get the rewards:",
  crisisLevelUnlock: "Has $CURRENCY$ Crisis Currency",
  crisisLevelDesc: "Accumulate Crisis Currency to advance.",
  crisisDescriptionTitle: "Test Crisis",
  crisisDescription: "The galaxy will remember this.",
  crisisHowtoTitle: "Ruin & Resolve",
  crisisHowto: "Pursuing Crisis Objectives generates Crisis Currency.",
} satisfies CrisisCurrencyLocalization;

const SDK45_CONFIG = { name: "SDK-45 types", prefix: "sdk45", supportedVersion: "4.4.*" } as const;
const defaultSdk45Mod = createMod(SDK45_CONFIG);
const sdk45Mod = createMod(SDK45_CONFIG, {
  ids: { ...defaultSdk45Mod.ids, weaponComponentTemplate: "weapon" },
});

describe("generated content authoring types", () => {
  it("keeps root-only declarative fields as plain values", () => {
    expectTypeOf<
      WithFrom<Trigger<"country">, "country", { readonly root: "country" }>
    >().toEqualTypeOf<Trigger<"country">>();
  });

  it("does not invent a category field on traditions", () => {
    contentMod.tradition("without_category", {
      name: "No synthetic membership",
      // @ts-expect-error — membership belongs to TraditionCategoryDef.traditions
      category: "content_types_tradition_category_x",
    });
  });

  it("authors a complete player-crisis route with branded registry links", () => {
    expectTypeOf<CrisisPathFields["crisisCurrency"]>().toEqualTypeOf<CrisisCurrencyRole>();
    expectTypeOf<CrisisPathFields["levels"]>().toEqualTypeOf<(CrisisLevelRef | string)[]>();
    expectTypeOf<CrisisPathFields["objectives"]>().toEqualTypeOf<(CrisisObjectiveRef | string)[]>();
    expectTypeOf<CrisisLevelFields["perks"]>().toEqualTypeOf<(MenacePerkRef | string)[]>();
    expectTypeOf<CrisisObjectiveFields["potential"]>().toEqualTypeOf<
      Trigger<"country"> | undefined
    >();
    expectTypeOf<MenacePerkFields["modifier"]>().toEqualTypeOf<
      ModifierClosure<"country"> | undefined
    >();

    const currency = contentMod.resource("crisis_currency", {
      name: "Crisis Currency",
      category: "strategic",
    });
    const perk = contentMod.menacePerk("first_perk", {
      name: "First Perk",
      portrait: "GFX_ap_become_the_crisis",
      modifier: (modifier) => modifier.country.unity.produces.mult(0.1),
      onUnlock: (country) => country.setCountryFlag("content_types_crisis_perk_unlocked"),
    });
    const level = contentMod.crisisLevel("first_level", {
      name: "First Level",
      requiredCrisisCurrency: 100,
      perks: [perk],
      onUnlock: (country) => country.setCountryFlag("content_types_crisis_level_unlocked"),
    });
    const objective = contentMod.crisisObjective("first_objective", {
      name: "First Objective",
      potential: hasAuthority("auth_democratic"),
      reward: { base: 10 },
    });
    const path = contentMod.crisisPath("player_crisis", {
      crisisCurrency: { resource: currency, localization: crisisCurrencyText },
      levels: [level],
      objectives: [objective],
    });
    const ascensionPerk = contentMod.ascensionPerk("player_crisis", {
      name: "Player Crisis",
      onEnabled: (country) => country.activateCrisisProgression(path),
    });
    const category = contentMod.ascensionPerkCategory("player_crisis", {
      name: "Player Crisis Paths",
      ascensionPerks: [ascensionPerk],
    });

    const resourceItem: ResourceItem = currency;
    const resourceDef: ResourceDef = currency.def;
    const crisisPathItem: CrisisPathItem = path;
    const crisisPathDef: CrisisPathDef = path.def;
    const crisisLevelItem: CrisisLevelItem = level;
    const crisisLevelDef: CrisisLevelDef = level.def;
    const crisisObjectiveItem: CrisisObjectiveItem = objective;
    const crisisObjectiveDef: CrisisObjectiveDef = objective.def;
    const menacePerkItem: MenacePerkItem = perk;
    const menacePerkDef: MenacePerkDef = perk.def;
    const categoryItem: AscensionPerkCategoryItem = category;
    const categoryDef: AscensionPerkCategoryDef = category.def;
    const vanillaResource: ResourceRef = vanilla.resource("menace");
    const vanillaPath: CrisisPathRef = vanilla.crisisPath("nemesis_path");
    const vanillaLevel: CrisisLevelRef = vanilla.crisisLevel("crisis_level_1");
    const vanillaObjective: CrisisObjectiveRef = vanilla.crisisObjective("crisobj_destroy_worlds");
    const vanillaPerk: MenacePerkRef = vanilla.menacePerk("menp_base_breaker");
    const vanillaCategory: AscensionPerkCategoryRef =
      vanilla.ascensionPerkCategory("ap_category_ambitions");
    void resourceItem;
    void resourceDef;
    void crisisPathItem;
    void crisisPathDef;
    void crisisLevelItem;
    void crisisLevelDef;
    void crisisObjectiveItem;
    void crisisObjectiveDef;
    void menacePerkItem;
    void menacePerkDef;
    void categoryItem;
    void categoryDef;
    void ascensionPerk;
    void vanillaResource;
    void vanillaPath;
    void vanillaLevel;
    void vanillaObjective;
    void vanillaPerk;
    void vanillaCategory;

    expectTypeOf<AscensionPerkCategoryFields["ascensionPerks"]>().toEqualTypeOf<
      (AscensionPerkRef | string)[]
    >();

    contentMod.crisisPath("wrong_currency", {
      // @ts-expect-error — a level is not a crisis currency resource
      crisisCurrency: level,
      levels: [level],
      objectives: [objective],
    });
    contentMod.crisisLevel("wrong_perk", {
      requiredCrisisCurrency: 100,
      // @ts-expect-error — a crisis path is not a menace perk
      perks: [path],
      onUnlock: () => {},
    });
    contentMod.crisisPath("wrong_objective", {
      crisisCurrency: { resource: currency, localization: crisisCurrencyText },
      levels: [level],
      // @ts-expect-error — a crisis level is not a crisis objective
      objectives: [level],
    });
    contentMod.ascensionPerk("wrong_crisis_path", {
      name: "Wrong Crisis Path",
      onEnabled: (country) => {
        // @ts-expect-error — activate_crisis_progression requires a crisis path
        country.activateCrisisProgression(level);
      },
    });
  });

  it("requires the Ambition UI text family from a mod-defined crisis currency", () => {
    const currency = contentMod.resource("family_currency", {
      name: "Family Currency",
      category: "strategic",
    });
    const level = contentMod.crisisLevel("family_level", {
      name: "Family Level",
      requiredCrisisCurrency: 100,
      perks: [],
      onUnlock: () => {},
    });
    const objective = contentMod.crisisObjective("family_objective", {
      name: "Family Objective",
      reward: { base: 10 },
    });
    const lists = { levels: [level], objectives: [objective] };

    contentMod.crisisPath("bare_owned_currency", {
      // @ts-expect-error — vanilla ships no text for a resource this mod defines
      crisisCurrency: currency,
      ...lists,
    });
    contentMod.crisisPath("partial_family", {
      // @ts-expect-error — a partial family shows raw keys through the Ambition UI
      crisisCurrency: { resource: currency, localization: { name: "Family Currency:" } },
      ...lists,
    });

    // Vanilla already defines `menace_*`, so its reference stands alone; the
    // bundle stays legal over it for a mod that restates that text.
    contentMod.crisisPath("vanilla_currency", {
      crisisCurrency: vanilla.resource("menace"),
      ...lists,
    });
    contentMod.crisisPath("vanilla_currency_retext", {
      crisisCurrency: { resource: vanilla.resource("menace"), localization: crisisCurrencyText },
      ...lists,
    });
    contentMod.crisisPath("foreign_currency", {
      crisisCurrency: "other_mod_currency",
      ...lists,
    });
    contentMod.crisisPath("with_intro", {
      crisisCurrency: {
        resource: currency,
        localization: {
          ...crisisCurrencyText,
          crisisDescriptionIntro: "Long ago, it was foretold.",
        },
      },
      ...lists,
    });

    // A handle carries no `def`, so only excluding `handleKind` too keeps a
    // resource whose definition has not been attached yet out of the bare arm.
    const handle = contentMod.resourceHandle("handle_currency");
    contentMod.crisisPath("bare_handle_currency", {
      // @ts-expect-error — a handle names a resource this mod is about to define
      crisisCurrency: handle,
      ...lists,
    });
    contentMod.crisisPath("bundled_handle_currency", {
      crisisCurrency: { resource: handle, localization: crisisCurrencyText },
      ...lists,
    });

    expectTypeOf<CrisisCurrencyLocalization["name"]>().toEqualTypeOf<LocalizedText>();
    expectTypeOf<CrisisCurrencyLocalization["crisisDescriptionIntro"]>().toEqualTypeOf<
      LocalizedText | undefined
    >();
  });

  // The interface carries the prose and the measured table stays the runtime
  // authority, so nothing but this stops the two from drifting apart. Mutual
  // assignability rather than identity: a dropped member, an added one, or a
  // flipped optionality each break one direction, and the table's shape is an
  // intersection the interface is deliberately not spelled as.
  it("keeps the crisis-currency interface in step with the measured family table", () => {
    expectTypeOf<CrisisCurrencyLocalization>().toExtend<CrisisCurrencyFamilyShape>();
    expectTypeOf<CrisisCurrencyFamilyShape>().toExtend<CrisisCurrencyLocalization>();
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
          site.addExpeditionLogEntry({ title: external.localization("content_test_dig_failed") });
        });
      },
      onCreate: (site, ctx) => {
        // Same registry, and CWT gives this one a `push_scope` with no FROM:
        // the ctx is still there, and reading FROM through it does not compile.
        site.addExpeditionLogEntry({ title: external.localization("content_test_dig_begins") });
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

  it("carries one static modifier host into authored consumers", () => {
    const countryHosted = contentMod.staticModifier("country_hosted", {
      hostScope: "country",
      name: "X",
      modifiers: (m) => {
        m.country.unity.produces.mult(0.1);
        m.planet.jobs.engineering.research.produces.mult(-0.15);
        m.raw("ship_weapon_damage", 0.1);
        m.unchecked("othermod_invented_mult", 0.1);
      },
    });
    const shipHosted = contentMod.staticModifier("ship_hosted", {
      hostScope: "ship",
      name: "X",
      modifiers: (m) => m.ship.tracking.add(10),
    });
    const country = makeScope<"country">([]);
    const ship = makeScope<"ship">([]);
    const rift = makeScope<"astral_rift">([]);
    const operation = makeScope<"espionage_operation">([]);
    const colony = makeScope<"colony">([]);
    const carrier = makeScope<"carrier">([]);
    const riftHosted = contentMod.staticModifier("rift_hosted", {
      hostScope: "astral_rift",
      name: "X",
    });
    const carrierHosted = contentMod.staticModifier("carrier_hosted", {
      hostScope: "carrier",
      name: "X",
    });
    const planetHosted = contentMod.staticModifier("planet_hosted", {
      hostScope: "planet",
      name: "X",
    });

    expectTypeOf(countryHosted.hostScope).toEqualTypeOf<"country">();
    // @ts-expect-error — the non-emitting host witness is carried beside the serialized def
    countryHosted.def.hostScope;
    country.addModifier({ modifier: countryHosted });
    country.removeModifier(countryHosted);
    country.if(hasModifier(countryHosted), () => {});
    country.exportModifierDurationToVariable({ modifier: countryHosted, variable: "remaining" });
    carrier.if(hasModifier(carrierHosted), () => {});
    colony.if(hasModifier(carrierHosted), () => {});
    // @ts-expect-error — only a colony may proxy a carrier modifier check
    ship.if(hasModifier(carrierHosted), () => {});
    // @ts-expect-error — an authored country modifier cannot execute on a ship
    ship.addModifier({ modifier: countryHosted });
    // @ts-expect-error — removing it from a ship contradicts the same host witness
    ship.removeModifier(countryHosted);
    // @ts-expect-error — hasModifier returns the authored definition's host scope
    ship.if(hasModifier(countryHosted), () => {});
    // @ts-expect-error — duration queries run against the current modifier host
    ship.exportModifierDurationToVariable({ modifier: countryHosted, variable: "remaining" });

    rift.addStageModifier({ modifier: riftHosted });
    rift.removeStageModifier(riftHosted);
    rift.if(hasStageModifier(riftHosted), () => {});
    // @ts-expect-error — an astral-rift stage modifier cannot execute on an operation
    operation.addStageModifier({ modifier: riftHosted });
    // @ts-expect-error — stage removal checks the same receiver contract
    operation.removeStageModifier(riftHosted);
    // @ts-expect-error — stage checks preserve the authored host contract
    operation.if(hasStageModifier(riftHosted), () => {});

    ship.previewModifier(countryHosted);
    ship.addModifier({ modifier: "third_party_modifier" });
    ship.removeModifier("third_party_modifier");
    ship.if(hasModifier("third_party_modifier"), () => {});
    country.addModifier({ modifier: vanilla.staticModifier("food_deficit") });
    country.removeModifier(vanilla.staticModifier("food_deficit"));
    country.if(hasModifier(vanilla.staticModifier("food_deficit")), () => {});

    contentMod.agenda("country_finish", {
      name: "X",
      agendaCost: 1,
      finishModifier: countryHosted,
    });
    contentMod.agenda("wrong_finish", {
      name: "X",
      agendaCost: 1,
      // @ts-expect-error — agenda finish modifiers execute on their country
      finishModifier: planetHosted,
    });
    contentMod.agenda("unchecked_finish", {
      name: "X",
      agendaCost: 1,
      finishModifier: "third_party_modifier",
    });

    const either: StaticModifierItem<"country" | "ship"> =
      Math.random() > 0.5 ? countryHosted : shipHosted;
    // @ts-expect-error — a union-valued definition has no single host contract to execute
    country.addModifier({ modifier: either });

    // @ts-expect-error — SDK-authored static modifiers must declare one host scope
    contentMod.staticModifier("missing_host", {
      name: "X",
    });
    contentMod.staticModifier("bad_path", {
      hostScope: "country",
      name: "X",
      // @ts-expect-error — a typo in a host-valid path segment is a compile error
      modifiers: (m) => m.country.unity.produses.mult(0.1),
    });
    contentMod.staticModifier("bad_raw", {
      hostScope: "country",
      name: "X",
      // @ts-expect-error — raw() is checked against known country-valid modifier names
      modifiers: (m) => m.raw("not_a_real_modifier_name", 0.1),
    });
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
      vanilla.utilityComponentTemplate("SHIELD_BOOSTER");
    void fromVanilla;

    contentMod.globalShipDesign("components", {
      shipSize: "ship_size_corvette",
      growthStages: [{ shipSize: "ship_size_corvette", requiredComponent: [util] }],
    });
  });

  it("brands an authored sprite as the reference every <sprite> field asks for", () => {
    // `type[sprite]` declares eight subtypes and the rules never spell one in a
    // reference, so a defined sprite is a `SpriteRef` outright — the opposite
    // disposition to component_template above, and decided by the rules rather
    // than by the presence of the `as` narrowing. Without it an authored sprite
    // could not reach `event.picture` or any other `<sprite>` field.
    const icon = contentMod.spriteType("icon", { textureFile: "gfx/x.dds" });
    expectTypeOf(icon.id).toEqualTypeOf<"GFX_content_types_icon">();
    const asSprite: SpriteRef = icon;
    void asSprite;
    // A vanilla id is the same kind of thing, so it wears the same brand.
    const fromVanilla: SpriteRef = vanilla.spriteType("GFX_evt_ship_in_orbit");
    void fromVanilla;
    // And it flows into a real `<sprite>` field of another registry.
    contentMod.spriteType("child", { parent: icon });
  });

  it("keeps the three GFX registries' items apart from each other", () => {
    const icon = contentMod.spriteType("icon", { textureFile: "gfx/x.dds" });
    const mesh = contentMod.pdxmesh("hull", { file: "gfx/models/x.mesh" });
    const particle = contentMod.pdxparticle("dust", { type: "dust_file" });
    expectTypeOf(mesh.id).toEqualTypeOf<"content_types_hull">();
    expectTypeOf(particle.id).toEqualTypeOf<"content_types_dust">();

    // @ts-expect-error — a mesh is not a sprite, whatever `<sprite>` asks for
    const meshAsSprite: SpriteRef = mesh;
    void meshAsSprite;
    // @ts-expect-error — nor is a particle
    const particleAsSprite: SpriteRef = particle;
    void particleAsSprite;
    // @ts-expect-error — and a sprite is not a mesh
    const spriteAsMesh: ModelMeshRef = icon;
    void spriteAsMesh;
    const meshRef: ModelMeshRef = mesh;
    const particleRef: ParticleRef = particle;
    void meshRef;
    void particleRef;
  });

  it("types pdxparticle.type as a plain string, with no reference to brand it", () => {
    // `<particle_type>` names definitions in `.asset` files the SDK carries as
    // opaque Assets. There is no registry, so `ParticleTypeRef` is a brand
    // nothing can mint — the member is `string` and says so.
    expectTypeOf<PdxparticleFields["type"]>().toEqualTypeOf<string>();
    expectTypeOf<PdxmeshFields["animation"]>().toEqualTypeOf<
      { id: ModelAnimation | string; type: string }[] | undefined
    >();
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

  it("types a handle as its registry's reference, and never as placeable content", () => {
    // A handle exists so a definition can name the id the capability is about
    // to mint for it. That only works if it reaches the same reference fields
    // its item does — and only stays safe if it cannot be placed in a Feature,
    // where a minted id with no body would emit nothing while every reference
    // to it still resolved.
    const spelltech = contentMod.ascensionPerkHandle("spelltech");
    expectTypeOf(spelltech.id).toEqualTypeOf<"content_types_ascension_perk_spelltech">();

    // Its own registry's reference fields take it, exactly as the item's do.
    const own: AscensionPerkRef = spelltech;
    void own;
    // @ts-expect-error — an ascension perk handle is not a technology reference
    const crossRegistry: TechnologyRef = spelltech;
    void crossRegistry;
    // @ts-expect-error — a handle is an identity, not content: place what define() returns
    contentMod.feature(undefined, [spelltech]);
    // @ts-expect-error — and it is not a ContentItem either
    const asItem: ContentItem<"ascension_perk"> = spelltech;
    void asItem;

    // `define` returns exactly what the eager definer returns.
    expectTypeOf(spelltech.define({ name: "X" })).toEqualTypeOf(
      contentMod.ascensionPerk("spelltech", { name: "X" })
    );
    // The literal id still narrows, so a nested id can be built from it.
    const nested: `content_types_ascension_perk_spelltech_synth` = `${spelltech.id}_synth`;
    void nested;
  });

  it("keeps a definition-time generic on define, where there is a def to infer it from", () => {
    // A handle mints before any def exists, so a parameter the *definition*
    // introduces cannot be inferred at the mint. These registries therefore
    // carry it on `define` rather than on the handle.
    const decision = contentMod.decisionHandle("survey");
    expectTypeOf(decision.id).toEqualTypeOf<"content_types_decision_survey">();

    const modifier = contentMod.staticModifierHandle("drag");
    expectTypeOf(
      modifier.define({ name: "Drag", hostScope: "ship" }).hostScope
    ).toEqualTypeOf<"ship">();

    // @ts-expect-error — still not placeable, whatever shape its define takes
    contentMod.feature(undefined, [decision]);
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

  it("defines situation approaches and stages as parent-scoped references", () => {
    contentMod.situationType("nested_refs", (situation) => {
      const observe = situation.approach("observe", {
        name: "Observe",
        icon: "GFX_situation_approach_observe",
        iconBackground: "GFX_situation_approach_bg_observe",
      });
      const germination = situation.stage("germination", {
        name: "Germination",
        icon: "GFX_situation_stage_germination",
        iconBackground: "GFX_situation_stage_bg_germination",
      });

      expectTypeOf(
        observe.id
      ).toEqualTypeOf<"content_types_situation_nested_refs_approach_observe">();
      expectTypeOf(
        germination.id
      ).toEqualTypeOf<"content_types_situation_nested_refs_stage_germination">();

      return {
        name: "Nested references",
        approach: [observe],
        stages: [germination],
        onStart: (scope) => scope.setSituationApproach(observe),
        monthlyProgress: {
          base: 1,
          modifiers: [
            {
              add: 2,
              desc: "Observe the situation.",
              when: currentSituationApproach(observe),
            },
            {
              factor: 0.5,
              desc: "The situation is germinating.",
              when: currentStage(germination),
            },
          ],
        },
      };
    });

    contentMod.situationTypeHandle("nested_handle_refs").define((situation) => {
      const observe = situation.approach("observe", {
        name: "Observe",
        icon: "GFX_situation_approach_observe",
        iconBackground: "GFX_situation_approach_bg_observe",
      });
      return {
        name: "Nested handle references",
        approach: [observe],
        monthlyProgress: { base: 1 },
      };
    });

    const foreign = {} as SituationApproach<"content_types_situation_foreign", "observe">;
    // @ts-expect-error — the callback references an approach owned by another situation type
    contentMod.situationType("nested_ref_owner", (situation) => {
      const local = situation.approach("observe", {
        name: "Observe",
        icon: "GFX_situation_approach_observe",
        iconBackground: "GFX_situation_approach_bg_observe",
      });
      return {
        name: "Nested reference owner",
        approach: [local],
        monthlyProgress: {
          base: 1,
          modifiers: [
            {
              add: 1,
              desc: "Wrong owner",
              when: currentSituationApproach(foreign),
            },
          ],
        },
      };
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
    const aliasedWeightWithDesc = { factor: 5000, desc: "silently dropped" };
    contentMod.tradition("aliased_weight_operation_desc", {
      name: "X",
      // @ts-expect-error — desc is row-only and must not pass through an alias.
      aiWeight: aliasedWeightWithDesc,
    });
    const aliasedWeightWithWhen = { factor: 5000, when: always() };
    contentMod.tradition("aliased_weight_operation_when", {
      name: "X",
      // @ts-expect-error — when is row-only and must not pass through an alias.
      aiWeight: aliasedWeightWithWhen,
    });
    contentMod.tradition("modifier_row_desc_key", {
      name: "X",
      aiWeight: {
        modifiers: [{ factor: 2, desc: { english: "Still allowed.", key: "still_allowed" } }],
      },
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
    const aliasedWideWeight = { base: 1, weight: 4 };
    contentMod.situationType("aliased_weight_with_loc_operation", {
      name: "X",
      // @ts-expect-error — excluded with-loc operations stay forbidden through aliases.
      monthlyProgress: aliasedWideWeight,
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
      TriggeredModifier<"country", "planet">[] | undefined
    >();
    expectTypeOf<BuildingFields["triggeredArmyModifier"]>().toEqualTypeOf<
      TriggeredModifier<"army", "planet">[] | undefined
    >();
    expectTypeOf<BuildingFields["triggeredPlanetPopGroupModifierForAll"]>().toEqualTypeOf<
      TriggeredModifier<"pop_group", "planet">[] | undefined
    >();
    // The seventh field caught in review: a different clause
    // (triggered_modifier_by_pop_group_clause, not by_planet_clause) but the
    // same pop_group scope and the same TriggeredModifier shape as its
    // _for_all sibling — the clause difference is in an extra field
    // (divide_over_pop_groups) the shape doesn't model, not in scope.
    expectTypeOf<BuildingFields["triggeredPlanetPopGroupModifierForSpecies"]>().toEqualTypeOf<
      TriggeredModifier<"pop_group">[] | undefined
    >();

    contentMod.building("modifier_potential_scope_hole", {
      name: "X",
      triggeredCountryModifier: [
        {
          when: isCapital(),
          modifiers: (m) => m.raw("country_edict_fund_add", 10),
        },
        {
          // @ts-expect-error — potential runs in planet scope, not country
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
          when: isCapital(),
          modifiers: (m) => m.raw("armies_cost_mult", -0.05),
        },
        {
          // @ts-expect-error — potential runs in planet scope, not country
          when: hasAuthority("auth_democratic"),
          modifiers: (m) => m.raw("armies_cost_mult", -0.05),
        },
      ],
      triggeredPlanetPopGroupModifierForAll: [
        {
          when: isCapital(),
          modifiers: (m) => m.pop.happiness(0.1),
        },
        {
          // @ts-expect-error — potential runs in planet scope, not country
          when: hasAuthority("auth_democratic"),
          modifiers: (m) => m.pop.happiness(0.1),
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

  it("authors technology's open single weight-group map (SDK-66)", () => {
    expectTypeOf<TechnologyFields["modWeightIfGroupPicked"]>().toEqualTypeOf<
      Readonly<Record<string, number>> | undefined
    >();
    expectTypeOf<TechnologyPatch["modWeightIfGroupPicked"]>().toEqualTypeOf<
      PatchInput<Readonly<Record<string, number>>> | undefined
    >();

    contentMod.technology("mod_weight_if_group_picked", {
      name: "Weight Group Test",
      area: "physics",
      tier: 1,
      category: "particles",
      // Keys remain open because value[tech_weight_group] is an engine value
      // set, not a closed enum in the SDK surface.
      modWeightIfGroupPicked: {
        repeatable: 2,
        deposit_blockers: 0.5,
        third_party_group: 1.25,
      },
    });
    contentMod.technology("mod_weight_if_group_picked_bad_value", {
      name: "Weight Group Bad Value",
      area: "physics",
      tier: 1,
      category: "particles",
      // @ts-expect-error — scalarMap values are numbers, not nested blocks.
      modWeightIfGroupPicked: { repeatable: { value: 2 } },
    });
    contentMod.technology("mod_weight_if_group_picked_bad_form", {
      name: "Weight Group Bad Form",
      area: "physics",
      tier: 1,
      category: "particles",
      // @ts-expect-error — the outer member is one record, not an array of
      // repeated maps; arity: "single" keeps its type and metadata aligned.
      modWeightIfGroupPicked: [{ repeatable: 2 }],
    });
  });

  it("authors weapon_component_template's open target-weight map (SDK-67)", () => {
    expectTypeOf<WeaponComponentTemplateFields["targetWeights"]>().toEqualTypeOf<
      Readonly<Record<string, number>> | undefined
    >();

    contentMod.weaponComponentTemplate("target_weights", {
      icon: "GFX_weapon_target_weights",
      targetWeights: {
        corvette: 1,
        cruiser: 2.5,
        third_party_target: 0.25,
      },
    });
    contentMod.weaponComponentTemplate("target_weights_bad_value", {
      icon: "GFX_weapon_target_weights",
      targetWeights: {
        // @ts-expect-error — scalarMap values are numbers, not nested blocks.
        corvette: { weight: 1 },
      },
    });
    contentMod.weaponComponentTemplate("target_weights_bad_form", {
      icon: "GFX_weapon_target_weights",
      // @ts-expect-error — the outer target_weights block is a single map, not
      // a repeated list of maps.
      targetWeights: [{ corvette: 1 }],
    });
  });

  it("authors technology's modifier at both levels the rules declare it (SDK-63)", () => {
    // technologies_consolidated.cwt declares the same
    // `single_alias_right[modifier_clause]` twice — once on the definition
    // body (237-238) and once inside the technology_swap struct (162-163) —
    // each with its own `## replace_scopes = { this = country root = country }`.
    // The nested one is not inherited from the parent: it is declared again,
    // which is why closing the top level alone would have left the swap's
    // 55 shipped uses unauthorable.
    expectTypeOf<TechnologyFields["modifier"]>().toEqualTypeOf<
      ModifierClosure<"country"> | undefined
    >();
    type TechnologySwap = NonNullable<TechnologyFields["technologySwap"]>[number];
    expectTypeOf<TechnologySwap["modifier"]>().toEqualTypeOf<
      ModifierClosure<"country"> | undefined
    >();
    // The patch surface gets the member too — technology is a patch registry,
    // so a vanilla technology's modifier block is now replaceable rather than
    // only preservable as an unmodelled `rest` entry.
    expectTypeOf<TechnologyPatch["modifier"]>().toEqualTypeOf<
      PatchInput<ModifierClosure<"country">> | undefined
    >();

    contentMod.technology("modifier_scopes", {
      name: "X",
      area: "physics",
      tier: 1,
      category: "particles",
      modifier: (m) => m.all.technology.research.speed(0.05),
      technologySwap: [
        {
          name: "swap",
          modifier: (m) => m.raw("all_technology_research_speed", 0.1),
        },
      ],
    });

    contentMod.technology("modifier_wrong_scope", {
      name: "X",
      area: "physics",
      tier: 1,
      category: "particles",
      modifier: (m) => {
        // @ts-expect-error — federation_fleet_cap_add is federation-scoped
        // only, and the clause's own replace_scopes pin this to country
        m.raw("federation_fleet_cap_add", 5);
      },
      technologySwap: [
        {
          name: "swap",
          modifier: (m) => {
            // @ts-expect-error — the nested clause carries the same country
            // scope, declared in its own right rather than inherited
            m.raw("federation_fleet_cap_add", 5);
          },
        },
      ],
    });
  });

  it("authors prereqfor_desc's enum keys as members at both levels (SDK-64)", () => {
    // The rules close the key set — `enum[prereq_for_category] = { title desc }`
    // (technologies_consolidated.cwt:245-249, and again at 169-173 inside
    // technology_swap) — so every key is a named member, in the SDK's own
    // camelCase, sharing one entry interface. A `Record<PrereqForCategory, …>`
    // would have spelled the keys the game's way and put `diplo_action` beside
    // the `hidePrereqForDesc` sibling the same block declares.
    type PrereqforDesc = NonNullable<TechnologyFields["prereqforDesc"]>[number];
    type Entry = NonNullable<PrereqforDesc["custom"]>[number];
    expectTypeOf<PrereqforDesc["hidePrereqForDesc"]>().toEqualTypeOf<
      PrereqForCategory[] | undefined
    >();
    expectTypeOf<PrereqforDesc["diploAction"]>().toEqualTypeOf<Entry[] | undefined>();
    expectTypeOf<Entry>().toEqualTypeOf<{
      title: LocalizationInput;
      desc?: LocalizationInput;
    }>();
    // The same declaration one level down is its own lowering, not the
    // parent's: closing only the top level would have left 28 shipped
    // technology_swap blocks unauthorable.
    type Swap = NonNullable<TechnologyFields["technologySwap"]>[number];
    type SwapPrereqforDesc = NonNullable<Swap["prereqforDesc"]>[number];
    expectTypeOf<SwapPrereqforDesc["ship"]>().toEqualTypeOf<
      | {
          title: LocalizationInput;
          desc?: LocalizationInput;
        }[]
      | undefined
    >();
    expectTypeOf<TechnologyPatch["prereqforDesc"]>().toEqualTypeOf<
      PatchInput<PrereqforDesc[]> | undefined
    >();

    contentMod.technology("prereqfor_desc_keys", {
      name: "X",
      area: "physics",
      tier: 1,
      category: "particles",
      prereqforDesc: [
        {
          hidePrereqForDesc: ["component"],
          custom: [{ title: "X_TITLE", desc: "X_DESC" }],
        },
      ],
    });

    contentMod.technology("prereqfor_desc_bad_key", {
      name: "X",
      area: "physics",
      tier: 1,
      category: "particles",
      prereqforDesc: [
        {
          // @ts-expect-error — `hull` is not one of enum[prereq_for_category]'s
          // six members, and the key set is closed by the rules
          hull: [{ title: "X_TITLE" }],
        },
      ],
    });
  });

  it("splits every situation triggered modifier potential from its modifier scope (SDK-61)", () => {
    expectTypeOf<SituationTypeFields["triggeredModifier"]>().toEqualTypeOf<
      TriggeredModifier<"country", "situation">[] | undefined
    >();
    expectTypeOf<SituationTypeFields["triggeredTargetModifier"]>().toEqualTypeOf<
      TriggeredModifier<"planet", "situation">[] | undefined
    >();
    expectTypeOf<SituationApproachFields["triggeredModifier"]>().toEqualTypeOf<
      TriggeredModifier<"country", "situation">[] | undefined
    >();
    expectTypeOf<SituationApproachFields["triggeredTargetModifier"]>().toEqualTypeOf<
      TriggeredModifier<"planet", "situation">[] | undefined
    >();
    expectTypeOf<SituationStageFields["triggeredModifier"]>().toEqualTypeOf<
      TriggeredModifier<"country", "situation">[] | undefined
    >();
    expectTypeOf<SituationStageFields["triggeredTargetModifier"]>().toEqualTypeOf<
      TriggeredModifier<ScopeName, "situation">[] | undefined
    >();

    contentMod.situationType("triggered_modifier_scopes", {
      name: "X",
      monthlyProgress: { base: 1 },
      triggeredModifier: [
        {
          // @ts-expect-error — the nested potential runs in situation scope
          when: hasAuthority("auth_democratic"),
          modifiers: (m) => m.country.naval.cap.add(1),
        },
      ],
      triggeredTargetModifier: [
        {
          // @ts-expect-error — the nested potential runs in situation scope
          when: isCapital(),
          modifiers: (m) => m.planet.jobs.produces.mult(0.1),
        },
      ],
    });
  });

  it("authors building.resources as a plain economic_template splice (SDK-62)", () => {
    // buildings.cwt:242-246 is the byte-identical `category`-beside-splice
    // declaration megastructure.resources, job.resources and
    // decision.resources already lower. The splice is plain
    // economic_template, not economic_template_no_produce, so this is
    // EconomicResourceBlock and `produces` is a real member — and the scope
    // is colony because building's body is (`## push_scope = colony`), read
    // off the rules rather than asserted by an overlay row.
    expectTypeOf<BuildingFields["resources"]>().toEqualTypeOf<
      EconomicResourceBlock<"colony">[] | undefined
    >();

    contentMod.building("resources", {
      name: "X",
      resources: [
        {
          category: "planet_buildings",
          cost: { amounts: { alloys: 300 } },
          upkeep: { amounts: { energy: 5 }, when: isCapital() },
          produces: { amounts: { physics_research: 10 } },
        },
      ],
    });

    contentMod.building("resources_wrong_shape", {
      name: "X",
      resources: [
        {
          // @ts-expect-error — the amounts map is required inside each arm;
          // a bare resource-name map is not the block shape
          cost: { alloys: 300 },
        },
      ],
    });

    contentMod.building("resources_wrong_scope", {
      name: "X",
      resources: [
        {
          // @ts-expect-error — building's body is colony-scoped, so a
          // ship-scope condition is not a legal `when` here
          cost: { amounts: { alloys: 300 }, when: hasShipFlag("x") },
        },
      ],
    });
  });

  it("authors repeated building.ai_resource_production operations (SDK-65)", () => {
    expectTypeOf<BuildingFields["aiResourceProduction"]>().toEqualTypeOf<
      EconomicResourceOperation<"colony">[] | undefined
    >();
    expectTypeOf<BuildingPatch["aiResourceProduction"]>().toEqualTypeOf<
      PatchInput<EconomicResourceOperation<"colony">[]> | undefined
    >();

    contentMod.building("ai_resource_production", {
      name: "X",
      aiResourceProduction: [
        { amounts: { energy: 2 }, when: isCapital(), mult: [1, 2] },
        { amounts: { unity: 1 }, multiplier: 0.5 },
      ],
    });

    contentMod.building("ai_resource_production_wrong_form", {
      name: "X",
      aiResourceProduction: [
        {
          // @ts-expect-error — the operation owns an `amounts` map; its
          // resource ids are not direct object members.
          energy: 2,
        },
      ],
    });

    contentMod.building("ai_resource_production_wrong_scope", {
      name: "X",
      aiResourceProduction: [
        {
          amounts: { energy: 2 },
          // @ts-expect-error — this direct trigger runs in the building's
          // colony scope, not ship scope.
          when: hasShipFlag("x"),
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

  it("preserves event-chain and special-project ids and brands their references", () => {
    const chain = contentMod.eventChain("signal", { title: "Signal" });
    expectTypeOf(chain.id).toEqualTypeOf<"content_types_event_chain_signal">();
    contentMod.eventChain("counter", {
      counter: { crystals_analyzed: { max: 3 } },
    });
    contentMod.eventChain("bad_counter", {
      counter: {
        crystals_analyzed: {
          // @ts-expect-error — a counter maximum is numeric.
          max: "three",
        },
      },
    });
    const project = contentMod.specialProject("survey", {
      name: "Survey",
      eventChain: chain,
      eventScope: "planet_event",
      sameOptionGroupAs: ["some_other_mod_project"],
    });
    expectTypeOf(project.id).toEqualTypeOf<"content_types_special_project_survey">();
    contentMod.specialProject("recovery", {
      name: "Recover",
      eventChain: "vanilla_chain",
      eventScope: "ship_event",
      sameOptionGroupAs: [project],
    });
    contentMod.specialProject("ship_callbacks", {
      eventScope: "ship_event",
      onSuccess: (ship) => ship.setShipFlag("content_types_ship_callbacks"),
      cost: { modifiers: [{ factor: 2, when: hasCountryFlag("content_types_weight") }] },
    });
    contentMod.specialProject("invalid_ship_callback", {
      eventScope: "ship_event",
      onSuccess: (ship) => {
        // @ts-expect-error — eventScope, not an author assertion, controls callback scope.
        ship.setCountryFlag("content_types_wrong_scope");
      },
    });
    const wrongRegistry = defineBuilding({
      id: "content_types_special_project_wrong_registry",
      name: "X",
    });
    contentMod.specialProject("wrong_refs", {
      name: "X",
      // @ts-expect-error — event_chain rejects a building reference.
      eventChain: wrongRegistry,
      eventScope: "country_event",
    });
    // @ts-expect-error — a special project cannot flow into an event-chain reference.
    const _wrongChain: EventChainRef = project;
    // @ts-expect-error — an event chain cannot flow into a special-project reference.
    const _wrongProject: SpecialProjectRef = chain;
  });

  it("preserves relic and mission ids and brands mission categories and counters", () => {
    const relic = contentMod.relic("hesperides", {
      portrait: "GFX_relic_ancient_sword",
      possible: always(),
    });
    const category = contentMod.missionCategory("labours", {
      isContract: false,
      mapIcon: "GFX_nomad_contract_icon",
      logIcon: "gfx/interface/icons/contracts/contract_icon_log.dds",
    });
    const mission = contentMod.mission("first_labour", {
      category,
      picture: "GFX_event_pictures_ancient_ruins",
      counter: { labours_completed: { max: 4 } },
    });
    expectTypeOf(relic.id).toEqualTypeOf<"content_types_relic_hesperides">();
    expectTypeOf(mission.id).toEqualTypeOf<"content_types_mission_first_labour">();
    expectTypeOf<MissionFields["counter"]>().toEqualTypeOf<
      Readonly<Record<string, MissionCounterDefinition>> | undefined
    >();
    const acceptsMission = (_mission: MissionRef): void => {};
    const acceptsCategory = (_category: MissionCategoryRef): void => {};
    const acceptsRelic = (_relic: RelicRef): void => {};
    acceptsMission(mission);
    acceptsCategory(category);
    acceptsRelic(relic);
    contentMod.mission("wrong_category", {
      picture: "GFX_event_pictures_ancient_ruins",
      // @ts-expect-error — a relic is not a mission category.
      category: relic,
    });
    // @ts-expect-error — items from another registry cannot become mission references.
    acceptsMission(relic);
    contentMod.mission("bad_counter", {
      picture: "GFX_event_pictures_ancient_ruins",
      counter: {
        labours_completed: {
          // @ts-expect-error — a mission counter maximum is numeric.
          max: "four",
        },
      },
    });
  });

  it("hands the country-scoped callbacks the project's own scope as FROM", () => {
    // The four callbacks the game runs on the owner country still receive the
    // project's object, and `event_scope` names it: THIS = country,
    // FROM = the project scope. One selector, read the other way round.
    contentMod.specialProject("failure_from", {
      eventScope: "planet_event",
      onFail: (country, ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"planet">>();
        country.setCountryFlag("content_types_failure_from");
        ctx.from.effects((planet) => planet.setPlanetFlag("content_types_failure_from_planet"));
      },
      onCancel: (_country, ctx) => {
        ctx.from.effects((planet) => planet.setPlanetFlag("content_types_cancel_planet"));
      },
      // A trigger is a value, so the FROM arrives through the closure form.
      abortTrigger: (ctx) => ctx.from.trigger(hasPlanetFlag("content_types_abort")),
      failTrigger: hasCountryFlag("content_types_fail_plain"),
    });
    contentMod.specialProject("failure_from_ship", {
      eventScope: "ship_event",
      onFail: (_country, ctx) => {
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"ship">>();
      },
      // @ts-expect-error — this project's FROM is its ship, not a planet.
      abortTrigger: (ctx) => ctx.from.trigger(hasPlanetFlag("content_types_wrong_from")),
    });
    contentMod.specialProject("success_from", {
      eventScope: "planet_event",
      onSuccess: (_planet, ctx) => {
        // The success family's FROM is the location handed to
        // `enable_special_project`, which is any of fourteen scopes chosen at
        // the call site — nothing the definition knows, so it stays unreadable.
        // @ts-expect-error — on_success declares no FROM the SDK can name
        ctx.from.effects(() => {});
      },
    });
  });

  it("connects an event chain's declared counters to every counter consumer", () => {
    const insightChain = contentMod.eventChain("insights", {
      counter: { insights: { max: 6 } },
    });
    const artifactChain = contentMod.eventChain("artifacts", {
      counter: { artifacts: { max: 3 } },
    });
    const emptyChain = contentMod.eventChain("empty", {});
    const country = makeScope<"country">([]);

    expectTypeOf<EventChainCounterOf<typeof insightChain>>().toEqualTypeOf<"insights">();
    country.addEventChainCounter({ eventChain: insightChain, counter: "insights", amount: 1 });
    country.resetEventChainCounter({ eventChain: insightChain, counter: "insights" });
    hasCompletedEventChainCounter({ eventChain: insightChain, counter: "insights" });
    country.addEventChainCounter({
      eventChain: "other_mod_chain",
      counter: "any_counter",
      amount: 1,
    });
    country.resetEventChainCounter({
      eventChain: vanilla.eventChain("MSI_chain"),
      counter: "vanilla_counter",
    });

    // @ts-expect-error — the chain did not declare this counter.
    country.addEventChainCounter({ eventChain: insightChain, counter: "insght", amount: 1 });
    // @ts-expect-error — reset has the same counter contract.
    country.resetEventChainCounter({ eventChain: insightChain, counter: "insght" });
    // @ts-expect-error — completion checks share the same counter contract.
    hasCompletedEventChainCounter({ eventChain: insightChain, counter: "insght" });
    // @ts-expect-error — a counter from a different chain is not interchangeable.
    country.addEventChainCounter({ eventChain: insightChain, counter: "artifacts", amount: 1 });
    // @ts-expect-error — a chain without a counter map declares no usable counters.
    country.resetEventChainCounter({ eventChain: emptyChain, counter: "anything" });

    expectTypeOf<EventChainCounterOf<typeof artifactChain>>().toEqualTypeOf<"artifacts">();
  });

  it("preserves a megastructure's id and brands its self-reference", () => {
    const gateway = contentMod.megastructure("gateway", {
      name: "Gateway",
      entity: "gateway_entity",
      buildTime: 3600,
      countryModifier: (m) => m.country.naval.cap.add(10),
    });
    expectTypeOf(gateway.id).toEqualTypeOf<"content_types_megastructure_gateway">();
    // `upgrade_from = { <megastructure> }` points the registry at itself, so
    // this is the reference test and the self-reference test at once — and a
    // raw vanilla id stays available beside the branded one.
    contentMod.megastructure("gateway_ruined", {
      name: "Ruined Gateway",
      entity: "gateway_ruined_entity",
      upgradeFrom: [gateway, "dyson_sphere_1"],
    });
    const wrongRegistry = defineBuilding({
      id: "content_types_megastructure_wrong_registry",
      name: "X",
    });
    contentMod.megastructure("bad_upgrade", {
      name: "X",
      entity: "x_entity",
      // @ts-expect-error — a BuildingRef is not a MegastructureRef.
      upgradeFrom: [wrongRegistry],
    });
    // The other direction: a megastructure is not a building.
    contentMod.building("wrong_megastructure", {
      name: "X",
      // @ts-expect-error — `upgrades` names buildings, not megastructures.
      upgrades: [gateway],
    });
  });

  it("takes a megastructure's triggered country modifiers as a list", () => {
    // megastructures.cwt declares the key `0..1` and vanilla's shroud_seal
    // writes two, so an `arity: "repeated"` overlay row lifts the member — the
    // type is the whole fix, since a singular member makes the second block
    // unwritable rather than merely awkward.
    expectTypeOf<MegastructureFields["triggeredCountryModifier"]>().toEqualTypeOf<
      TriggeredModifier<"country">[] | undefined
    >();
    contentMod.megastructure("two_modifiers", {
      name: "X",
      entity: "x_entity",
      triggeredCountryModifier: [
        { when: hasCountryFlag("first"), modifier: (m) => m.country.naval.cap.add(10) },
        { when: hasCountryFlag("second"), modifier: (m) => m.country.naval.cap.add(20) },
      ],
    });
    contentMod.megastructure("bare_modifier", {
      name: "X",
      entity: "x_entity",
      // @ts-expect-error — a list, so a bare block no longer assigns.
      triggeredCountryModifier: { when: hasCountryFlag("only"), modifier: (m) => m.raw("x", 1) },
    });
  });

  it("scopes a megastructure's clauses by the rules' replace_scopes", () => {
    expectTypeOf<MegastructureFields["placementRules"]>().toEqualTypeOf<
      | {
          planetPossible?: Trigger<"planet">;
          when?: Trigger<never>;
        }
      | undefined
    >();
    expectTypeOf<MegastructurePatch["placementRules"]>().toEqualTypeOf<
      | PatchInput<{
          planetPossible?: Trigger<"planet">;
          when?: Trigger<never>;
        }>
      | undefined
    >();
    contentMod.megastructure("scopes", {
      name: "X",
      entity: "x_entity",
      // potential is country-scoped, possible system-scoped with the building
      // country as FROM — megastructures.cwt:161-165.
      potential: hasCountryFlag("country_only"),
      possible: (system) => system.from.trigger(hasCountryFlag("country_only")),
      onBuildComplete: (system, ctx) => {
        system.setStarFlag("content_types_flag");
        expectTypeOf(ctx.fromfrom).toEqualTypeOf<ScopeRef<"megastructure">>();
      },
      // A station modifier applies in megastructure scope, not country.
      stationModifier: (m) => m.unchecked("starbase_shipyard_capacity_add", 5),
      placementRules: {
        when: hasCountryFlag("unchecked_placement_scope"),
        planetPossible: hasPlanetFlag("planet_only"),
      },
    });
    contentMod.megastructure("bad_placement_scope", {
      name: "X",
      entity: "x_entity",
      placementRules: {
        // @ts-expect-error — planet_possible has its own planet replace_scope.
        planetPossible: hasCountryFlag("country_only"),
      },
    });
    contentMod.megastructure("bad_scopes", {
      name: "X",
      entity: "x_entity",
      // @ts-expect-error — potential runs in country scope, not planet
      potential: hasPlanetFlag("planet_only"),
    });
    contentMod.megastructure("bad_effect_scope", {
      name: "X",
      entity: "x_entity",
      onBuildStart: (system) => {
        // @ts-expect-error — build hooks run in system, not planet, scope
        system.setCapital(true);
      },
    });
  });

  it("keeps mixed tooltip blocks optional and dual with their scalar forms", () => {
    contentMod.decision("tooltip", {
      name: "X",
      effect: () => {},
      customTooltip: { when: hasPlanetFlag("planet_only") },
    });
    contentMod.decision("tooltip_wrong_scope", {
      name: "X",
      effect: () => {},
      customTooltip: {
        // @ts-expect-error — the default decision scope is planet.
        when: hasCountryFlag("country_only"),
      },
    });
    // `text` and `fail_text` are each declared twice — once as an engine
    // sentinel, once as `localisation` — so the sentinel stays in the union
    // beside the two authored forms of a key (SDK-303).
    expectTypeOf<UtilityComponentTemplateFields["customTooltip"]>().toEqualTypeOf<
      | LocalizationInput
      | {
          text?: "" | LocalizationInput;
          failText?: "default" | LocalizationInput;
          successText?: LocalizationInput;
          when?: Trigger<never>;
        }
      | undefined
    >();
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

  it("types ROOT from the same annotation as THIS, not from THIS", () => {
    contentMod.solarSystemInitializer("root_scopes", {
      class: "sc_g",
      planet: [
        {
          // `## replace_scopes = { this = planet root = country prev = system
          // prevprev = system }` — the block runs in planet scope, but ROOT is
          // the fallen empire, and vanilla's own initializers write
          // `root = { ... }` against exactly that country.
          initEffect: (planet, ctx) => {
            planet.setCapital(true);
            expectTypeOf(ctx.root).toEqualTypeOf<ScopeRef<"country">>();
            expectTypeOf(ctx.prev).toEqualTypeOf<ScopeRef<"system">>();
            expectTypeOf(ctx.prevprev).toEqualTypeOf<ScopeRef<"system">>();
            ctx.root.effects((country) => country.setCountryFlag("content_types_root_flag"));
            // @ts-expect-error — ROOT is a country here, not the planet the block runs in
            ctx.root.effects((country) => country.setCapital(true));
          },
        },
      ],
      // The top-level clause's rules say `root = any`, which names no scope:
      // ROOT stays an inert sentinel there rather than lowering to something
      // an author could navigate, exactly as an undeclared FROM does.
      initEffect: (system, ctx) => {
        system.setStarFlag("content_types_flag");
        // @ts-expect-error — `root = any` declares no ROOT scope to read
        ctx.root.effects(() => {});
      },
    });
  });

  it("does not let split-root self witness natural event FROM", () => {
    const events = contentMod.namespace("split_root_witness");
    const needsPlanetFrom = events.planet(40, {
      scopes: { from: "planet" },
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const needsCountryFrom = events.planet(41, {
      scopes: { from: "country" },
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const needsCountryThenPlanet = events.planet(42, {
      scopes: { from: "country", fromfrom: "planet" },
      hideWindow: true,
      isTriggeredOnly: true,
    });

    contentMod.solarSystemInitializer("split_root_witness", {
      class: "sc_g",
      planet: [
        {
          initEffect: (planet, ctx) => {
            // @ts-expect-error — natural event FROM is ROOT, which is country
            // here; ctx.self is the planet this initializer block runs in.
            planet.planetEvent({ id: needsPlanetFrom, scopes: { from: ctx.self } });
            planet.planetEvent({ id: needsCountryFrom, scopes: { from: ctx.root } });
            // @ts-expect-error — deeper FROM overrides require an absolute ref.
            planet.planetEvent({
              id: needsCountryThenPlanet,
              scopes: {
                from: ctx.root,
                fromfrom: ctx.self,
              },
            });
          },
        },
      ],
    });
  });

  it("leaves ROOT unreadable where the rules never name one", () => {
    contentMod.decision("root_sentinel", {
      name: "X",
      // A decision's effect declares FROM and no ROOT, so FROM is a ref and
      // ROOT is the sentinel — the two are independent, and neither is
      // inferred from the other or from the block's own scope.
      effect: (planet, ctx) => {
        planet.setPlanetFlag("content_types_planet_only");
        expectTypeOf(ctx.from).toEqualTypeOf<ScopeRef<"country">>();
        expectTypeOf(ctx.root).toEqualTypeOf<UndeclaredAmbientScope<"root">>();
        // @ts-expect-error — nothing declares what ROOT holds here
        ctx.root.effects(() => {});
      },
    });
  });
});

/**
 * The patch surface is generated from the same field descriptors the
 * definition's own members come from, so what it accepts is checked the same
 * way — and what it must not accept is the identity it exists to keep.
 */
describe("generated patch authoring types", () => {
  const view = viewFromFiles({
    "common/technology/pp_soc_tech.txt":
      "tech_pp_forging = {\n\tarea = society\n\ttier = 3\n\tcategory = { biology }\n}\n",
    "common/buildings/pp_buildings.txt":
      "building_pp_refinery = {\n\tcategory = manufacturing\n\tplanet_limit = 1\n}\n",
    "common/ascension_perk_categories/pp_ascension_perk_categories.txt":
      "ap_category_ambitions = {\n\tascension_perks = { ap_become_the_crisis }\n}\n",
    "common/megastructures/pp_megastructures.txt":
      "megastructure_pp_array = {\n\tentity = pp_array_entity\n\tbuild_time = 1800\n}\n",
  });
  const forging = view.definition("technology", "tech_pp_forging");
  const refinery = view.definition("building", "building_pp_refinery");
  const ambitions = view.definition("ascension_perk_category", "ap_category_ambitions");
  const array = view.definition("megastructure", "megastructure_pp_array");

  it("keeps vanilla's identity: a patch cannot set an id", () => {
    // A patched definition keeps vanilla's key, or the override does not win.
    expectTypeOf<TechnologyPatch>().not.toHaveProperty("id");
    const patch: TechnologyPatch = {
      cost: 8000,
      // @ts-expect-error — and the type is closed, so saying so is an error.
      id: "content_types_tech_elsewhere",
    };
    void patch;
    // @ts-expect-error — a member naming nothing the patch type has, in the one
    // position the compiler does check it: an object with no member in common.
    contentMod.patchTechnology(forging, () => ({ csot: 8000 }));
  });

  it("appends an authored perk to a parsed ascension perk category", () => {
    const archiveAmbition = contentMod.ascensionPerk("archive_ambition", {
      name: "Archive Ambition",
    });
    expectTypeOf(ambitions.registry).toEqualTypeOf<"ascension_perk_category">();
    expectTypeOf(ambitions.ascensionPerks).toEqualTypeOf<readonly AscensionPerkRef[]>();
    expectTypeOf<AscensionPerkCategoryPatch["ascensionPerks"]>().toEqualTypeOf<
      PatchInput<(AscensionPerkRef | string)[]> | undefined
    >();
    expectTypeOf<AscensionPerkCategoryPatch>().not.toHaveProperty("id");
    expectTypeOf(
      contentMod.patchAscensionPerkCategory(ambitions, (category) => ({
        ascensionPerks: [...category.ascensionPerks, archiveAmbition],
      })).patched.registry
    ).toEqualTypeOf<"ascension_perk_category">();
    // @ts-expect-error — a parsed building is not an ascension perk category.
    contentMod.patchAscensionPerkCategory(refinery, () => ({ ascensionPerks: [] }));
    // @ts-expect-error — a category is not a building patch source.
    contentMod.patchBuilding(ambitions, () => ({ planetLimit: 1 }));
  });

  it("leaves an unknown member beside a known one to the runtime guard", () => {
    // Pinning what the compiler does NOT do, because it decides where the
    // check has to live. TypeScript performs no excess-property check on an
    // object literal returned from an inferred-return arrow, so neither of
    // these is a type error — `patchContent` refuses them at build time
    // instead (`tests/vanilla/surface.test.ts`), rather than silently
    // emitting nothing for the member.
    expectTypeOf(() => ({ cost: 8000, id: "x" })).toExtend<() => TechnologyPatch>();
    expectTypeOf(() => ({ cost: 8000, costt: 2 })).toExtend<() => TechnologyPatch>();
  });

  it("admits the definition's own forms, plus the ways parsed values come back", () => {
    contentMod.patchTechnology(forging.require("tier"), (technology) => ({
      // The dual field's block arm, which the definition admits too.
      cost: { base: 4000, factor: 2 },
      // A parsed number, carried back with its `@variable` provenance.
      tier: technology.tier,
      // The widened element form: vanilla's own `OR = { ... }` groups.
      prerequisites: [anyOf("tech_pp_lasers_1"), "content_types_tech_marker"],
    }));
    contentMod.patchTechnology(forging, () => ({
      // @ts-expect-error — `area` is an enum, and a parsed number is not one.
      area: { value: 3 },
    }));
  });

  it("takes only its own registry's parsed definition", () => {
    // A structurally parsed-definition-shaped value is not a parsed
    // technology: the capability method names the registry it patches.
    const looksParsed = { id: "tech_pp_forging", body: [] };
    // @ts-expect-error — not a ParsedTechnology.
    contentMod.patchTechnology(looksParsed, () => ({ cost: 1 }));
    // @ts-expect-error — a definition of this mod's own is not a patch source.
    contentMod.patchTechnology(defineBuilding({ id: "content_types_b", name: "B" }), () => ({}));
  });

  it("keeps two registries' parsed definitions apart, in both directions", () => {
    // The registry tag, not the modelled fields, is what does this: a parsed
    // building models nothing at all, so structural typing alone would let it
    // stand in for anything with an `id` and a `body`.
    expectTypeOf(refinery.registry).toEqualTypeOf<"building">();
    expectTypeOf(forging.registry).toEqualTypeOf<"technology">();
    // @ts-expect-error — a parsed building is not a patch source for technology.
    contentMod.patchTechnology(refinery, () => ({ cost: 1 }));
    // @ts-expect-error — nor the other way round.
    contentMod.patchBuilding(forging, () => ({ planetLimit: 1 }));
    // Each in its own registry compiles, and the patched item carries the tag.
    expectTypeOf(
      contentMod.patchBuilding(refinery, () => ({ planetLimit: 2 })).patched.registry
    ).toEqualTypeOf<"building">();
    expectTypeOf(
      contentMod.patchTechnology(forging, () => ({ tier: 2 })).patched.registry
    ).toEqualTypeOf<"technology">();
  });

  it("carries the registry's localisation slots as optional replacement text", () => {
    // Derived from the same declared localisation table the definition's own
    // text members come from — not a hand-listed pair — so both registries
    // have both slots, both optional, both the shared text type: the text
    // replaces vanilla's, and the key is vanilla's own rather than authored.
    expectTypeOf<TechnologyPatch["name"]>().toEqualTypeOf<LocalizedText | undefined>();
    expectTypeOf<TechnologyPatch["desc"]>().toEqualTypeOf<LocalizedText | undefined>();
    expectTypeOf<BuildingPatch["name"]>().toEqualTypeOf<LocalizedText | undefined>();
    expectTypeOf<BuildingPatch["desc"]>().toEqualTypeOf<LocalizedText | undefined>();
    // A rename alone is a complete patch: nothing about the body is required.
    const rename: TechnologyPatch = { name: "Renamed" };
    void rename;
  });

  it("gives the second registry the same closed, id-less patch type", () => {
    expectTypeOf<BuildingPatch>().not.toHaveProperty("id");
    const patch: BuildingPatch = {
      planetLimit: 1,
      // @ts-expect-error — closed, so a patched id is a compile error here.
      id: "content_types_building_elsewhere",
    };
    void patch;
    // @ts-expect-error — a member naming nothing the patch type has.
    contentMod.patchBuilding(refinery, () => ({ planetLmit: 1 }));
  });

  it("keeps the third registry apart from both of the others, in every direction", () => {
    expectTypeOf(array.registry).toEqualTypeOf<"megastructure">();
    // @ts-expect-error — a parsed megastructure is not a technology patch source.
    contentMod.patchTechnology(array, () => ({ cost: 1 }));
    // @ts-expect-error — nor a building one.
    contentMod.patchBuilding(array, () => ({ planetLimit: 1 }));
    // @ts-expect-error — and neither of theirs stands in for a megastructure.
    contentMod.patchMegastructure(forging, () => ({ buildTime: 1 }));
    // @ts-expect-error — in both directions, as with every other pair.
    contentMod.patchMegastructure(refinery, () => ({ buildTime: 1 }));
    expectTypeOf(
      contentMod.patchMegastructure(array, () => ({ buildTime: 2400 })).patched.registry
    ).toEqualTypeOf<"megastructure">();
  });

  it("gives the third registry the same closed, id-less patch type and its four slots", () => {
    expectTypeOf<MegastructurePatch>().not.toHaveProperty("id");
    const patch: MegastructurePatch = {
      buildTime: 2400,
      // @ts-expect-error — closed, so a patched id is a compile error here.
      id: "content_types_megastructure_elsewhere",
    };
    void patch;
    // Four declared localisation slots rather than the other two registries'
    // two: the member list is the registry's own table, never a fixed pair.
    expectTypeOf<MegastructurePatch["name"]>().toEqualTypeOf<LocalizedText | undefined>();
    expectTypeOf<MegastructurePatch["desc"]>().toEqualTypeOf<LocalizedText | undefined>();
    expectTypeOf<MegastructurePatch["details"]>().toEqualTypeOf<LocalizedText | undefined>();
    expectTypeOf<MegastructurePatch["delayedInfo"]>().toEqualTypeOf<LocalizedText | undefined>();
    // @ts-expect-error — a member naming nothing the patch type has.
    contentMod.patchMegastructure(array, () => ({ buildTme: 1 }));
  });

  it("carries the repeated-member arity assertion onto the patch surface too", () => {
    // The `arity: "repeated"` row corrects the declared cardinality once, so
    // the patch member is a list for the same reason the definition's is —
    // a patch that could carry only one block could not reproduce a vanilla
    // megastructure writing two, which is the case the row exists for.
    expectTypeOf<MegastructurePatch["triggeredCountryModifier"]>().toEqualTypeOf<
      PatchInput<TriggeredModifier<"country">[]> | undefined
    >();
    contentMod.patchMegastructure(array, () => ({
      // @ts-expect-error — a bare block is not a list, here as on the definer.
      triggeredCountryModifier: { when: always(), modifier: (m) => m.country.naval.cap.add(1) },
    }));
  });
});
