/** One Item under two export names: one binding, one placement. */

import { mod } from "./mod.ts";

export const epsilon = mod.technology("epsilon", {
  name: "Epsilon",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export { epsilon as alsoEpsilon };
