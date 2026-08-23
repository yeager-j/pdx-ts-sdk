import {
  countryFlags,
  createMod,
  eventTarget,
  hasAuthority,
  numOwnedPlanets,
  onActions,
  type VanillaView,
} from "@pdx-ts/sdk";

export const hardeningFlags = countryFlags("pdx_hardening_entry_fired");
export const hardeningTarget = eventTarget<"planet">("pdx_hardening_chain_planet");

const config = {
  name: "PDX SDK Hardening",
  prefix: "pdx_hardening" as const,
  version: "1.0.0",
  supportedVersion: "v4.4.*",
};

const mod = createMod(config);

export function defineHardening(vanilla: VanillaView) {
  const events = mod.namespace();

  const markerTechnology = mod.technology("marker", {
    name: "SDK Hardening Marker",
    desc: "A harmless marker proving generated technology content loaded.",
    area: "society",
    tier: 0,
    category: "biology",
    icon: "tech_genome_mapping",
    startTech: true,
    weight: 0,
  });

  const markerBuilding = mod.building("marker", {
    name: "SDK Hardening Lab",
    desc: "A harmless building definition used by the hardening calibration.",
    baseBuildtime: 360,
    category: "research",
    icon: "building_research_lab_1",
    buildingSets: ["research"],
    canBuild: true,
    prerequisites: [markerTechnology],
    planetModifier: (m) => {
      m.planet.jobs.society.research.produces.mult(0.01);
    },
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
    modifier: (m) => {
      m.country.unity.produces.mult(0.01);
    },
  });

  const traditionCategory = mod.traditionCategory("marker", {
    name: "SDK Hardening",
    desc: "A one-node category for integration coverage.",
    treeTemplate: "tree_template_5",
    adoptionBonus: tradition,
    finishBonus: tradition,
    traditions: [tradition],
  });

  const markerEdict = mod.edict("marker", {
    name: "SDK Hardening Marker",
    description: "A harmless edict definition used by the hardening calibration.",
    length: 360,
    icon: "GFX_edict_type_time",
    resources: [
      {
        category: "edicts",
        upkeep: { amounts: { unity: 1 } },
      },
    ],
    triggeredCountryModifier: [
      {
        when: hasAuthority("auth_democratic"),
        modifiers: (m) => {
          m.country.unity.produces.mult(0.01);
        },
      },
    ],
    prerequisites: [markerTechnology],
    effect: (country) => country.log("PDX_HARDENING_EDICT"),
  });

  const cascade = events.country(4, {
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.log("PDX_HARDENING_ORDER_C");
    },
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
      hardeningTarget.effects((planet) =>
        planet.log("PDX_HARDENING_TARGET_STILL_AVAILABLE_AFTER_CHAIN")
      );
    },
  });

  const entryEvent = events.country(1, {
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.if(numOwnedPlanets(">=", 1), () => {
        country.log("PDX_HARDENING_ENTRY");
        country.setCountryFlag(hardeningFlags.pdx_hardening_entry_fired);
        country.everyOwnedPlanet({}, (planet) => {
          planet.saveEventTargetAs(hardeningTarget);
        });
        hardeningTarget.effects((planet) => planet.log("PDX_HARDENING_TARGET_AVAILABLE_IN_ENTRY"));
        country.countryEvent({
          id: delayedA,
          from: hardeningTarget,
          days: 1,
        });
        country.countryEvent({ id: delayedB, days: 1 });
      });
    },
  });

  const entryHook = mod.on(onActions.onGameStartCountry, [entryEvent]);

  const geneTailoring = vanilla
    .definition("technology", "tech_gene_tailoring")
    .require("cost", "prerequisites");
  const geneTailoringPatch = mod.patchTechnology(geneTailoring, (technology) => ({
    cost: technology.cost.value * 2,
    prerequisites: [...technology.prerequisites, markerTechnology],
  }));

  return {
    mod: mod.compile(
      [
        mod.feature(undefined, [
          markerTechnology,
          geneTailoringPatch,
          markerBuilding,
          agenda,
          tradition,
          traditionCategory,
          markerEdict,
          entryHook,
        ]),
        mod.feature("events", [cascade, delayedA, delayedB, expiredTargetProbe, entryEvent]),
      ],
      { vanilla }
    ),
    entryEvent,
    delayedA,
    delayedB,
    cascade,
    expiredTargetProbe,
    markerTechnology,
    vanillaCost: geneTailoring.cost.value,
  };
}

export type HardeningMod = ReturnType<typeof defineHardening>;
