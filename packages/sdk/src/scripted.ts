/**
 * Binding vanilla — and third-party — scripted triggers and effects.
 *
 * `is_fallen_empire` is not a game primitive, so no amount of codegen from the
 * CWT rules produces it: it is vanilla *script*, one of ~1,600 definitions in
 * `common/scripted_triggers`. Install `@pdx-ts/stellaris-ids` and every one of
 * them arrives already bound, with its scope inferred and its `$PARAM$` list
 * typed:
 *
 * ```ts
 * import { isFallenEmpire } from "@pdx-ts/stellaris-ids/triggers";
 * potential: isFallenEmpire(),
 * ```
 *
 * What is left here is the factory those bindings are built on, and the escape
 * hatch for definitions no install-derived package can know: another mod's
 * scripted trigger, or a vanilla one newer than the pinned package. There the
 * scope is the author's assertion — the same deal `docs/handoff-vanilla-surface.md`
 * settled on, now the fallback rather than the whole story.
 *
 * ```ts
 * const pdHabitable = scriptedTrigger("pd_habitability_check", "planet");
 * ```
 *
 * Every binding is a function, parameterless ones included. They are
 * function-like, calling one reads the same whether or not it takes arguments,
 * and a definer for a mod's own scripted triggers would return the same shape.
 *
 * The two halves are asymmetric, and the reason is the recorder rather than
 * taste. A trigger is a value that travels, so a trigger binding returns a
 * `Trigger`. An effect records by side effect into a sink the scope object
 * closes over, and nothing outside can reach that sink — so an effect binding
 * returns an inert call that `scope.run(...)` splices.
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeValue } from "./effect-core.ts";
import type { TypedRef } from "./generated/refs.ts";
import type { ScopeName } from "./generated/scopes.ts";
import { compareUtf8 } from "./resolver/path-order.ts";
import { toScalar, type ScalarArg } from "./scalar.ts";
import { trigger, type Trigger } from "./trigger-core.ts";
import type { VanillaScriptedEffects, VanillaScriptedTriggers } from "./vanilla-ids.ts";

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * A scope a binding claims to be valid in. `"any"` is the deliberate opt-out —
 * one greppable keystroke that yields "fits everywhere", rather than an awkward
 * explicit type argument nobody would reach for.
 */
export type ScopeAssertion = ScopeName | "any";

/** One scope, `"any"`, or the set a definition is valid in. */
export type ScopeClaim = ScopeAssertion | readonly ScopeAssertion[];

export type AssertedScope<A> = [A] extends [readonly (infer Member)[]]
  ? "any" extends Member
    ? ScopeName
    : Extract<Member, ScopeName>
  : ["any"] extends [A]
    ? ScopeName
    : Extract<A, ScopeName>;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * What a `$PARAM$` may be given: anything that lowers to one PDXScript scalar.
 *
 * The package types every parameter `string | number`, because a scripted
 * definition substitutes text and the rules say nothing about what kind of
 * text. Widening past that is ergonomics rather than a claim, and each widening
 * is there because vanilla's own call sites need it: ids and scope paths
 * (`RESOURCE = rare_crystals`, 111 sites), and booleans, where a parameter
 * lands in a slot the game reads as `yes`/`no` (`MESSAGE = no`, 120 sites
 * across `give_tech_no_error_effect`, `ethic_leader_creator` and a dozen
 * others). Without the last, `true` — which the SDK lowers to `yes` everywhere
 * else — would have to be spelled `"yes"` here and nowhere else.
 */
export type ScriptedParamValue = ScalarArg;

/**
 * The unchecked parameter bag: what a name outside the pinned set may carry.
 *
 * `undefined` is a legal *value* rather than merely an absent key, because the
 * repo does not set `exactOptionalPropertyTypes` — so `{ STAGE: undefined }`
 * typechecks against a package-declared `{ STAGE?: string | number }` and has
 * to mean the same thing as omitting it.
 */
export type ScriptedParams = Readonly<Record<string, ScriptedParamValue | undefined>>;

/**
 * Additive on purpose. `P[K] | ScalarArg` would collapse to `ScalarArg`, since
 * the package types every parameter `string | number` today — and would then
 * silently widen away any parameter it ever types more narrowly.
 */
type Widened<P> = { readonly [K in keyof P]: P[K] | boolean | TypedRef<string> | ScopeValue };

/**
 * The argument list a binding takes, resolved once where the name is known.
 *
 * Three cases, and the middle one is what keeps a single source compiling with
 * and without `@pdx-ts/stellaris-ids` installed. Absent, the parameter type is
 * `ScriptedParams`, whose `keyof` is `string` and which `{}` extends — so it
 * lands on the optional arm and both call forms stay legal. Putting the arity
 * in the return type instead would flip a binding between a value and a
 * function depending on whether the package is there.
 */
export type ScriptedArgs<P> = [keyof P] extends [never]
  ? []
  : {} extends P
    ? [args?: Widened<P>]
    : [args: Widened<P>];

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export type ScriptedTriggerName = [keyof VanillaScriptedTriggers] extends [never]
  ? string
  : keyof VanillaScriptedTriggers & string;

