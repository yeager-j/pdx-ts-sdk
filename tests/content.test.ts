import { describe, expect, it } from "vitest";

import { hasAuthority, isCapital, Mod } from "../src/index.ts";

function defineContentExample(): Mod<"content_test"> {
  const mod = new Mod({
    name: "Content test",
    prefix: "content_test",
    supportedVersion: "4.4.*",
  });

  const agenda = mod.defineAgenda({
    id: "content_test_agenda_machine_futures",
    name: "Machine Futures",
    desc: "Direct the council toward synthetic ascension.",
    agendaCost: 1_000,
    agendaCooldown: 3_600,
    potential: hasAuthority("auth_machine_intelligence"),
    allow: hasAuthority("auth_machine_intelligence"),
    initialEffectCustomLoc: "content_test_agenda_machine_futures_initial",
    initEffect: (country) => country.setCountryFlag("content_test_machine_agenda_started"),
    modifier: { country_unity_produces_mult: 0.1 },
    finishModifier: "agenda_defensive_focus_finish",
    effect: (country) => country.addResource({ resource: "unity", amount: 500 }),
    aiWeight: {
      base: 25,
      modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
    },
  });

  mod.defineEdict({
    id: "content_test_edict_machine_mobilization",
    name: "Machine Mobilization",
    description: "Redirect the economy toward immediate expansion.",
    length: 3_600,
    icon: "GFX_edict_machine_mobilization",
    isWartimeEdict: true,
    edictLockInMonths: 12,
    edictCapUsage: 1,
    resources: [
      {
        category: "edicts",
        cost: { amounts: { unity: 100 } },
        upkeep: {
          amounts: { unity: 2 },
          when: hasAuthority("auth_machine_intelligence"),
          multiplier: [1, 2],
        },
      },
    ],
    unityCostMult: 0.9,
    modifier: { country_ship_build_speed_mult: 0.1 },
    triggeredCountryModifier: [
      {
        when: hasAuthority("auth_machine_intelligence"),
        key: "content_test_machine_mobilization_modifier",
        showIfNotPotential: false,
        notPotentialOverrideTextKey: "content_test_requires_machine_authority",
        modifier: { country_command_limit_add: 1 },
        modifiers: { country_naval_cap_mult: 0.1 },
        description: "content_test_machine_mobilization_modifier_desc",
        descriptionParameters: { amount: "10%" },
        showOnlyCustomTooltip: false,
        customTooltip: "content_test_machine_mobilization_modifier_tooltip",
        mult: [1, 2],
        multiplier: 0.5,
      },
    ],
    relayNetworkModifier: { country_unity_produces_mult: 0.05 },
    potential: hasAuthority("auth_machine_intelligence"),
    allow: hasAuthority("auth_machine_intelligence"),
    prerequisites: ["tech_global_production_strategy"],
    showTechUnlockIf: hasAuthority("auth_machine_intelligence"),
    aiWeight: { base: 50 },
    effect: (country) => country.setCountryFlag("content_test_machine_mobilization_active"),
    onDisabled: (country) => country.removeCountryFlag("content_test_machine_mobilization_active"),
  });

  mod.defineBuilding({
    id: "content_test_building_lab_1",
    name: "Experimental Lab",
    desc: "A proving ground for impossible ideas.",
    baseBuildtime: 360,
    category: "research",
    capital: true,
    capitalTier: 2,
    canDemolish: false,
    canBuild: true,
    isCappedByModifier: true,
    allow: isCapital(),
    planetModifier: { planet_jobs_engineering_research_produces_mult: 0.1 },
    showInTech: ["tech_basic_science_lab_1"],
    upgrades: ["content_test_building_lab_2"],
    prerequisites: ["tech_basic_science_lab_1"],
    convertTo: ["building_ruined_lab"],
  });

  const tradition = mod.defineTradition({
    id: "content_test_tradition_ascension",
    name: "Synthetic Ascension",
    flavor: "The flesh is a temporary constraint.",
    effects: "Our people approach mechanical perfection.",
    unlocksAgenda: agenda,
    modifier: { pop_growth_speed: 0.1 },
    possible: hasAuthority("auth_machine_intelligence"),
    customTooltip: ["content_test_ascension_tooltip"],
    traditionSwap: [
      {
        id: "content_test_tradition_ascension_servitor",
        name: "Custodian Ascension",
        inheritIcon: true,
        modifier: { pop_happiness: 0.05 },
        weight: {
          base: 10,
          modifiers: [
            {
              factor: 2,
              when: hasAuthority("auth_machine_intelligence"),
            },
          ],
        },
        trigger: hasAuthority("auth_machine_intelligence"),
      },
    ],
    aiWeight: {
      base: 100,
      modifiers: [{ factor: 0.5, when: hasAuthority("auth_corporate") }],
    },
  });

  mod.defineTraditionCategory({
    id: "content_test_tradition_category_machines",
    name: "Machine Futures",
    desc: "Choose the shape of tomorrow.",
    treeTemplate: "tree_template_5",
    adoptionBonus: tradition,
    finishBonus: tradition,
    traditions: [tradition],
    potential: hasAuthority("auth_machine_intelligence"),
    aiWeight: { base: 50 },
  });

  return mod;
}

describe("generated content registries", () => {
  const files = defineContentExample().render();

  it("renders one generated file per populated registry", () => {
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/buildings/content_test_buildings.txt",
      "common/traditions/content_test_traditions.txt",
      "common/tradition_categories/content_test_tradition_categories.txt",
      "common/council_agendas/content_test_council_agendas.txt",
      "common/edicts/content_test_edicts.txt",
      "localisation/english/content_test_l_english.yml",
    ]);
  });

  for (const [relPath, content] of files) {
    it(`matches the content golden for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/content/${relPath.replaceAll("/", "__")}`
      );
    });
  }

  it("rejects an unprefixed nested definition before rendering", () => {
    const mod = new Mod({
      name: "Content test",
      prefix: "content_test",
      supportedVersion: "4.4.*",
    });
    const runtimeConfigured: Mod<string> = mod;
    expect(() =>
      runtimeConfigured.defineTradition({
        id: "content_test_tradition_x",
        name: "X",
        traditionSwap: [{ id: "othermod_swap", name: "Wrong namespace" }],
      })
    ).toThrow(/must start with the mod prefix "content_test_"/);
    expect(() =>
      mod.defineTradition({
        id: "content_test_tradition_x",
        name: "X",
        traditionSwap: [{ id: "content_test_swap_x", name: "Correct namespace" }],
      })
    ).not.toThrow();
  });

  it("rejects duplicate nested ids across traditions", () => {
    const mod = new Mod({
      name: "Content test",
      prefix: "content_test",
      supportedVersion: "4.4.*",
    });
    mod.defineTradition({
      id: "content_test_tradition_x",
      name: "X",
      traditionSwap: [{ id: "content_test_swap_shared", name: "First" }],
    });
    expect(() =>
      mod.defineTradition({
        id: "content_test_tradition_y",
        name: "Y",
        traditionSwap: [{ id: "content_test_swap_shared", name: "Second" }],
      })
    ).toThrow('Duplicate tradition.tradition_swap id "content_test_swap_shared"');
  });
});
