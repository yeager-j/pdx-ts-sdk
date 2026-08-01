import { describe, expect, it } from "vitest";

import {
  always,
  canGoMia,
  canJoinFactions,
  hasAuthority,
  hasPlanetFlag,
  isCapital,
  Mod,
} from "../src/index.ts";

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
    modifier: (m) => m.country.unity.produces.mult(0.1),
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
    modifier: (m) => m.starbase.shipyard.build.speed.mult(0.1),
    triggeredCountryModifier: [
      {
        when: hasAuthority("auth_machine_intelligence"),
        key: "content_test_machine_mobilization_modifier",
        showIfNotPotential: false,
        notPotentialOverrideTextKey: "content_test_requires_machine_authority",
        modifier: (m) => m.command.limit.add(1),
        modifiers: (m) => m.country.naval.cap.mult(0.1),
        description: "content_test_machine_mobilization_modifier_desc",
        descriptionParameters: { amount: "10%" },
        showOnlyCustomTooltip: false,
        customTooltip: "content_test_machine_mobilization_modifier_tooltip",
        mult: [1, 2],
        multiplier: 0.5,
      },
    ],
    relayNetworkModifier: (m) => m.country.unity.produces.mult(0.05),
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
    planetModifier: (m) => m.planet.jobs.engineering.research.produces.mult(0.1),
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
    modifier: (m) => m.planet.pop.assembly.mult(0.1),
    possible: hasAuthority("auth_machine_intelligence"),
    customTooltip: ["content_test_ascension_tooltip"],
    traditionSwap: {
      content_test_tradition_ascension_servitor: {
        name: "Custodian Ascension",
        inheritIcon: true,
        modifier: (m) => m.pop.happiness(0.05),
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
    },
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

  mod.defineAscensionPerk({
    id: "content_test_ascension_perk_machine_futures",
    name: "Machine Futures",
    desc: "Our future belongs to forms we choose.",
    potential: hasAuthority("auth_machine_intelligence"),
    possible: hasAuthority("auth_machine_intelligence"),
    onEnabled: (country) => country.setCountryFlag("content_test_machine_futures_enabled"),
    modifier: (m) => m.planet.pop.assembly.mult(0.1),
    triggeredModifier: [
      {
        when: hasAuthority("auth_machine_intelligence"),
        modifiers: (m) => m.country.unity.produces.mult(0.05),
      },
    ],
    aiWeight: {
      base: 100,
      modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
    },
    customTooltip: "content_test_machine_futures_tooltip",
    traditionSwap: {
      content_test_ascension_perk_machine_servitor: {
        name: "Custodian Futures",
        flavor: "Perfection is stewardship.",
        effects: "Our purpose is renewed.",
        inheritIcon: true,
        customTooltip: ["content_test_machine_servitor_tooltip"],
        modifier: (m) => m.pop.happiness(0.05),
        onEnabled: (country) =>
          country.setCountryFlag("content_test_machine_servitor_futures_enabled"),
        weight: {
          base: 10,
          modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
        },
        trigger: hasAuthority("auth_machine_intelligence"),
      },
    },
  });

  mod.defineDecision({
    id: "content_test_decision_machine_ascendancy",
    name: "Pursue Machine Ascendancy",
    desc: "Redirect national effort toward synthetic transcendence.",
    ownedPlanetsOnly: true,
    important: true,
    enactmentTime: 360,
    icon: "GFX_decision_machine_ascendancy",
    resources: [
      {
        category: "decisions",
        cost: { amounts: { unity: 500 } },
      },
    ],
    showTechUnlockIf: hasAuthority("auth_machine_intelligence"),
    // decision.potential/allow/abort_trigger carry no fixed scope in the rules — the
    // decision's own scope varies by category (ship, planet, or country) — so only a
    // scope-agnostic trigger like `always()` type-checks here.
    potential: always(),
    allow: always(),
    abortTrigger: always(),
    abortEffect: () => {},
    onQueued: () => {},
    onUnqueued: () => {},
    effect: () => {},
    aiWeight: { base: 50 },
    prerequisites: ["tech_global_production_strategy"],
  });

  mod.defineJob({
    id: "content_test_job_synthetic_technician",
    name: "Synthetic Technician",
    plural: "Synthetic Technicians",
    desc: "Maintains the machine collective's growing infrastructure.",
    effect: "content_test_job_synthetic_technician_effect_desc_text",
    category: "worker",
    firstComeFirstServed: false,
    isCappedByModifier: true,
    canBeAutomated: true,
    exemptFromAiAmenityPrioritization: false,
    countAsAvailableForAi: true,
    canSetPriority: true,
    isPreSapient: false,
    ignoresSapience: false,
    ignoresFavorite: false,
    purge: "purge_processing",
    contributesToDiploWeight: true,
    tags: ["content_test_tag_machine"],
    localizedTags: ["content_test_job_localized_tag"],
    possiblePrecalc: "can_fill_worker_job",
    possible: canJoinFactions(),
    resources: [
      {
        category: "jobs",
        produces: { amounts: { unity: 2 } },
      },
    ],
    overlordResources: [
      {
        category: "jobs",
        upkeep: { amounts: { energy: 1 } },
      },
    ],
    popGroupModifier: (m) => m.country.unity.produces.mult(0.02),
    countryModifier: (m) => m.country.unity.produces.mult(0.02),
    planetModifier: (m) => m.planet.pop.assembly.mult(0.05),
    systemModifier: (m) => m.system.storm.influence.add(1),
    triggeredPlanetPopGroupModifierForAll: [
      {
        when: canJoinFactions(),
        modifiers: (m) => m.country.unity.produces.mult(0.01),
      },
    ],
    triggeredCountryModifier: [
      {
        when: hasAuthority("auth_machine_intelligence"),
        modifiers: (m) => m.country.unity.produces.mult(0.01),
      },
    ],
    triggeredPlanetModifier: [
      {
        when: isCapital(),
        modifiers: (m) => m.planet.pop.assembly.mult(0.01),
      },
    ],
    triggeredSystemModifier: {
      when: always(),
      modifiers: (m) => m.system.storm.influence.add(1),
    },
    weight: {
      base: 10,
      modifiers: [{ factor: 2, when: canJoinFactions() }],
    },
    autoTraitPrio: ["trait_thrifty"],
  });

  mod.defineOpinionModifier({
    id: "content_test_opinion_modifier_diplomatic_thaw",
    name: "Diplomatic Thaw",
    opinion: {
      base: 20,
      modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
    },
    decay: { base: -1 },
    growth: { base: 5 },
    accumulative: true,
    min: -50,
    max: 50,
    unique: true,
    monthly: true,
    months: 12,
  });

  mod.defineScriptedModifier({
    id: "content_test_scripted_modifier_synthetic_output",
    name: "Synthetic Output",
    icon: "GFX_scripted_modifier_synthetic_output",
    percentage: true,
    minMult: 0,
    maxDecimals: 1,
    good: true,
    neutral: false,
    hidden: false,
    noDiff: false,
    capZeroToOne: false,
    localizeWithValueKey: false,
    category: "country",
  });

  const casusBelli = mod.defineCasusBelli({
    id: "content_test_casus_belli_manufactured_grievance",
    name: "Manufactured Grievance",
    hint: "Fabricate a pretext for war.",
    potential: hasAuthority("auth_machine_intelligence"),
    isValid: always(),
    showNotification: true,
    proxyWarResources: [{ category: "physics_research", cost: { amounts: { unity: 50 } } }],
    onProxyWarStart: (country) => country.setCountryFlag("content_test_proxy_war_started"),
    showInDiplomacy: true,
    aggregatedMessageKey: "content_test_casus_belli_aggregated",
  });

  mod.defineWarGoal({
    id: "content_test_war_goal_liberation",
    name: "Liberation",
    desc: "Free the occupied systems.",
    casusBelli,
    hide: "no_cb",
    cedeClaims: "yes",
    threatMultiplier: 1.5,
    surrenderAcceptance: 10,
    warExhaustion: 1.2,
    potential: hasAuthority("auth_machine_intelligence"),
    possible: always(),
    allowedPeaceOffers: ["status_quo", "surrender"],
    onStatusQuo: (country) => country.setCountryFlag("content_test_status_quo"),
    aiWeight: {
      base: 5,
      modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
    },
    destroyStarbases: true,
    forbiddenPeaceOffers: {
      demandSurrender: "content_test_war_goal_liberation_no_demand",
      surrender: "content_test_war_goal_liberation_no_surrender",
    },
  });

  mod.defineAgreementPreset({
    id: "content_test_agreement_preset_tribute",
    name: "Tribute",
    desc: "A modest tribute agreement.",
    flavor: "Coin for peace.",
    icon: "GFX_agreement_preset_tribute",
    termData: {
      hasCooldownOnFirstRenegotiation: true,
      forcedInitialLoyalty: 20,
      discreteTerms: [{ key: "subject_integration", value: "subject_can_not_be_integrated" }],
      resourceTerms: [{ key: "energy", value: 0.1 }],
    },
    overlordWeight: {
      base: 10,
      modifiers: [{ factor: 2, when: hasAuthority("auth_machine_intelligence") }],
    },
    subjectWeight: { base: -5 },
    potential: hasAuthority("auth_machine_intelligence"),
    hidden: false,
    shouldAiUseForProposals: true,
    canPresetBeChanged: true,
  });

  mod.defineBombardmentStance({
    id: "content_test_bombardment_stance_scorched_earth",
    name: "Scorched Earth",
    desc: "Bombard with no restraint.",
    trigger: canGoMia(),
    default: false,
    stopWhenArmiesDead: false,
    acceptSurrender: false,
    planetDamage: { base: 1.5 },
    armyDamage: 1.2,
    killPopChance: {
      base: 0.1,
      modifiers: [{ factor: 2, when: always() }],
    },
    minPopsToKillPop: 5,
    aiWeight: { base: 1 },
  });

  mod.defineArchaeologicalSiteType({
    id: "content_test_archaeological_site_type_derelict",
    name: "Derelict Outpost",
    desc: "The ruins of a forgotten station.",
    picture: "GFX_archaeological_site_derelict",
    situationLogCategory: "arch_site",
    maxInstances: 3,
    notificationDuration: 30,
    weight: {
      base: 10,
      modifiers: [{ factor: 2, when: hasPlanetFlag("content_test_archaeological_planet_flag") }],
    },
    stages: 3,
    stage: [
      { difficulty: 1, icon: "GFX_archaeology_runes_E1", event: "content_test.1" },
      { difficulty: 2, icon: "GFX_archaeology_runes_E2", event: "content_test.2" },
      { difficulty: 3, icon: "GFX_archaeology_runes_E3", event: "content_test.3" },
    ],
    potential: canGoMia(),
    allow: canGoMia(),
    visible: hasAuthority("auth_machine_intelligence"),
    onRollFailed: () => {},
    onCreate: () => {},
    onVisible: (country) => country.setCountryFlag("content_test_site_visible"),
  });

  mod.defineScriptedLoc({
    id: "content_test_scripted_loc_flavor_text",
    random: false,
    // scripted_loc carries no fixed scope in the rules, so only a scope-agnostic
    // trigger like always() type-checks here — the same reasoning as decision.potential.
    text: [
      {
        weight: 2,
        trigger: always(),
        localizationKey: "content_test_scripted_loc_flavor_text_machine",
      },
      { localizationKey: "content_test_scripted_loc_flavor_text_default" },
    ],
    value: 1,
    default: "content_test_scripted_loc_flavor_text_default",
  });

  return mod;
}

