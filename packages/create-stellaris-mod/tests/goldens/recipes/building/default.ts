/**
 * One building, and the feature that places it.
 *
 * Generated once by the `building` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * `#mod` is the project's own alias for `src/mod.ts` (see `package.json#imports`),
 * so this import never changes when the file moves. The filename decides
 * nothing either: the `mod.feature(...)` call at the bottom is what names the
 * emitted files, and what puts it in the mod is its line in `src/features.ts`.
 */

import { mod } from "#mod";

export const resonanceTheory = mod.building("resonance_theory", {
  name: "Resonance Theory",
  desc: "PLACEHOLDER: what this building does for the colony, in a sentence or two.",
  category: "research",
  // Which planet classes' construction lists this appears in. A building needs
  // at least one set, and `research` groups it with the research buildings.
  buildingSets: ["research"],
  baseBuildtime: 240,
  // What it costs to build, and what it costs to run every month. `amounts` is
  // the wrapper around the resource map — a bare `{ minerals: 300 }` is a
  // compile error rather than a block the game silently ignores.
  resources: [
    {
      category: "planet_buildings",
      cost: { amounts: { minerals: 300 } },
      upkeep: { amounts: { energy: 2 } },
    },
  ],

  // There is no `produces` arm here on purpose. A building gives the colony
  // something back through the jobs and modifiers it grants — `planetModifier`,
  // `countryModifier`, a job of your own — rather than by producing directly.

  // Technologies that must be researched before this can be built. A vanilla
  // technology is a plain string, taken as given — nothing checks a bare
  // literal; `vanilla.technology(...)` from @pdx-ts/sdk/stellaris is the checked form,
  // against the real id set when @pdx-ts/stellaris-ids is installed. One of
  // your own is the binding another feature file exports, imported as usual.
  // prerequisites: ["tech_basic_science_lab_1"],

  // What the colony can replace this with once it is built. Same reference
  // either way: a vanilla building id, or an imported binding of your own.
  // upgrades: ["building_research_lab_2"],
});

export const feature = mod.feature("resonance_theory", [resonanceTheory]);
