import { createMod, vanilla } from "@pdx-ts/sdk";
import { giveTechOptionOrProgressEffect } from "@pdx-ts/stellaris-ids/effects";
import { isRegularEmpire } from "@pdx-ts/stellaris-ids/triggers";

const mod = createMod({
  name: "Luminous Cartography",
  prefix: "luminous_cartography",
  supportedVersion: "v4.0.*",
});

const spectralSurveying = mod.technology("spectral_surveying", {
  name: "Spectral Surveying",
  desc: "New instruments reveal the faint contours between familiar stars.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "computing",
  weight: 100,
});

const observatoryNetworks = mod.technology("observatory_networks", {
  name: "Observatory Networks",
  desc: "Linked observatories turn scattered readings into a map of the unseen.",
  cost: 4000,
  area: "physics",
  tier: 3,
  category: "computing",
  prerequisites: [spectralSurveying, vanilla.technology("tech_lasers_1")],
  potential: isRegularEmpire(),
  weight: 80,
});

const events = mod.namespace("discovery");

const patternEmerges = events.country(1, {
  title: "A Pattern Emerges",
  desc: "Our observatories agree: the darkness between the stars has structure.",
  isTriggeredOnly: true,
  immediate: (country) => {
    country.run(giveTechOptionOrProgressEffect({ TECH: observatoryNetworks }));
  },
  options: [{ name: "Follow every thread.", key: "follow_every_thread" }],
});

export default mod.compile([
  mod.feature("cartography", [spectralSurveying, observatoryNetworks, patternEmerges]),
]);
