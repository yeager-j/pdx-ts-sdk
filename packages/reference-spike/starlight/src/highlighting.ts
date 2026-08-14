/**
 * Build-time syntax highlighting, kept where the browser cannot reach it.
 *
 * This is a separate module from `builds.ts` because of a defect the port
 * shipped and the bundle size caught. `coloursOf` lived beside `BUILDS`, which
 * read well — one module, everything a page needs about a page. But
 * `ReferenceSearch.tsx` is a hydrated island, `builds.ts` was in its import
 * graph, and a bundler follows imports rather than intentions: Shiki came with
 * it, and Shiki brings every TextMate grammar it ships. The client bundle was
 * **9.4 MB** — emacs-lisp, wolfram, angular-ts, wasm — on a page that renders
 * TypeScript, PDXScript and Stellaris localization.
 *
 * The first viewer could not make this mistake. Its highlighting was behind a
 * Vite virtual module whose `load` hook runs in Node and returns a JSON string,
 * so there was no import edge for a bundler to follow. Astro removed the need
 * for that bridge — an `.astro` component runs in Node and can simply await
 * this — and in removing it, removed the wall that made the mistake impossible.
 * A plain module boundary is the replacement, and it is weaker: nothing stops
 * the next island from importing this file except knowing not to.
 *
 * Only `.astro` components may import this. `tests/pages.test.ts` holds that.
 */

import { highlightStories, type HighlightedStory } from "../../src/build/highlight.ts";
import { BUILDS } from "./builds.ts";

/**
 * Every page's stories, highlighted once.
 *
 * Still a derived viewer asset, still absent from the committed snapshot: a
 * diff full of `<span style="--shiki-light:#…">` is a diff nobody can review,
 * and the same build rendered in different colours is the same build.
 */
const highlighted = (async (): Promise<Record<string, Record<string, HighlightedStory>>> => {
  const byPage: Record<string, Record<string, HighlightedStory>> = {};
  for (const [page, build] of Object.entries(BUILDS)) {
    byPage[page] = await highlightStories(build.stories);
  }
  return byPage;
})();

export async function coloursOf(
  page: string,
  story: string
): Promise<HighlightedStory | undefined> {
  return (await highlighted)[page]?.[story];
}
