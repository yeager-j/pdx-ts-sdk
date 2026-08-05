/**
 * Trigger builders.
 *
 * The 889 leaf conditions below are generated from the cwtools rules and the
 * game's own documentation dump — see `tools/codegen`. Only the combinators are
 * hand-written, because they are the shape of the condition tree rather than
 * conditions themselves: the rules have no way to say "this one flattens its
 * operands" or "this one infers the scope intersection of its arguments".
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeName } from "../generated/scopes.ts";
import { conjoin, trigger, type Trigger } from "./trigger-core.ts";

export type { ScopeName } from "../generated/scopes.ts";
export { trigger, type ScriptValue, type Trigger } from "./trigger-core.ts";
export * from "../generated/triggers.ts";
export * from "../generated/links.ts";

declare const situationApproachBrand: unique symbol;
declare const situationStageBrand: unique symbol;

/**
 * A `Trigger<"situation">` optionally carrying the literal approach and/or
 * stage id it names — phantom only, never read at runtime (SDK-52).
 *
 * `defineSituationType` narrows its `approach`, `stages`, and `abortTrigger`
 * fields to this type with `Approach`/`Stage` bound to that same call's own
 * declared `approach`/`stages` keys (see `definers.ts`), so a value built by
 * `currentSituationApproach`/`currentStage`/`canSetSituationApproach` is
 * checked directly against them wherever one is assigned straight to such a
 * field. Both brands are optional, so a plain `Trigger<"situation">` — what
 * every combinator (`and`, `or`, `not`, `customTooltipFail`) and every effect
 * closure (`scope.if(...)`) returns, having no way to thread a phantom brand
 * through arbitrary composition — still satisfies it. That is the checking
 * boundary: real vanilla `current_situation_approach`/`current_stage` usage is
 * near-universally nested inside one of those two forms, and there it degrades
 * to unchecked, the same as an id whose situation identity genuinely is not
 * known elsewhere in the SDK.
 */
export type SituationTrigger<
  Approach extends string = string,
  Stage extends string = string,
> = Trigger<"situation"> & {
  readonly [situationApproachBrand]?: Approach;
  readonly [situationStageBrand]?: Stage;
};

/**
 * Checks if the specified approach has been picked on the scoped situation.
 *
 * Hand-written over the generated `current_situation_approach` leaf so the
 * return type can carry the literal approach id — see `SituationTrigger`.
 * ```
 * current_situation_approach = <approach> (name field of the approach)
 * ```
 */
export function currentSituationApproach<const Approach extends string>(
  value: Approach
): SituationTrigger<Approach, never> {
  return trigger([kv("current_situation_approach", value)]) as SituationTrigger<Approach, never>;
}

/**
 * Checks if the specified stage is currently active in the scoped situation.
 *
 * Hand-written for the same reason as `currentSituationApproach`.
 * ```
 * current_stage = <stage> (name defined in situation's stages)
 * ```
 */
export function currentStage<const Stage extends string>(
  value: Stage
): SituationTrigger<never, Stage> {
  return trigger([kv("current_stage", value)]) as SituationTrigger<never, Stage>;
}

/**
 * Checks if the specified approach is allowed to be picked (according to
 * potential and allow triggers) on the scoped situation.
 *
 * Hand-written for the same reason as `currentSituationApproach`.
 * ```
 * can_set_situation_approach = <approach> (name field of the approach)
 * ```
 */
export function canSetSituationApproach<const Approach extends string>(
  value: Approach
): SituationTrigger<Approach, never> {
  return trigger([kv("can_set_situation_approach", value)]) as SituationTrigger<Approach, never>;
}

/** Operand references travel with the combinator: a technology named inside an
 * `and(...)` is referenced just as surely as one named at the top level. */
function operandRefs<S extends ScopeName>(triggers: readonly Trigger<S>[]) {
  return triggers.flatMap((operand) => [...operand.refs]);
}

/**
 * `and(a, b)`'s operands splice flat, with no `AND` wrapper — the same tree
 * `a.and(b)` builds (`./trigger-core.ts`). PDXScript blocks are already an
 * implicit AND of their members, so a nested `AND = { ... }` inside another
 * implicit-AND context (a content field, a `limit`, a scope link, another
 * `and(...)`) says nothing vanilla's own spelling does not already say.
 *
 * That flattening is only safe where the *parent* is implicit-AND. A `NOT`
 * (or `OR`) block gives its immediate children a different meaning — `NOT =
 * { a b }` is "neither a nor b" (a NOR), not "not both" (a NAND) — so a
 * grouped operand has to stay grouped there. `grouped()` below is what
 * `or()`/`not()` use to re-wrap a multi-entry operand for exactly that
 * reason; `and()` itself never needs to, since AND-of-AND is still AND and
 * associativity lets it flatten unconditionally.
 */
export function and<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return conjoin(triggers);
}

/**
 * A multi-entry operand as one grouped unit: `[...t.entries]` when there is
 * only one (already a single self-contained block — a leaf, or another named
 * combinator), or `[AND = { ...t.entries }]` when there are several (an
 * unwrapped `and()`, or any other multi-entry trigger) so the grouping is not
 * lost by splicing its members in flat.
 */
function grouped<S extends ScopeName>(t: Trigger<S>): PdxEntry[] {
  return t.entries.length === 1 ? [...t.entries] : [block("AND", [...t.entries])];
}

export function or<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "OR",
        triggers.flatMap((operand) => grouped(operand))
      ),
    ],
    operandRefs(triggers)
  );
}

/**
 * `NOT = { ... }` negates the AND of its immediate children as one unit — a
 * single-entry condition negates directly, and a multi-entry one (an
 * unwrapped `and()`) is re-grouped first, or the flattening would silently
 * turn "not (a and b)" into "not a and not b" (NAND into NOR — see `and()`'s
 * doc comment).
 */
export function not<S extends ScopeName>(condition: Trigger<S>): Trigger<S> {
  return trigger([block("NOT", grouped(condition))], [...condition.refs]);
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
