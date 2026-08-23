import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Momentum",
  prefix: "frontier_momentum",
  supportedVersion: "v4.4.*",
});

const researchSurge = mod.staticModifier("research_surge", {
  hostScope: "country",
  name: "Research Surge",
  desc: "A coordinated research drive increases national unity and alloy output.",
  modifiers: (modifier) => {
    modifier.country.unity.produces.mult(0.15);
    modifier.planet.jobs.alloys.produces.mult(0.1);
  },
});

export const feature = mod.feature("research_surge", [researchSurge]);

export default mod.compile([feature]);
