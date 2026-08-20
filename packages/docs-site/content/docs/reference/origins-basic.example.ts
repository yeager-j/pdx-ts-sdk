import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Surveyors' Legacy",
  prefix: "surveyors_legacy",
  supportedVersion: "v4.4.*",
});

const surveyorsLegacy = mod.civicOrOrigin("surveyors_legacy", {
  name: "Surveyors' Legacy",
  desc: "Our first explorers mapped the sky long before we could reach it.",
  isOrigin: true,
  icon: "gfx/interface/icons/origins/origins_default.dds",
  picture: "GFX_origin_default",
  potential: { always: true },
  possible: { isNomadic: false },
  modifier: (modifier) => modifier.country.physics.research.produces.mult(0.05),
  randomWeight: { base: 10 },
  aiWeight: { base: 10 },
});

export const feature = mod.feature("surveyors_legacy", [surveyorsLegacy]);

export default mod.compile([feature]);
