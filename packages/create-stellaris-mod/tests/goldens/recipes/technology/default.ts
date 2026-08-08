/**
 * One technology, and the feature that places it.
 *
 * Generated once by the `technology` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the `mod.feature(...)` call at the
 * bottom is what names the emitted files.
 */

import { mod } from "#mod";

export const resonanceTheory = mod.technology("resonance_theory", {
  name: "Resonance Theory",
  desc: "PLACEHOLDER: what researching this unlocks, in a sentence or two.",
  area: "physics",
  category: "particles",
  tier: 1,
  cost: 2000,

  // Technologies that have to be researched first. Every feature file exports
  // its items, so import one and list it here:
  //
  //   import { plasmaWeapons } from "./plasma_weapons.ts";
  //   prerequisites: [plasmaWeapons],

  // How likely the game is to offer this as a research option next to the
  // others in its category. 100 is the conventional starting weight.
  // weight: 100,
});

export const feature = mod.feature("resonance_theory", [resonanceTheory]);
