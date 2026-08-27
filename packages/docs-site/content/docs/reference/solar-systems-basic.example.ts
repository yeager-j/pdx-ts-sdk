import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Cartography",
  prefix: "frontier_cartography",
  supportedVersion: "v4.4.*",
});

const systemName = mod.localization("HAVEN_SYSTEM", "Haven");
const worldName = mod.localization("HAVEN_WORLD", "Haven Prime");
const moonName = mod.localization("HAVEN_MOON", "Pilgrim");

const haven = mod.solarSystemInitializer("haven", {
  name: systemName,
  class: "sc_g",
  preventAnomalies: true,
  asteroidBelt: [{ type: "rocky_asteroid_belt", radius: 90 }],
  planet: [
    { class: "star", orbitDistance: 0, size: 30 },
    {
      name: worldName,
      class: "pc_continental",
      orbitDistance: 60,
      orbitAngle: 35,
      size: 18,
      homePlanet: true,
      moon: [
        {
          name: moonName,
          class: "pc_barren_cold",
          orbitDistance: 12,
          size: 5,
        },
      ],
      initEffect: (planet) => {
        planet.setPlanetFlag("frontier_cartography_haven_world");
      },
    },
  ],
  initEffect: (system) => {
    system.setStarFlag("frontier_cartography_haven_system");
  },
});

export const feature = mod.feature("haven", [systemName, worldName, moonName, haven]);

export default mod.compile([feature]);
