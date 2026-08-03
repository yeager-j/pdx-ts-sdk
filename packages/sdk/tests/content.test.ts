import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ContentAuthoring,
  registerAliasStructFields,
  type ContentField,
  type ContentRegistryDescriptor,
} from "../src/content.ts";
import {
  addShipOfSizeLimits,
  always,
  and,
  buildMod,
  canGoMia,
  canJoinFactions,
  collection,
  currentSituationApproach,
  currentStage,
  defineAgenda,
  defineAgreementPreset,
  defineAmbientObject,
  defineArchaeologicalSiteType,
  defineAscensionPerk,
  defineBombardmentStance,
  defineBuilding,
  defineCasusBelli,
  defineCivicOrOrigin,
  defineComponentSet,
  defineCouncilor,
  defineCountryShipOfSizeLimit,
  defineDecision,
  defineEconomicCategory,
  defineEdict,
  defineGraphicalCulture,
  defineJob,
  defineOpinionModifier,
  defineScriptedLoc,
  defineScriptedModifier,
  defineSectionTemplate,
  defineShipSize,
  defineSituationType,
  defineSolarSystemInitializer,
  defineSpeciesClass,
  defineStarbaseLevel,
  defineStaticModifier,
  defineStrikeCraftComponentTemplate,
  defineTradition,
  defineTraditionCategory,
  defineUtilityComponentTemplate,
  defineWarGoal,
  defineWeaponComponentTemplate,
  hasAuthority,
  hasPlanetFlag,
  hasShipFlag,
  hasSituationFlag,
  hasTechnology,
  isBottleneckSystem,
  isCapital,
  isScopeValid,
  isSiteLocked,
  namespace,
  render,
  type PureMod,
  type SpriteRef,
} from "../src/index.ts";

function configFor(name: string, prefix: string) {
  return { name, prefix, supportedVersion: "4.4.*" };
}

const CONFIG = configFor("Content test", "content_test");

