/** The two capabilities the bag fixtures mint from: one under test, one foreign to it. */

import { createMod } from "../../../src/index.ts";

export const mod = createMod({
  name: "Feature bags",
  prefix: "feature_bags",
  supportedVersion: "4.4.*",
});

export const otherMod = createMod({
  name: "Other bags",
  prefix: "other_bags",
  supportedVersion: "4.4.*",
});
