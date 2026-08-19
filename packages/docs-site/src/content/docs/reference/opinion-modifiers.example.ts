import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Diplomacy",
  prefix: "frontier_diplomacy",
  supportedVersion: "v4.4.*",
});

const frontierAid = mod.opinionModifier("frontier_aid", {
  name: "Frontier Aid",
  opinion: 40,
  decay: 1,
  unique: true,
});

export const feature = mod.feature("frontier_opinion", [frontierAid]);

export default mod.compile([feature]);
