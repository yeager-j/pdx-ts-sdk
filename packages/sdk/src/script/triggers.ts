/**
 * Trigger builders.
 *
 * The 889 leaf conditions below are generated from the cwtools rules and the
 * game's own documentation dump — see `packages/codegen-cwt`. Only the combinators are
 * hand-written, because they are the shape of the condition tree rather than
 * conditions themselves: the rules have no way to say "this one flattens its
 * operands" or "this one infers the scope intersection of its arguments".
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type {
  EventChainCounterOf,
  EventChainItem,
  ExternalEventChainRef,
} from "../content/event-chains.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { scopeValue } from "./effects/recorder.ts";
import type { ScopeValue } from "./effects/types.ts";
import { refId } from "./scalar.ts";
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
 * Attaches the phantom approach and stage brands to a `Trigger<"situation">`.
 *
 * Both brands are declared-only symbol members with no runtime counterpart,
 * so the value a builder returns is already complete and the cast only names
 * the literal ids the SDK carries in the type. It lives here so the three
 * builders below state that once rather than each spelling its own cast.
 */
function situationTrigger<Approach extends string, Stage extends string>(
  entries: PdxEntry[]
): SituationTrigger<Approach, Stage> {
  return trigger<"situation">(entries) as SituationTrigger<Approach, Stage>;
}

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
  return situationTrigger<Approach, never>([kv("current_situation_approach", value)]);
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
  return situationTrigger<never, Stage>([kv("current_stage", value)]);
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
  return situationTrigger<Approach, never>([kv("can_set_situation_approach", value)]);
}

type DefinedEventChainCounterArgs<Chain extends EventChainItem> = {
  readonly eventChain: Chain;
  readonly counter: EventChainCounterOf<Chain>;
};

type ExternalEventChainCounterArgs = {
  readonly eventChain: ExternalEventChainRef;
  readonly counter: string;
};

/** Checks whether the country completed a declared counter in an event chain. */
export function hasCompletedEventChainCounter<Chain extends EventChainItem>(
  args: DefinedEventChainCounterArgs<Chain>
): Trigger<"country">;
/** Checks a vanilla or third-party chain counter whose declaration is not available to this build. */
export function hasCompletedEventChainCounter(
  args: ExternalEventChainCounterArgs
): Trigger<"country">;
export function hasCompletedEventChainCounter(
  args: DefinedEventChainCounterArgs<EventChainItem> | ExternalEventChainCounterArgs
): Trigger<"country"> {
  const id = String(refId(args.eventChain));
  return trigger(
    [
      block("has_completed_event_chain_counter", [
        kv("event_chain", id),
        kv("counter", args.counter),
      ]),
    ],
    [
      {
        targets: ["event_chain"],
        id,
        field: "has_completed_event_chain_counter.event_chain",
      },
    ]
  );
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
 * `NOR = { ... }` passes when none of its operands pass.
 *
 * Like `or()`, every operand stays grouped: a multi-entry trigger represents
 * an implicit AND and must not be split into separate NOR operands.
 */
export function nor<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "NOR",
        triggers.flatMap((operand) => grouped(operand))
      ),
    ],
    operandRefs(triggers)
  );
}

/**
 * `NAND = { ... }` passes unless every operand passes.
 *
 * Operands use the same grouping as `or()` and `nor()`, preserving a
 * multi-entry trigger as one condition rather than changing its meaning.
 */
export function nand<S extends ScopeName>(...triggers: Trigger<S>[]): Trigger<S> {
  return trigger(
    [
      block(
        "NAND",
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
): Trigger<"agreement" | "espionage_operation" | "situation" | "spy_network">;
/**
 * The same link as a value: the bare word `target`, which is what a situation
 * event's header writes — `location = target` appears in 209 places across
 * vanilla `events/`, about a quarter of all situation events — and what
 * `exists = target` tests.
 *
 * Relative, so a plain {@link ScopeValue} and deliberately never a `ScopeRef`:
 * `target` names whatever the *enclosing* situation (or spy network,
 * espionage operation, agreement) targets, shifting with its block exactly the
 * way `this` does, so there is no scope its type could promise a block's
 * contents would run in.
 *
 * Unasserted, so it lands at the widest scope and stays there. This overload
 * is non-generic on purpose: a single `<S = ScopeName>` value signature let
 * TypeScript infer `S` from the *expected* type, so `const p:
 * ScopeValue<"planet"> = target()` silently claimed a planet nobody had
 * asserted — which is exactly what the covariant brand on {@link ScopeValue}
 * exists to prevent. With no type parameter here there is nothing to infer,
 * and a bare call is `ScopeValue<ScopeName>` in every context.
 */
export function target(): ScopeValue<ScopeName>;
/**
 * The value form with the landing scope asserted: `target<"country">()`.
 *
 * The assertion is the author's, for the same reason the condition form's is —
 * `output_scope = any` is declared nowhere the SDK can read, which is also why
 * `defineSituationType` takes an author-declared `targetScope` at all. Written
 * explicitly or not at all: TypeScript skips the non-generic overload above
 * whenever type arguments are supplied, so this arm is reachable only by
 * writing the scope out.
 */
export function target<S extends ScopeName>(): ScopeValue<S>;
export function target<S extends ScopeName>(
  condition?: Trigger<S>
): Trigger<"agreement" | "espionage_operation" | "situation" | "spy_network"> | ScopeValue<S> {
  return condition === undefined
    ? scopeValue<S>("target")
    : trigger([block("target", [...condition.entries])], [...condition.refs]);
}
