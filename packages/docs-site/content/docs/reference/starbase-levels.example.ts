import { createMod } from "@pdx-ts/sdk";
import { always, vanilla } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Relay Bastions",
  prefix: "relay_bastions",
  supportedVersion: "v4.4.*",
});

const relayBastion = mod.starbaseLevel("bastion", {
  shipSize: vanilla.shipSize("starbase_starhold"),
  levelWeight: 2,
  aiWeight: { base: 3 },
  starbaseCapacityUsed: 1,
  potentialHomeBase: true,
  collectsTrade: true,
  upgradePossible: always(),
  downgradePotential: always(),
  moduleSlots: [1, 2, 3, 4],
  buildingSlots: [1, 2],
});

const relayPort = mod.starbaseLevel("port", {
  shipSize: vanilla.shipSize("starbase_starport"),
  nextLevel: relayBastion,
  levelWeight: 1,
  aiWeight: { base: 2 },
  starbaseCapacityUsed: 1,
  potentialHomeBase: true,
  collectsTrade: true,
  upgradePossible: always(),
  downgradePotential: always(),
  moduleSlots: [1, 2],
  buildingSlots: [1],
});

export const feature = mod.feature("relay_levels", [relayPort, relayBastion]);

export default mod.compile([feature]);
