/** One half of an `export * as` cycle. */

import { mod } from "./mod.ts";

export const fromA = mod.technology("from_a", {
  name: "From A",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export * as b from "./cycle-b.ts";
