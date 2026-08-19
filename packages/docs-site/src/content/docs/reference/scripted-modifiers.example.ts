import { createMod } from "@pdx-ts/sdk";

const mod = createMod({
  name: "Frontier Metrics",
  prefix: "frontier_metrics",
  supportedVersion: "v4.4.*",
});

const expeditionOutput = mod.scriptedModifier("expedition_output_mult", {
  name: "Expedition Output",
  percentage: true,
  maxDecimals: 1,
  good: true,
  category: "country",
});

export const feature = mod.feature("expedition_metrics", [expeditionOutput]);

export default mod.compile([feature]);
