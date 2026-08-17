import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "My First Mod",
  prefix: "my_mod",
  supportedVersion: "v4.0.*",
});

const resonanceTheory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
});

const resonanceLab = mod.building("resonance_lab", {
  name: "Resonance Lab",
  desc: "A laboratory powered by Resonance Crystals.",
  baseBuildtime: 360,
  category: "research",
  icon: "building_research_lab_1",
  buildingSets: ["research"],
  canBuild: true,
  prerequisites: [resonanceTheory],
  planetModifier: (m) => {
    m.planet.jobs.physics.research.produces.mult(0.1);
  },
});

export const feature = mod.feature("resonance", [resonanceTheory, resonanceLab]);

export default mod.compile([feature]);
