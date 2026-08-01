import { describe, expectTypeOf, it } from "vitest";

import {
  canJoinFactions,
  hasAuthority,
  hasCountryFlag,
  hasPlanetFlag,
  isCapital,
  Mod,
  type AgendaRef,
  type AscensionPerkRef,
  type DecisionRef,
  type EdictRef,
  type JobRef,
  type TechnologyRef,
  type Trigger,
} from "../src/index.ts";

describe("generated content authoring types", () => {
  const mod = new Mod({
    name: "Content types",
    prefix: "content_types",
    supportedVersion: "4.4.*",
  });

  it("returns branded references and lets categories own tradition membership", () => {
    const agenda = mod.defineAgenda({
      id: "content_types_agenda_x",
      name: "X",
      agendaCost: 100,
      effect: (country) => country.setCountryFlag("content_types_agenda_finished"),
    });
    const tradition = mod.defineTradition({
      id: "content_types_tradition_x",
      name: "X",
      unlocksAgenda: agenda,
    });
    const category = mod.defineTraditionCategory({
      id: "content_types_tradition_category_x",
      name: "X",
      treeTemplate: "tree_template_5",
      adoptionBonus: tradition,
      finishBonus: tradition,
      traditions: [tradition],
    });
    expectTypeOf(tradition).toExtend<{ readonly id: string }>();
    expectTypeOf(category).toExtend<{ readonly id: string }>();
    expectTypeOf(agenda).toExtend<AgendaRef>();
    const edict = mod.defineEdict({
      id: "content_types_edict_x",
      name: "X",
      length: 360,
      icon: "GFX_edict_x",
    });
    expectTypeOf(edict).toExtend<EdictRef>();
    const ascensionPerk = mod.defineAscensionPerk({
      id: "content_types_ascension_perk_x",
      name: "X",
    });
    expectTypeOf(ascensionPerk).toExtend<AscensionPerkRef>();
    const decision = mod.defineDecision({
      id: "content_types_decision_x",
      name: "X",
      effect: () => {},
    });
    expectTypeOf(decision).toExtend<DecisionRef>();
    const job = mod.defineJob({
      id: "content_types_job_x",
      name: "X",
    });
    expectTypeOf(job).toExtend<JobRef>();
  });

  it("does not invent a category field on traditions", () => {
    mod.defineTradition({
      id: "content_types_tradition_without_category",
      name: "No synthetic membership",
      // @ts-expect-error — membership belongs to TraditionCategoryDef.traditions
      category: "content_types_tradition_category_x",
    });
  });

  it("enforces top-level and nested prefixes", () => {
    // @ts-expect-error — the building id must carry the inferred mod prefix
    mod.defineBuilding({ id: "other_building_x", name: "X" });
    // @ts-expect-error — the decision id must carry the inferred mod prefix
    mod.defineDecision({ id: "other_decision_x", name: "X", effect: () => {} });
    // @ts-expect-error — the job id must carry the inferred mod prefix
    mod.defineJob({ id: "other_job_x", name: "X" });
    mod.defineTradition({
      id: "content_types_tradition_with_swap",
      name: "X",
      traditionSwap: [
        {
          // @ts-expect-error — nested identities use the same prefix contract
          id: "other_swap_x",
          name: "Wrong namespace",
        },
      ],
    });
    mod.defineAscensionPerk({
      id: "content_types_ascension_perk_with_swap",
      name: "X",
      traditionSwap: [
        {
          // @ts-expect-error — ascension perk swaps use the same prefix contract
          id: "other_ascension_perk_swap",
          name: "Wrong namespace",
        },
      ],
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
      traditionSwap: [
        {
          id: "content_types_ascension_perk_swap_scoped",
          name: "X",
          onEnabled: (country) => {
            // @ts-expect-error — ascension perk swap effects also run in country scope
            country.setPlanetFlag("planet_only");
          },
        },
      ],
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
      // @ts-expect-error — swappable_data nests its repeated entries two levels
      // deep, which the nested-definition machinery cannot express yet
      swappableData: {},
    });
    mod.defineAgenda({
      id: "content_types_agenda_localisation_alias",
      name: "X",
      agendaCost: 100,
      // @ts-expect-error — duplicate CWT localization aliases collapse to the canonical name slot
      councilAgendaName: "Duplicate",
    });
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
