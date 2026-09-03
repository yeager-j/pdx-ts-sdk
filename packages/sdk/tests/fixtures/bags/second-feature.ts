/** A feature module placing its Items from an array. */

import { mod } from "./mod.ts";

export const feature = mod.feature("second", [
  mod.technology("zeta", {
    name: "Zeta",
    area: "physics",
    tier: 1,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
]);
