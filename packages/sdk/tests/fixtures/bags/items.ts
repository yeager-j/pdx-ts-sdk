/**
 * A module namespace as `mod.feature` receives it: Items beside ordinary
 * module API, a nested namespace, and a plain object that holds an Item.
 */

import { mod } from "./mod.ts";

export const alpha = mod.technology("alpha", {
  name: "Alpha",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export const beta = mod.technology("beta", {
  name: "Beta",
  area: "physics",
  tier: 1,
  category: "particles",
  cost: 100,
  weight: 100,
});

export const note = "module API, not an item";

export function helper(): string {
  return note;
}

/** Not walked: an object literal is a value the author built, not a module. */
export const holder = {
  hidden: mod.technology("hidden", {
    name: "Hidden",
    area: "physics",
    tier: 1,
    category: "particles",
    cost: 100,
    weight: 100,
  }),
};

export * as nested from "./nested-items.ts";
