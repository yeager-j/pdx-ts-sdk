import {
  and,
  countryFlags,
  createMod,
  eventTarget,
  hasAuthority,
  hasCountryFlag,
  hasOwner,
  isAtWar,
  not,
  numOwnedPlanets,
  onActions,
  scriptedEffect,
  scriptedTrigger,
  vanilla,
  type TechnologyItem,
  type VanillaView,
} from "../../src/index.ts";

const helloFlags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");
const isRegularEmpire = scriptedTrigger.unchecked("is_regular_empire", "country");
const hasActualDeficit = scriptedTrigger.unchecked("has_actual_deficit", "country");
const giveTechOptionOrProgressEffect = scriptedEffect.unchecked(
  "give_tech_option_or_progress_effect",
  "country"
);

/** A test-only capability-authored equivalent of examples/hello-galaxy. */
export function defineCapabilityHelloGalaxy() {
  const mod = createMod({
    name: "Hello Galaxy",
    prefix: "hello_galaxy",
    version: "0.1.0",
    supportedVersion: "v4.0.*",
    tags: ["Technologies"],
  });
  const events = mod.namespace();
  const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");
  const resonanceTheory = mod.technology("resonance_theory", {
    name: "Crystal Resonance Theory",
    desc: "The lattice hums at frequencies we are only beginning to hear.",
    cost: 2000,
    area: "physics",
    tier: 2,
    category: "particles",
    weight: 100,
  });
  const resonanceWeapons = mod.technology("resonance_weapons", {
    name: "Resonance Disruptors",
    desc: "Weaponized harmonics that shatter hulls from within.",
    cost: 6000,
    area: "physics",
    tier: 3,
    category: "particles",
    prerequisites: [resonanceTheory, "tech_lasers_2"],
    isRare: true,
    weight: 70,
    potential: and(
      hasCountryFlag(helloFlags.hello_galaxy_heard_the_hum),
      not(hasCountryFlag(helloFlags.hello_galaxy_pacifist_path)),
      isRegularEmpire()
    ),
  });
  const aftershock = events.planet(2, {
    from: "country",
    title: "Aftershock",
    desc: "The crystal hum lingers over this world.",
    isTriggeredOnly: true,
    immediate: (_planet, ctx) => {
      ctx.from.effects((country) => country.addResource({ resource: "influence", amount: 50 }));
    },
    options: [{ name: "Noted." }],
  });
  const humReturns = events.country(1, {
    title: "The Hum Returns",
    desc: "Deep in the lattice, something answers back.",
    isTriggeredOnly: true,
    immediate: (country, ctx) => {
      country.randomList([
        {
          weight: 60,
          do: (scopedCountry) => {
            scopedCountry.setCountryFlag(helloFlags.hello_galaxy_heard_the_hum);
            scopedCountry.run(giveTechOptionOrProgressEffect({ TECH: resonanceTheory }));
          },
        },
        {
          weight: 40,
          modifiers: [
            { factor: 2, when: isAtWar() },
            { factor: 3, when: hasActualDeficit({ RESOURCE: vanilla.resource("minerals") }) },
          ],
          do: (scopedCountry) => {
            scopedCountry.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
              planet.saveEventTargetAs(stormWorld);
              planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
            });
          },
        },
      ]);
      country
        .if(hasCountryFlag(helloFlags.hello_galaxy_heard_the_hum), () => {
          stormWorld.effects((planet) => planet.addDeposit("d_minerals_1"));
        })
        .else((scopedCountry) => scopedCountry.log("the hum went unheard"));
    },
    options: [{ name: "Fascinating." }],
  });
  const amplifiers: TechnologyItem[] = [];
  let previous: TechnologyItem = resonanceTheory;
  for (const [index, adjective] of [
    "Attuned",
    "Harmonic",
    "Coherent",
    "Superradiant",
    "Transcendent",
  ].entries()) {
    const tier = index + 1;
    previous = mod.technology(`amplifier_${tier}`, {
      name: `${adjective} Resonance Amplifiers`,
      cost: 1000 * 2 ** tier,
      area: "physics",
      tier: Math.min(tier + 1, 5),
      category: "particles",
      prerequisites: [previous],
      weight: 100 - 10 * tier,
    });
    amplifiers.push(previous);
  }
  return mod.compile([
    mod.feature("resonance", [resonanceTheory, resonanceWeapons, aftershock, humReturns]),
    mod.feature("amplifiers", amplifiers),
  ]);
}

