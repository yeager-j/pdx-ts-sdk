import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Directives",
  prefix: "frontier_directives",
  supportedVersion: "v4.4.*",
});

const frontierLogistics = mod.edict("frontier_logistics", {
  name: "Frontier Logistics",
  description: "Maintain supply lines across the outer systems.",
  length: -1,
  icon: "GFX_edict_type_policy",
  resources: [
    {
      category: "edicts",
      upkeep: { amounts: { unity: 2 } },
    },
  ],
  modifier: (modifier) => modifier.country.naval.cap.add(10),
  aiWeight: { base: 10 },
});

export const feature = mod.feature("frontier_edict", [frontierLogistics]);

export default mod.compile([feature]);
