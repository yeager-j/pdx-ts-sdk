/**
 * Turning fenced code — and one Recipe's own output — back into TypeScript the
 * compiler actually sees.
 *
 * This is the load-bearing part of authoring in MDX. A fenced block is a
 * string; TypeScript does not read it, `mod.compile` never runs it, and a story
 * that drifted from the real surface would sit on the page looking authoritative
 * for as long as nobody tried it. That is the Storybook rot failure, and the
 * whole reason this page's examples are worth more than snippets is that they
 * cannot rot.
 *
 * So every story is written out as a real module under
 * `src/example/generated/<page>/`. Those modules are committed, which means the
 * repository's ordinary `npm run typecheck` compiles them with no separate
 * invocation, and a stale extraction shows up as a reviewable diff the same way
 * every other generated artifact in this repo does.
 *
 * Nothing is injected into a fence. It carries its own imports and its own
 * `createMod`, because the code a reader copies has to be the code that ran —
 * a hidden preamble makes the example a lie in a nicer outfit, and for a
 * newcomer the imports are content rather than noise.
 *
 * A Recipe story is the one story with a preamble, and it is not this module's:
 * a scaffolded project's files import their capability from `#mod`, so the
 * Recipe writes that import and the package supplies the module behind it.
 * Rewriting the import to make the file self-contained would have made the page
 * show something the Recipe does not produce, which is the one thing a Recipe
 * example exists to rule out.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePage, type ParsedStory } from "./mdx.ts";
import { storiesPathOf, type ReferencePage } from "./pages.ts";
import { renderRecipeStory, type RenderedRecipe } from "./recipes.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function generatedDirOf(page: ReferencePage): string {
  return path.join(ROOT, storiesPathOf(page));
}

/** Every story a page renders, whichever half of the format produced it. */
export interface PageStorySources {
  readonly fences: readonly ParsedStory[];
  readonly recipes: readonly RenderedRecipe[];
}

export function storySourcesOf(page: ReferencePage): PageStorySources {
  return {
    fences: parsePage(page).stories,
    recipes: page.recipeStories.map(renderRecipeStory),
  };
}

function fenceModule(page: ReferencePage, story: ParsedStory): string {
  return (
    `// Extracted from ${page.mdxPath}:${story.line} by src/build/stories.ts. Do not edit.\n` +
    `// Edit the fenced \`story="${story.id}"\` block in that file and re-run:\n` +
    "//   npm run stories -w @pdx-ts/reference-spike\n\n" +
    story.code
  );
}

function recipeModule(recipe: RenderedRecipe): string {
  return (
    `// Rendered by the \`${recipe.id}\` Recipe story, through the Recipe Catalog's own\n` +
    "// `generate`, by src/build/stories.ts. Do not edit — everything below the\n" +
    "// header is the Catalog's bytes, unchanged, and re-running the extraction\n" +
    "// overwrites it:\n" +
    `//   ${recipe.command}\n` +
    "//   npm run stories -w @pdx-ts/reference-spike\n\n" +
    recipe.contents
  );
}

function identifier(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
}

/**
 * The page's story map, as a module the fold can import.
 *
 * A fence exports both halves `synthesizeStories` needs — the capability it
 * built and the feature it placed — because it wrote both. A Recipe's file
 * exports only the feature: its capability came from `#mod`, which is the whole
 * point of the alias. So the index pairs it back up here, which keeps the
 * synthesizer ignorant of where a story came from.
 */
function indexModule(page: ReferencePage, sources: PageStorySources): string {
  const imports = [
    ...sources.fences.map(
      (story) => `import * as ${identifier(story.id)} from "./${story.id}.ts";`
    ),
    ...sources.recipes.map(
      (recipe) => `import * as ${identifier(recipe.id)} from "./${recipe.id}.ts";`
    ),
  ];
  if (sources.recipes.length > 0) {
    imports.push('import { mod as projectMod } from "#mod";');
  }
  const rows = [
    ...sources.fences.map((story) => `  ${JSON.stringify(story.id)}: ${identifier(story.id)},`),
    ...sources.recipes.map(
      (recipe) =>
        `  ${JSON.stringify(recipe.id)}: { mod: projectMod, feature: ${identifier(recipe.id)}.feature },`
    ),
  ];
  return (
    `// Generated from ${page.mdxPath} by src/build/stories.ts. Do not edit.\n\n` +
    `${imports.join("\n")}\n\n` +
    "/**\n" +
    " * Every story, keyed by the id its fence or its Recipe row declared.\n" +
    " *\n" +
    " * Each entry exposes the `mod` it built and the `feature` it placed, which\n" +
    " * is all `synthesizeStories` needs to render one — and is also exactly what a\n" +
    " * real feature module exports, so the story is shaped like the thing it\n" +
    " * teaches rather than like a test fixture.\n" +
    " */\n" +
    "export const STORY_MODULES = {\n" +
    `${rows.join("\n")}\n` +
    "} as const;\n"
  );
}

