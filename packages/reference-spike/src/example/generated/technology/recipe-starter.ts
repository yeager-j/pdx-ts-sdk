// Rendered by the `recipe-starter` Recipe story, through the Recipe Catalog's own
// `generate`, by src/build/stories.ts. Do not edit — everything below the
// header is the Catalog's bytes, unchanged, and re-running the extraction
// overwrites it:
//   npx create-stellaris-mod generate technology "Filament Weaving"
//   npm run stories -w @pdx-ts/reference-spike

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

export const filamentWeaving = mod.technology("filament_weaving", {
  name: "Filament Weaving",
  desc: "PLACEHOLDER: what researching this unlocks, in a sentence or two.",
  area: "physics",
  category: "particles",
  tier: 2,
  cost: 2000,

  // Technologies that must be researched first. A vanilla technology is a plain
  // string, taken as given — nothing checks a bare literal;
  // `vanilla.technology(...)` from @pdx-ts/sdk is the checked form, against the
  // real id set when @pdx-ts/stellaris-ids is installed. One of your own is the
  // binding another feature file exports, imported as usual.
  // prerequisites: ["tech_basic_science_lab_1"],

  // How likely the game is to offer this as a research option next to the
  // others in its category. 100 is the conventional starting weight.
  // weight: 100,
});

export const feature = mod.feature("filament_weaving", [filamentWeaving]);
