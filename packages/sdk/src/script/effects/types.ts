/** Public effect-surface types shared by the recorder and generated scope interfaces. */

import type { LocalizationInput } from "../../authoring/localization.ts";
import type { EffectPathOf, ScopeObjOf } from "../../generated/effects.ts";
import type { ModifierOperationFields } from "../../generated/modifier-policy.ts";
import type { StaticModifierRef } from "../../generated/refs.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { ScriptedEffectCall, ScriptedParamValue } from "../scripted.ts";
import type { ScriptValue, Trigger } from "../trigger-core.ts";

declare const refScopeBrand: unique symbol;
declare const cannotWitnessNaturalFromBrand: unique symbol;

/**
 * A reference to a scope reachable by name from inside script: an event
 * target, `from`, `this`, or (later) `prev`.
 *
 * Two things at once, as the game writes it. A bare word wherever the rules
 * expect a `scope[X]` value (`save_event_target_as`, a scripted effect's
 * parameter), and the key of a block that opens it — `from = { ... }`,
 * `event_target:storm_world = { ... }`. The block is what `effects` and
 * `trigger` write; which one you reach for is which side of the API you are
 * on, so the ref never has to guess.
 *
 * Deliberately a plain object with methods rather than a callable, even though
 * the script's `from = { }` reads like a call: `toScalar` and the content
 * writer's dual-arm dispatcher both tell an authored value from an authored
 * closure by `typeof`, and a callable ref would land on the wrong side of every
 * one of those tests.
 *
 * The brand is covariant: a ref of unknown scope does not assign where a
 * specific scope is required.
 */
export interface ScopeValue<S extends ScopeName = ScopeName> {
  readonly kind: "scope-ref";
  /** The script path this serializes to: `this`, `from`, `event_target:x`. */
  readonly path: string;
  readonly [refScopeBrand]?: S;
}

/**
 * The lexical scope capability carried by every generated effect proxy.
 *
 * Effects record through the proxy itself. Use `.ref` when an effect
 * field needs that same scope as a scalar value. The reference stays relative
 * to the recording where it is consumed, so a captured outer proxy becomes
 * `prev` or a deeper verified PREV path inside nested callbacks. Reading it
 * after its callback returns or across an unverified transition throws.
 */
export interface EffectScope<S extends ScopeName> {
  /** The proxy's current scope as a lexical, non-openable scalar reference. */
  readonly ref: ScopeValue<S>;
}

/** A scope value that may satisfy an event fire by omission or explicit override. */
export type FireFromWitness<S extends ScopeName> = ScopeValue<S> & {
  readonly [cannotWitnessNaturalFromBrand]?: never;
};

/**
 * A {@link ScopeValue} that can be *opened* as a block.
 *
 * `from` and `event_target:x` name their scope absolutely: nesting inside
 * `every_owned_planet = { ... }` does not change what either resolves to.
 * A context PREV ref is different: it preserves the ambient PREV identity
 * declared for the owning block by adding verified nested pushes to its PREV
 * depth. `this` does not — inside that block it is the
 * planet — so `ctx.self` is a plain {@link ScopeValue}, and the one thing you
 * cannot do with it is open a block whose contents would run in a scope its
 * type does not describe. As a value it remains useful as an immediate FROM
 * witness, a situation target, or a scripted-effect argument.
 */
export interface ScopeRef<S extends ScopeName = ScopeName> extends ScopeValue<S> {
  /**
   * Opens the ref as an effect block, such as `from = { <effects> }`.
   *
   * Records into the block being recorded around the call, so a call inside a
   * loop body lands inside that loop — which is where the game would run it.
   * Calling it outside any effect closure throws rather than guessing a home
   * for the entries.
   */
  effects(body: (scope: ScopeObjOf<S>) => void): void;
  /**
   * Opens the ref as a condition block, such as `from = { <condition> }`.
   *
   * Takes the condition as a value, like the `target(...)` combinator it sits
   * beside — a trigger is a value, so there is nothing to record and nothing
   * to run it against.
   */
  trigger(condition: Trigger<S>): Trigger<ScopeName>;
}

