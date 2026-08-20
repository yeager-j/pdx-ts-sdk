import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Adaptive Science",
  prefix: "adaptive_science",
  supportedVersion: "v4.4.*",
});

const spectralAnalysis = mod.technology("spectral_analysis", {
  name: "Spectral Analysis",
  desc: "New instruments separate the faint signatures hidden in starlight.",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 1_000,
  weight: 100,
});

export const feature = mod.feature("spectral_analysis", [spectralAnalysis]);

export default mod.compile([feature]);
