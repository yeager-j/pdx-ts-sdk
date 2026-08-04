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

import { varRef, type PdxScalar } from "@pdx-ts/pdxscript";

import type { ScopeValue } from "./effect-core.ts";
import type { TypedRef } from "./generated/refs.ts";

/** Anything that lowers to one PDXScript scalar. */
export type ScalarArg = string | number | boolean | TypedRef<string> | ScopeValue;

export function toScalar(value: unknown): string | number | boolean | PdxScalar {
  if (typeof value === "object" && value !== null) {
    if ("path" in value) {
      return (value as ScopeValue).path;
    }
    if ("id" in value) {
      return (value as { id: string }).id;
    }
    throw new Error(`Cannot serialize ${JSON.stringify(value)} as an effect argument`);
  }
  // A `@name` scripted-variable reference (a `ScriptValue` argument, e.g.
  // `changeVariable`'s `value`) has to become a `var` node to write bare — see
  // `scriptValueScalar` in `trigger-core.ts`. Effect arguments funnel through
  // this one lowering regardless of which effect they belong to, and no
  // non-`ScriptValue` argument's real domain admits a leading `@`, so the
  // check is safe to apply unconditionally here too.
  if (typeof value === "string" && value.startsWith("@")) {
    return varRef(value);
  }
  return value as string | number | boolean;
}