/**
 * A composable sequence of effect blocks whose innermost block runs in `S`.
 *
 * Reading a generated scope-link property adds one nested block without
 * recording anything. {@link effects} terminates the path, records one leaf
 * closure, and writes the complete nested structure. `Transition` records
 * whether the final block preserves, pushes, replaces, or has an unknown
 * scope identity. `hiddenEffect` is the
 * same-scope structural node, so it composes with generated navigation while
 * still allowing sibling effects when terminated on its own.
 */
export interface EffectPath<S extends ScopeName, Transition extends EffectPathTransition = "push"> {
  /** Continues through `hidden_effect` without changing scope identity. */
  readonly hiddenEffect: EffectPathOf<S, Transition>;
  /** Ends the path; same-scope paths take no argument, changed scopes receive their destination. */
  effects(body: Transition extends "same" ? () => void : (scope: ScopeObjOf<S>) => void): void;
}

/** How the path's final block relates to the scope that opened it. */
export type EffectPathTransition = "same" | "push" | "replace" | "unknown";

/** A path node that keeps the receiver's game scope. */
export type SameScopeEffectPath<S extends ScopeName> = EffectPathOf<S, "same">;

/**
 * A saved event target. Declaring one names its scope once, explicitly; every
 * save site then enforces it (`saveEventTargetAs` in planet scope only
 * accepts an `EventTarget<"planet">`), so reads through the target are
 * scope-safe.
 */
export interface EventTarget<S extends ScopeName = ScopeName> extends ScopeRef<S> {
  readonly name: string;
}

/**
 * Every ambient scope name Stellaris can declare for a script block.
 *
 * Generated declarations use this map instead of positional generic arguments.
 * A missing key remains an inert sentinel on {@link ScriptCtx}; it is not a
 * claim that the game supplies that scope.
 */
export interface AmbientScopeContext {
  /** The top-level script scope. */
  readonly root?: ScopeName;
  /** The immediate FROM scope. */
  readonly from?: ScopeName;
  /** The second FROM scope. */
  readonly fromfrom?: ScopeName;
  /** The third FROM scope. */
  readonly fromfromfrom?: ScopeName;
  /** The fourth FROM scope. */
  readonly fromfromfromfrom?: ScopeName;
  /** The immediate PREV scope. */
  readonly prev?: ScopeName;
  /** The second PREV scope. */
  readonly prevprev?: ScopeName;
  /** The third PREV scope. */
  readonly prevprevprev?: ScopeName;
  /** The fourth PREV scope. */
  readonly prevprevprevprev?: ScopeName;
}

/** The stable order used in generated context maps and runtime scope overrides. */
export const AMBIENT_SCOPE_KEYS = [
  "root",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
] as const satisfies readonly (keyof AmbientScopeContext)[];

/** One named ambient slot. */
export type AmbientScopeKey = (typeof AMBIENT_SCOPE_KEYS)[number];

/** The declared scope at one ambient slot, or never when the map omits it. */
export type AmbientScopeAt<
  Context extends AmbientScopeContext,
  Key extends AmbientScopeKey,
> = Key extends keyof Context ? Extract<Context[Key], ScopeName> : never;

/** An ambient slot the rules did not declare. */
export interface UndeclaredAmbientScope<Key extends AmbientScopeKey> {
  readonly kind: "undeclared-ambient-scope";
  readonly slot: Key;
  readonly hint: "Nothing declares this ambient scope here; read it only where the rules name it.";
}

type AmbientRef<Context extends AmbientScopeContext, Key extends AmbientScopeKey> = [
  AmbientScopeAt<Context, Key>,
] extends [never]
  ? UndeclaredAmbientScope<Key>
  : ScopeRef<AmbientScopeAt<Context, Key>>;

