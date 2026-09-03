/** An Item beside a Feature, which a bag of Items must refuse. */

import { mod } from "./mod.ts";

export const gamma = mod.technology("gamma", {
  name: "Gamma",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export const placed = mod.feature("elsewhere", [
  mod.technology("delta", {
    name: "Delta",
    area: "physics",
    tier: 1,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
]);