/** What the extraction should produce for one page, as file name to contents. */
function plan(page: ReferencePage, sources: PageStorySources): Map<string, string> {
  const files = new Map<string, string>();
  for (const story of sources.fences) {
    files.set(`${story.id}.ts`, fenceModule(page, story));
  }
  for (const recipe of sources.recipes) {
    files.set(`${recipe.id}.ts`, recipeModule(recipe));
  }
  files.set("index.ts", indexModule(page, sources));
  return files;
}

/**
 * The one file above the per-page directories: which pages have stories at all.
 *
 * Generated rather than written, because it is a restatement of `PAGES` and a
 * restatement somebody maintains by hand is one that goes out of step on the
 * day a third page is added.
 */
function rootIndexModule(pages: readonly ReferencePage[]): string {
  return (
    "// Generated from src/build/pages.ts by src/build/stories.ts. Do not edit.\n\n" +
    pages
      .map(
        (page) => `import { STORY_MODULES as ${identifier(page.id)} } from "./${page.id}/index.ts";`
      )
      .join("\n") +
    "\n\n" +
    "/** Every page's stories, keyed by page id. */\n" +
    "export const PAGE_STORY_MODULES = {\n" +
    pages.map((page) => `  ${JSON.stringify(page.id)}: ${identifier(page.id)},`).join("\n") +
    "\n} as const;\n"
  );
}

function rootIndexFile(): string {
  return path.join(ROOT, "packages/reference-spike/src/example/generated/index.ts");
}

function currentFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of names.filter((entry) => entry.endsWith(".ts"))) {
    files.set(name, readFileSync(path.join(dir, name), "utf8"));
  }
  return files;
}

export interface ExtractionResult {
  readonly page: ReferencePage;
  readonly sources: PageStorySources;
  /** File names that would change, empty when the extraction is current. */
  readonly stale: readonly string[];
}

function staleFiles(expected: Map<string, string>, actual: Map<string, string>): string[] {
  return [
    ...[...expected]
      .filter(([name, contents]) => actual.get(name) !== contents)
      .map(([name]) => name),
    ...[...actual.keys()].filter((name) => !expected.has(name)),
  ].sort();
}

/** Compares one page's committed modules against its sources, writing nothing. */
export function checkStories(page: ReferencePage): ExtractionResult {
  const sources = storySourcesOf(page);
  return {
    page,
    sources,
    stale: staleFiles(plan(page, sources), currentFiles(generatedDirOf(page))),
  };
}

/** Rewrites one page's generated directory, pruning modules whose source is gone. */
export function writeStories(page: ReferencePage): ExtractionResult {
  const sources = storySourcesOf(page);
  const expected = plan(page, sources);
  const dir = generatedDirOf(page);
  mkdirSync(dir, { recursive: true });
  for (const name of currentFiles(dir).keys()) {
    if (!expected.has(name)) {
      rmSync(path.join(dir, name));
    }
  }
  for (const [name, contents] of expected) {
    writeFileSync(path.join(dir, name), contents, "utf8");
  }
  return { page, sources, stale: [] };
}

/** True when the committed page index still names exactly the pages that exist. */
export function rootIndexIsStale(pages: readonly ReferencePage[]): boolean {
  let current = "";
  try {
    current = readFileSync(rootIndexFile(), "utf8");
  } catch {
    return true;
  }
  return current !== rootIndexModule(pages);
}

export function writeRootIndex(pages: readonly ReferencePage[]): void {
  writeFileSync(rootIndexFile(), rootIndexModule(pages), "utf8");
}