function defineContentExample(): PureMod {
  // Event identity is authored: the namespace is declared here, and the
  // `collection(...)` at the fold names the file the events land in.
  const events = namespace("content_test");

  const agenda = defineAgenda({
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

  const machineMobilization = defineEdict({
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

  const experimentalLab = defineBuilding({
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
    // A vanilla building: nothing in this fixture defines a second lab, and an
    // own-prefixed id here would (rightly) fail the reference guard.
    upgrades: ["building_research_lab_2"],
    prerequisites: ["tech_basic_science_lab_1"],
    convertTo: ["building_ruined_lab"],
  });

  const tradition = defineTradition({
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

  const traditionCategory = defineTraditionCategory({
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

  const ascensionPerk = defineAscensionPerk({
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

  const decision = defineDecision({
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
    // This decision takes the default `scope: "planet"`, so its clauses would
    // also admit planet conditions; `always()` keeps the golden fixture's
    // conditions independent of that choice. The scoped forms are covered on
    // their own below.
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

  const job = defineJob({
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

  const opinionModifier = defineOpinionModifier({
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

  // The modifier rows land at the block root, next to the metadata keys —
  // static_modifier splices `alias_name[modifier]` unkeyed at its top level.
  const staticModifier = defineStaticModifier({
    id: "content_test_static_modifier_synthetic_surge",
    name: "Synthetic Surge",
    desc: "Machine empires push their production past its rated limits.",
    modifiers: (m) => {
      m.country.unity.produces.mult(0.15);
      m.planet.jobs.alloys.produces.mult(0.1);
    },
    icon: "gfx/interface/icons/modifiers/mod_synthetic_surge.dds",
    iconFrame: 2,
    important: true,
    customTooltip: "content_test_static_modifier_synthetic_surge_tt",
    showOnlyCustomTooltip: false,
    hideFromCountryList: true,
  });

  const shipSize = defineShipSize({
    id: "content_test_ship_size_synth_cruiser",
    name: "Synthetic Cruiser",
    class: "shipclass_military",
    // Engine-keyed, not mod-prefixed: section templates mount to these names.
    sectionSlots: {
      bow: { locator: ["part1"] },
      mid: { locator: ["part2", "part3"] },
    },
    minUpgradeCost: { alloys: 20 },
    modifier: (m) => m.starbase.shipyard.build.speed.mult(0.1),
    shipModifier: (m) => m.ship.weapon.damage(0.05),
  });

  const scriptedModifier = defineScriptedModifier({
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

  const casusBelli = defineCasusBelli({
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

  const warGoal = defineWarGoal({
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
    // The closure form of a weight block, whose FROM is the targeted country.
    // The `desc` row is the point: its generated localisation key is registered
    // against the row's object identity, so the closure has to run once and
    // once only — see `resolveFromClosures`.
    aiWeight: (ctx) => ({
      base: 5,
      modifiers: [
        {
          factor: 2,
          desc: "The target is a rival.",
          when: ctx.from.trigger(hasAuthority("auth_machine_intelligence")),
        },
      ],
    }),
    destroyStarbases: true,
    forbiddenPeaceOffers: {
      demandSurrender: "content_test_war_goal_liberation_no_demand",
      surrender: "content_test_war_goal_liberation_no_surrender",
    },
  });

  const agreementPreset = defineAgreementPreset({
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

  const bombardmentStance = defineBombardmentStance({
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

  // The site stages fire this mod's own events. Under the pure API a scalar
  // shaped like one of the mod's event ids must have a definition in the
  // build, so the three dig events the stages reference are defined here.
  // Fleet events, because that is what a stage's `event` is: `<event.fleet>`.
  // They were country events until the ref brand started checking, which is
  // the whole point of the brand — the game would have refused these.
  const digEvents = [1, 2, 3].map((id) =>
    events.defineFleetEvent({ id, hideWindow: true, isTriggeredOnly: true })
  );

  const archaeologicalSiteType = defineArchaeologicalSiteType({
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
      { difficulty: 1, icon: "GFX_archaeology_runes_E1", event: digEvents[0]! },
      { difficulty: 2, icon: "GFX_archaeology_runes_E2", event: digEvents[1]! },
      { difficulty: 3, icon: "GFX_archaeology_runes_E3", event: digEvents[2]! },
    ],
    // Both forms of a FROM-bearing trigger field, side by side: the plain
    // value where the condition never names FROM, the closure where it does.
    potential: canGoMia(),
    allow: (ctx) => and(canGoMia(), ctx.from.trigger(isSiteLocked(false))),
    visible: hasAuthority("auth_machine_intelligence"),
    // The rules scope this block this=fleet, from=archaeological site, and the
    // vanilla shape for it opens FROM. `ctx.from` is what makes that sayable,
    // and a reference written inside it is still recorded and resolved.
    onRollFailed: (fleet, ctx) => {
      ctx.from.effects((site) => site.expireSiteEvent(digEvents[0]!));
    },
    onCreate: () => {},
    onVisible: (country) => country.setCountryFlag("content_test_site_visible"),
  });

  const situationType = defineSituationType({
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

  const scriptedLoc = defineScriptedLoc({
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

  const councilor = defineCouncilor({
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

  const economicCategory = defineEconomicCategory({
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

  const civicOrOrigin = defineCivicOrOrigin({
    id: "content_test_civic_meritocracy",
    name: "Meritocracy",
    desc: "Leadership is earned, not inherited.",
    // no_scope AND triggers — real Triggers, not government_trigger, per the
    // CWT's own `## replace_scopes = { this = no_scope root = no_scope }`.
    playable: always(),
    aiPlayable: always(),
    // The government_trigger requirements DSL: a plain data object, not a
    // Trigger — the game reads potential/possible against empire setup, not
    // as a script condition tree.
    potential: {
      authority: { value: "auth_democratic" },
      // A vanilla civic id, not this mod's own: an own-prefixed value here
      // would (rightly) fail the reference guard, same as `alternateCivicVersion`.
      civics: { not: [{ values: ["civic_shadow_council"] }] },
    },
    possible: {
      or: [
        { authority: { value: "auth_democratic" } },
        { text: "content_test_meritocracy_oligarchic", authority: { value: "auth_oligarchic" } },
      ],
    },
    modifier: (m) => m.country.unity.produces.mult(0.05),
    cost: 1,
    pickableAtStart: true,
    canBuildRulerShip: false,
    swapType: [
      {
        name: "content_test_civic_meritocracy_swap",
        // Neither trigger nor modifier has a `## replace_scopes` inside
        // swap_type, so both stay scope-agnostic: always() for the trigger,
        // and unchecked() for the recorder, since a ScopeName modifier
        // closure's `m` is too wide a union for the checked trie API to
        // resolve through every scope's recorder at once.
        trigger: always(),
        modifier: (m) => m.unchecked("country_unity_produces_mult", 0.1),
      },
    ],
  });

  const componentSet = defineComponentSet({
    id: "content_test_component_set_reactor",
    name: "Reactor Boosters",
    desc: "Auxiliary reactor components.",
    shipDesc: "Ship-mounted reactor boosters.",
    stationDesc: "Station-mounted reactor boosters.",
    isCoreComponentSet: true,
    affectsTargetType: true,
    affectsTargetFocus: false,
    icon: "GFX_component_set_reactor",
  });

  // name_field registry keyed by the repeated `ship_section_template` keyword,
  // with `resources`/`modifier`/`ship_modifier` exercising the overlay's
  // economicResources/modifierBlock shapes.
  const sectionTemplate = defineSectionTemplate({
    id: "content_test_section_template_core",
    name: "Core Section",
    shipSize: ["ship_size_corvette"],
    fitsOnSlot: ["core"],
    entity: "content_test_section_core_entity",
    resources: [{ category: "ship_components", cost: { amounts: { alloys: 20 } } }],
    componentSlot: [
      {
        name: "core_slot_1",
        template: "content_test_component_slot_template",
        locatorname: "$mesh_locator",
      },
    ],
    smallUtilitySlots: 2,
    // Both pinned to ship scope by `## replace_scopes = { this = ship root = ship }`.
    // unchecked() names the flat modifier directly, same as civic_or_origin's
    // swapType.modifier — the checked trie's per-scope shape is a separate
    // concern from this registry's own wiring.
    modifier: (m) => m.unchecked("ship_hull_add", 10),
    shipModifier: (m) => m.unchecked("ship_hull_mult", 0.05),
  });

  const ambientObject = defineAmbientObject({
    id: "content_test_ambient_object_wreck",
    name: "Adrift Hulk",
    entity: "content_test_ambient_wreck_entity",
    selectable: true,
    showName: true,
    // `description`/`tooltip` are `localisation`-typed CWT fields with no `$`
    // static id placeholder, so they hold an author-chosen localisation key
    // rather than a slot the SDK auto-writes — hence the free-form names.
    description: "content_test_ambient_object_wreck_description",
    tooltip: "content_test_ambient_object_wreck_tooltip",
  });

  const graphicalCulture = defineGraphicalCulture({
    id: "content_test_graphical_culture_synthetic",
    hasCityGraphics: false,
    fallback: "graphical_culture_01",
    shipColor: true,
    shipLighting: {
      camLight1Dir: [1, 0, 0],
      camLight2Dir: [0, 1, 0],
      camLight3Dir: [0, 0, 1],
      intensityNear: 1.2,
      intensityFar: 0.6,
    },
    // Neither carries a `## replace_scopes`, unlike shipSelectionWeight below —
    // only a scope-agnostic trigger like always() type-checks at every scope.
    randomized: always(),
    selectable: always(),
    shipKinds: ["ship_categories_military"],
    // `## replace_scopes = { this = species from = country }` pins this to
    // species scope — always() is the only trigger this file already imports
    // that holds there.
    shipSelectionWeight: {
      base: 10,
      modifiers: [{ factor: 1.5, when: always() }],
    },
  });

  const starbaseLevel = defineStarbaseLevel({
    id: "content_test_starbase_level_outpost",
    shipSize: "ship_size_starbase_i",
    // Vanilla's starport, for the same reason `upgrades` above names a vanilla
    // building: this fixture defines exactly one starbase level.
    nextLevel: "starbase_level_starport",
    levelWeight: 0,
    showInOutliner: true,
    collectsTrade: false,
    potentialHomeBase: false,
    specialConstruction: true,
    portrait: "GFX_starbase_background_outpost",
    // `## replace_scopes = { root = starbase this = starbase }` on both —
    // always() is the only trigger this file already imports that holds at
    // every scope, starbase included.
    upgradePossible: always(),
    downgradePotential: always(),
    picture: { trigger: always(), picture: "GFX_starbase_outpost_view" },
    moduleSlots: [2, "spinal_mount_1"],
    buildingSlots: [1, "lower_1"],
  });

  const speciesClass = defineSpeciesClass({
    id: "content_test_species_class_precursor",
    name: "Precursor",
    desc: "An ancient and enigmatic lineage.",
    plural: "Precursors",
    archetype: "ARCHETYPE_HUMANOID",
    // playable carries no `## replace_scopes`, unlike possible/possibleSecondary
    // below — always() is the widest trigger this file already imports.
    playable: always(),
    randomized: true,
    graphicalCulture: "content_test_graphical_culture_synthetic",
    // pop_group-scope modifier_clause, the same shape every other registry's
    // `modifier` field uses; unchecked() names it directly, same reasoning as
    // section_template's modifier/shipModifier above.
    modifier: (m) => m.unchecked("bonus_pop_growth", 1),
    // The government_trigger requirements DSL, not a Trigger — same shape and
    // reasoning as civic_or_origin.potential/.possible (SDK-3).
    possible: {
      authority: { value: "auth_democratic" },
    },
    possibleSecondary: {
      or: [{ ethics: { value: "ethic_xenophile" } }],
    },
    resources: [{ category: "species", cost: { amounts: { unity: 50 } } }],
    ethicsToPrefer: ["ethic_xenophile"],
    leaderAgeMin: 20,
    leaderAgeMax: 80,
  });

  // Modeled on the vanilla doa_ascendant_titan_ships_limit entry: a branded
  // ship_size ref alongside a raw vanilla ship_size string, both accepted by
  // shipTypes, and a `show` written the way all 7 shipped entries write it —
  // is_scope_valid plus a country condition. The overlay asserts the country
  // scope the rules omit; without it this clause would not type-check.
  const titanLimit = defineCountryShipOfSizeLimit({
    id: "content_test_ship_of_size_limit_titan",
    shipTypes: [shipSize, "ship_size_titan"],
    base: 80,
    max: 1600,
    navalCapFraction: 0.1,
    show: and(isScopeValid(), hasTechnology("tech_titans")),
  });

  // Not a define: the ownership limit has no id this mod owns.
  const ownershipLimits = addShipOfSizeLimits([titanLimit]);

  // The neighbor a system links to, defined first so the link below is a
  // branded ref into this same registry rather than a raw string.
  const neighborSystem = defineSolarSystemInitializer({
    id: "content_test_system_outpost",
    class: "sc_g",
    usage: ["misc_system_init"],
    planet: [{ class: "star", size: 20, orbitDistance: 0, orbitAngle: 0 }],
  });

  // Modeled on the vanilla custom_starting_init_* entries: a star, then a
  // planet carrying its own moons, then a second planet nested one level
  // deeper. `changeOrbit` sits between the planet and its moons on purpose —
  // it advances the orbit cursor, so its position among the siblings is the
  // geometry, and the emitter has to preserve declaration order to keep it.
  const homeSystem = defineSolarSystemInitializer({
    id: "content_test_system_home",
    class: "rl_standard_stars",
    flags: ["content_test_home_system"],
    usage: ["custom_empire"],
    usageOdds: 5,
    asteroidBelt: [{ type: "rocky_asteroid_belt", radius: { min: 400, max: 450 } }],
    initEffect: (system) => {
      system.setStarFlag("content_test_surveyed");
    },
    planet: [
      { count: 1, class: "star", orbitDistance: 0, orbitAngle: 0, size: { min: 30, max: 35 } },
      {
        name: "NAME_Content_Test_Prime",
        class: "pc_continental",
        orbitDistance: 60,
        orbitAngle: { min: 90, max: 270 },
        size: 20,
        hasRing: false,
        homePlanet: true,
        initEffect: (planet) => {
          planet.setCapital(true);
        },
        changeOrbit: 12,
        moon: [
          { class: "pc_barren", size: 8, orbitDistance: 10 },
          {
            class: "pc_frozen",
            size: 6,
            orbitDistance: 8,
            moon: [{ class: "pc_barren", size: 4 }],
          },
        ],
      },
      {
        class: "pc_gas_giant",
        orbitDistance: 90,
        size: 25,
        planet: [{ class: "pc_asteroid", size: 4, orbitDistance: 15 }],
      },
    ],
    neighborSystem: [
      { initializer: neighborSystem, distance: { min: 20, max: 40 }, hyperlaneJumps: 1 },
    ],
  });

  return buildMod(CONFIG, [
    collection(undefined, [
      agenda,
      machineMobilization,
      experimentalLab,
      tradition,
      traditionCategory,
      ascensionPerk,
      decision,
      job,
      opinionModifier,
      staticModifier,
      shipSize,
      scriptedModifier,
      casusBelli,
      warGoal,
      agreementPreset,
      bombardmentStance,
      archaeologicalSiteType,
      situationType,
      scriptedLoc,
      councilor,
      economicCategory,
      civicOrOrigin,
      componentSet,
      sectionTemplate,
      ambientObject,
      graphicalCulture,
      starbaseLevel,
      speciesClass,
      titanLimit,
      ownershipLimits,
      neighborSystem,
      homeSystem,
    ]),
    collection("events", digEvents),
  ]);
}

describe("generated content registries", () => {
  const files = render(defineContentExample());

  for (const [relPath, content] of files) {
    it(`matches the content golden for ${relPath}`, async () => {
      await expect(content).toMatchFileSnapshot(
        `__snapshots__/content/${relPath.replaceAll("/", "__")}`
      );
    });
  }

  it("writes country_ship_of_size_limit under its two-segment nested path", () => {
    // country_limits.cwt declares `path = "game/common/country_limits/
    // ship_of_size_limits"` — two segments below common/, same depth as the
    // councilor/civic_or_origin registries already write under
    // common/governments/. contentRegistry() derives outputDir/fileStem
    // generically from the CWT path, so this should need no special case.
    expect([...files.keys()]).toContain(
      "common/country_limits/ship_of_size_limits/content_test_ship_of_size_limits.txt"
    );
    const rendered = files.get(
      "common/country_limits/ship_of_size_limits/content_test_ship_of_size_limits.txt"
    )!;
    expect(rendered).toContain(
      "ship_types = { content_test_ship_size_synth_cruiser ship_size_titan }"
    );
    expect(rendered).not.toContain("name =");
    expect(rendered).not.toContain("desc =");
  });

  it("writes a solar system's planets and moons as ordered anonymous siblings", () => {
    // The whole registry rests on this byte shape. `planet` is not a keyed
    // collection and not one block: it is N sibling blocks with no id, whose
    // order is the geometry, nested to whatever depth the author wrote.
    const rendered = files.get(
      "common/solar_system_initializers/content_test_solar_system_initializers.txt"
    )!;
    const home = rendered.slice(0, rendered.indexOf("content_test_system_outpost = {"));
    expect(home.match(/^\tplanet = \{$/gm)).toHaveLength(3);
    // A moon inside a planet, and a moon inside that moon — the recursion is
    // resolved through registerAliasStructFields at write time, since the
    // field table cannot reference itself.
    expect(rendered).toContain("\t\tmoon = {\n\t\t\tclass = pc_frozen");
    expect(rendered).toContain("\t\t\tmoon = {\n\t\t\t\tclass = pc_barren");
    // And a planet inside a planet, the other half of the mutual recursion.
    expect(rendered).toContain("\t\tplanet = {\n\t\t\tclass = pc_asteroid");
    // `change_orbit` advances the orbit cursor, so it has to precede the moons
    // it applies to. This is what the declaration-ordered splice emission buys:
    // emitting the splice member first would put every moon ahead of it.
    //
    // Only the nested case. At the *top* level the same key cannot be
    // interleaved between planets at all — members are emitted one key at a
    // time, so every planet lands before every orbit change, and 280 of the 360
    // shipped initializers are written the other way. SDK-30 tracks the ordered
    // sequence shape that would fix it; the README documents the workaround.
    const prime = rendered.slice(rendered.indexOf("NAME_Content_Test_Prime"));
    expect(prime.indexOf("change_orbit")).toBeLessThan(prime.indexOf("moon = {"));
    // A neighbour link is a branded ref into this same registry, so it carries
    // the other definition's prefixed id rather than whatever was typed.
    expect(rendered).toContain("initializer = content_test_system_outpost");
    // No id and no localisation anywhere below the top level: a planet is
    // author data, not a definition.
    expect(rendered).not.toContain("\t\tid =");
  });

  it("lowers recorder paths, raw names, and unchecked names identically", () => {
    const traditions = collection(undefined, [
      defineTradition({
        id: "rec_test_tradition",
        name: "X",
        modifier: (m) => {
          m.country.unity.produces.mult(0.01);
          m.bonus.pop.growth(0.1);
          m.raw("country_energy_produces_mult", 0.02);
          m.unchecked("someone_elses_modifier", 0.03);
        },
      }),
    ]);
    const rendered = render(buildMod(configFor("Recorder test", "rec_test"), [traditions])).get(
      "common/traditions/rec_test_traditions.txt"
    );
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
    const situationTypes = collection(undefined, [
      defineSituationType({
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
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Section weights test", "sw_test"), [situationTypes])
    ).get("common/situations/sw_test_situations.txt");
    expect(rendered).toContain(
      "total_progress = {\n\t\tbase = 60000\n\t\tmodifier = {\n\t\t\tfactor = 2\n\t\t\talways = yes\n\t\t}\n\t}"
    );
    expect(rendered).toContain("section_weight = {\n\t\t\t\tbase = 25\n\t\t\t}");
  });

  it("lowers the scalar form of a dual bare/modifier_rule declaration", () => {
    // Vanilla writes `end = 100` 254 times against 1 block, so the scalar form
    // is the common case; it must serialize as a plain assignment, not as an
    // empty weight block.
    const situationTypes = collection(undefined, [
      defineSituationType({
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
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Scalar end test", "se_test"), [situationTypes])
    ).get("common/situations/se_test_situations.txt");
    expect(rendered).toContain("end = 100");
    expect(rendered).not.toContain("end = {");
    expect(rendered).toContain("progress_direction = bidirectional");
  });

  it("emits current_situation_approach/current_stage identically once checked (SDK-52)", () => {
    // currentSituationApproach/currentStage are now hand-written overrides of
    // the generated leaves (see src/triggers.ts), checked against this same
    // call's own `approach`/`stages` keys — a compile-time-only change. This
    // pins that the emitted bytes are exactly what the plain generated
    // `kv("current_situation_approach"/"current_stage", value)` always wrote:
    // one scalar assignment, no extra wrapping, no recorded content ref.
    const situationTypes = collection(undefined, [
      defineSituationType({
        id: "sa_test_situation",
        name: "Situation",
        monthlyProgress: { base: 1 },
        abortTrigger: and(
          currentSituationApproach("sa_test_situation_approach_calm"),
          currentStage("sa_test_situation_stage_1")
        ),
        stages: {
          sa_test_situation_stage_1: {
            name: "Stage One",
            icon: "GFX_situation_stage_only",
            iconBackground: "GFX_situation_stage_only_bg",
            potential: currentSituationApproach("sa_test_situation_approach_calm"),
          },
        },
        approach: {
          sa_test_situation_approach_calm: {
            name: "Calm",
            icon: "GFX_situation_approach_calm",
            iconBackground: "GFX_situation_approach_calm_bg",
            allow: currentStage("sa_test_situation_stage_1"),
          },
        },
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Situation approach test", "sa_test"), [situationTypes])
    ).get("common/situations/sa_test_situations.txt");
    // and()'s two operands splice flat with no AND wrapper (SDK-53) — each
    // leaf's own emission is still the plain, unwrapped scalar this test
    // pins; only the (already implicit-AND) abort_trigger block around them
    // changed shape.
    expect(rendered).toContain(
      "abort_trigger = {\n\t\tcurrent_situation_approach = sa_test_situation_approach_calm\n\t\tcurrent_stage = sa_test_situation_stage_1\n\t}"
    );
    expect(rendered).toContain(
      "potential = {\n\t\t\t\tcurrent_situation_approach = sa_test_situation_approach_calm\n\t\t\t}"
    );
    expect(rendered).toContain("allow = {\n\t\t\tcurrent_stage = sa_test_situation_stage_1\n\t\t}");
  });

  it("emits conditionalDesc under the game's desc key", () => {
    // The authoring member is renamed to dodge the desc flavor-text slot, but
    // the serialized key is still `desc`, one block per entry.
    const situationTypes = collection(undefined, [
      defineSituationType({
        id: "cd_test_situation",
        name: "Situation",
        monthlyProgress: { base: 1 },
        conditionalDesc: [
          { trigger: always(), text: "cd_test_situation_desc_alt" },
          { text: "cd_test_situation_desc_fallback" },
        ],
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Conditional desc test", "cd_test"), [situationTypes])
    ).get("common/situations/cd_test_situations.txt");
    expect(rendered).toContain(
      "desc = {\n\t\ttrigger = {\n\t\t\talways = yes\n\t\t}\n\t\ttext = cd_test_situation_desc_alt\n\t}"
    );
    expect(rendered).toContain("desc = {\n\t\ttext = cd_test_situation_desc_fallback\n\t}");
  });

  it("emits random_events as weight = event rows with 0 for the empty arm", () => {
    // The fired event has to exist in the build: buildMod scans emitted
    // scalars for ids shaped like this mod's own and demands a definition.
    const eventNamespace = namespace("re_test_event");
    const events = collection("events", [
      eventNamespace.defineCountryEvent({ id: 1, hideWindow: true, isTriggeredOnly: true }),
    ]);
    const situationTypes = collection(undefined, [
      defineSituationType({
        id: "re_test_situation",
        name: "Situation",
        monthlyProgress: { base: 1 },
        onMonthly: {
          randomEvents: [{ weight: 100, event: "re_test_event.1" }, { weight: 20 }],
        },
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Random events test", "re_test"), [situationTypes, events])
    ).get("common/situations/re_test_situations.txt");
    expect(rendered).toContain(
      "on_monthly = {\n\t\trandom_events = {\n\t\t\t100 = re_test_event.1\n\t\t\t20 = 0\n\t\t}\n\t}"
    );
  });

  it("contributes ship-of-size limits under the engine's `default` key", () => {
    // The ownership limit is not a define: its key belongs to the engine and
    // the game reads it additively, so the API takes no id and the mod-prefix
    // rule never applies to it. Repeated calls accumulate; duplicates collapse.
    const titan = defineCountryShipOfSizeLimit({
      id: "cl_test_titan_limit",
      shipTypes: ["ship_size_titan"],
      base: 80,
      show: isScopeValid(),
    });
    const limits = collection(undefined, [
      titan,
      addShipOfSizeLimits([titan]),
      // The raw string is another mod's id: it carries no prefix of this mod's,
      // so the reference guard leaves it alone.
      addShipOfSizeLimits([titan, "third_party_limit"]),
    ]);
    const rendered = render(buildMod(configFor("Limit test", "cl_test"), [limits])).get(
      "common/country_limits/ownership_limits/cl_test_ownership_limits.txt"
    );
    expect(rendered).toBe(
      "default = {\n\tship_of_size_limits = { cl_test_titan_limit third_party_limit }\n}\n"
    );
  });

  it("emits no ownership-limit file when no limits are applied", () => {
    const limits = collection(undefined, [
      defineCountryShipOfSizeLimit({
        id: "cl_test_unused_limit",
        shipTypes: ["ship_size_titan"],
        base: 80,
        show: isScopeValid(),
      }),
    ]);
    const files = render(buildMod(configFor("Limit test", "cl_test"), [limits]));
    expect(
      files.has("common/country_limits/ship_of_size_limits/cl_test_ship_of_size_limits.txt")
    ).toBe(true);
    expect(files.has("common/country_limits/ownership_limits/cl_test_ownership_limits.txt")).toBe(
      false
    );
  });

  it("writes engine-keyed maps verbatim, taking no mod prefix", () => {
    // The whole reason structMap exists rather than reusing repeatedStruct:
    // these keys are the engine's, so `assertPrefixed` must not run on them and
    // no localisation key is derived. Vanilla really does use bare integers
    // (`1`..`6`) alongside names like `mid`, so both spellings are covered.
    const shipSizes = collection(undefined, [
      defineShipSize({
        id: "ss_test_cruiser",
        name: "Cruiser",
        class: "shipclass_military",
        sectionSlots: {
          mid: { locator: ["part1"] },
          "1": { locator: ["part2"] },
        },
        minUpgradeCost: { alloys: 20, energy: 5 },
      }),
    ]);
    const files = render(buildMod(configFor("Ship size test", "ss_test"), [shipSizes]));
    const rendered = files.get("common/ship_sizes/ss_test_ship_sizes.txt")!;
    expect(rendered).toContain("mid = {\n\t\t\tlocator = part1\n\t\t}");
    expect(rendered).toContain("1 = {\n\t\t\tlocator = part2\n\t\t}");
    expect(rendered).toContain("min_upgrade_cost = {\n\t\talloys = 20\n\t\tenergy = 5\n\t}");
    // No prefixing, and no `ss_test_mid` localisation key invented for a slot.
    expect(rendered).not.toContain("ss_test_mid");
    expect(files.get("localisation/english/ss_test_l_english.yml")).not.toContain("mid");
  });

  it("takes the definition's scope for the clauses CWT leaves to it", () => {
    // CWT annotates the decision body `this = any` and means it: the same
    // registry is planet-scoped on a planet and ship-scoped on a nomadic colony
    // ship. `Trigger<S>` is contravariant, so the mechanical `Trigger<ScopeName>`
    // reading admitted only universal conditions — every planet condition the
    // 111 shipped decisions write was unauthorable. The definition declares its
    // own scope instead, and `scope` itself emits nothing.
    const decisions = collection(undefined, [
      defineDecision({
        id: "sc_test_terraform",
        name: "Terraform Deeply",
        potential: isCapital(),
        effect: (planet) => planet.setPlanetFlag("sc_test_terraformed"),
      }),
      defineDecision({
        id: "sc_test_jettison",
        name: "Jettison Cargo",
        scope: "ship",
        potential: hasShipFlag("sc_test_laden"),
        effect: (ship) => ship.removeShipFlag("sc_test_laden"),
      }),
    ]);
    const rendered = render(buildMod(configFor("Decision scope test", "sc_test"), [decisions])).get(
      "common/decisions/sc_test_decisions.txt"
    )!;
    expect(rendered).toContain("potential = {\n\t\tis_capital = yes\n\t}");
    expect(rendered).toContain("effect = {\n\t\tset_planet_flag = sc_test_terraformed\n\t}");
    expect(rendered).toContain("potential = {\n\t\thas_ship_flag = sc_test_laden\n\t}");
    // The declaration is authoring-only: it names a fact the engine already
    // knows, and writing it into the file would be a key the game cannot read.
    expect(rendered).not.toContain("scope =");
  });

  it("serializes a ported SMALL_SHIELD_1's resources and modifier (componentTemplateResources)", () => {
    // SDK-31: utility_component_template/weapon_component_template/
    // strike_craft_component_template had no CONTENT_FIELD_OVERRIDES rows for
    // resources/modifier/ship_modifier/ship_design_modifier/
    // triggered_ship_modifier/triggered_ship_design_modifier, so the writer —
    // which only iterates a registry's declared ContentField[] — silently
    // dropped all of them. A ported SMALL_SHIELD_1 occupied a slot, cost
    // nothing, and granted nothing; this is that repro, now fixed.
    //
    // All three share one output file
    // (common/component_templates/<prefix>_component_templates.txt) and can
    // sit in one collection: SDK-32 made `render` merge content files that
    // share an emitted relPath instead of the later one clobbering the
    // earlier ones.
    const shield = defineUtilityComponentTemplate({
      id: "ctr_test_small_shield_1",
      icon: "GFX_shield_1",
      power: 6,
      size: "small",
      resources: [{ category: "ship_components", cost: { amounts: { alloys: 20 } } }],
      modifier: (m) => m.unchecked("ship_shield_hit_points_add", 200),
    });
    const weapon = defineWeaponComponentTemplate({
      id: "ctr_test_weapon_1",
      icon: "GFX_weapon_1",
      resources: [{ category: "ship_weapon_components", cost: { amounts: { alloys: 10 } } }],
      shipModifier: (m) => m.unchecked("ship_weapon_damage_mult", 0.1),
      shipDesignModifier: (m) => m.unchecked("design_ship_weapon_damage_mult", 0.1),
    });
    // strike_craft_component_template declares only resources and
    // ship_modifier (components.cwt:332-343), not modifier.
    const strikeCraft = defineStrikeCraftComponentTemplate({
      id: "ctr_test_strike_craft_1",
      icon: "GFX_strike_craft_1",
      resources: [{ category: "ship_components", cost: { amounts: { alloys: 15 } } }],
      shipModifier: (m) => m.unchecked("ship_hull_add", 10),
    });
    const rendered = render(
      buildMod(configFor("Component template resources test", "ctr_test"), [
        collection(undefined, [shield, weapon, strikeCraft]),
      ])
    ).get("common/component_templates/ctr_test_component_templates.txt")!;

    expect(rendered).toContain(
      "resources = {\n\t\tcategory = ship_components\n\t\tcost = {\n\t\t\talloys = 20\n\t\t}\n\t}"
    );
    expect(rendered).toContain("modifier = {\n\t\tship_shield_hit_points_add = 200\n\t}");
    expect(rendered).toContain(
      "resources = {\n\t\tcategory = ship_weapon_components\n\t\tcost = {\n\t\t\talloys = 10\n\t\t}\n\t}"
    );
    expect(rendered).toContain("ship_modifier = {\n\t\tship_weapon_damage_mult = 0.1\n\t}");
    expect(rendered).toContain(
      "ship_design_modifier = {\n\t\tdesign_ship_weapon_damage_mult = 0.1\n\t}"
    );
    expect(rendered).toContain(
      "resources = {\n\t\tcategory = ship_components\n\t\tcost = {\n\t\t\talloys = 15\n\t\t}\n\t}"
    );
    expect(rendered).toContain("ship_modifier = {\n\t\tship_hull_add = 10\n\t}");
  });

  it("never emits produces on weapon/strike-craft resources, even forced past a cast (componentTemplateResources)", () => {
    // weapon_component_template and strike_craft_component_template splice
    // economic_template_no_produce (components.cwt:189, :338), so `produces`
    // is not game-legal there. EconomicResourceBlockNoProduce already keeps
    // it from type-checking (see content.test-d.ts), but this proves the
    // deeper claim: the writer's economicResourceBlock iterates a
    // produces-free operation list for this shape, so a value that carries a
    // `produces` property past a type-level escape hatch still does not
    // reach the emitted file.
    const weapon = defineWeaponComponentTemplate({
      id: "ctr_test_weapon_no_produce",
      icon: "GFX_weapon_no_produce",
      resources: [
        {
          category: "ship_weapon_components",
          cost: { amounts: { alloys: 10 } },
          produces: { amounts: { energy: 3 } },
        } as any,
      ],
    });
    const strikeCraft = defineStrikeCraftComponentTemplate({
      id: "ctr_test_strike_craft_no_produce",
      icon: "GFX_strike_craft_no_produce",
      resources: [
        {
          category: "ship_components",
          cost: { amounts: { alloys: 15 } },
          produces: { amounts: { energy: 3 } },
        } as any,
      ],
    });
    const rendered = render(
      buildMod(configFor("Component template no-produce test", "npr_test"), [
        collection(undefined, [weapon, strikeCraft]),
      ])
    ).get("common/component_templates/npr_test_component_templates.txt")!;

    expect(rendered).not.toContain("produces");
    expect(rendered).not.toContain("energy = 3");
    // The legal arms still render, so this is not just an empty block.
    expect(rendered).toContain(
      "resources = {\n\t\tcategory = ship_weapon_components\n\t\tcost = {\n\t\t\talloys = 10\n\t\t}\n\t}"
    );
    expect(rendered).toContain(
      "resources = {\n\t\tcategory = ship_components\n\t\tcost = {\n\t\t\talloys = 15\n\t\t}\n\t}"
    );
  });

  it("lowers every arm of a dual declaration by what the author passed", () => {
    // The arms below were all unreachable before duals generalized past
    // scalar-or-weight-block: first-wins picking kept one declaration per field
    // and the other form could not be authored at all, though the shipped game
    // writes both. One case per arm kind the writer has to tell apart — a bare
    // list, a scalar beside a struct, and a trigger — since the dispatch is by
    // the value's runtime form and nothing else.
    const shipSizes = collection(undefined, [
      defineShipSize({
        id: "du_test_cruiser",
        name: "Cruiser",
        class: "shipclass_military",
        // `construction_type` is declared as one value_set member and as a
        // block of them; vanilla writes both.
        constructionType: ["starbase_shipyard", "starbase_beastport"],
      }),
      defineShipSize({
        id: "du_test_corvette",
        name: "Corvette",
        class: "shipclass_military",
        constructionType: "starbase_shipyard",
      }),
    ]);
    const starbaseLevels = collection(undefined, [
      defineStarbaseLevel({
        id: "du_test_outpost",
        shipSize: "ship_size_starbase_i",
        // The bare <sprite> arm — 18 of the 27 shipped starbase levels write
        // this form, against 9 writing the trigger-gated block.
        picture: "GFX_starbase_background_outpost",
      }),
      defineStarbaseLevel({
        id: "du_test_ring",
        shipSize: "ship_size_starbase_i",
        // The same arm reached by a branded reference rather than a raw id.
        // A `TypedRef` is `{ id }` — an object at runtime and a scalar in the
        // file — so nothing about the value's own shape places it on the
        // scalar arm; only the arm's `ref` conversion does.
        picture: { id: "GFX_orbital_ring_background" } as SpriteRef,
      }),
    ]);
    const speciesClasses = collection(undefined, [
      defineSpeciesClass({
        id: "du_test_precursor",
        name: "Precursor",
        plural: "Precursors",
        archetype: "ARCHETYPE_HUMANOID",
        // A bool in 20 shipped species classes, a condition block in 13.
        randomized: always(),
      }),
    ]);
    const files = render(
      buildMod(configFor("Dual arm test", "du_test"), [shipSizes, starbaseLevels, speciesClasses])
    );
    const sizes = files.get("common/ship_sizes/du_test_ship_sizes.txt")!;
    expect(sizes).toContain("construction_type = { starbase_shipyard starbase_beastport }");
    expect(sizes).toContain("construction_type = starbase_shipyard\n");
    const levels = files.get("common/starbase_levels/du_test_starbase_levels.txt")!;
    expect(levels).toContain("picture = GFX_starbase_background_outpost");
    expect(levels).toContain("picture = GFX_orbital_ring_background");
    expect(files.get("common/species_classes/du_test_species_classes.txt")).toContain(
      "randomized = {\n\t\talways = yes\n\t}"
    );
  });

  it("warns on an unprefixed id but not on an unprefixed engine key", () => {
    // The prefix rule still applies to the definition itself — only the
    // structMap keys inside it are exempt. The pure API demotes the rule to a
    // warning datum on the built value; exactly one warning means the engine
    // keys inside the definition stayed exempt.
    const shipSizes = collection(undefined, [
      defineShipSize({
        id: "othermod_cruiser",
        name: "X",
        class: "shipclass_military",
        sectionSlots: { mid: { locator: ["part1"] } },
      }),
    ]);
    expect(buildMod(configFor("Ship size test", "ss_test"), [shipSizes]).warnings).toEqual([
      {
        code: "missing-prefix",
        message:
          'ship_size id "othermod_cruiser" must start with the mod prefix "ss_test_" ' +
          "so it cannot collide with vanilla or other mods",
      },
    ]);
  });

  it("splices a static modifier's rows at the block root, with no enclosing key", () => {
    // static_modifier declares alias_name[modifier] at the top level of its
    // rule, so the modifier names sit next to the metadata keys — writing them
    // under a `modifier = { ... }` block would produce a file the game reads as
    // a static modifier with no effect at all.
    const staticModifiers = collection(undefined, [
      defineStaticModifier({
        id: "sm_test_surge",
        name: "Surge",
        modifiers: (m) => {
          m.country.unity.produces.mult(0.15);
          m.planet.jobs.alloys.produces.mult(0.1);
        },
        icon: "gfx/interface/icons/modifiers/mod_surge.dds",
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Static modifier test", "sm_test"), [staticModifiers])
    ).get("common/static_modifiers/sm_test_static_modifiers.txt")!;
    expect(rendered).toContain(
      "sm_test_surge = {\n\tcountry_unity_produces_mult = 0.15\n" +
        "\tplanet_jobs_alloys_produces_mult = 0.1\n" +
        "\ticon = gfx/interface/icons/modifiers/mod_surge.dds\n}"
    );
    expect(rendered).not.toContain("modifier = {");
    expect(rendered).not.toContain("modifiers = {");
  });

  it("emits a static modifier with no modifiers as an empty body", () => {
    // Vanilla ships plenty of these (`player_empire`, `empire_size`): the
    // registry's other fields must not depend on the splice being present.
    const staticModifiers = collection(undefined, [
      defineStaticModifier({ id: "sm_test_marker", name: "Marker" }),
    ]);
    expect(
      render(buildMod(configFor("Static modifier test", "sm_test"), [staticModifiers])).get(
        "common/static_modifiers/sm_test_static_modifiers.txt"
      )
    ).toBe("sm_test_marker = {}\n");
  });

  it("warns on an unprefixed nested definition", () => {
    const wrong = collection(undefined, [
      defineTradition({
        id: "content_test_tradition_x",
        name: "X",
        traditionSwap: { othermod_swap: { name: "Wrong namespace" } },
      }),
    ]);
    const warnings = buildMod(CONFIG, [wrong]).warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/must start with the mod prefix "content_test_"/);

    const right = collection(undefined, [
      defineTradition({
        id: "content_test_tradition_x",
        name: "X",
        traditionSwap: { content_test_swap_x: { name: "Correct namespace" } },
      }),
    ]);
    expect(buildMod(CONFIG, [right]).warnings).toEqual([]);
  });

  it("rejects duplicate nested ids across traditions", () => {
    const traditions = collection(undefined, [
      defineTradition({
        id: "content_test_tradition_x",
        name: "X",
        traditionSwap: { content_test_swap_shared: { name: "First" } },
      }),
      defineTradition({
        id: "content_test_tradition_y",
        name: "Y",
        traditionSwap: { content_test_swap_shared: { name: "Second" } },
      }),
    ]);
    expect(() => buildMod(CONFIG, [traditions])).toThrow(
      'Duplicate tradition.tradition_swap id "content_test_swap_shared"'
    );
  });

  it('applies the same mod-prefix and duplicate-id rules to "container" keying', () => {
    // stages is repeated-struct's first "container" consumer — its record key
    // IS the block's own key rather than a body field, a different code path
    // through the writer than "siblings" (tradition_swap, approach) already
    // exercises, so it needs its own direct check rather than relying on
    // approach's coverage to stand in for it.
    const unprefixed = collection(undefined, [
      defineSituationType({
        id: "content_test_situation_x",
        name: "X",
        monthlyProgress: { base: 1 },
        stages: {
          othermod_stage: { name: "Wrong namespace", icon: "GFX_x", iconBackground: "GFX_x_bg" },
        },
      }),
    ]);
    const warnings = buildMod(CONFIG, [unprefixed]).warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/must start with the mod prefix "content_test_"/);

    const duplicated = collection(undefined, [
      defineSituationType({
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
      }),
      defineSituationType({
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
      }),
    ]);
    expect(() => buildMod(CONFIG, [duplicated])).toThrow(
      'Duplicate situation_type.stages id "content_test_situation_stage_shared"'
    );
  });

  it("lowers pop_pre_trigger's alias splice as named bools, not a trigger block", () => {
    const rendered = files.get("common/pop_jobs/content_test_pop_jobs.txt")!;
    expect(rendered).toContain(
      "possible_pre_triggers = {\n\t\thas_owner = yes\n\t\tis_enslaved = no\n\t\tis_robotic = yes\n\t}"
    );
  });

  it("emits tradition.triggeredModifier and tradition_swap.triggeredModifier (sdk39TriggeredModifier)", () => {
    // SDK-39: both were silently dropped for want of a CONTENT_FIELD_OVERRIDES
    // row, even though the runtime TriggeredModifier writer already supported
    // the shape (ascension_perk, edict, job, councilor, situation_type all
    // had the row already).
    const tradition = defineTradition({
      id: "sdk39_tradition_triggered_modifier",
      name: "Sdk39 Tradition",
      triggeredModifier: [
        {
          when: hasAuthority("auth_democratic"),
          modifiers: (m) => m.country.unity.produces.mult(0.1),
        },
      ],
      traditionSwap: {
        sdk39_tradition_swap_triggered_modifier: {
          name: "Sdk39 Swap",
          triggeredModifier: [
            {
              when: hasAuthority("auth_oligarchic"),
              modifiers: (m) => m.country.unity.produces.mult(0.2),
            },
          ],
        },
      },
    });
    const rendered = render(
      buildMod(configFor("SDK-39 test", "sdk39"), [collection(undefined, [tradition])])
    ).get("common/traditions/sdk39_traditions.txt")!;
    expect(rendered).toContain(
      "triggered_modifier = {\n\t\tpotential = {\n\t\t\thas_authority = auth_democratic\n\t\t}\n" +
        "\t\tcountry_unity_produces_mult = 0.1\n\t}"
    );
    expect(rendered).toContain(
      "triggered_modifier = {\n\t\t\tpotential = {\n\t\t\t\thas_authority = auth_oligarchic\n\t\t\t}\n" +
        "\t\t\tcountry_unity_produces_mult = 0.2\n\t\t}"
    );
  });

  it("emits building.triggeredPlanetModifier and job.triggeredPlanetPopGroupModifierForSpecies (sdk39TriggeredModifier)", () => {
    // The sweep's other two finds: building's own plain triggered_modifier_clause
    // field (672 shipped buildings write it) and job's pop_group-clause variant
    // (7 shipped jobs write it, reusing the shape and dropping only
    // divide_over_pop_groups, which zero shipped jobs set).
    const building = defineBuilding({
      id: "sdk39_building_triggered_planet_modifier",
      name: "Sdk39 Building",
      triggeredPlanetModifier: [
        {
          when: always(),
          modifiers: (m) => m.planet.pop.assembly.mult(0.1),
        },
      ],
    });
    const job = defineJob({
      id: "sdk39_job_triggered_pop_group_modifier",
      name: "Sdk39 Job",
      triggeredPlanetPopGroupModifierForSpecies: [
        {
          when: always(),
          modifiers: (m) => m.pop.happiness(0.1),
        },
      ],
    });
    const rendered = render(
      buildMod(configFor("SDK-39 test", "sdk39"), [collection(undefined, [building, job])])
    );
    expect(rendered.get("common/buildings/sdk39_buildings.txt")).toContain(
      "triggered_planet_modifier = {\n\t\tpotential = {\n\t\t\talways = yes\n\t\t}\n"
    );
    expect(rendered.get("common/pop_jobs/sdk39_pop_jobs.txt")).toContain(
      "triggered_planet_pop_group_modifier_for_species = {\n\t\tpotential = {\n\t\t\talways = yes\n\t\t}\n"
    );
  });
});

/**
 * Runtime serialization evidence for widenedLowering (SDK-33, SDK-47).
 *
 * Both fixes stop collapsing a richer `RuleType` down to a narrower one: an
 * unannotated CWT scope now lowers to unchecked (`Trigger<never>`/
 * `WeightBlock<never>`) instead of the unsatisfiable `Trigger<ScopeName>`,
 * and `value_field` now lowers to `ScriptValue` (number widens in for free)
 * instead of plain `number`. Compile-time coverage lives in
 * content.test-d.ts; this is the matching runtime proof that the widened
 * types actually serialize.
 */
describe("widenedLowering: unpinned scope and value_field widening", () => {
  it("writes a real single-scope trigger through an unpinned-scope field (SDK-33)", () => {
    // tradition_category.conditionalDesc.trigger (the `desc` key's repeated
    // trigger+text block form) carries no `## replace_scopes` anywhere in its
    // chain, so before the fix it lowered to `Trigger<ScopeName>` —
    // contravariant, so only a universal trigger like always() type-checked.
    // The overlay's `country` scope assertion (backed by all 25 shipped
    // desc.trigger conditions) buys back real checking; this proves a real
    // country-scoped trigger both type-checks and serializes.
    const traditionCategory = collection(undefined, [
      defineTraditionCategory({
        id: "wl_test_widened_tradition_category",
        name: "Widened Futures",
        treeTemplate: "tree_template_5",
        adoptionBonus: "tr_placeholder",
        finishBonus: "tr_placeholder",
        traditions: ["tr_placeholder"],
        conditionalDesc: [
          {
            trigger: hasAuthority("auth_machine_intelligence"),
            text: "Only machine empires walk this path.",
          },
        ],
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Widened lowering test", "wl_test"), [traditionCategory])
    ).get("common/tradition_categories/wl_test_tradition_categories.txt")!;
    expect(rendered).toContain(
      "\tdesc = {\n\t\ttrigger = {\n\t\t\thas_authority = auth_machine_intelligence\n\t\t}\n" +
        '\t\ttext = "Only machine empires walk this path."\n\t}'
    );
  });

  it("writes a real system-scoped weight block through an unpinned-scope field (SDK-33)", () => {
    // solar_system_initializer.usage_odds carries no `## replace_scopes` and
    // the registry has no body-level push_scope either, so before the fix it
    // lowered to `WeightBlock<ScopeName>`. The overlay's `system` scope
    // assertion buys back real checking.
    const initializer = collection(undefined, [
      defineSolarSystemInitializer({
        id: "wl_test_widened_solar_system",
        class: "star1",
        usageOdds: {
          base: 10,
          modifiers: [{ factor: 2, when: isBottleneckSystem() }],
        },
      }),
    ]);
    const rendered = render(
      buildMod(configFor("Widened lowering test", "wl_test"), [initializer])
    ).get("common/solar_system_initializers/wl_test_solar_system_initializers.txt")!;
    expect(rendered).toContain("\tusage_odds = {\n\t\tbase = 10\n\t\tmodifier = {");
    expect(rendered).toContain("is_bottleneck_system = yes");
  });

  it("accepts and serializes both a plain number and a script-value string for the same field (SDK-47)", () => {
    // country_ship_of_size_limit.base is `country_limits.cwt`'s `value_field`,
    // not `float`. A plain number keeps working unchanged (the widening's
    // whole point); a scripted-variable string is a form the old `number`
    // type could not express at all.
    const limits = collection(undefined, [
      defineCountryShipOfSizeLimit({
        id: "wl_test_numeric_limit",
        shipTypes: ["ship_size_titan"],
        base: 80,
        show: isScopeValid(),
      }),
      defineCountryShipOfSizeLimit({
        id: "wl_test_script_value_limit",
        shipTypes: ["ship_size_titan"],
        base: "some_scripted_variable",
        show: isScopeValid(),
      }),
    ]);
    const rendered = render(buildMod(configFor("Widened lowering test", "wl_test"), [limits])).get(
      "common/country_limits/ship_of_size_limits/wl_test_ship_of_size_limits.txt"
    )!;
    expect(rendered).toContain("base = 80");
    expect(rendered).toContain("base = some_scripted_variable");
  });

  it("serializes every ScriptValue form to the exact bytes the game reads (widenedLowering, SDK-47 P1 fix)", () => {
    // Each of value_field's four non-numeric forms, one definition per form,
    // asserted against the *exact* emitted line — types were never the
    // problem here, only bytes. `@my_value` is the form that was broken: a
    // bare string passed straight to pdxscript's `kv`/`scalar` gets quoted
    // defensively on serialization (`classifyUnquoted` reads a leading `@`
    // as a variable token, so writing it bare would misparse on reread),
    // which silently turned a scripted-variable reference into a literal
    // string the game would never evaluate. `scriptValueScalar` in
    // trigger-core.ts converts a `@`-prefixed input to a `varRef` node before
    // it reaches pdxscript, which writes a `var` node bare by construction.
    // The other three forms (`value:<script_value>`, `trigger:<name>`, a
    // bare `scope.variable` path) already round-tripped as plain bare string
    // scalars with no fix needed — asserted here so a future regression in
    // any of the four is caught the same way.
    const limits = collection(undefined, [
      defineCountryShipOfSizeLimit({
        id: "wl_test_script_value_variable",
        shipTypes: ["ship_size_titan"],
        base: "@my_value",
        show: isScopeValid(),
      }),
      defineCountryShipOfSizeLimit({
        id: "wl_test_script_value_named",
        shipTypes: ["ship_size_titan"],
        base: "value:my_script_value",
        show: isScopeValid(),
      }),
      defineCountryShipOfSizeLimit({
        id: "wl_test_script_value_trigger",
        shipTypes: ["ship_size_titan"],
        base: "trigger:my_trigger",
        show: isScopeValid(),
      }),
      defineCountryShipOfSizeLimit({
        id: "wl_test_script_value_scope_path",
        shipTypes: ["ship_size_titan"],
        base: "owner.some_variable",
        show: isScopeValid(),
      }),
    ]);
    const rendered = render(buildMod(configFor("Widened lowering test", "wl_test"), [limits])).get(
      "common/country_limits/ship_of_size_limits/wl_test_ship_of_size_limits.txt"
    )!;
    expect(rendered).toContain("\tbase = @my_value\n");
    expect(rendered).not.toContain('"@my_value"');
    expect(rendered).toContain("\tbase = value:my_script_value\n");
    expect(rendered).toContain("\tbase = trigger:my_trigger\n");
    expect(rendered).toContain("\tbase = owner.some_variable\n");
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
    { key: "text", member: "text", shape: "value", form: "scalar", conversion: "identity" },
    {
      key: "value",
      member: "values",
      shape: "value",
      form: "list",
      conversion: "ref",
      repeated: true,
    },
  ];
  const CLAUSE_FIELDS: readonly ContentField[] = [
    { key: "value", member: "value", shape: "value", form: "scalar", conversion: "ref" },
    {
      key: "OR",
      member: "or",
      shape: "struct",
      form: "list",
      fields: GROUP_FIELDS,
      repeated: true,
    },
    {
      key: "NOT",
      member: "not",
      shape: "struct",
      form: "list",
      fields: GROUP_FIELDS,
      repeated: true,
    },
    {
      key: "NOR",
      member: "nor",
      shape: "struct",
      form: "list",
      fields: GROUP_FIELDS,
      repeated: true,
    },
  ];
  const GOVERNMENT_TRIGGER_FIELDS: readonly ContentField[] = [
    { key: "text", member: "text", shape: "value", form: "scalar", conversion: "identity" },
    { key: "always", member: "always", shape: "value", form: "scalar", conversion: "identity" },
    {
      key: "authority",
      member: "authority",
      shape: "struct",
      form: "block",
      fields: CLAUSE_FIELDS,
    },
    { key: "ethics", member: "ethics", shape: "struct", form: "block", fields: CLAUSE_FIELDS },
    { key: "civics", member: "civics", shape: "struct", form: "block", fields: CLAUSE_FIELDS },
    {
      key: "OR",
      member: "or",
      shape: "aliasStruct",
      form: "list",
      category: "government_trigger",
      repeated: true,
    },
    {
      key: "host_has_dlc",
      member: "hostHasDlc",
      shape: "value",
      form: "scalar",
      conversion: "identity",
    },
  ];
  registerAliasStructFields("government_trigger", GOVERNMENT_TRIGGER_FIELDS);

  const descriptor: ContentRegistryDescriptor = {
    type: "civic_or_origin",
    referenceName: "civic_or_origin",
    outputDir: "common/governments/civics",
    fileStem: "civics",
    fields: [
      {
        key: "potential",
        member: "potential",
        shape: "aliasStruct",
        form: "block",
        category: "government_trigger",
      },
      {
        key: "possible",
        member: "possible",
        shape: "aliasStruct",
        form: "block",
        category: "government_trigger",
      },
    ],
    localisation: [],
  };

  function renderCivic(def: Record<string, unknown> & { id: string }): string {
    const authoring = new ContentAuthoring("gt_test", [descriptor], () => {});
    authoring.define("civic_or_origin", def);
    return authoring.render().get("common/governments/civics/gt_test_civics.txt")!;
  }

  it("writes a domain clause the way vanilla civics write it", () => {
    // civic_corvee_system, verbatim in shape: a bare NOT group in `potential`,
    // and a NOR group carrying its tooltip plus two operands in `possible`.
    expect(
      renderCivic({
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
      renderCivic({
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
              form: "block",
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

describe("registries that share an outputDir (SDK-32)", () => {
  // utility_component_template, weapon_component_template and
  // strike_craft_component_template are the only three of the SDK's 35
  // content registries that share an `outputDir` and file stem — mirroring
  // the game's own `components.cwt` — so one feature module fanning out
  // across two of them (the pattern AGENTS.md teaches) used to have the
  // second registry's file silently overwrite the first in `render`'s path
  // map, with no warning and a `.yml` still advertising the dropped id.
  const SHARED_OUTPUT_DIR_CONFIG = configFor("Shared output dir test", "shared_output_dir_test");
  const SHARED_OUTPUT_DIR_RELPATH =
    "common/component_templates/shared_output_dir_test_component_templates.txt";
  const SHARED_OUTPUT_DIR_LOC_RELPATH = "localisation/english/shared_output_dir_test_l_english.yml";

  function sharedOutputDirTemplates() {
    const weapon = defineWeaponComponentTemplate({
      id: "shared_output_dir_test_weapon_mass_driver",
      name: "Mass Driver",
      icon: "GFX_ship_part_mass_driver",
    });
    const utility = defineUtilityComponentTemplate({
      id: "shared_output_dir_test_utility_armor_plating",
      name: "Armor Plating",
      icon: "GFX_ship_part_armor",
    });
    return { weapon, utility };
  }

  it("merges a weapon and a utility template into one file instead of the second overwriting the first", () => {
    const { weapon, utility } = sharedOutputDirTemplates();
    const mod = buildMod(SHARED_OUTPUT_DIR_CONFIG, [collection(undefined, [weapon, utility])]);
    const files = render(mod);

    expect([...files.keys()]).toContain(SHARED_OUTPUT_DIR_RELPATH);
    const content = files.get(SHARED_OUTPUT_DIR_RELPATH)!;
    expect(content).toContain("shared_output_dir_test_weapon_mass_driver");
    expect(content).toContain("shared_output_dir_test_utility_armor_plating");
    expect(mod.warnings).toEqual([]);
  });

  it("renders the merged file identically regardless of authoring order", () => {
    const forward = sharedOutputDirTemplates();
    const forwardContent = render(
      buildMod(SHARED_OUTPUT_DIR_CONFIG, [collection(undefined, [forward.weapon, forward.utility])])
    ).get(SHARED_OUTPUT_DIR_RELPATH);

    const backward = sharedOutputDirTemplates();
    const backwardContent = render(
      buildMod(SHARED_OUTPUT_DIR_CONFIG, [
        collection(undefined, [backward.utility, backward.weapon]),
      ])
    ).get(SHARED_OUTPUT_DIR_RELPATH);

    expect(forwardContent).toBeDefined();
    expect(backwardContent).toEqual(forwardContent);
  });

  it("matches the merged component-templates golden", async () => {
    const { weapon, utility } = sharedOutputDirTemplates();
    const content = render(
      buildMod(SHARED_OUTPUT_DIR_CONFIG, [collection(undefined, [weapon, utility])])
    ).get(SHARED_OUTPUT_DIR_RELPATH);

    await expect(content).toMatchFileSnapshot(
      "__snapshots__/content/shared-output-dir-component-templates.txt"
    );
  });

  it("keeps localization consistent with the merged file — no id advertised that has no definition", () => {
    const { weapon, utility } = sharedOutputDirTemplates();
    const files = render(
      buildMod(SHARED_OUTPUT_DIR_CONFIG, [collection(undefined, [weapon, utility])])
    );

    const loc = files.get(SHARED_OUTPUT_DIR_LOC_RELPATH)!;
    const content = files.get(SHARED_OUTPUT_DIR_RELPATH)!;
    for (const id of [
      "shared_output_dir_test_weapon_mass_driver",
      "shared_output_dir_test_utility_armor_plating",
    ]) {
      expect(loc).toContain(`${id}:0`);
      expect(content).toContain(id);
    }
  });

  it("rejects two component-template subtypes sharing an id, even when the loc guard misses it", () => {
    // The loc-duplicate guard only fires when both definitions register a
    // loc key for the shared id — omitting the optional `name` on one of
    // them (as here) means no loc key collides, so it never runs. The
    // per-registry duplicate check in `ContentAuthoring.define` also misses
    // it: it dedups within one registry's own id list, and these are two
    // different registries. Only the own-id-by-outputDir check in build.ts's
    // content pass 1 catches this, the same way — and for the same reason —
    // the neighbouring vanilla-collision check is keyed by outputDir: the
    // game merges every file in a directory into one id-keyed namespace, so
    // two subtypes sharing an id here is unusable output, not merely odd.
    const weapon = defineWeaponComponentTemplate({
      id: "shared_output_dir_test_shared_id",
      icon: "GFX_ship_part_mass_driver",
    });
    const utility = defineUtilityComponentTemplate({
      id: "shared_output_dir_test_shared_id",
      name: "Armor Plating",
      icon: "GFX_ship_part_armor",
    });

    expect(() =>
      buildMod(SHARED_OUTPUT_DIR_CONFIG, [collection(undefined, [weapon, utility])])
    ).toThrow(
      'utility_component_template id "shared_output_dir_test_shared_id" collides with a ' +
        "weapon_component_template of the same id — both are emitted under " +
        '"common/component_templates", where the game merges every file it loads by id, so only ' +
        "one definition would survive and which one is undetermined; give one of them a different id"
    );
  });
});

describe("modifier desc keys are content-derived, not positional (SDK-48)", () => {
  const DESC_KEY_CONFIG = configFor("Desc key test", "desc_key_test");

  function situationWithRows(descs: readonly string[]) {
    return defineSituationType({
      id: "desc_key_test_situation_reorder",
      name: "Reorder Test",
      monthlyProgress: {
        base: 1,
        modifiers: descs.map((desc) => ({ subtract: 1, desc, when: always() })),
      },
    });
  }

  function keyForText(loc: ReadonlyMap<string, string>, text: string): string | undefined {
    for (const [key, value] of loc) {
      if (value === text) {
        return key;
      }
    }
    return undefined;
  }

  it("keeps every pre-existing row's key stable when a new row is inserted mid-list", () => {
    // The reproduction from the ticket: 11 rows, one inserted at index 2. On
    // main, collectModifierDescs derives the key from the row's index in
    // `weight.modifiers`, so every row from index 2 down shifts to the next
    // localisation key and silently repoints at whichever row now sits
    // there — no build error, and no symptom until a shipped translation is
    // read in that language. This must fail on main and pass once the key is
    // a function of the row's own content instead.
    const descs = Array.from({ length: 11 }, (_, i) => `Row ${i} of the uprising.`);
    const before = buildMod(DESC_KEY_CONFIG, [collection(undefined, [situationWithRows(descs)])]);
    const withInsertion = [
      ...descs.slice(0, 2),
      "A newly inserted row at index 2.",
      ...descs.slice(2),
    ];
    const after = buildMod(DESC_KEY_CONFIG, [
      collection(undefined, [situationWithRows(withInsertion)]),
    ]);

    for (const desc of descs) {
      expect(keyForText(after.loc, desc)).toBe(keyForText(before.loc, desc));
      expect(keyForText(after.loc, desc)).toBeDefined();
    }
  });

  it("derives the key from an author-supplied descKey and emits no warning", () => {
    const situation = defineSituationType({
      id: "desc_key_test_situation_pinned",
      name: "Pinned Key Test",
      monthlyProgress: {
        base: 1,
        modifiers: [
          {
            subtract: 1,
            desc: "The Flesh is Weak.",
            descKey: "flesh_is_weak",
            when: always(),
          },
        ],
      },
    });

    const mod = buildMod(DESC_KEY_CONFIG, [collection(undefined, [situation])]);

    expect(mod.loc.get("desc_key_test_situation_pinned_monthly_progress_flesh_is_weak")).toBe(
      "The Flesh is Weak."
    );
    expect(mod.warnings).toEqual([]);
  });

  it("falls back to a hash of the desc text and warns when no descKey is given", () => {
    const desc = "Machine intelligence keeps the uprising contained.";
    const expectedSlug = createHash("sha256").update(desc).digest("hex").slice(0, 8);
    const situation = defineSituationType({
      id: "desc_key_test_situation_unkeyed",
      name: "Unkeyed Test",
      monthlyProgress: {
        base: 1,
        modifiers: [{ subtract: 1, desc, when: always() }],
      },
    });

    const mod = buildMod(DESC_KEY_CONFIG, [collection(undefined, [situation])]);

    const expectedKey = `desc_key_test_situation_unkeyed_monthly_progress_${expectedSlug}`;
    expect(mod.loc.get(expectedKey)).toBe(desc);
    expect(mod.warnings).toEqual([
      {
        code: "unstable-desc-key",
        message:
          'Modifier desc on "desc_key_test_situation_unkeyed" (monthly_progress) has no ' +
          "descKey; its localisation key is a hash of the desc text and will change if that " +
          "text is edited, silently orphaning any existing translation. Set descKey to pin a " +
          "stable key.",
      },
    ]);
  });

  it("rejects a descKey that is not lowercase snake_case", () => {
    const situation = defineSituationType({
      id: "desc_key_test_situation_bad_key",
      name: "Bad Key Test",
      monthlyProgress: {
        base: 1,
        modifiers: [{ subtract: 1, desc: "Bad key.", descKey: "Flesh-Is-Weak", when: always() }],
      },
    });

    expect(() => buildMod(DESC_KEY_CONFIG, [collection(undefined, [situation])])).toThrow(
      'Modifier.descKey "Flesh-Is-Weak" on "desc_key_test_situation_bad_key" ' +
        '(monthly_progress) must be lowercase snake_case (e.g. "flesh_is_weak")'
    );
  });

  it("builds when two rows share identical unpinned desc text under different conditions", () => {
    // Two rows can legitimately want the exact same tooltip gated on
    // different conditions — "insufficient resources" under one flag, the
    // same line under another. Hashing only the desc text (no descKey given)
    // produces the same slug, and therefore the same full key, for both
    // rows. That must not be treated as a collision: the game shows the
    // same string either way, so registering the identical key/text once
    // is correct, not a bug the duplicate-key guard should catch. This must
    // fail on the branch tip before this fix, where the guard rejected any
    // repeated key regardless of whether the text matched.
    const desc = "Insufficient resources.";
    const situation = defineSituationType({
      id: "desc_key_test_situation_shared_text",
      name: "Shared Text Test",
      monthlyProgress: {
        base: 1,
        modifiers: [
          { subtract: 1, desc, when: hasSituationFlag("desc_key_test_flag_a") },
          { factor: 2, desc, when: hasSituationFlag("desc_key_test_flag_b") },
        ],
      },
    });

    const mod = buildMod(DESC_KEY_CONFIG, [collection(undefined, [situation])]);
    const expectedSlug = createHash("sha256").update(desc).digest("hex").slice(0, 8);
    const expectedKey = `desc_key_test_situation_shared_text_monthly_progress_${expectedSlug}`;

    // One yml entry, not two identical ones.
    expect(mod.loc.get(expectedKey)).toBe(desc);
    expect([...mod.loc.values()].filter((text) => text === desc)).toHaveLength(1);

    // Both modifier rows reference that same key in the emitted content.
    const content = render(mod).get("common/situations/desc_key_test_situations.txt")!;
    const descLines = content.split("\n").filter((line) => line.includes("desc ="));
    expect(descLines).toEqual([`\t\t\tdesc = ${expectedKey}`, `\t\t\tdesc = ${expectedKey}`]);
  });

  it("still rejects a genuine collision — same key, different text", () => {
    // Two rows deliberately sharing a descKey but carrying different desc
    // text compute the same localisation key for different English strings.
    // That is exactly what the duplicate-key guard exists to catch, and the
    // benign same-text exemption above must not weaken it.
    const situation = defineSituationType({
      id: "desc_key_test_situation_collision",
      name: "Collision Test",
      monthlyProgress: {
        base: 1,
        modifiers: [
          { subtract: 1, desc: "Text A.", descKey: "shared_key", when: always() },
          { factor: 2, desc: "Text B.", descKey: "shared_key", when: always() },
        ],
      },
    });

    expect(() => buildMod(DESC_KEY_CONFIG, [collection(undefined, [situation])])).toThrow(
      'Duplicate localization key "desc_key_test_situation_collision_monthly_progress_shared_key"'
    );
  });

  it("matches the golden localisation and content for a mix of pinned and unpinned desc keys", async () => {
    const situation = defineSituationType({
      id: "desc_key_test_situation_golden",
      name: "Golden Test",
      monthlyProgress: {
        base: 1,
        modifiers: [
          {
            subtract: 1,
            desc: "The Flesh is Weak.",
            descKey: "flesh_is_weak",
            when: always(),
          },
          { factor: 2, desc: "An unpinned row.", when: always() },
        ],
      },
    });

    const files = render(buildMod(DESC_KEY_CONFIG, [collection(undefined, [situation])]));
    const loc = files.get("localisation/english/desc_key_test_l_english.yml")!;

    await expect(loc).toMatchFileSnapshot("__snapshots__/content/desc-key-localisation.yml");
  });
});
