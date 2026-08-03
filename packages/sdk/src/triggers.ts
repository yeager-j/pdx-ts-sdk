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

/** Operand references travel with the combinator: a technology named inside an
 * `and(...)` is referenced just as surely as one named at the top level. */
function operandRefs<S extends ScopeName>(triggers: readonly Trigger<S>[]) {
  return triggers.flatMap((operand) => [...operand.refs]);
}

export function and<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "AND",
        triggers.flatMap((t) => [...t.entries])
      ),
    ],
    operandRefs(triggers)
  );
}

export function or<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "OR",
        triggers.flatMap((operand) =>
          operand.entries.length === 1 ? [...operand.entries] : [block("AND", [...operand.entries])]
        )
      ),
    ],
    operandRefs(triggers)
  );
}

export function not<S extends ScopeName>(condition: Trigger<S>): Trigger<S> {
  return trigger([block("NOT", [...condition.entries])], [...condition.refs]);
}

/**
 * Hides the enclosed conditions from generated tooltips: `hidden_trigger = { ... }`.
 *
 * Tooltip visibility, not logic — the conditions still have to hold, and the
 * block changes no scope, so `this`, `from`, and `root` inside it are what
 * they are outside it. That is why it takes conditions rather than a closure:
 * there is no new scope to hand anyone, and a trigger is a value.
 *
 * Operands splice in flat, the way the game writes them, so `hiddenTrigger(a, b)`
 * is `hidden_trigger = { a b }` rather than a nested `AND`.
 */
export function hiddenTrigger<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "hidden_trigger",
        triggers.flatMap((t) => [...t.entries])
      ),
    ],
    operandRefs(triggers)
  );
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
  return trigger([block("target", [...condition.entries])], [...condition.refs]);
}