export type ScriptedEffectName = [keyof VanillaScriptedEffects] extends [never]
  ? string
  : keyof VanillaScriptedEffects & string;

type TriggerParams<N> = [N] extends [keyof VanillaScriptedTriggers]
  ? VanillaScriptedTriggers[N]
  : ScriptedParams;

type EffectParams<N> = [N] extends [keyof VanillaScriptedEffects]
  ? VanillaScriptedEffects[N]
  : ScriptedParams;

/**
 * Distributive on purpose. A union-valued name would otherwise resolve to
 * `keyof` of the *intersection* of the two parameter objects — `never` the
 * moment either takes no parameters — and silently swallow the other's required
 * arguments. Distributing yields a union of signatures instead, which fails at
 * the call.
 */
export type ScriptedTriggerBinding<N extends string, S extends ScopeName> = N extends unknown
  ? (...args: ScriptedArgs<TriggerParams<N>>) => Trigger<S>
  : never;

export type ScriptedEffectBinding<N extends string, S extends ScopeName> = N extends unknown
  ? (...args: ScriptedArgs<EffectParams<N>>) => ScriptedEffectCall<S>
  : never;

// ---------------------------------------------------------------------------
// The effect call
// ---------------------------------------------------------------------------

declare const scriptedCallBrand: unique symbol;

/**
 * One scripted effect invocation, waiting for `scope.run(...)`.
 *
 * Its own brand rather than the trigger's, so a `Trigger` can never satisfy
 * `run` and a call can never be spliced into a condition — the two are
 * different things that happen to serialize alike.
 */
export interface ScriptedEffectCall<in S extends ScopeName = ScopeName> {
  readonly kind: "scripted_effect_call";
  readonly entries: readonly PdxEntry[];
  readonly [scriptedCallBrand]: (scope: S) => void;
}

// ---------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------

/**
 * The one place the `name = yes` / `name = { A = 1 }` choice is made. Both call
 * shapes are confirmed against a real install and are identical for scripted
 * triggers and scripted effects, so they share one lowering.
 *
 * Keys sort, and `undefined` values drop. Parameters are a named set rather
 * than ordered author data, so reordering an object literal must not move a
 * byte; and an optional `$X|default$` parameter takes the game's default only
 * when the key is *absent*, which is also what keeps an explicit `undefined`
 * out of the serializer.
 */
function scriptedEntry(name: string, args: ScriptedParams | undefined): PdxEntry {
  const given = args ?? {};
  const keys = Object.keys(given)
    .filter((key) => given[key] !== undefined)
    .sort(compareUtf8);
  return keys.length === 0
    ? kv(name, true)
    : block(
        name,
        keys.map((key) => kv(key, toScalar(given[key])))
      );
}

// ---------------------------------------------------------------------------
// The factories
// ---------------------------------------------------------------------------

function triggerBinding(name: string) {
  return (args?: ScriptedParams): Trigger<ScopeName> => trigger([scriptedEntry(name, args)]);
}

function effectBinding(name: string) {
  return (args?: ScriptedParams): ScriptedEffectCall =>
    ({
      kind: "scripted_effect_call",
      entries: [scriptedEntry(name, args)],
    }) as unknown as ScriptedEffectCall;
}

/**
 * Binds a vanilla or third-party scripted trigger under an asserted scope.
 *
 * The name and its `$PARAM$` list are checked against `@pdx-ts/stellaris-ids`
 * when it is installed; **only the scope is an assertion**. Prefer the
 * pre-bound `@pdx-ts/stellaris-ids/triggers` exports, whose scope is inferred
 * from the rules rather than claimed.
 *
 * `scriptedTrigger.unchecked` takes any *name* — another mod's trigger, or one
 * newer than the pinned package. The scope is an assertion either way.
 */
export const scriptedTrigger: {
  <const N extends ScriptedTriggerName, const A extends ScopeClaim>(
    name: N,
    scope: A
  ): ScriptedTriggerBinding<N, AssertedScope<A>>;
  unchecked<const A extends ScopeClaim>(
    name: string,
    scope: A
  ): (args?: ScriptedParams) => Trigger<AssertedScope<A>>;
} = Object.assign(triggerBinding as never, { unchecked: triggerBinding as never });

/**
 * Binds a vanilla or third-party scripted effect under an asserted scope.
 * Invoke the result inside an effect closure with `scope.run(...)`.
 *
 * The same deal as {@link scriptedTrigger}: name and parameters checked, scope
 * asserted, and `@pdx-ts/stellaris-ids/effects` is the pre-bound form.
 */
export const scriptedEffect: {
  <const N extends ScriptedEffectName, const A extends ScopeClaim>(
    name: N,
    scope: A
  ): ScriptedEffectBinding<N, AssertedScope<A>>;
  unchecked<const A extends ScopeClaim>(
    name: string,
    scope: A
  ): (args?: ScriptedParams) => ScriptedEffectCall<AssertedScope<A>>;
} = Object.assign(effectBinding as never, { unchecked: effectBinding as never });
