/**
 * A module the declared feature imports for a helper, that also mints a
 * Feature of its own. An import reaches it, so knip is silent about it; only
 * the build can see that its Feature is not in the list.
 */

import { mod } from "./project.ts";

export const TIER = 1;

export const feature = mod.feature("helper", [
  mod.technology("helper", {
    name: "Helper",
    area: "physics",
    tier: TIER,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
]);
