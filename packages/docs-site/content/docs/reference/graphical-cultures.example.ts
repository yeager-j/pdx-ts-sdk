import { createMod } from "@pdx-ts/sdk";
import { always, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Frontier Forms",
  prefix: "frontier_forms",
  supportedVersion: "v4.4.*",
});

const frontierCulture = mod.graphicalCulture("frontier", {
  fallback: vanilla.graphicalCulture("mammalian_01"),
  shipColor: true,
  shipKinds: ["default_ship"],
  randomized: always(),
  selectable: always(),
  shipSelectionWeight: { base: 10 },
  shipLighting: {
    camLight1Dir: [0.6, -0.2, 0.1],
    camLight2Dir: [-0.4, 0, 0],
    camLight3Dir: [0.4, -1, -0.1],
    intensityNear: 1,
    intensityFar: 5,
    nearValue: 100,
    farValue: 4000,
    ambientNear: 0.1,
    ambientFar: 0,
  },
});

export const feature = mod.feature("frontier", [frontierCulture]);

export default mod.compile([feature]);
