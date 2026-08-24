import { createMod } from "@pdx-ts/sdk";
import { vanilla, type PlanetClassRef } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Frontier Cartography",
  prefix: "frontier_cartography",
  supportedVersion: "v4.4.*",
});

const starWithPlanet = (
  orbitDistance: number,
  orbitAngle: number,
  planetClass: PlanetClassRef
) => ({
  class: vanilla.planetClass("pc_g_star"),
  orbitDistance,
  orbitAngle,
  size: 22,
  planet: [
    {
      class: planetClass,
      orbitDistance: 35,
      size: 12,
    },
  ],
});

const umbraTrine = mod.solarSystemInitializer("umbra_trine", {
  class: vanilla.starClass("sc_black_hole"),
  planet: [
    {
      class: vanilla.planetClass("pc_black_hole"),
      orbitDistance: 0,
      size: 30,
      planet: [
        starWithPlanet(65, 0, vanilla.planetClass("pc_barren")),
        starWithPlanet(45, 120, vanilla.planetClass("pc_desert")),
        starWithPlanet(45, 120, vanilla.planetClass("pc_frozen")),
      ],
    },
  ],
});

export const feature = mod.feature("umbra_trine", [umbraTrine]);

export default mod.compile([feature]);