describe("generated content registries", () => {
  const files = defineContentExample().render();

  for (const [relPath, content] of files) {
    it(`matches the content golden for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/content/${relPath.replaceAll("/", "__")}`
      );
    });
  }

  it("lowers recorder paths, raw names, and unchecked names identically", () => {
    const mod = new Mod({
      name: "Recorder test",
      prefix: "rec_test",
      supportedVersion: "4.4.*",
    });
    mod.defineTradition({
      id: "rec_test_tradition",
      name: "X",
      modifier: (m) => {
        m.country.unity.produces.mult(0.01);
        m.bonus.pop.growth(0.1);
        m.raw("country_energy_produces_mult", 0.02);
        m.unchecked("someone_elses_modifier", 0.03);
      },
    });
    const rendered = mod.render().get("common/traditions/rec_test_traditions.txt");
    expect(rendered).toContain("country_unity_produces_mult = 0.01");
    expect(rendered).toContain("bonus_pop_growth = 0.1");
    expect(rendered).toContain("country_energy_produces_mult = 0.02");
    expect(rendered).toContain("someone_elses_modifier = 0.03");
  });

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
        traditionSwap: { othermod_swap: { name: "Wrong namespace" } },
      })
    ).toThrow(/must start with the mod prefix "content_test_"/);
    expect(() =>
      mod.defineTradition({
        id: "content_test_tradition_x",
        name: "X",
        traditionSwap: { content_test_swap_x: { name: "Correct namespace" } },
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
      traditionSwap: { content_test_swap_shared: { name: "First" } },
    });
    expect(() =>
      mod.defineTradition({
        id: "content_test_tradition_y",
        name: "Y",
        traditionSwap: { content_test_swap_shared: { name: "Second" } },
      })
    ).toThrow('Duplicate tradition.tradition_swap id "content_test_swap_shared"');
  });
});