/**
 * The ambient scopes a script block runs in, handed to every closure that
 * records effects: an event's `immediate`/`after`/option effects, and a
 * content definition's effect fields.
 *
 * `self` doubles as the natural FROM witness at fire sites where SELF and ROOT
 * are the same. The game supplies the firing execution's ROOT as natural FROM,
 * so a known split-root content block must use `root` or an explicit absolute
 * ref instead. `from` is the block's own FROM, which the game supplies and the rules name —
 * `on_roll_failed` runs in fleet scope with the archaeological site as FROM, so
 * `ctx.from.effects((site) => ...)` opens the site.
 *
 * The default context declares `root: Self` because that is true wherever a
 * script block *is* the top level — an event's `immediate` runs in the event's
 * own scope, and ROOT is that scope. A content field is where the two come
 * apart, so its generated type states ROOT explicitly and defaults it to
 * undeclared instead; see {@link EffectBlock}.
 */
export interface ScriptCtx<
  Self extends ScopeName,
  Context extends AmbientScopeContext = { readonly root: Self },
> {
  /**
   * The scope this block runs in, as a value — the FROM witness at a fire
   * site only when this block's ROOT is not known to differ. Natural event
   * FROM is ROOT, so a split-root content block cannot use `self` as its
   * witness even though both serialize relative paths. Not openable: `this`
   * is relative to the block it is written in, so
   * inside a scope transition it would name that scope rather than this one.
   */
  readonly self: ScopeValue<Self> &
    SelfNaturalFromConstraint<Self, AmbientScopeAt<Context, "root">>;
  /**
   * ROOT — the scope the script's top level runs in, where something declares
   * what that is. Everywhere else an inert sentinel, exactly like `from`.
   *
   * Openable where `self` is not, and for the reason {@link ScopeRef} draws
   * the line on: `root` resolves to the same scope wherever it is written, so
   * nesting inside `every_owned_planet = { ... }` leaves it naming the block's
   * top-level scope while `this` has become the planet. Navigating from it is
   * what the game script does constantly — `root.owner`, `root.capital_scope`
   * — and that is a value form, not a block, which is why the generated links
   * take a scope value as well as a condition.
   *
   * Not simply `Self`: a content field's `## replace_scopes` sets THIS and
   * ROOT independently, and often to different scopes. A solar system
   * initializer's `init_effect` runs in planet scope with the fallen empire's
   * country as ROOT (`solar_system_initializers.cwt`), so typing ROOT as the
   * block's own scope would both admit planet effects the game rejects and
   * reject the country operations that are the whole point of reaching for it.
   */
  readonly root: AmbientRef<Context, "root">;
  /**
   * FROM, where something declares what it holds — an event's `scopes.from` field, a
   * content field's `replace_scopes` in the rules. Everywhere else this is an
   * inert sentinel, so touching an undeclared FROM is a compile error.
   */
  readonly from: AmbientRef<Context, "from">;
  /** The second declared FROM scope. */
  readonly fromfrom: AmbientRef<Context, "fromfrom">;
  /** The third declared FROM scope. */
  readonly fromfromfrom: AmbientRef<Context, "fromfromfrom">;
  /** The fourth declared FROM scope. */
  readonly fromfromfromfrom: AmbientRef<Context, "fromfromfromfrom">;
  /** The immediate declared PREV scope, relative to this block's verified nesting. */
  readonly prev: AmbientRef<Context, "prev">;
  /** The second declared PREV scope. */
  readonly prevprev: AmbientRef<Context, "prevprev">;
  /** The third declared PREV scope. */
  readonly prevprevprev: AmbientRef<Context, "prevprevprev">;
  /** The fourth declared PREV scope. */
  readonly prevprevprevprev: AmbientRef<Context, "prevprevprevprev">;
}

type SelfNaturalFromConstraint<Self extends ScopeName, Root extends ScopeName | never> = [
  Root,
] extends [ScopeName]
  ? [Root] extends [Self]
    ? [Self] extends [Root]
      ? object
      : { readonly [cannotWitnessNaturalFromBrand]: true }
    : { readonly [cannotWitnessNaturalFromBrand]: true }
  : object;

