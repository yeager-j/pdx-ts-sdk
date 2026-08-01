/**
 * Trigger builders.
 *
 * The 889 leaf conditions below are generated from the cwtools rules and the
 * game's own documentation dump — see `tools/codegen`. Only the combinators are
 * hand-written, because they are the shape of the condition tree rather than
 * conditions themselves: the rules have no way to say "this one flattens its
 * operands" or "this one infers the scope intersection of its arguments".
 */

import { block } from "@pdx-ts/pdxscript";

import type { ScopeName } from "./generated/scopes.ts";
import { trigger, type Trigger } from "./trigger-core.ts";

export type { ScopeName } from "./generated/scopes.ts";
export { trigger, type Trigger } from "./trigger-core.ts";
export * from "./generated/triggers.ts";
export * from "./generated/links.ts";

export function and<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger([
    block(
      "AND",
      triggers.flatMap((t) => [...t.entries])
    ),
  ]);
}

export function or<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger([
    block(
      "OR",
      triggers.flatMap((operand) =>
        operand.entries.length === 1 ? [...operand.entries] : [block("AND", [...operand.entries])]
      )
    ),
  ]);
}

export function not<S extends ScopeName>(condition: Trigger<S>): Trigger<S> {
  return trigger([block("NOT", [...condition.entries])]);
}

/**
 * The `target` scope link: a situation's (or spy network's, espionage
 * operation's, agreement's) target. Its landing scope varies per definition
 * (`output_scope = any`) and is declared nowhere the SDK can read, so — unlike
 * the generated links — the author asserts it: `target<"planet">(hasOwner())`.
 */
export function target<S extends ScopeName>(
  condition: Trigger<S>
): Trigger<"agreement" | "espionage_operation" | "situation" | "spy_network"> {
  return trigger([block("target", [...condition.entries])]);
}
