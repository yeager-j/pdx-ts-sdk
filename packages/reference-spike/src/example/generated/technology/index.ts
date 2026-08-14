// Generated from packages/reference-spike/content/technology.mdx by src/build/stories.ts. Do not edit.

import * as minimal from "./minimal.ts";
import * as prerequisites from "./prerequisites.ts";
import * as unlocks from "./unlocks.ts";
import * as costCurve from "./cost-curve.ts";
import * as weighting from "./weighting.ts";
import * as swap from "./swap.ts";
import * as recipeStarter from "./recipe-starter.ts";
import { mod as projectMod } from "#mod";

/**
 * Every story, keyed by the id its fence or its Recipe row declared.
 *
 * Each entry exposes the `mod` it built and the `feature` it placed, which
 * is all `synthesizeStories` needs to render one — and is also exactly what a
 * real feature module exports, so the story is shaped like the thing it
 * teaches rather than like a test fixture.
 */
export const STORY_MODULES = {
  "minimal": minimal,
  "prerequisites": prerequisites,
  "unlocks": unlocks,
  "cost-curve": costCurve,
  "weighting": weighting,
  "swap": swap,
  "recipe-starter": { mod: projectMod, feature: recipeStarter.feature },
} as const;
