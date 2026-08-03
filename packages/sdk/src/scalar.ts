/**
 * Lowering an authored argument value to a PDXScript scalar.
 *
 * A branded reference (`vanilla.technology("tech_lasers_1")`) and a scope
 * reference (`eventTarget<"planet">("colony")`) are objects at authoring time
 * and one bare word in the output. Every place that takes an argument has to
 * unwrap them the same way, so the unwrapping lives here rather than in
 * whichever module happened to need it first — the effect recorder and the
 * scripted trigger/effect bindings both do.
 */

import type { ScopeRef } from "./effect-core.ts";
import type { TypedRef } from "./generated/refs.ts";

/** Anything that lowers to one PDXScript scalar. */
export type ScalarArg = string | number | boolean | TypedRef<string> | ScopeRef;

export function toScalar(value: unknown): string | number | boolean {
  if (typeof value === "object" && value !== null) {
    if ("path" in value) {
      return (value as ScopeRef).path;
    }
    if ("id" in value) {
      return (value as { id: string }).id;
    }
    throw new Error(`Cannot serialize ${JSON.stringify(value)} as an effect argument`);
  }
  return value as string | number | boolean;
}
