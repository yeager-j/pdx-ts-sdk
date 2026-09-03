/**
 * One technology, and the feature that places it.
 *
 * Generated once by the `technology` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so this import never changes when the file moves. The filename decides
 * nothing either: the `mod.feature(...)` call at the bottom is what names the
 * emitted files, and what puts it in the mod is its line in `src/features.ts`.
 */

import { mod } from "#mod";

export const resonanceTheory = mod.technology("resonance_theory", {
  name: "Resonance Theory",
  desc: "PLACEHOLDER: what researching this unlocks, in a sentence or two.",
  area: "physics",
  category: "particles",
  tier: 2,
  cost: 2000,

  // Technologies that must be researched first. A vanilla technology is a plain
  // string, taken as given — nothing checks a bare literal;
  // `vanilla.technology(...)` from @pdx-ts/sdk/stellaris is the checked form, against the
  // real id set when @pdx-ts/stellaris-ids is installed. One of your own is the
  // binding another feature file exports, imported as usual.
  // prerequisites: ["tech_basic_science_lab_1"],

  // How likely the game is to offer this as a research option next to the
  // others in its category. 100 is the conventional starting weight, and the
  // rules require one on every technology that is not a starting technology.
  weight: 100,
});

export const feature = mod.feature("resonance_theory", [resonanceTheory]);
