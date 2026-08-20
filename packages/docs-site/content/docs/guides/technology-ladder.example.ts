import { createMod, type TechnologyItem } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Luminous Cartography",
  prefix: "luminous_cartography",
  supportedVersion: "v4.4.*",
});

const spectralSurveying = mod.technology("spectral_surveying", {
  name: "Spectral Surveying",
  desc: "Every star leaves a signature for those patient enough to measure it.",
  cost: 1000,
  area: "physics",
  tier: 1,
  category: "particles",
  weight: 100,
});

const CALIBRATIONS = ["Prismatic", "Harmonic", "Coherent", "Quantum", "Transcendent"] as const;

const observatories: TechnologyItem[] = [];
let previous: TechnologyItem = spectralSurveying;

for (const [index, calibration] of CALIBRATIONS.entries()) {
  const level = index + 1;
  previous = mod.technology(`observatory_${level}`, {
    name: `${calibration} Observatory Arrays`,
    desc: `Generation ${level} instruments refine the empire's spectral maps.`,
    cost: 1000 * 2 ** level,
    area: "physics",
    tier: Math.min(level + 1, 5),
    category: "particles",
    prerequisites: [previous],
    weight: 100 - 10 * level,
  });
  observatories.push(previous);
}

export default mod.compile([mod.feature("observatories", [spectralSurveying, ...observatories])]);
