/**
 * Compiling and rendering every story, in memory.
 *
 * This is the second half of what makes a fenced block a Verified example
 * rather than a snippet. Extraction gets the code in front of the compiler;
 * this runs it. A story that typechecks but throws during the fold, or emits
 * nothing, fails here.
 *
 * Nothing touches disk. An example that needed a build directory to be checked
 * would eventually stop being checked.
 */

import { render, type PureMod } from "@pdx-ts/sdk";

import { PAGE_STORY_MODULES } from "./generated/index.ts";

/**
 * The shape every story module has, with its two type parameters erased.
 *
 * Each story builds its own capability with its own literal prefix, so
 * `ModCapability<P, I>` is a different type in each one and there is no
 * instantiation they all satisfy. The cast is confined to this line, and the
 * property it asserts — that a story exports the `mod` it built and the
 * `feature` it placed — is exactly what the generated index's doc comment
 * promises and what `storiesExportTheRightShape` below checks at runtime.
 */
interface StoryModule {
  readonly mod: { compile(features: readonly never[]): PureMod };
  readonly feature: never;
}

function renderFiles(compiled: PureMod): Record<string, string> {
  const rendered = render(compiled);
  const files: Record<string, string> = {};
  for (const filePath of [...rendered.keys()].sort()) {
    const text = rendered.text(filePath);
    if (text !== undefined) {
      files[filePath] = text;
    }
  }
  return files;
}

/** One page's story output, keyed by story id then by logical path. */
export function synthesizeStories(pageId: string): Record<string, Record<string, string>> {
  const modules = (PAGE_STORY_MODULES as Record<string, Record<string, unknown>>)[pageId];
  if (modules === undefined) {
    throw new Error(
      `no extracted stories exist for the page "${pageId}" — run ` +
        "`npm run stories -w @pdx-ts/reference-spike` and commit the result"
    );
  }
  const outputs: Record<string, Record<string, string>> = {};
  for (const [id, module] of Object.entries(modules)) {
    const story = module as unknown as StoryModule;
    if (story.mod === undefined || story.feature === undefined) {
      throw new Error(
        `story "${id}" does not expose both \`mod\` and \`feature\` — the page renders a story ` +
          "by compiling what it exported, so a story with neither has nothing to show"
      );
    }
    outputs[id] = renderFiles(story.mod.compile([story.feature]));
  }
  return outputs;
}

/** The pages that have extracted stories at all. */
export const STORY_PAGE_IDS: readonly string[] = Object.keys(PAGE_STORY_MODULES);

/**
 * What the fold said about each story, keyed by story id.
 *
 * The SDK reports diagnostics as `mod.warnings` data rather than as console
 * output, which means a story can teach something the build already knows is
 * wrong and nothing on the page will say so. It happened while this page was
 * being written: an unlock line's `title` is a localization key, English was
 * written into it, the definition built, and the only complaint was in a list
 * nobody was reading.
 *
 * Recorded rather than thrown on, because the two pages disagree about whether
 * a warning is a defect and only a person can say which. `tests/stories.test.ts`
 * is where that judgment lives.
 */
export function storyWarnings(pageId: string): Record<string, readonly string[]> {
  const modules = (PAGE_STORY_MODULES as Record<string, Record<string, unknown>>)[pageId] ?? {};
  const warnings: Record<string, readonly string[]> = {};
  for (const [id, module] of Object.entries(modules)) {
    const story = module as unknown as StoryModule;
    warnings[id] = story.mod
      .compile([story.feature])
      .warnings.map((warning) => `${warning.code}: ${warning.message}`);
  }
  return warnings;
}
