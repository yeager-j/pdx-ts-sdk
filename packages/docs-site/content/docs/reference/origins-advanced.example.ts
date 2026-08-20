import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Haven Founders",
  prefix: "haven_founders",
  supportedVersion: "v4.4.*",
});

const systemName = mod.localization("HAVEN_SYSTEM", "Haven");
const worldName = mod.localization("HAVEN_WORLD", "Haven Prime");
const effects = mod.localization(
  "haven_founders_effects",
  "Begins on a continental world in the custom Haven system."
);

const havenSystem = mod.solarSystemInitializer("haven", {
  name: systemName.key,
  class: "sc_g",
  preventAnomalies: true,
  planet: [
    { class: "star", orbitDistance: 0, size: 30 },
    {
      name: worldName.key,
      class: "pc_continental",
      orbitDistance: 60,
      orbitAngle: 30,
      size: 18,
      homePlanet: true,
      initEffect: (planet) => planet.setPlanetFlag("haven_founders_homeworld"),
    },
  ],
});

const havenFounders = mod.civicOrOrigin("haven_founders", {
  name: "Haven Founders",
  desc: "A carefully chosen refuge became the center of a new civilization.",
  isOrigin: true,
  icon: "gfx/interface/icons/origins/origins_default.dds",
  picture: "GFX_origin_default",
  flags: ["custom_start_screen"],
  description: effects.key,
  startingColony: "pc_continental",
  habitabilityPreference: "pc_continental",
  initializers: [havenSystem],
  potential: {
    speciesArchetype: { not: [{ values: ["MACHINE"] }] },
  },
  possible: { isNomadic: false },
  modifier: (modifier) => modifier.country.unity.produces.mult(0.05),
  advancedStart: true,
  maxOnceGlobal: true,
  blocksRandomMachineEmpireGeneration: true,
  randomWeight: { base: 5 },
  aiWeight: { base: 5 },
});

export const feature = mod.feature("haven_founders", [
  systemName,
  worldName,
  effects,
  havenSystem,
  havenFounders,
]);

export default mod.compile([feature]);
