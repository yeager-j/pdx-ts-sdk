import { describe, expectTypeOf, it } from "vitest";

import {
  hasAuthority,
  hasCountryFlag,
  hasPlanetFlag,
  isCapital,
  Mod,
  type AgendaRef,
  type EdictRef,
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
          modifiers: { country_naval_cap_mult: 0.1 },
        },
      ],
      effect: (country) => {
        // @ts-expect-error — edict effects run in country, not planet, scope
        country.setPlanetFlag("planet_only");
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

  it("rejects fields outside the curated surface", () => {
    mod.defineTradition({
      id: "content_types_tradition_effect",
      name: "X",
      // @ts-expect-error — effect closures remain reported, not silently admitted
      onEnabled: () => {},
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

  it("keeps modifier blocks numeric and weight conditions scoped", () => {
    mod.defineTradition({
      id: "content_types_tradition_modifier",
      name: "X",
      modifier: {
        pop_growth_speed: 0.1,
        // @ts-expect-error — modifier values serialize as numeric assignments
        pop_happiness: "high",
      },
    });
    expectTypeOf(hasAuthority("auth_democratic")).toExtend<Trigger<"country">>();
  });
});
