import type { PureMod } from "@pdx-ts/sdk";

import * as features from "./features.ts";
import { mod } from "./mod.ts";

/**
 * The whole mod, from its declared feature list.
 *
 * `mod.compile` is the fold: capability-owned features in, an assembled value
 * out. Nothing is written and nothing is serialized until `render`/`write`.
 *
 * This module is the one that imports both `mod.ts` and the feature modules.
 * The feature modules import `mod` themselves, so `mod.ts` cannot import them
 * back without evaluating them before `mod` exists.
 */
export function defineHelloGalaxy(): PureMod {
  return mod.compile(features);
}
