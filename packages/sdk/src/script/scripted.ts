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
 * scope is the author's assertion — the deal the vanilla surface settled on,
 * now the fallback rather than the whole story.
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
import type { VanillaScriptedEffects, VanillaScriptedTriggers } from "@pdx-ts/stellaris-ids";

import type { ScopeName } from "../generated/scopes.ts";
import { compareUtf8 } from "../ordering.ts";
import type { ScopeValue } from "./effects/types.ts";
import { toScalar, type ScalarArg, type TypedRef } from "./scalar.ts";
import { trigger, type Trigger } from "./trigger-core.ts";

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
 * Three cases: no `$PARAM$`s at all takes no argument, every parameter
 * optional makes the bag optional, and one required parameter makes it
 * required.
 */
export type ScriptedArgs<P> = [keyof P] extends [never]
  ? []
  : {} extends P
    ? [args?: Widened<P>]
    : [args: Widened<P>];

/**
 * {@link ScriptedArgs}, but for triggers: a scripted trigger with no
 * `$PARAM$`s doubles as a boolean condition. Vanilla writes the negated form
 * as `name = no` at 7,746 call sites — roughly a quarter of all
 * scripted-trigger uses — right beside 23,174 affirmative ones, and nothing
 * at the call site distinguishes a scripted trigger from a native one like
 * `is_nomadic`, which already accepts `(false)`. Default stays `true`, so
 * every existing `binding()` call keeps meaning what it always meant.
 *
 * A trigger that *does* take `$PARAM$`s does not get this. Vanilla always
 * substitutes those into a block (`some_trigger = { X = 1 }`), never
 * `some_trigger = no` — a corpus sweep of every parameterless top-level
 * scripted-trigger and scripted-effect name against every `= no` call site in
 * the vanilla install turned up negation only for triggers, and only ever
 * bare (never alongside a parameter block) — so a `boolean` is not a
 * meaningful call form there and the object-args branches are unchanged.
 */
export type ScriptedTriggerArgs<P> = [keyof P] extends [never]
  ? [value?: boolean]
  : {} extends P
    ? [args?: Widened<P>]
    : [args: Widened<P>];

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export type ScriptedTriggerName = keyof VanillaScriptedTriggers & string;

export type ScriptedEffectName = keyof VanillaScriptedEffects & string;

type TriggerParams<N extends ScriptedTriggerName> = VanillaScriptedTriggers[N];

type EffectParams<N extends ScriptedEffectName> = VanillaScriptedEffects[N];

/**
 * Distributive on purpose. A union-valued name would otherwise resolve to
 * `keyof` of the *intersection* of the two parameter objects — `never` the
 * moment either takes no parameters — and silently swallow the other's required
 * arguments. Distributing yields a union of signatures instead, which fails at
 * the call.
 */
export type ScriptedTriggerBinding<
  N extends ScriptedTriggerName,
  S extends ScopeName,
> = N extends ScriptedTriggerName
  ? (...args: ScriptedTriggerArgs<TriggerParams<N>>) => Trigger<S>
  : never;

export type ScriptedEffectBinding<
  N extends ScriptedEffectName,
  S extends ScopeName,
> = N extends ScriptedEffectName
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

/**
 * Builds a checked `{ trigger, parameters }` pair for a
 * `ComplexTriggerModifier` row (`content/types.ts`, `script/effects/modifiers.ts`): the name and
 * its parameter bag are checked against `@pdx-ts/stellaris-ids`'s scripted
 * triggers — the same machinery {@link scriptedTrigger} uses — so a typo
 * (`check_galaxy_setup_vaule`), an unknown parameter, or a missing required
 * one is a compile error.
 *
 * `complex_trigger_modifier`'s own `trigger` field draws from CWT's whole
 * `alias_keys_field[trigger]` namespace (`modifier_rule.cwt:33`), which spans
 * both install-derived *scripted* triggers (what this checks) and the SDK's
 * own ~1,050 codegen'd *native* triggers (`generated/triggers.ts`) — e.g.
 * `check_galaxy_setup_value`, the exact trigger the SDK-36 habitable-worlds
 * port uses, which is a native trigger and therefore not a member of {@link
 * ScriptedTriggerName} at all. Natives have no comparable name+parameter-bag
 * surface to check against, so a `ComplexTriggerModifier` row's plain
 * `{ trigger: "name", parameters: {...} }` object literal remains the way to
 * name one of those, or a third-party mod's scripted trigger the installed
 * package does not know — this function is strictly additive, an opt-in for
 * the subset of rows that do name an install-known scripted trigger.
 *
 *     usageOdds: {
 *       modifiers: [
 *         { ...scriptedTriggerModifier("check_recent_migration", { AMOUNT: 5 }), mode: "factor" },
 *       ],
 *     }
 */
