/**
 * The one question about the scope-link vocabulary that a string can ask.
 *
 * The generated link functions (`src/generated/links.ts`) answer it for an
 * author writing script: `owner(...)` exists, so `owner` is navigation. A tool
 * reading recorded script back out has only the key, and the answer changes
 * what it should say about a key it cannot handle — a scope link is a
 * navigation somebody could model, while a scripted trigger's body is
 * something the SDK never sees and never will. Telling a reader the first is
 * the second sends them looking for a fix that does not exist.
 */

import { SCOPE_LINK_NAVIGATION } from "../generated/link-meta.ts";
import type { ScopeName } from "../generated/scopes.ts";

/**
 * Where the scope link written as `key` navigates to, or `undefined` when
 * `key` is not a scope link at all.
 *
 * `"any"` is the rules' own answer for the links whose output scope is decided
 * at runtime (`target`), not a widening added here — which is also why those
 * links have no generated navigation function to ask instead.
 *
 * Narrow on purpose, for the same reason `isEffectKey` is: the generated
 * table is codegen's shape to change, and exporting it would freeze that shape
 * into the public API to answer one lookup.
 */
export function scopeLinkOutput(key: string): ScopeName | "any" | undefined {
  return SCOPE_LINK_NAVIGATION[key];
}
