import { createMod } from "@pdx-ts/sdk";
import { and, hasAnomaly, isStar, not } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Aurora Works",
  prefix: "aurora_works",
  supportedVersion: "v4.4.*",
});

const heliograph = mod.megastructure("heliograph", {
  name: "Heliograph Array",
  desc: "A stellar observatory that reads the star as an instrument.",
  details: "Produces an ongoing physics-research bonus while it remains in service.",
  entity: "mega_shipyard_01_stage_1_entity",
  constructionEntity: "mega_shipyard_01_stage_1_entity",
  portrait: "GFX_megastructure_construction_background",
  placeEntityOnPlanetPlane: false,
  buildTime: 1_800,
  resources: [
    {
      category: "megastructures",
      cost: { amounts: { alloys: 5_000, unity: 1_000 } },
      upkeep: { amounts: { energy: 10 } },
    },
  ],
  placementRules: {
    planetPossible: and(isStar(), not(hasAnomaly())),
  },
  countryModifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
  onBuildComplete: (system) => {
    system.setStarFlag("aurora_works_heliograph_complete");
  },
  aiWeight: { base: 10 },
});

export const feature = mod.feature("heliograph", [heliograph]);

export default mod.compile([feature]);
