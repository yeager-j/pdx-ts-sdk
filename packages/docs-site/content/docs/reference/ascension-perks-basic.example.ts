import { createMod, hasTechnology, numAscensionPerks, vanilla } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Stellar Stewardship",
  prefix: "stellar_stewardship",
  supportedVersion: "v4.4.*",
});

const stellarStewardship = mod.ascensionPerk("stellar_stewardship", {
  name: "Stellar Stewardship",
  desc: "Turn the lessons of distant worlds into a shared planetary purpose.",
  potential: hasTechnology(vanilla.technology("tech_colonization_1")),
  possible: numAscensionPerks(">", 0),
  modifier: (modifier) => modifier.pop.happiness(0.05),
  aiWeight: { base: 10 },
});

export const feature = mod.feature("stellar_stewardship", [stellarStewardship]);

export default mod.compile([feature]);
