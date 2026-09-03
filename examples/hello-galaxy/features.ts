/**
 * The feature list: every Feature this mod ships, one line each.
 *
 * `index.ts` hands this module to `mod.compile`, so a feature module is in the
 * mod exactly when its line is here. The names are for the reader; the fold
 * derives emission order from content, never from this list's order.
 */

export { feature as amplifiers } from "./features/amplifiers.ts";
export { feature as resonance } from "./features/resonance.ts";
