// Generated from packages/reference-spike/content/situations.mdx by src/build/stories.ts. Do not edit.

import * as complete from "./complete.ts";
import * as minimal from "./minimal.ts";
import * as stages from "./stages.ts";
import * as approaches from "./approaches.ts";
import * as gatedApproach from "./gated-approach.ts";
import * as progress from "./progress.ts";
import * as typedStart from "./typed-start.ts";
import * as sectionWeights from "./section-weights.ts";

/**
 * Every story, keyed by the id its fence or its Recipe row declared.
 *
 * Each entry exposes the `mod` it built and the `feature` it placed, which
 * is all `synthesizeStories` needs to render one — and is also exactly what a
 * real feature module exports, so the story is shaped like the thing it
 * teaches rather than like a test fixture.
 */
export const STORY_MODULES = {
  "complete": complete,
  "minimal": minimal,
  "stages": stages,
  "approaches": approaches,
  "gated-approach": gatedApproach,
  "progress": progress,
  "typed-start": typedStart,
  "section-weights": sectionWeights,
} as const;