/**
 * One `modifier = { ... }` rule: a numeric change gated by a trigger.
 *
 * The operations mirror `complex_maths_enum` in `modifier_rule.cwt`
 * (`set weight add subtract factor mult multiply divide modulo round_to max
 * min pow`) restricted to the members the corpus actually exercises across
 * every weight-block consumer, not just `situation_type.monthly_progress` —
 * measured there alone: add 255, mult 176, subtract 37, factor 34, min 2,
 * max 2, divide 2. `multiply` is spelled `multiplier` here to stay distinct
 * from `mult`, and `min`/`max` are spelled `minValue`/`maxValue` since bare
 * `min`/`max` read as comparisons rather than assignments. `set`, `modulo`,
 * `round_to`, and `pow` are declared but unmeasured anywhere in the corpus
 * and stay out until a real consumer needs them.
 *
 * Every operation here is `modifier_rule.cwt`'s `value_field`, not `float`:
 * a literal, a scripted variable, a `scope.variable` path, or
 * `value:<script_value>`. Across every modifier operand in vanilla's
 * `common/`, 12% are one of those non-literal forms, so `ScriptValue` (which
 * a plain number already widens into) rather than `number` alone.
 */
export interface Modifier<S extends ScopeName> extends ModifierOperationFields<ScriptValue> {
  /**
   * Text for this modifier row's tooltip (`desc = localisation` in
   * `modifier_rule.cwt`). Inline display text is keyed and registered
   * automatically — see `ContentAuthoring`'s modifier-desc
   * collection in `content/authoring.ts`, which is the only pathway that can safely
   * auto-register (it runs once, at `define()` time, against a stable
   * definition id). `randomList`/`lockedRandomList`/`random` and other
   * runtime-recorded effect modifiers have no such stable, once-only
   * registration point — `modifierEntry` below throws if inline text reaches
   * it unresolved from one of those. A `LocalizationRef` already has a key and
   * is accepted anywhere this row shape is used.
   *
   * Modifier rows have no id of their own, so the generated key ends in a
   * hash of the English text: it survives reordering, but it changes — and
   * orphans any shipped translation — whenever that text is edited, which
   * `mod.warnings` reports. Write `{ english, key: "flesh_is_weak" }` to pin
   * that part of the key instead. The pin is lowercase snake_case, matching
   * the same pattern as content ids.
   */
  readonly desc?: LocalizationInput;
  /**
   * The gating condition, spliced inline per `modifier_rule.cwt`.
   *
   * Optional because the grammar makes it so — a row is operations, an optional
   * `desc`, and however much of `alias_name[trigger]` the author writes, none of
   * it required — and because the game ships rows with no condition at all: 159
   * definitions across seven weight fields (`opinion_modifier.decay` in 115 of
   * its 138) write an unconditional adjustment as a `modifier` row rather than
   * folding it into the block's own operations. Requiring `when` made every one
   * of those unauthorable.
   */
  readonly when?: Trigger<S>;
}

/**
 * A {@link Modifier} whose `desc` is required, matching
 * `modifier_rule_with_loc` — "deliberately more restrictive because of what
 * we can make good tooltips with", per the CWT source comment. Same concept
 * as `Modifier`, one stricter requiredness level, not a duplicate shape.
 */
export type ModifierWithLoc<S extends ScopeName> = Modifier<S> & {
  readonly desc: LocalizationInput;
};

/**
 * The `mode` a {@link ComplexTriggerModifier} row feeds its trigger result
 * into. Same `complex_maths_enum` source as {@link Modifier}'s operations,
 * restricted the same way — by what the corpus actually exercises for `mode`
 * specifically: add 474, subtract 45, mult 19, divide 8, factor 4, weight 1.
 * The unmeasured members (`set`, `multiply`, `modulo`, `round_to`, `max`,
 * `min`, `pow`) stay out until a real consumer needs them, matching
 * {@link Modifier}'s own convention.
 */
export type ComplexTriggerModifierMode =
  "add" | "subtract" | "mult" | "divide" | "factor" | "weight";

