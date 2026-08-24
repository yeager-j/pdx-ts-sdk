import { createMod } from "@pdx-ts/sdk";
import { and, hasAnomaly, isStar, not } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Helios Forge",
  prefix: "helios_forge",
  supportedVersion: "v4.4.*",
});

const frame = mod.megastructure("stellar_forge_frame", {
  name: "Stellar Forge Frame",
  desc: "A construction lattice anchored around a star.",
  entity: "construction_platform_entity",
  constructionEntity: "construction_platform_entity",
  portrait: "GFX_megastructure_construction_background",
  placeEntityOnPlanetPlane: false,
  buildTime: 1_800,
  resources: [
    {
      category: "megastructures",
      cost: { amounts: { alloys: 5_000, unity: 1_000 } },
    },
  ],
  placementRules: {
    planetPossible: and(isStar(), not(hasAnomaly())),
  },
});

const foundry = mod.megastructure("stellar_forge_foundry", {
  name: "Stellar Forge",
  desc: "The completed frame draws material from the stellar corona.",
  entity: "dyson_sphere_phase_03_entity",
  constructionEntity: "dyson_sphere_part_2_entity",
  portrait: "GFX_megastructure_construction_background",
  upgradeFrom: [frame],
  buildTime: 3_600,
  resources: [
    {
      category: "megastructures",
      cost: { amounts: { alloys: 10_000, unity: 2_500 } },
      produces: { amounts: { alloys: 250 } },
    },
  ],
  countryModifier: (modifier) => modifier.country.engineering.research.produces.mult(0.05),
});

const researchCore = mod.megastructure("stellar_forge_research_core", {
  name: "Stellar Forge Research Core",
  desc: "The forge is rebuilt as a laboratory for stellar materials.",
  entity: "dyson_sphere_phase_04_entity",
  constructionEntity: "dyson_sphere_part_3_entity",
  portrait: "GFX_megastructure_construction_background",
  upgradeFrom: [foundry],
  buildTime: 3_600,
  resources: [
    {
      category: "megastructures",
      cost: { amounts: { alloys: 12_500, unity: 5_000 } },
      produces: { amounts: { engineering_research: 500 } },
    },
  ],
});

const shipyardCore = mod.megastructure("stellar_forge_shipyard_core", {
  name: "Stellar Forge Shipyard Core",
  desc: "The forge is rebuilt around high-capacity assembly docks.",
  entity: "mega_shipyard_01_stage_3_entity",
  constructionEntity: "mega_shipyard_01_stage_3_entity",
  portrait: "GFX_megastructure_mega_shipyard_background",
  upgradeFrom: [foundry],
  buildTime: 3_600,
  resources: [
    {
      category: "megastructures",
      cost: { amounts: { alloys: 12_500, unity: 5_000 } },
    },
  ],
  countryModifier: (modifier) => modifier.country.naval.cap.add(50),
});

export const feature = mod.feature("stellar_forge", [frame, foundry, researchCore, shipyardCore]);

export default mod.compile([feature]);
