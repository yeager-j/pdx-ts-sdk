/**
 * Re-extracts every page's stories, or checks the committed modules are current.
 *
 *   npm run stories -w @pdx-ts/reference-spike            rewrites them
 *   npm run stories:check -w @pdx-ts/reference-spike      fails if stale
 */

import { PAGES, storiesPathOf } from "./pages.ts";
import { checkStories, rootIndexIsStale, writeRootIndex, writeStories } from "./stories.ts";

if (process.argv.includes("--check")) {
  const stale = PAGES.flatMap((page) =>
    checkStories(page).stale.map((name) => `${storiesPathOf(page)}/${name}`)
  );
  if (rootIndexIsStale(PAGES)) {
    stale.push("packages/reference-spike/src/example/generated/index.ts");
  }
  if (stale.length > 0) {
    console.error(
      `these extracted story modules no longer match their sources: ${stale.join(", ")}\n` +
        "Re-extract and commit the result:\n" +
        "  npm run stories -w @pdx-ts/reference-spike"
    );
    process.exit(1);
  }
  console.log("Extracted stories are current.");
} else {
  for (const page of PAGES) {
    const { sources } = writeStories(page);
    const total = sources.fences.length + sources.recipes.length;
    console.log(`wrote ${total} stories to ${storiesPathOf(page)}/`);
    for (const story of sources.fences) {
      console.log(`  ${story.id} — ${story.title}`);
    }
    for (const recipe of sources.recipes) {
      console.log(`  ${recipe.id} — ${recipe.title} (Recipe)`);
    }
  }
  writeRootIndex(PAGES);
}
