import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Crystal Resonance",
  prefix: "crystal_resonance",
  supportedVersion: "v4.0.*",
});

const resonanceTheory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  desc: "The lattice hums at frequencies we are only beginning to hear.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

export default mod.compile([mod.feature("resonance", [resonanceTheory])]);