/**
 * A `complex_trigger_modifier = { ... }` row (`modifier_rule.cwt:32-53`): a
 * named trigger's result feeds a weight operation directly, rather than
 * gating a fixed adjustment the way {@link Modifier} does. 552 occurrences
 * across 42 files in `common/`. The vanilla `usage_odds` row that scales a
 * `solar_system_initializer`'s spawn odds by the habitable-worlds galaxy
 * setting is one (`initializer_modifiers_habitable_world_systems.txt`):
 *
 *     complex_trigger_modifier = {
 *         trigger = check_galaxy_setup_value
 *         parameters = { setting = habitable_worlds_scale }
 *         mode = factor
 *     }
 *
 * `trigger` names a scripted trigger by its key rather than splicing a nested
 * block, so — unlike {@link Modifier}'s `when` — this needs no scope type
 * parameter of its own: `triggerScope` names whatever scope the trigger
 * should run in as a raw scope path (`"owner"`, `"target.solar_system"`,
 * ...), the same way the game writes it, not a checked reference. `S` only
 * surfaces through the optional `potential` gate, an ordinary scoped trigger
 * clause evaluated alongside the named trigger.
 *
 * `mult`/`multiplier`/`min_value`/`max_value` are this row's own fields per
 * the CWT alias, spelled distinctly from {@link Modifier}'s `mult`/`multiply`/
 * `min`/`max` — the two row kinds share no field names beyond `mult` itself,
 * so the lowering keeps them separate rather than reusing `Modifier`'s
 * mapping. Each is declared `value_field` in `modifier_rule.cwt`, the same
 * domain as {@link Modifier}'s own numeric arms, so they are `ScriptValue`
 * (not bare `number`) for the same reason those are: a `@scripted_variable`
 * has to lower through `scriptValueScalar` to write bare rather than
 * quoted, exactly like every other `value_field` here.
 */
export interface ComplexTriggerModifier<S extends ScopeName> {
  /** The scripted trigger's key, evaluated with `parameters` as arguments. */
  readonly trigger: string;
  /** Scope path the trigger runs in (defaults to `this` when omitted). */
  readonly triggerScope?: string;
  /**
   * Arguments passed to the named trigger. `ScriptedParamValue` (not a bare
   * `string | number`) so a row built by hand accepts the same widened
   * forms — booleans, branded references, scope values — `scriptedTrigger`
   * and {@link scriptedTriggerModifier} already accept, and so it can hold
   * exactly what `scriptedTriggerModifier`'s checked return value produces.
   */
  readonly parameters?: Readonly<Record<string, ScriptedParamValue>>;
  /** Which operation the trigger's result feeds. */
  readonly mode: ComplexTriggerModifierMode;
  readonly mult?: ScriptValue;
  readonly multiplier?: ScriptValue;
  readonly divide?: ScriptValue;
  readonly minValue?: ScriptValue;
  readonly maxValue?: ScriptValue;
  /**
   * Text for this row's tooltip. Inline display text is auto-registered as
   * localisation the same way {@link Modifier.desc} is — see `ContentAuthoring`'s
   * modifier-desc collection in `content/authoring.ts`. `complexTriggerModifierEntry`
   * below throws if `desc` reaches it unresolved. Like {@link Modifier.desc},
   * this row has no id of its own, so an unpinned key hashes the English text
   * and an optional `key` pin supplies a stable anonymous segment; reordering
   * rows does not change either form.
   */
  readonly desc?: LocalizationInput;
  /** Additional gate evaluated alongside the named trigger. */
  readonly potential?: Trigger<S>;
}

/**
 * A {@link ComplexTriggerModifier} for `modifier_rule_with_loc` consumers.
 * `modifier_rule.cwt:67-81` admits only `mult`/`multiplier`, not
 * `divide`/`min_value`/`max_value` — `modifier_rule_with_loc` drops those
 * three fields the plain alias's `complex_trigger_modifier` allows — and
 * `desc` there has no `## cardinality = 0..1` marker (every other field in
 * that block does), so it defaults to required, matching {@link
 * ModifierWithLoc}'s own `desc` requirement on the sibling row kind.
 *
 * The three dropped fields are forbidden (`?: never`) rather than merely
 * omitted: `WeightBlockRow`'s union of this type with `ModifierWithLoc`
 * would otherwise let `divide`/`minValue`/`maxValue` leak back in, the same
 * excess-property leniency `ExclusiveModifierRow`/
 * `ExclusiveComplexTriggerModifierRow` in `content/types.ts` exist to close —
 * `ModifierWithLoc` (inherited from `Modifier`) still declares all three, so
 * a plain `Omit` here would make them "not excess" for the row as a whole
 * even though this specific row kind cannot legally carry them.
 */
