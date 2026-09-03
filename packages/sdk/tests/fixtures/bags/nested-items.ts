/** Reached through `export * as nested` from `items.ts`. */

import { mod } from "./mod.ts";

export const deep = mod.technology("deep", {
  name: "Deep",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export const nestedNote = "not an item either";
