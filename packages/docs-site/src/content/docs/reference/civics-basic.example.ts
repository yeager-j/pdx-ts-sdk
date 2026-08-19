import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Civic Stewardship",
  prefix: "civic_stewardship",
  supportedVersion: "v4.4.*",
});

const publicStewardship = mod.civicOrOrigin("public_stewardship", {
  name: "Public Stewardship",
  desc: "Public institutions preserve knowledge for every citizen.",
  icon: "gfx/interface/icons/governments/civics/civic_meritocracy.dds",
  potential: {
    authority: { not: [{ values: ["auth_corporate"] }] },
    ethics: { not: [{ values: ["ethic_gestalt_consciousness"] }] },
  },
  possible: {
    authority: {
      or: [{ values: ["auth_democratic", "auth_oligarchic"] }],
    },
  },
  modifier: (modifier) => modifier.country.unity.produces.mult(0.05),
  cost: 1,
  pickableAtStart: true,
  randomWeight: { base: 10 },
  aiWeight: { base: 10 },
});

export const feature = mod.feature("public_stewardship", [publicStewardship]);

export default mod.compile([feature]);