export type ComplexTriggerModifierWithLoc<S extends ScopeName> = Omit<
  ComplexTriggerModifier<S>,
  "divide" | "minValue" | "maxValue" | "desc"
> & {
  readonly desc: LocalizationInput;
  readonly divide?: never;
  readonly minValue?: never;
  readonly maxValue?: never;
};

/**
 * The chain returned by `if`. PDXScript associates `else_if`/`else` with the
 * preceding `if` purely by position, so the chain guards against effects
 * being recorded between its links — that would silently detach the `else`.
 */
export interface IfChain<S extends ScopeName> {
  /** Adds an adjacent `else_if` branch before any other effect is recorded. */
  elseIf(condition: Trigger<S>, body: () => void): IfChain<S>;
  /** Ends the chain: a further `elseIf` or `else` on it throws. */
  else(body: () => void): void;
}

/** One arm of a `random_list`: trigger-ish parts as data, effects as a closure. */
export interface RandomListArm<S extends ScopeName> {
  readonly weight: number;
  readonly modifiers?: readonly Modifier<S>[];
  /** Effects run when this arm is selected, in the list's receiving scope. */
  readonly do: () => void;
}

/**
 * Control flow and the few effects whose types the rules cannot express — the
 * `structural` rows in the generated effect ownership policy. Every generated
 * scope interface extends this.
 */
export interface StructuralEffects<S extends ScopeName> {
  /** Displays a static modifier in a non-executing tooltip without treating this scope as its host. */
  previewModifier(modifier: StaticModifierRef | string): void;

  /**
   * In-game branching: `if = { limit = { ... } ... }`. This is the in-game
   * counterpart of a TypeScript `if`, which branches at build time. Chain
   * `.elseIf(...)` and `.else(...)` before recording any further effects.
   */
  if(condition: Trigger<S>, body: () => void): IfChain<S>;

  /**
   * Begins a same-scope `hidden_effect = { ... }` path. Terminate it with
   * `.effects(...)`, or continue through generated scope-link properties.
   */
  readonly hiddenEffect: SameScopeEffectPath<S>;

  /** Picks one arm at random, weighted; modifiers adjust weights in-game. */
  randomList(arms: ReadonlyArray<RandomListArm<S>>): void;

  /** `random_list` that shows only the chosen arm in tooltips. */
  lockedRandomList(arms: ReadonlyArray<RandomListArm<S>>): void;

  /** Runs the body with the given percent chance, in-game. */
  random(args: { chance: number; modifiers?: readonly Modifier<S>[] }, body: () => void): void;

  /** `while = { count/limit ... }` — in-game iteration. */
  whileLoop(args: { count?: number; limit?: Trigger<S> }, body: () => void): void;

  /**
   * Saves the current scope under the target's name. The target's declared
   * scope must match the scope being saved — reads stay safe because saves
   * are checked.
   */
  saveEventTargetAs(target: EventTarget<S>): void;

  /** Like `saveEventTargetAs`, but the target survives the event chain. */
  saveGlobalEventTargetAs(target: EventTarget<S>): void;

  /**
   * Runs a scripted effect bound by `scriptedEffect` or imported from
   * `@pdx-ts/stellaris-ids/effects`:
   * `give_ascension_perk_effect = { PERK = ap_mind_over_matter }`.
   *
   * ```ts
   * scope.run(giveAscensionPerkEffect({ PERK: "ap_mind_over_matter" }));
   * ```
   *
   * The call carries the scope its binding claims, so a country-scoped effect
   * inside a planet closure is a compile error. It goes through a method rather
   * than recording itself because the recorder's sink is closed over and
   * nothing outside the scope object can reach it — which is the property that
   * keeps arbitrary entries out of the output.
   */
  run(effect: ScriptedEffectCall<S>): void;

  /** Adds resources to the scope's stockpile: `add_resource = { energy = 50 }`. */
  addResource(args: { resource: string; amount: number; mult?: number }): void;
}
