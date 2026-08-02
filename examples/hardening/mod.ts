import {
  buildMod,
  countryFlags,
  createAgendas,
  createBuildings,
  createEdicts,
  createEvents,
  createOnActions,
  createTechnologies,
  createTraditionCategories,
  createTraditions,
  eventTarget,
  hasAuthority,
  numOwnedPlanets,
  onActions,
  type VanillaView,
} from "../../src/index.ts";

export const hardeningFlags = countryFlags("pdx_hardening_entry_fired");
export const hardeningTarget = eventTarget<"planet">("pdx_hardening_chain_planet");

const config = {
  name: "PDX SDK Hardening",
  prefix: "pdx_hardening",
  version: "1.0.0",
  supportedVersion: "v4.4.*",
};

export function defineHardening(vanilla: VanillaView) {
  // One collection per registry the corpus covers; each takes the registry's
  // default file stem, so the emitted paths are the same ones the goldens pin.
  const technologies = createTechnologies();
  const buildings = createBuildings();
  const agendas = createAgendas();
  const traditions = createTraditions();
  const traditionCategories = createTraditionCategories();
  const edicts = createEdicts();
  const events = createEvents("events", "pdx_hardening");
  const hooks = createOnActions();

  const markerTechnology = technologies.defineTechnology({
    id: "pdx_hardening_tech_marker",
    name: "SDK Hardening Marker",
    desc: "A harmless marker proving generated technology content loaded.",
    area: "society",
    tier: 0,
    category: "biology",
    icon: "tech_genome_mapping",
    startTech: true,
    weight: 0,
  });

  buildings.defineBuilding({
    id: "pdx_hardening_building_marker",
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

  const agenda = agendas.defineAgenda({
    id: "pdx_hardening_agenda_marker",
    name: "SDK Hardening",
    desc: "Keep generated definitions observable and boring.",
    agendaCost: 1_000,
    effect: (country) => country.log("PDX_HARDENING_AGENDA"),
  });

  const tradition = traditions.defineTradition({
    id: "pdx_hardening_tradition_marker",
    name: "Hardening Discipline",
    effects: "The SDK seams remain observable.",
    unlocksAgenda: agenda,
    possible: hasAuthority("auth_democratic"),
    modifier: (m) => {
      m.country.unity.produces.mult(0.01);
    },
  });

  traditionCategories.defineTraditionCategory({
    id: "pdx_hardening_tradition_category_marker",
    name: "SDK Hardening",
    desc: "A one-node category for integration coverage.",
    treeTemplate: "tree_template_5",
    adoptionBonus: tradition,
    finishBonus: tradition,
    traditions: [tradition],
  });

  edicts.defineEdict({
    id: "pdx_hardening_edict_marker",
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

  const cascade = events.defineCountryEvent({
    id: 4,
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.log("PDX_HARDENING_ORDER_C");
    },
  });

  const delayedA = events.defineCountryEvent({
    id: 2,
    from: "planet",
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country, ctx) => {
      country.log("PDX_HARDENING_ORDER_A");
      country.within(ctx.from, (planet) => planet.log("PDX_HARDENING_FROM_OVERRIDE_IS_PLANET"));
      country.countryEvent({ id: cascade, days: 0 });
    },
  });

  const delayedB = events.defineCountryEvent({
    id: 3,
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => country.log("PDX_HARDENING_ORDER_B"),
  });

  const expiredTargetProbe = events.defineCountryEvent({
    id: 5,
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.log("PDX_HARDENING_EXPIRY_PROBE_STARTED");
      country.within(hardeningTarget, (planet) =>
        planet.log("PDX_HARDENING_TARGET_STILL_AVAILABLE_AFTER_CHAIN")
      );
    },
  });

  const entryEvent = events.defineCountryEvent({
    id: 1,
    hideWindow: true,
    isTriggeredOnly: true,
    immediate: (country) => {
      country.if(numOwnedPlanets(">=", 1), (scopedCountry) => {
        scopedCountry.log("PDX_HARDENING_ENTRY");
        scopedCountry.setCountryFlag(hardeningFlags.pdx_hardening_entry_fired);
        scopedCountry.everyOwnedPlanet({}, (planet) => {
          planet.saveEventTargetAs(hardeningTarget);
        });
        scopedCountry.within(hardeningTarget, (planet) =>
          planet.log("PDX_HARDENING_TARGET_AVAILABLE_IN_ENTRY")
        );
        scopedCountry.countryEvent({
          id: delayedA,
          from: hardeningTarget,
          days: 1,
        });
        scopedCountry.countryEvent({ id: delayedB, days: 1 });
      });
    },
  });

  hooks.on(onActions.onGameStartCountry, entryEvent);

  const geneTailoring = vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites");
  technologies.patchTechnology(geneTailoring, (technology) => ({
    cost: technology.cost.value * 2,
    prerequisites: [...technology.prerequisites, markerTechnology],
  }));

  return {
    mod: buildMod(
      config,
      [technologies, buildings, agendas, traditions, traditionCategories, edicts, events, hooks],
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
