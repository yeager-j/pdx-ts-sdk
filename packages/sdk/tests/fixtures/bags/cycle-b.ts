/** The other half of an `export * as` cycle. */

import { mod } from "./mod.ts";

export const fromB = mod.technology("from_b", {
  name: "From B",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export * as a from "./cycle-a.ts";
