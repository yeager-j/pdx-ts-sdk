/**
 * Asking the Recipe Catalog for the source it would write into a project.
 *
 * The spike's other examples are written by hand on the page. This one is not
 * written at all: `create-stellaris-mod` already ships a reviewed starter for
 * a technology, and a Reference page that hand-wrote its own "start here"
 * example would be publishing a second opinion about the same question. So the
 * page renders the Catalog's answer, and the extraction commits it as a module
 * the compiler and the fold both see — the same treatment a fence gets, for
 * the same reason.
 *
 * `generate` is pure and in-process: no filesystem, no terminal, no clock. The
 * import is through the package's `pdx-source` condition, which is the only
 * condition this repository ever resolves workspace packages under, so nothing
 * here reaches across a package boundary by path.
 *
 * This is not the codegen exception. `create-stellaris-mod` is an ordinary
 * workspace dependency with a public entry point, and reading a recipe's output
 * is using that package, not reaching inside it.
 */

import { CATALOG } from "create-stellaris-mod/catalog";

import type { RecipeStorySource } from "./pages.ts";

/** One Recipe's rendered source, and the request that produced it. */
export interface RenderedRecipe {
  readonly id: string;
  readonly title: string;
  /** The command an author would type to get exactly these bytes. */
  readonly command: string;
  /** The file name the scaffolder would write it to. */
  readonly basename: string;
  readonly contents: string;
}

export function renderRecipeStory(story: RecipeStorySource): RenderedRecipe {
  const generated = CATALOG.generate({
    recipeId: story.recipeId,
    name: story.name,
    answers: story.answers,
  });
  const flags = Object.entries(story.answers)
    .map(([key, value]) => ` --${key} ${value}`)
    .join("");
  return {
    id: story.id,
    title: story.title,
    command: `npx create-stellaris-mod generate ${story.recipeId} ${JSON.stringify(story.name)}${flags}`,
    basename: generated.basename,
    contents: generated.contents,
  };
}