export function scriptedTriggerModifier<const N extends ScriptedTriggerName>(
  name: N,
  ...args: ScriptedArgs<TriggerParams<N>>
): { readonly trigger: N; readonly parameters?: Readonly<Record<string, ScriptedParamValue>> } {
  const [params] = args as [ScriptedParams?];
  return params === undefined
    ? { trigger: name }
    : { trigger: name, parameters: params as Readonly<Record<string, ScriptedParamValue>> };
}

// ---------------------------------------------------------------------------
// The factories
// ---------------------------------------------------------------------------

function triggerBinding(name: string) {
  return (args?: ScriptedParams | boolean): Trigger<ScopeName> =>
    trigger([typeof args === "boolean" ? kv(name, args) : scriptedEntry(name, args)]);
}

/**
 * Mints a {@link ScriptedEffectCall} from the entries it lowers to.
 *
 * `[scriptedCallBrand]` is a phantom member with no runtime counterpart, so no
 * expression is structurally a `ScriptedEffectCall` and this cast is the only
 * way to produce one. `kind` and `entries` are the value's real members, so
 * the cast adds the brand and nothing else.
 */
function scriptedEffectCall(entries: readonly PdxEntry[]): ScriptedEffectCall {
  return { kind: "scripted_effect_call", entries } as unknown as ScriptedEffectCall;
}

function effectBinding(name: string) {
  return (args?: ScriptedParams): ScriptedEffectCall =>
    scriptedEffectCall([scriptedEntry(name, args)]);
}

/**
 * Publishes one binding factory under both the checked call signature and the
 * `unchecked` member, which are the same function at runtime.
 *
 * The cast is needed because the two forms differ only in the type: the
 * checked signature is generic over a name drawn from `@pdx-ts/stellaris-ids`
 * and a claimed scope, and `unchecked` takes any name. Both erase to the same
 * plain `(name: string)` factory, and a plain function expression cannot be
 * checked against a generic overload set whose type arguments the runtime
 * never sees. `Surface` comes from the declared type of the constant this
 * result is assigned to.
 */
function withUncheckedForm<Surface>(binding: (name: string) => unknown): Surface {
  return Object.assign(binding, { unchecked: binding }) as unknown as Surface;
}

/**
 * Binds a vanilla or third-party scripted trigger under an asserted scope.
 *
 * The name and its `$PARAM$` list are checked against `@pdx-ts/stellaris-ids`;
 * **only the scope is an assertion**. Prefer the pre-bound
 * `@pdx-ts/stellaris-ids/triggers` exports, whose scope is inferred from the
 * rules rather than claimed.
 *
 * `scriptedTrigger.unchecked` takes any *name* — another mod's trigger, or one
 * newer than the pinned package. The scope is an assertion either way, and the
 * real arity is unknown there, so the parameterless boolean call form stays
 * legal alongside the object form.
 */
export const scriptedTrigger: {
  <const N extends ScriptedTriggerName, const A extends ScopeClaim>(
    name: N,
    scope: A
  ): ScriptedTriggerBinding<N, AssertedScope<A>>;
  unchecked<const A extends ScopeClaim>(
    name: string,
    scope: A
  ): (args?: ScriptedParams | boolean) => Trigger<AssertedScope<A>>;
} = withUncheckedForm(triggerBinding);

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
} = withUncheckedForm(effectBinding);
