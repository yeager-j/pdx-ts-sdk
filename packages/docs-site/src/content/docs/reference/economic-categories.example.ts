import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Economy",
  prefix: "frontier_economy",
  supportedVersion: "v4.4.*",
});

const expeditions = mod.economicCategory("expeditions", {
  useForAiBudget: true,
  modifierCategory: "country",
  generateAddModifiers: ["produces"],
  generateMultModifiers: ["cost", "produces", "upkeep"],
});

export const feature = mod.feature("expedition_economy", [expeditions]);

export default mod.compile([feature]);
