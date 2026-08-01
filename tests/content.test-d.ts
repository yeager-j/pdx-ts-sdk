import { describe, expectTypeOf, it } from "vitest";

import {
  canGoMia,
  canJoinFactions,
  hasAuthority,
  hasCountryFlag,
  hasPlanetFlag,
  isCapital,
  Mod,
  type AgendaRef,
  type AgreementPresetRef,
  type ArchaeologicalSiteTypeRef,
  type AscensionPerkRef,
  type BombardmentStanceRef,
  type CasusBelliRef,
  type DecisionRef,
  type EdictRef,
  type JobRef,
  type OpinionModifierRef,
  type TechnologyRef,
  type Trigger,
  type WarGoalRef,
} from "../src/index.ts";

describe("generated content authoring types", () => {
  const mod = new Mod({
    name: "Content types",
    prefix: "content_types",
    supportedVersion: "4.4.*",
  });

  it("does not invent a category field on traditions", () => {
    mod.defineTradition({
      id: "content_types_tradition_without_category",
      name: "No synthetic membership",
      // @ts-expect-error — membership belongs to TraditionCategoryDef.traditions
      category: "content_types_tradition_category_x",
    });
  });

  it("carries inherited and explicit trigger scopes", () => {
    mod.defineBuilding({
      id: "content_types_building_x",
      name: "X",
      allow: isCapital(),
      // @ts-expect-error — a country-only condition is not valid in colony scope
      potential: hasCountryFlag("country_only"),
    });
    mod.defineTradition({
      id: "content_types_tradition_scoped",
      name: "X",
      possible: hasAuthority("auth_democratic"),
      // @ts-expect-error — tradition weights and conditions run in country scope
      aiWeight: { modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }] },
    });
    mod.defineAgenda({
      id: "content_types_agenda_scoped",
      name: "X",
      agendaCost: 100,
      effect: (country) => {
        country.setCountryFlag("country_only");
        // @ts-expect-error — agenda effects run in country, not planet, scope
        country.setPlanetFlag("planet_only");
      },
    });
    mod.defineAscensionPerk({
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
    mod.defineEdict({
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
    mod.defineDecision({
      id: "content_types_decision_scoped",
      name: "X",
      effect: () => {},
      showTechUnlockIf: hasAuthority("auth_democratic"),
    });
    mod.defineJob({
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
    mod.defineOpinionModifier({
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
    mod.defineCasusBelli({
      id: "content_types_casus_belli_scoped",
      name: "X",
      showNotification: true,
      // @ts-expect-error — casus belli triggers run in country scope
      potential: hasPlanetFlag("planet_only"),
    });
    mod.defineWarGoal({
      id: "content_types_war_goal_scoped",
      name: "X",
      casusBelli: "some_casus_belli",
      // @ts-expect-error — war goal ai_weight gates run in country scope
      aiWeight: { modifiers: [{ factor: 2, when: hasPlanetFlag("planet_only") }] },
    });
    mod.defineBombardmentStance({
      id: "content_types_bombardment_stance_scoped",
      name: "X",
      // @ts-expect-error — bombardment stance triggers run in fleet scope
      trigger: hasCountryFlag("country_only"),
      default: false,
      aiWeight: { base: 1 },
    });
    mod.defineArchaeologicalSiteType({
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
    mod.defineBuilding({
      id: "content_types_building_capital_tier",
      name: "X",
      capitalTier: 2,
    });
    mod.defineEdict({
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
    mod.defineTradition({
      id: "content_types_tradition_effect",
      name: "X",
      onEnabled: () => {},
    });
    mod.defineJob({
      id: "content_types_job_unlowerable",
      name: "X",
      // @ts-expect-error — swappable_data's own `default` sub-struct is required
      swappableData: {},
    });
    mod.defineJob({
      id: "content_types_job_swappable_data",
      name: "X",
      // The struct field shape now expresses swappable_data's two-level nesting:
      // a required `default` struct plus a repeated `swap_type` struct list.
      swappableData: {
        default: { desc: "content_types_job_swappable_default_desc" },
        swapType: [{ trigger: isCapital(), weight: 1 }],
      },
    });
    mod.defineAgenda({
      id: "content_types_agenda_localisation_alias",
      name: "X",
      agendaCost: 100,
      // @ts-expect-error — duplicate CWT localization aliases collapse to the canonical name slot
      councilAgendaName: "Duplicate",
    });
  });

  it("restricts scripted modifier category to the generated enum", () => {
    mod.defineScriptedModifier({
      id: "content_types_scripted_modifier_category",
      category: "planet",
      // @ts-expect-error — category is drawn from enum[scripted_modifier_category], not a free string
      icon: 5,
    });
    // @ts-expect-error — an unknown category value is not a member of ScriptedModifierCategory
    mod.defineScriptedModifier({ id: "content_types_scripted_modifier_bad", category: "nonsense" });
  });

  it("keeps content reference brands distinct", () => {
    const building = mod.defineBuilding({
      id: "content_types_building_brand",
      name: "X",
    });
    // @ts-expect-error — a defined building is not a technology reference
    const technology: TechnologyRef = building;
    void technology;
  });

  it("scopes situations' repeated-struct fields per their own push_scope, not the body default", () => {
    // situation_type's body defaults every unmarked field to "situation"
    // scope, but potential replace_scopes to "country" at the top level while
    // staying "situation" inside both stages ("container" keying) and
    // approach ("siblings" keying) — so a country-scoped trigger fits the top
    // level but not either nested field. Both keyings need their own check,
    // not just the top level.
    mod.defineSituationType({
      id: "content_types_situation_scoped",
      name: "X",
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
    mod.defineTradition({
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
});