/** A test-only capability-authored equivalent of examples/hardening. */
export function defineCapabilityHardening(vanillaView: VanillaView) {
  const mod = createMod({
    name: "PDX SDK Hardening",
    prefix: "pdx_hardening",
    version: "1.0.0",
    supportedVersion: "v4.4.*",
  });
  const events = mod.namespace();
  const flags = countryFlags("pdx_hardening_entry_fired");
  const target = eventTarget<"planet">("pdx_hardening_chain_planet");
  const technology = mod.technology("marker", {
    name: "SDK Hardening Marker",
    desc: "A harmless marker proving generated technology content loaded.",
    area: "society",
    tier: 0,
    category: "biology",
    icon: "tech_genome_mapping",
    startTech: true,
    weight: 0,
  });
  const building = mod.building("marker", {
    name: "SDK Hardening Lab",
    desc: "A harmless building definition used by the hardening calibration.",
    baseBuildtime: 360,
    category: "research",
    icon: "building_research_lab_1",
    buildingSets: ["research"],
    canBuild: true,
    prerequisites: [technology],
    planetModifier: (modifiers) => modifiers.planet.jobs.society.research.produces.mult(0.01),
  });
  const agenda = mod.agenda("marker", {
    name: "SDK Hardening",
    desc: "Keep generated definitions observable and boring.",
    agendaCost: 1_000,
    effect: (country) => country.log("PDX_HARDENING_AGENDA"),
  });
  const tradition = mod.tradition("marker", {
    name: "Hardening Discipline",
    effects: "The SDK seams remain observable.",
    unlocksAgenda: agenda,
    possible: hasAuthority("auth_democratic"),
    modifier: (modifiers) => modifiers.country.unity.produces.mult(0.01),
  });
  const traditionCategory = mod.traditionCategory("marker", {
    name: "SDK Hardening",
    desc: "A one-node category for integration coverage.",
    treeTemplate: "tree_template_5",
    adoptionBonus: tradition,
    finishBonus: tradition,
    traditions: [tradition],
  });
  const edict = mod.edict("marker", {
    name: "SDK Hardening Marker",
    description: "A harmless edict definition used by the hardening calibration.",
    length: 360,
    icon: "GFX_edict_type_time",
    resources: [{ category: "edicts", upkeep: { amounts: { unity: 1 } } }],
    triggeredCountryModifier: [
      {
        when: hasAuthority("auth_democratic"),
        modifiers: (modifiers) => modifiers.country.unity.produces.mult(0.01),
      },
    ],
    prerequisites: [technology],
    effect: (country) => country.log("PDX_HARDENING_EDICT"),
  });
  const cascade = events.country(4, {
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => country.log("PDX_HARDENING_ORDER_C"),
  });
  const delayedA = events.country(2, {
    from: "planet",
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country, ctx) => {
      country.log("PDX_HARDENING_ORDER_A");
      ctx.from.effects((planet) => planet.log("PDX_HARDENING_FROM_OVERRIDE_IS_PLANET"));
      country.countryEvent({ id: cascade, days: 0 });
    },
  });
  const delayedB = events.country(3, {
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => country.log("PDX_HARDENING_ORDER_B"),
  });
  const expiredTargetProbe = events.country(5, {
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.log("PDX_HARDENING_EXPIRY_PROBE_STARTED");
      target.effects((planet) => planet.log("PDX_HARDENING_TARGET_STILL_AVAILABLE_AFTER_CHAIN"));
    },
  });
  const entryEvent = events.country(1, {
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.if(numOwnedPlanets(">=", 1), (scopedCountry) => {
        scopedCountry.log("PDX_HARDENING_ENTRY");
        scopedCountry.setCountryFlag(flags.pdx_hardening_entry_fired);
        scopedCountry.everyOwnedPlanet({}, (planet) => planet.saveEventTargetAs(target));
        target.effects((planet) => planet.log("PDX_HARDENING_TARGET_AVAILABLE_IN_ENTRY"));
        scopedCountry.countryEvent({ id: delayedA, from: target, days: 1 });
        scopedCountry.countryEvent({ id: delayedB, days: 1 });
      });
    },
  });
  const hook = mod.on(onActions.onGameStartCountry, [entryEvent]);
  const vanillaTechnology = vanillaView
    .technology("tech_gene_tailoring")
    .require("cost", "prerequisites");
  const patch = mod.patchTechnology(vanillaTechnology, (source) => ({
    cost: source.cost.value * 2,
    prerequisites: [...source.prerequisites, technology],
  }));
  return {
    mod: mod.compile(
      [
        mod.feature(undefined, [
          technology,
          patch,
          building,
          agenda,
          tradition,
          traditionCategory,
          edict,
          hook,
        ]),
        mod.feature("events", [cascade, delayedA, delayedB, expiredTargetProbe, entryEvent]),
      ],
      { vanilla: vanillaView }
    ),
    entryEvent,
    delayedA,
    delayedB,
    cascade,
    expiredTargetProbe,
    vanillaCost: vanillaTechnology.cost.value,
  };
}
