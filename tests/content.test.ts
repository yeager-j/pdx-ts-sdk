import { describe, expect, it } from "vitest";

import {
  ContentAuthoring,
  registerAliasStructFields,
  type ContentField,
  type ContentRegistryDescriptor,
} from "../src/content.ts";
import {
  always,
  canGoMia,
  canJoinFactions,
  hasAuthority,
  hasPlanetFlag,
  hasSituationFlag,
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
    // The pop_pre_trigger alias category, lowered as an ordinary struct: seven
    // named bools rather than a Trigger the game would not read here.
    possiblePreTriggers: { hasOwner: true, isEnslaved: false, isRobotic: true },
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

  mod.defineSituationType({
    id: "content_test_situation_machine_uprising",
    name: "Machine Uprising",
    desc: "The machines stir beneath the surface.",
    category: "negative",
    potential: hasAuthority("auth_machine_intelligence"),
    onStart: (situation) => situation.addSituationProgress(5),
    onProgressComplete: () => {},
    onFail: () => {},
    abortTrigger: always(),
    // modifier_rule_with_loc: `desc` is required per row (unlike plain
    // modifier_rule) and takes display text, auto-registered like every other
    // definition-attached localization slot — see the golden snapshot and the
    // "registers a generated localisation key per monthly_progress desc" test
    // below for the generated keys this produces. The corpus's dominant
    // operations beyond add/factor — mult and subtract — are exercised here.
    monthlyProgress: {
      base: 2,
      modifiers: [
        { mult: 1.5, desc: "The uprising is spreading.", when: always() },
        {
          subtract: 1,
          desc: "Machine intelligence keeps the uprising contained.",
          when: hasSituationFlag("content_test_situation_uprising_contained"),
        },
      ],
    },
    modifier: (m) => m.country.unity.produces.mult(0.02),
    targetModifier: (m) => m.pop.happiness(0.05),
    triggeredModifier: [
      {
        when: hasAuthority("auth_machine_intelligence"),
        modifiers: (m) => m.country.unity.produces.mult(-0.05),
      },
    ],
    startValue: 0,
    permanent: false,
    // stages = { stage_1 = { ... } stage_2 = { ... } } — a keyed container
    // (repeated-struct's "container" keying), id order preserved exactly as
    // declared here.
    stages: {
      content_test_situation_machine_uprising_stage_unrest: {
        name: "Rising Unrest",
        icon: "GFX_situation_stage_unrest",
        iconBackground: "GFX_situation_stage_unrest_bg",
        end: { base: 40 },
        onFirstEnter: (situation) => situation.addSituationProgress(1),
        modifier: (m) => m.country.unity.produces.mult(0.01),
      },
      content_test_situation_machine_uprising_stage_revolt: {
        name: "Open Revolt",
        desc: "The machines have taken up arms.",
        icon: "GFX_situation_stage_revolt",
        iconBackground: "GFX_situation_stage_revolt_bg",
        end: { base: 100, modifiers: [{ factor: 1.5, when: always() }] },
        potential: always(),
        triggeredModifier: [
          {
            when: hasAuthority("auth_machine_intelligence"),
            modifiers: (m) => m.country.unity.produces.mult(-0.05),
          },
        ],
      },
    },
    // approach = { name = ... } repeated sibling blocks — repeated-struct's
    // "siblings" keying, the same shape tradition_swap already exercises.
    approach: {
      content_test_situation_machine_uprising_approach_negotiate: {
        name: "Negotiate",
        icon: "GFX_situation_approach_negotiate",
        iconBackground: "GFX_situation_approach_negotiate_bg",
        default: true,
        allow: always(),
        onSelect: (situation) => situation.addSituationProgress(-2),
        modifier: (m) => m.country.unity.produces.mult(0.02),
        resources: [{ category: "situations", cost: { amounts: { unity: 100 } } }],
        aiWeight: 5,
      },
      content_test_situation_machine_uprising_approach_purge: {
        name: "Purge",
        desc: "Meet the uprising with force.",
        icon: "GFX_situation_approach_purge",
        iconBackground: "GFX_situation_approach_purge_bg",
        potential: always(),
        onSelect: () => {},
        targetModifier: (m) => m.pop.happiness(-0.1),
      },
    },
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

  mod.defineCouncilor({
    id: "content_test_councilor_chancellor",
    name: "Chancellor",
    desc: "Presides over the ruling council.",
    leaderClass: ["leader_class_official"],
    // Country/leader scope triggers, per the CWT's own `## replace_scopes`.
    possible: always(),
    isLeaderPossible: always(),
    civic: "content_test_civic_meritocracy",
    modifier: (m) => m.country.unity.produces.mult(0.02),
    triggeredCountryModifier: [
      {
        when: hasAuthority("auth_machine_intelligence"),
        modifiers: (m) => m.country.unity.produces.mult(0.01),
      },
    ],
    aiPriority: 10,
    optional: always(),
    // aiHiringWeight runs in leader scope — always() is the only trigger valid
    // there among the ones this file already imports.
    aiHiringWeight: {
      base: 1,
      modifiers: [{ factor: 2, when: always() }],
    },
  });

  mod.defineEconomicCategory({
    id: "content_test_economic_category_research",
    useForAiBudget: true,
    modifierCategory: "economic_unit",
    addUnscaledValueToTooltip: false,
    generateAddModifiers: ["produces"],
    generateMultModifiers: ["produces", "upkeep"],
    triggeredCostModifier: [
      {
        key: "content_test_economic_category_research",
        modifierTypes: ["mult"],
        // No `## replace_scopes` on this trigger, so it must hold at every
        // scope — only a scope-agnostic trigger like always() type-checks.
        trigger: always(),
      },
    ],
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

  it("emits stages as one keyed container and approach as repeated siblings", () => {
    // The two repeated-struct keyings read very differently on the wire:
    // "container" collapses every stage into one `stages = { ... }` block
    // keyed by id, in declaration order, while "siblings" repeats `approach`
    // itself once per entry with the id written into a `name` field inside
    // each block. Getting them backwards would still parse — only the shape
    // of the output would be wrong — so this checks the literal text.
    const rendered = files.get("common/situations/content_test_situations.txt")!;
    const stagesBlock = rendered.match(/stages = \{([\s\S]*)\n\}\n?$/)?.[1];
    expect(stagesBlock).toBeDefined();
    // One `stages` key, holding both stage ids as its own entries.
    expect(rendered.match(/^\tstages = \{/gm)).toHaveLength(1);
    expect(stagesBlock).toContain("content_test_situation_machine_uprising_stage_unrest = {");
    expect(stagesBlock).toContain("content_test_situation_machine_uprising_stage_revolt = {");
    // Declaration order survives into the emitted block.
    expect(
      stagesBlock!.indexOf("content_test_situation_machine_uprising_stage_unrest")
    ).toBeLessThan(stagesBlock!.indexOf("content_test_situation_machine_uprising_stage_revolt"));

    // Two sibling `approach = { name = ... }` blocks, not one `approach`
    // container keyed by id.
    expect(rendered.match(/^\tapproach = \{/gm)).toHaveLength(2);
    expect(rendered).toContain(
      "approach = {\n\t\tname = content_test_situation_machine_uprising_approach_negotiate"
    );
    expect(rendered).toContain(
      "approach = {\n\t\tname = content_test_situation_machine_uprising_approach_purge"
    );
  });

  it("lowers the block form of a dual bare/modifier_rule declaration", () => {
    // total_progress (bare `value_int_field`, an upstream CWT typo, versus a
    // modifier_rule block) and stages' section_weight (bare int_value_field
    // versus a modifier_rule block, gated to the dynamic_progress subtype) are
    // each declared twice; the union type keeps the block form's gated
    // adjustments authorable.
    const mod = new Mod({
      name: "Section weights test",
      prefix: "sw_test",
      supportedVersion: "4.4.*",
    });
    mod.defineSituationType({
      id: "sw_test_situation_dynamic",
      name: "Dynamic Progress Situation",
      monthlyProgress: { base: 1 },
      totalProgress: { base: 60_000, modifiers: [{ factor: 2, when: always() }] },
      stages: {
        sw_test_situation_dynamic_stage_only: {
          name: "Only Stage",
          icon: "GFX_situation_stage_only",
          iconBackground: "GFX_situation_stage_only_bg",
          sectionWeight: { base: 25 },
        },
      },
    });
    const rendered = mod.render().get("common/situations/sw_test_situations.txt");
    expect(rendered).toContain(
      "total_progress = {\n\t\tbase = 60000\n\t\tmodifier = {\n\t\t\tfactor = 2\n\t\t\talways = yes\n\t\t}\n\t}"
    );
    expect(rendered).toContain("section_weight = {\n\t\t\t\tbase = 25\n\t\t\t}");
  });

  it("lowers the scalar form of a dual bare/modifier_rule declaration", () => {
    // Vanilla writes `end = 100` 254 times against 1 block, so the scalar form
    // is the common case; it must serialize as a plain assignment, not as an
    // empty weight block.
    const mod = new Mod({
      name: "Scalar end test",
      prefix: "se_test",
      supportedVersion: "4.4.*",
    });
    mod.defineSituationType({
      id: "se_test_situation_plain",
      name: "Plain Situation",
      monthlyProgress: { base: 1 },
      progressDirection: "bidirectional",
      stages: {
        se_test_situation_plain_stage: {
          name: "Only Stage",
          icon: "GFX_situation_stage_only",
          iconBackground: "GFX_situation_stage_only_bg",
          end: 100,
        },
      },
    });
    const rendered = mod.render().get("common/situations/se_test_situations.txt");
    expect(rendered).toContain("end = 100");
    expect(rendered).not.toContain("end = {");
    expect(rendered).toContain("progress_direction = bidirectional");
  });

  it("emits conditionalDesc under the game's desc key", () => {
    // The authoring member is renamed to dodge the desc flavor-text slot, but
    // the serialized key is still `desc`, one block per entry.
    const mod = new Mod({
      name: "Conditional desc test",
      prefix: "cd_test",
      supportedVersion: "4.4.*",
    });
    mod.defineSituationType({
      id: "cd_test_situation",
      name: "Situation",
      monthlyProgress: { base: 1 },
      conditionalDesc: [
        { trigger: always(), text: "cd_test_situation_desc_alt" },
        { text: "cd_test_situation_desc_fallback" },
      ],
    });
    const rendered = mod.render().get("common/situations/cd_test_situations.txt");
    expect(rendered).toContain(
      "desc = {\n\t\ttrigger = {\n\t\t\talways = yes\n\t\t}\n\t\ttext = cd_test_situation_desc_alt\n\t}"
    );
    expect(rendered).toContain("desc = {\n\t\ttext = cd_test_situation_desc_fallback\n\t}");
  });

  it("emits random_events as weight = event rows with 0 for the empty arm", () => {
    const mod = new Mod({
      name: "Random events test",
      prefix: "re_test",
      supportedVersion: "4.4.*",
    });
    mod.defineSituationType({
      id: "re_test_situation",
      name: "Situation",
      monthlyProgress: { base: 1 },
      onMonthly: {
        randomEvents: [{ weight: 100, event: "re_test_event.1" }, { weight: 20 }],
      },
    });
    const rendered = mod.render().get("common/situations/re_test_situations.txt");
    expect(rendered).toContain(
      "on_monthly = {\n\t\trandom_events = {\n\t\t\t100 = re_test_event.1\n\t\t\t20 = 0\n\t\t}\n\t}"
    );
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

  it('applies the same mod-prefix and duplicate-id rules to "container" keying', () => {
    // stages is repeated-struct's first "container" consumer — its record key
    // IS the block's own key rather than a body field, a different code path
    // through the writer than "siblings" (tradition_swap, approach) already
    // exercises, so it needs its own direct check rather than relying on
    // approach's coverage to stand in for it.
    const mod = new Mod({
      name: "Content test",
      prefix: "content_test",
      supportedVersion: "4.4.*",
    });
    const runtimeConfigured: Mod<string> = mod;
    expect(() =>
      runtimeConfigured.defineSituationType({
        id: "content_test_situation_x",
        name: "X",
        monthlyProgress: { base: 1 },
        stages: {
          othermod_stage: { name: "Wrong namespace", icon: "GFX_x", iconBackground: "GFX_x_bg" },
        },
      })
    ).toThrow(/must start with the mod prefix "content_test_"/);
    mod.defineSituationType({
      id: "content_test_situation_y",
      name: "Y",
      monthlyProgress: { base: 1 },
      stages: {
        content_test_situation_stage_shared: {
          name: "First",
          icon: "GFX_x",
          iconBackground: "GFX_x_bg",
        },
      },
    });
    expect(() =>
      mod.defineSituationType({
        id: "content_test_situation_z",
        name: "Z",
        monthlyProgress: { base: 1 },
        stages: {
          content_test_situation_stage_shared: {
            name: "Second",
            icon: "GFX_x",
            iconBackground: "GFX_x_bg",
          },
        },
      })
    ).toThrow('Duplicate situation_type.stages id "content_test_situation_stage_shared"');
  });

  it("lowers pop_pre_trigger's alias splice as named bools, not a trigger block", () => {
    const rendered = files.get("common/pop_jobs/content_test_pop_jobs.txt")!;
    expect(rendered).toContain(
      "possible_pre_triggers = {\n\t\thas_owner = yes\n\t\tis_enslaved = no\n\t\tis_robotic = yes\n\t}"
    );
  });
});

/**
 * The `aliasStruct` writer arm, exercised through a descriptor built by hand.
 *
 * `government_trigger`'s consumer registry (`civic_or_origin`) is not generated
 * yet, so the field tables here are transcribed from what
 * `tools/codegen/emit/alias-struct.ts` emits for the real category — the
 * codegen side is asserted in `tests/codegen/alias-struct.test.ts`. The
 * expected output is pinned against real vanilla civics: `civic_corvee_system`
 * and `civic_corporate_dominion` in
 * `common/governments/civics/00_civics.txt`.
 */
describe("alias-struct serialization", () => {
  const GROUP_FIELDS: readonly ContentField[] = [
    { key: "text", member: "text", shape: "value", conversion: "identity" },
    { key: "value", member: "values", shape: "value", conversion: "ref", repeated: true },
  ];
  const CLAUSE_FIELDS: readonly ContentField[] = [
    { key: "value", member: "value", shape: "value", conversion: "ref" },
    { key: "OR", member: "or", shape: "struct", fields: GROUP_FIELDS, repeated: true },
    { key: "NOT", member: "not", shape: "struct", fields: GROUP_FIELDS, repeated: true },
    { key: "NOR", member: "nor", shape: "struct", fields: GROUP_FIELDS, repeated: true },
  ];
  const GOVERNMENT_TRIGGER_FIELDS: readonly ContentField[] = [
    { key: "text", member: "text", shape: "value", conversion: "identity" },
    { key: "always", member: "always", shape: "value", conversion: "identity" },
    { key: "authority", member: "authority", shape: "struct", fields: CLAUSE_FIELDS },
    { key: "ethics", member: "ethics", shape: "struct", fields: CLAUSE_FIELDS },
    { key: "civics", member: "civics", shape: "struct", fields: CLAUSE_FIELDS },
    {
      key: "OR",
      member: "or",
      shape: "aliasStruct",
      category: "government_trigger",
      repeated: true,
    },
    { key: "host_has_dlc", member: "hostHasDlc", shape: "value", conversion: "identity" },
  ];
  registerAliasStructFields("government_trigger", GOVERNMENT_TRIGGER_FIELDS);

  const descriptor: ContentRegistryDescriptor = {
    type: "civic_or_origin",
    outputDir: "common/governments/civics",
    fileStem: "civics",
    fields: [
      {
        key: "potential",
        member: "potential",
        shape: "aliasStruct",
        category: "government_trigger",
      },
      { key: "possible", member: "possible", shape: "aliasStruct", category: "government_trigger" },
    ],
    localisation: [],
  };

  function render(def: Record<string, unknown> & { id: string }): string {
    const authoring = new ContentAuthoring("gt_test", [descriptor], () => {});
    authoring.define("civic_or_origin", def);
    return authoring.render().get("common/governments/civics/gt_test_civics.txt")!;
  }

  it("writes a domain clause the way vanilla civics write it", () => {
    // civic_corvee_system, verbatim in shape: a bare NOT group in `potential`,
    // and a NOR group carrying its tooltip plus two operands in `possible`.
    expect(
      render({
        id: "gt_test_civic_corvee_system",
        potential: {
          ethics: { not: [{ values: ["ethic_gestalt_consciousness"] }] },
          authority: { not: [{ values: ["auth_corporate"] }] },
        },
        possible: {
          ethics: {
            nor: [
              {
                text: "civic_tooltip_not_egalitarian",
                values: ["ethic_egalitarian", "ethic_fanatic_egalitarian"],
              },
            ],
          },
          civics: { not: [{ values: ["civic_free_haven"] }] },
        },
      })
    ).toBe(
      "gt_test_civic_corvee_system = {\n" +
        "\tpotential = {\n" +
        "\t\tauthority = {\n\t\t\tNOT = {\n\t\t\t\tvalue = auth_corporate\n\t\t\t}\n\t\t}\n" +
        "\t\tethics = {\n\t\t\tNOT = {\n\t\t\t\tvalue = ethic_gestalt_consciousness\n\t\t\t}\n\t\t}\n" +
        "\t}\n" +
        "\tpossible = {\n" +
        "\t\tethics = {\n" +
        "\t\t\tNOR = {\n" +
        "\t\t\t\ttext = civic_tooltip_not_egalitarian\n" +
        "\t\t\t\tvalue = ethic_egalitarian\n" +
        "\t\t\t\tvalue = ethic_fanatic_egalitarian\n" +
        "\t\t\t}\n" +
        "\t\t}\n" +
        "\t\tcivics = {\n\t\t\tNOT = {\n\t\t\t\tvalue = civic_free_haven\n\t\t\t}\n\t\t}\n" +
        "\t}\n" +
        "}\n"
    );
  });

  it("recurses through the OR combinator via the category table", () => {
    // The self-reference the module-level table exists for: an `OR` inside
    // `possible` holds a whole government_trigger block again, repeated once
    // per entry rather than merged, exactly as the game reads it.
    expect(
      render({
        id: "gt_test_civic_corporate_dominion",
        possible: {
          or: [
            { authority: { value: "auth_oligarchic" } },
            { text: "gt_test_tooltip", always: true, hostHasDlc: "Overlord" },
          ],
        },
      })
    ).toBe(
      "gt_test_civic_corporate_dominion = {\n" +
        "\tpossible = {\n" +
        "\t\tOR = {\n\t\t\tauthority = {\n\t\t\t\tvalue = auth_oligarchic\n\t\t\t}\n\t\t}\n" +
        "\t\tOR = {\n" +
        "\t\t\ttext = gt_test_tooltip\n" +
        "\t\t\talways = yes\n" +
        "\t\t\thost_has_dlc = Overlord\n" +
        "\t\t}\n" +
        "\t}\n" +
        "}\n"
    );
  });

  it("refuses to render an alias category nothing registered", () => {
    // Silence here would emit an empty block the game reads as "no
    // requirements", quietly making a civic available to everyone.
    const authoring = new ContentAuthoring(
      "gt_test",
      [
        {
          ...descriptor,
          fields: [
            {
              key: "potential",
              member: "potential",
              shape: "aliasStruct",
              category: "species_trigger",
            },
          ],
        },
      ],
      () => {}
    );
    authoring.define("civic_or_origin", { id: "gt_test_civic_unregistered", potential: {} });
    expect(() => authoring.render()).toThrow(
      'No field table registered for alias category "species_trigger"'
    );
  });
});
