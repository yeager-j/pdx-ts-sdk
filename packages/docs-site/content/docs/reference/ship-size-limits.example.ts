import { createMod } from "@pdx-ts/sdk";
import { isScopeValid } from "@pdx-ts/sdk/stellaris";

const mod = createMod({
  name: "Dreadnought Doctrine",
  prefix: "dreadnought_doctrine",
  supportedVersion: "v4.4.*",
});

const dreadnought = mod.shipSize("dreadnought", {
  name: "Dreadnought",
  plural: "Dreadnoughts",
  entity: "battleship_entity",
  class: "shipclass_military",
  isDesignable: false,
  isListed: false,
  sizeMultiplier: 60,
  sectionSlots: {
    bow: { locator: ["part1"] },
    mid: { locator: ["part2"] },
    stern: { locator: ["part3"] },
  },
});

const dreadnoughtLimit = mod.countryShipOfSizeLimit("dreadnoughts", {
  shipTypes: [dreadnought],
  base: 60, // one Dreadnought: 1 * the hull's sizeMultiplier
  max: 600, // ten Dreadnoughts
  navalCapFraction: 0.1,
  show: isScopeValid(),
});

const applyDreadnoughtLimit = mod.addShipOfSizeLimits([dreadnoughtLimit]);

export const feature = mod.feature("dreadnought_limit", [
  dreadnought,
  dreadnoughtLimit,
  applyDreadnoughtLimit,
]);

export default mod.compile([feature]);
