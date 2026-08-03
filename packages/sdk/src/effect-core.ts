/**
 * The effects runtime: one scope-agnostic recorder behind generated types.
 *
 * Effects are recorded closures — a closure receives a scope object whose
 * methods append PDXScript AST nodes instead of executing anything. At
 * runtime every scope object is the same Proxy over an entry sink; the
 * generated interfaces in `generated/effects.ts` are what restrict which
 * effects exist in which scope, and `generated/effect-meta.ts` tells the
 * Proxy how to serialize each call. The design was validated by
 * `design/effects-probe/` — see `docs/verdict-effects-probe.md`.
 *
 * The Proxy throws on names missing from the meta table, so a typo in an
 * untyped position fails loudly instead of recording garbage.
 */

import { createHash } from "node:crypto";
import { block, cmp, kv, type PdxEntry, type PdxOp, type PdxScalar } from "@pdx-ts/pdxscript";

import type { ContentRefUse } from "./content-refs.ts";
import { EFFECT_META, type EffectFieldMeta } from "./generated/effect-meta.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import { EVENT_KINDS } from "./generated/events.ts";
import type { ScopeName } from "./generated/scopes.ts";
import { toScalar } from "./scalar.ts";
import type { ScriptedEffectCall } from "./scripted.ts";
import { scriptValueScalar, trigger, type ScriptValue, type Trigger } from "./trigger-core.ts";

// ---------------------------------------------------------------------------
// Scope references
// ---------------------------------------------------------------------------

declare const refScopeBrand: unique symbol;

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
 * A {@link ScopeValue} whose path means the same thing wherever it is written,
 * so it can also be *opened* as a block.
 *
 * That is the whole distinction. `from` and `event_target:x` name their scope
 * absolutely: nesting inside `every_owned_planet = { ... }` does not change
 * what either resolves to. `this` does not — inside that block it is the
 * planet — so `ctx.self` is a plain {@link ScopeValue}, and the one thing you
 * cannot do with it is open a block whose contents would run in a scope its
 * type does not describe. As a value it stays exactly as useful: the FROM
 * witness at a fire site, a situation's target, a scripted effect's argument.
 */
export interface ScopeRef<S extends ScopeName = ScopeName> extends ScopeValue<S> {
  /**
   * Opens the ref as an effect block: `from = { <effects> }`.
   *
   * Records into the block being recorded around the call, so a call inside a
   * loop body lands inside that loop — which is where the game would run it.
   * Calling it outside any effect closure throws rather than guessing a home
   * for the entries.
   */
  effects(body: (scope: ScopeObjOf<S>) => void): void;
  /**
   * Opens the ref as a condition block: `from = { <condition> }`.
   *
   * Takes the condition as a value, like the `target(...)` combinator it sits
   * beside — a trigger is a value, so there is nothing to record and nothing
   * to run it against.
   */
  trigger(condition: Trigger<S>): Trigger<ScopeName>;
}

/**
 * A saved event target. Declaring one names its scope once, explicitly; every
 * save site then enforces it (`saveEventTargetAs` in planet scope only
 * accepts an `EventTarget<"planet">`), so reads through the target are
 * scope-safe.
 */
export interface EventTarget<S extends ScopeName = ScopeName> extends ScopeRef<S> {
  readonly name: string;
}

export function eventTarget<S extends ScopeName>(name: string): EventTarget<S> {
  return { ...scopeRef<S>(`event_target:${name}`), name };
}

/** SDK-internal: an unchecked value for a well-known path (`this`). */
export function scopeValue<S extends ScopeName>(path: string): ScopeValue<S> {
  return { kind: "scope-ref", path };
}

/** SDK-internal: an unchecked openable ref for absolute paths (`from`). */
export function scopeRef<S extends ScopeName>(path: string): ScopeRef<S> {
  return {
    ...scopeValue<S>(path),
    effects(body) {
      const recording = activeRecording(path);
      recording.sink.push(block(path, recordEffects(recording.refs, body)));
    },
    trigger(condition) {
      return trigger([block(path, [...condition.entries])], [...condition.refs]);
    },
  };
}

/**
 * The block effects are being recorded into, innermost first.
 *
 * A ref opens a block relative to wherever the author is writing — `from = { }`
 * inside `every_owned_ship = { }` runs once per ship, and at the top level once
 * — so `effects` needs the *lexically* enclosing block, not the one whose scope
 * object happens to be in a variable. Recording is synchronous and eager
 * (closures run inside `define`), so the innermost live recording is exactly
 * that block.
 */
interface Recording {
  readonly sink: PdxEntry[];
  readonly refs: ContentRefUse[];
}

const RECORDINGS: Recording[] = [];

function activeRecording(path: string): Recording {
  const recording = RECORDINGS.at(-1);
  if (recording === undefined) {
    throw new Error(
      `'${path}' was opened with .effects() outside any effect closure, so there is no ` +
        "block for its entries to land in. Call it inside the closure that should contain " +
        "it — a definition's effect field, an event's immediate/after/option — rather than " +
        "storing the result and using it later."
    );
  }
  return recording;
}

/**
 * The sentinel behind `ctx.from` where nothing declared a FROM scope.
 * Deliberately NOT a `ScopeRef` (and not `never`, which would assign
 * anywhere), so every use site fails with this type's name in the message.
 */
export interface UndeclaredFrom {
  readonly kind: "undeclared-from";
  readonly hint: "Nothing declares what FROM holds here; read it only where the rules name a FROM scope.";
}

/**
 * The ambient scopes a script block runs in, handed to every closure that
 * records effects: an event's `immediate`/`after`/option effects, and a
 * content definition's effect fields.
 *
 * `self` doubles as the FROM witness at fire sites: passing `from: ctx.self`
 * proves the fired event's declared FROM matches the scope this block runs in.
 * `from` is the block's own FROM, which the game supplies and the rules name —
 * `on_roll_failed` runs in fleet scope with the archaeological site as FROM, so
 * `ctx.from.effects((site) => ...)` opens the site.
 */
export interface ScriptCtx<Self extends ScopeName, From extends ScopeName | undefined> {
  /**
   * The scope this block runs in, as a value — the FROM witness at a fire
   * site. Not openable: `this` is relative to the block it is written in, so
   * inside a scope transition it would name that scope rather than this one.
   */
  readonly self: ScopeValue<Self>;
  /**
   * FROM, where something declares what it holds — an event's `from:` field, a
   * content field's `replace_scopes` in the rules. Everywhere else this is an
   * inert sentinel, so touching an undeclared FROM is a compile error.
   */
  readonly from: [From] extends [ScopeName] ? ScopeRef<From> : UndeclaredFrom;
}

/**
 * The one runtime shape behind every {@link ScriptCtx}: `this` and `from` are
 * fixed script paths, so what varies between blocks is only the type.
 */
export function scriptCtx<Self extends ScopeName, From extends ScopeName | undefined>(): ScriptCtx<
  Self,
  From
> {
  return { self: scopeValue("this"), from: scopeRef("from") } as ScriptCtx<Self, From>;
}

// ---------------------------------------------------------------------------
// Weight modifiers
// ---------------------------------------------------------------------------

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
export interface Modifier<S extends ScopeName> {
  readonly factor?: ScriptValue;
  readonly add?: ScriptValue;
  readonly weight?: ScriptValue;
  readonly subtract?: ScriptValue;
  readonly mult?: ScriptValue;
  readonly multiplier?: ScriptValue;
  readonly divide?: ScriptValue;
  readonly minValue?: ScriptValue;
  readonly maxValue?: ScriptValue;
  /**
   * Display text for this modifier row's tooltip (`desc = localisation` in
   * `modifier_rule.cwt`). Like every other definition-attached localization
   * slot in the SDK, the author writes text and a key is generated and
   * registered automatically — see `ContentAuthoring`'s modifier-desc
   * collection in `content.ts`, which is the only pathway that can safely
   * auto-register (it runs once, at `define()` time, against a stable
   * definition id). `randomList`/`lockedRandomList`/`random` and other
   * runtime-recorded effect modifiers have no such stable, once-only
   * registration point — `modifierEntry` below throws if `desc` reaches it
   * unresolved from one of those.
   */
  readonly desc?: string;
  /**
   * A stable slug identifying this row's `desc` for localisation, e.g.
   * `"flesh_is_weak"`. Modifier rows have no id of their own and, absent a
   * `descKey`, the generated key falls back to a hash of the `desc` text —
   * automatic and stable under reordering, but it changes (and orphans any
   * shipped translation) whenever the English text is edited. Supplying
   * `descKey` pins the key so translations survive text edits too; see
   * `ContentAuthoring`'s modifier-desc collection in `content.ts` for the
   * exact key format and the `mod.warnings` entry an unset `descKey` emits.
   * Ignored when `desc` is not set. Lowercase snake_case, matching the same
   * pattern as content ids.
   */
  readonly descKey?: string;
  /** The gating condition, spliced inline per `modifier_rule.cwt`. */
  readonly when: Trigger<S>;
}

/**
 * A {@link Modifier} whose `desc` is required, matching
 * `modifier_rule_with_loc` — "deliberately more restrictive because of what
 * we can make good tooltips with", per the CWT source comment. Same concept
 * as `Modifier`, one stricter requiredness level, not a duplicate shape.
 */
export type ModifierWithLoc<S extends ScopeName> = Modifier<S> & { readonly desc: string };

/**
 * Resolved `desc` keys, by the exact `Modifier` object that carries them.
 *
 * Modifier rows are anonymous and repeated with no id of their own, so a
 * generated localisation key cannot ride the usual `<id>`/`<id>_desc`
 * pattern. `ContentAuthoring` (content.ts) generates and registers one key
 * per desc-bearing row at `define()` time — the only point with a stable
 * definition id and a once-only guarantee — and records it here, keyed by
 * object identity rather than by any path string, so `modifierEntry` below
 * needs no extra context threaded through the ordinary lowering call chain.
 */
const modifierDescKeys = new WeakMap<Modifier<ScopeName>, string>();

/** SDK-internal: records the localisation key a modifier row's `desc` resolved to. */
export function registerModifierDescKey(modifier: Modifier<ScopeName>, key: string): void {
  modifierDescKeys.set(modifier, key);
}

/** `Modifier.descKey`'s required shape — lowercase snake_case, matching content ids. */
export const DESC_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * A derived modifier desc localisation key, plus a warning to surface when
 * the derivation fell back to a content hash rather than an author-supplied
 * `descKey`. The warning is returned rather than emitted so this function
 * stays free of any opinion about where a caller's diagnostics land —
 * `content.ts` has `onUnstableDescKey` wired to `mod.warnings` already;
 * `events.ts` threads it through `DefinedEvent.warnings` instead, since an
 * event has no `ContentAuthoring` instance to hang a callback off.
 */
export interface ModifierDescKeyResult {
  readonly key: string;
  readonly unstableWarning?: string;
}

/**
 * Derives the localisation key for one desc-bearing `modifier_rule` row:
 * `<ownerId>_<fieldPath>_<descKey-or-hash>`. Modifier rows are anonymous and
 * repeated with no id of their own, so the key cannot ride the row's own
 * identity and is derived instead. `ownerId` and `fieldPath` are already
 * unique per definition (mod-prefixed and duplicate-checked, or a fixed
 * field key/struct path); what disambiguates multiple rows on the same
 * field must be a function of the row's own content, never of its position
 * in the array — an index-derived key repoints at whatever row now occupies
 * that index after an insertion or reorder, silently misaligning any
 * shipped translation with no build error and no symptom until a player
 * reads that language (SDK-48).
 *
 * An author-supplied `descKey` is preferred when given: stable under
 * reordering and under text edits, so it is the only scheme translations
 * can safely be pinned against long-term. Without one, the key falls back
 * to a short hash of the `desc` text itself — still a function of content
 * rather than position, so it survives reordering and insertion, but it
 * changes (and orphans any existing translation) whenever the English text
 * is edited; the caller is expected to surface `unstableWarning` when that
 * happens, the same way `content.ts`'s `onUnstableDescKey`/`mod.warnings`
 * already does, rather than let the fallback stay silently unattended.
 *
 * The single derivation, shared rather than duplicated per caller
 * (`content.ts`'s `collectModifierDescs`, `events.ts`'s
 * `registerModifierDescs`) — every caller inherits a future change to this
 * scheme in one place.
 */
export function modifierDescKey(
  ownerId: string,
  fieldPath: string,
  modifier: ModifierWithLoc<ScopeName>
): ModifierDescKeyResult {
  if (modifier.descKey !== undefined) {
    if (!DESC_KEY_PATTERN.test(modifier.descKey)) {
      throw new Error(
        `Modifier.descKey "${modifier.descKey}" on "${ownerId}" (${fieldPath}) must be ` +
          `lowercase snake_case (e.g. "flesh_is_weak")`
      );
    }
    return { key: `${ownerId}_${fieldPath}_${modifier.descKey}` };
  }
  const slug = createHash("sha256").update(modifier.desc).digest("hex").slice(0, 8);
  return {
    key: `${ownerId}_${fieldPath}_${slug}`,
    unstableWarning:
      `Modifier desc on "${ownerId}" (${fieldPath}) has no descKey; its localisation key ` +
      `is a hash of the desc text and will change if that text is edited, silently ` +
      `orphaning any existing translation. Set descKey to pin a stable key.`,
  };
}

/** SDK-internal shared lowering for a `modifier_rule`/`modifier_rule_with_loc` row.
 * `refs`, when given, collects the content references the gating trigger writes. */
export function modifierEntry(modifier: Modifier<ScopeName>, refs?: ContentRefUse[]): PdxEntry {
  const entries: PdxEntry[] = [];
  if (modifier.factor !== undefined) {
    entries.push(kv("factor", scriptValueScalar(modifier.factor)));
  }
  if (modifier.add !== undefined) {
    entries.push(kv("add", scriptValueScalar(modifier.add)));
  }
  if (modifier.weight !== undefined) {
    entries.push(kv("weight", scriptValueScalar(modifier.weight)));
  }
  if (modifier.subtract !== undefined) {
    entries.push(kv("subtract", scriptValueScalar(modifier.subtract)));
  }
  if (modifier.mult !== undefined) {
    entries.push(kv("mult", scriptValueScalar(modifier.mult)));
  }
  if (modifier.multiplier !== undefined) {
    entries.push(kv("multiply", scriptValueScalar(modifier.multiplier)));
  }
  if (modifier.divide !== undefined) {
    entries.push(kv("divide", scriptValueScalar(modifier.divide)));
  }
  if (modifier.minValue !== undefined) {
    entries.push(kv("min", scriptValueScalar(modifier.minValue)));
  }
  if (modifier.maxValue !== undefined) {
    entries.push(kv("max", scriptValueScalar(modifier.maxValue)));
  }
  if (modifier.desc !== undefined) {
    const key = modifierDescKeys.get(modifier);
    if (key === undefined) {
      throw new Error(
        "Modifier.desc is display text that must be registered as localization before it can " +
          "be lowered, and this row was never registered. desc is only supported on modifiers " +
          "inside a content definition's WeightBlock (e.g. situation_type.monthly_progress) — " +
          "randomList/lockedRandomList/random and other runtime-recorded effect modifiers have " +
          "no stable, once-only point to register a key against, so they cannot accept desc."
      );
    }
    entries.push(kv("desc", key));
  }
  entries.push(...modifier.when.entries);
  refs?.push(...modifier.when.refs);
  return block("modifier", entries);
}

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
 * mapping.
 */
export interface ComplexTriggerModifier<S extends ScopeName> {
  /** The scripted trigger's key, evaluated with `parameters` as arguments. */
  readonly trigger: string;
  /** Scope path the trigger runs in (defaults to `this` when omitted). */
  readonly triggerScope?: string;
  /** Arguments passed to the named trigger. */
  readonly parameters?: Readonly<Record<string, string | number>>;
  /** Which operation the trigger's result feeds. */
  readonly mode: ComplexTriggerModifierMode;
  readonly mult?: number;
  readonly multiplier?: number;
  readonly divide?: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  /**
   * Display text for this row's tooltip, auto-registered as localisation the
   * same way {@link Modifier.desc} is — see `ContentAuthoring`'s
   * modifier-desc collection in `content.ts`. `complexTriggerModifierEntry`
   * below throws if `desc` reaches it unresolved.
   */
  readonly desc?: string;
  /** Additional gate evaluated alongside the named trigger. */
  readonly potential?: Trigger<S>;
}

/**
 * Resolved `desc` keys for {@link ComplexTriggerModifier} rows, by object
 * identity — the same scheme as {@link modifierDescKeys}, kept as a separate
 * map because the two row kinds are separate types with no shared identity.
 */
const complexTriggerModifierDescKeys = new WeakMap<ComplexTriggerModifier<ScopeName>, string>();

/** SDK-internal: records the localisation key a complex-trigger-modifier row's `desc` resolved to. */
export function registerComplexTriggerModifierDescKey(
  modifier: ComplexTriggerModifier<ScopeName>,
  key: string
): void {
  complexTriggerModifierDescKeys.set(modifier, key);
}

/** SDK-internal shared lowering for a `complex_trigger_modifier` row.
 * `refs`, when given, collects the content references `potential` writes. */
export function complexTriggerModifierEntry(
  modifier: ComplexTriggerModifier<ScopeName>,
  refs?: ContentRefUse[]
): PdxEntry {
  const entries: PdxEntry[] = [kv("trigger", modifier.trigger)];
  if (modifier.triggerScope !== undefined) {
    entries.push(kv("trigger_scope", modifier.triggerScope));
  }
  if (modifier.parameters !== undefined) {
    entries.push(
      block(
        "parameters",
        Object.entries(modifier.parameters).map(([name, value]) => kv(name, value))
      )
    );
  }
  entries.push(kv("mode", modifier.mode));
  if (modifier.mult !== undefined) {
    entries.push(kv("mult", modifier.mult));
  }
  if (modifier.multiplier !== undefined) {
    entries.push(kv("multiplier", modifier.multiplier));
  }
  if (modifier.divide !== undefined) {
    entries.push(kv("divide", modifier.divide));
  }
  if (modifier.minValue !== undefined) {
    entries.push(kv("min_value", modifier.minValue));
  }
  if (modifier.maxValue !== undefined) {
    entries.push(kv("max_value", modifier.maxValue));
  }
  if (modifier.desc !== undefined) {
    const key = complexTriggerModifierDescKeys.get(modifier);
    if (key === undefined) {
      throw new Error(
        "ComplexTriggerModifier.desc is display text that must be registered as localization " +
          "before it can be lowered, and this row was never registered. desc is only supported " +
          "on complex trigger modifiers inside a content definition's WeightBlock — see " +
          "Modifier.desc for the same constraint on the sibling row kind."
      );
    }
    entries.push(kv("desc", key));
  }
  if (modifier.potential !== undefined) {
    entries.push(block("potential", [...modifier.potential.entries]));
    refs?.push(...modifier.potential.refs);
  }
  return block("complex_trigger_modifier", entries);
}

// ---------------------------------------------------------------------------
// In-game branching
// ---------------------------------------------------------------------------

/**
 * The chain returned by `if`. PDXScript associates `else_if`/`else` with the
 * preceding `if` purely by position, so the chain guards against effects
 * being recorded between its links — that would silently detach the `else`.
 */
export interface IfChain<S extends ScopeName> {
  elseIf(condition: Trigger<S>, body: (scope: ScopeObjOf<S>) => void): IfChain<S>;
  else(body: (scope: ScopeObjOf<S>) => void): void;
}

class IfChainRecorder {
  private readonly sink: PdxEntry[];
  private readonly refs: ContentRefUse[];
  private mark: number;

  constructor(sink: PdxEntry[], refs: ContentRefUse[]) {
    this.sink = sink;
    this.refs = refs;
    this.mark = sink.length;
  }

  private guard(link: string): void {
    if (this.sink.length !== this.mark) {
      throw new Error(
        `Effects were recorded between an if() chain's links; the game associates ` +
          `'${link}' with the preceding 'if' by position, so this would silently detach it. ` +
          `Finish the chain before recording more effects.`
      );
    }
  }

  elseIf(condition: Trigger<ScopeName>, body: (scope: unknown) => void): IfChainRecorder {
    this.guard("else_if");
    this.sink.push(conditionalBlock("else_if", condition, body, this.refs));
    this.mark = this.sink.length;
    return this;
  }

  else(body: (scope: unknown) => void): void {
    this.guard("else");
    this.sink.push(block("else", recordEffects(this.refs, body)));
    this.mark = this.sink.length;
  }
}

function conditionalBlock(
  key: string,
  condition: Trigger<ScopeName>,
  body: (scope: unknown) => void,
  refs: ContentRefUse[]
): PdxEntry {
  const child: PdxEntry[] = [block("limit", [...condition.entries])];
  refs.push(...condition.refs);
  recordEffects(refs, body, child);
  return block(key, child);
}

// ---------------------------------------------------------------------------
// The structural surface every scope object carries
// ---------------------------------------------------------------------------

/** One arm of a `random_list`: trigger-ish parts as data, effects as a closure. */
export interface RandomListArm<S extends ScopeName> {
  readonly weight: number;
  readonly modifiers?: readonly Modifier<S>[];
  readonly do: (scope: ScopeObjOf<S>) => void;
}

/**
 * Control flow and the few effects whose types the rules cannot express —
 * the audited `HAND_WRITTEN_EFFECTS` list in the codegen overlay. Every
 * generated scope interface extends this.
 */
export interface StructuralEffects<S extends ScopeName> {
  /**
   * In-game branching: `if = { limit = { ... } ... }`. This is the in-game
   * counterpart of a TypeScript `if`, which branches at build time. Chain
   * `.elseIf(...)` and `.else(...)` before recording any further effects.
   */
  if(condition: Trigger<S>, body: (scope: ScopeObjOf<S>) => void): IfChain<S>;

  /**
   * Keeps the enclosed effects out of generated tooltips:
   * `hidden_effect = { ... }`. They still run; the player is just not shown
   * them. The block changes no scope, so the closure gets the same scope back
   * — it takes one at all because the entries have to land inside the hidden
   * block rather than beside it.
   */
  hiddenEffect(body: (scope: ScopeObjOf<S>) => void): void;

  /** Picks one arm at random, weighted; modifiers adjust weights in-game. */
  randomList(arms: ReadonlyArray<RandomListArm<S>>): void;

  /** `random_list` that shows only the chosen arm in tooltips. */
  lockedRandomList(arms: ReadonlyArray<RandomListArm<S>>): void;

  /** Runs the body with the given percent chance, in-game. */
  random(
    args: { chance: number; modifiers?: readonly Modifier<S>[] },
    body: (scope: ScopeObjOf<S>) => void
  ): void;

  /** `while = { count/limit ... }` — in-game iteration. */
  whileLoop(
    args: { count?: number; limit?: Trigger<S> },
    body: (scope: ScopeObjOf<S>) => void
  ): void;

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

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

/**
 * Records an id-valued argument as a content reference when the generated meta
 * says every form the field admits is a `<type>` reference. A field that also
 * admits plain scalars says nothing about any registry and is left alone —
 * the same rule the content field tables follow.
 */
function recordRef(
  refs: ContentRefUse[],
  targets: readonly string[] | undefined,
  field: string,
  value: string | number | boolean | PdxScalar
): void {
  // A `var` node's `typeof` is `"object"`, so a `@name` scripted-variable
  // reference already falls out of `typeof value === "string"` here — it is
  // never itself a content id, so it is correctly left unrecorded.
  if (targets !== undefined && typeof value === "string") {
    refs.push({ targets, id: value, field });
  }
}

function fieldEntries(
  fields: readonly EffectFieldMeta[],
  args: Record<string, unknown>,
  path: string,
  refs: ContentRefUse[]
): PdxEntry[] {
  const entries: PdxEntry[] = [];
  for (const field of fields) {
    const value = args[field.prop];
    if (value === undefined) {
      continue;
    }
    switch (field.kind) {
      case "value": {
        const scalar = toScalar(value);
        recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
        entries.push(kv(field.key, scalar));
        break;
      }
      case "comparison":
        if (Array.isArray(value)) {
          entries.push(cmp(field.key, value[0] as PdxOp, value[1] as number));
        } else {
          const scalar = toScalar(value);
          recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
          entries.push(kv(field.key, scalar));
        }
        break;
      case "trigger":
        entries.push(block(field.key, [...(value as Trigger).entries]));
        refs.push(...(value as Trigger).refs);
        break;
      case "effect":
        entries.push(block(field.key, recordEffects(refs, value as (scope: unknown) => void)));
        break;
      case "modifiers":
        entries.push(
          block(
            field.key,
            (value as readonly Modifier<ScopeName>[]).map((modifier) =>
              modifierEntry(modifier, refs)
            )
          )
        );
        break;
    }
  }
  return entries;
}

function weightedList(key: string, sink: PdxEntry[], refs: ContentRefUse[]) {
  return (arms: ReadonlyArray<RandomListArm<ScopeName>>): void => {
    const armBlocks = arms.map((arm) => {
      const child: PdxEntry[] = (arm.modifiers ?? []).map((modifier) =>
        modifierEntry(modifier, refs)
      );
      recordEffects(refs, arm.do as (scope: unknown) => void, child);
      return block(String(arm.weight), child);
    });
    sink.push(block(key, armBlocks));
  };
}

const STRUCTURAL: Record<
  string,
  ((sink: PdxEntry[], refs: ContentRefUse[]) => unknown) | undefined
> = {
  if: (sink, refs) => (condition: Trigger<ScopeName>, body: (scope: unknown) => void) => {
    sink.push(conditionalBlock("if", condition, body, refs));
    return new IfChainRecorder(sink, refs);
  },

  target: (sink, refs) => (body: (scope: unknown) => void) => {
    sink.push(block("target", recordEffects(refs, body)));
  },

  hiddenEffect: (sink, refs) => (body: (scope: unknown) => void) => {
    sink.push(block("hidden_effect", recordEffects(refs, body)));
  },

  randomList: (sink, refs) => weightedList("random_list", sink, refs),
  lockedRandomList: (sink, refs) => weightedList("locked_random_list", sink, refs),

  random:
    (sink, refs) =>
    (
      args: { chance: number; modifiers?: readonly Modifier<ScopeName>[] },
      body: (scope: unknown) => void
    ) => {
      const child: PdxEntry[] = [kv("chance", args.chance)];
      child.push(...(args.modifiers ?? []).map((modifier) => modifierEntry(modifier, refs)));
      recordEffects(refs, body, child);
      sink.push(block("random", child));
    },

  whileLoop:
    (sink, refs) =>
    (args: { count?: number; limit?: Trigger<ScopeName> }, body: (scope: unknown) => void) => {
      const child: PdxEntry[] = [];
      if (args.count !== undefined) {
        child.push(kv("count", args.count));
      }
      if (args.limit !== undefined) {
        child.push(block("limit", [...args.limit.entries]));
        refs.push(...args.limit.refs);
      }
      recordEffects(refs, body, child);
      sink.push(block("while", child));
    },

  saveEventTargetAs: (sink) => (target: EventTarget) => {
    sink.push(kv("save_event_target_as", target.name));
  },

  saveGlobalEventTargetAs: (sink) => (target: EventTarget) => {
    sink.push(kv("save_global_event_target_as", target.name));
  },

  run: (sink) => (effect: ScriptedEffectCall) => {
    sink.push(...effect.entries);
  },

  addResource: (sink) => (args: { resource: string; amount: number; mult?: number }) => {
    const entries: PdxEntry[] = [kv(args.resource, args.amount)];
    if (args.mult !== undefined) {
      entries.push(kv("mult", args.mult));
    }
    sink.push(block("add_resource", entries));
  },
};

// The `target` scope link's landing scope varies per definition
// (`output_scope = any` in links.cwt) and is declared nowhere the SDK can
// read, so — unlike the generated links — the author asserts it. The method
// exists only on the four scopes the link is valid in; the runtime entry in
// STRUCTURAL is scope-agnostic like everything else.
declare module "./generated/effects.ts" {
  interface SituationScope {
    /** Opens the situation's target as the asserted scope: `target = { ... }`. */
    target<S2 extends ScopeName>(body: (scope: ScopeObjOf<S2>) => void): void;
  }
  interface SpyNetworkScope {
    /** Opens the spy network's target country: `target = { ... }`. */
    target<S2 extends ScopeName>(body: (scope: ScopeObjOf<S2>) => void): void;
  }
  interface EspionageOperationScope {
    /** Opens the operation's target as the asserted scope: `target = { ... }`. */
    target<S2 extends ScopeName>(body: (scope: ScopeObjOf<S2>) => void): void;
  }
  interface AgreementScope {
    /** Opens the agreement's target as the asserted scope: `target = { ... }`. */
    target<S2 extends ScopeName>(body: (scope: ScopeObjOf<S2>) => void): void;
  }
}

// ---------------------------------------------------------------------------
// Fire effects — one encoder per event kind, from the generated table
// ---------------------------------------------------------------------------

interface FireCallArgs {
  readonly id: { readonly id: string };
  readonly days?: number;
  readonly months?: number;
  readonly years?: number;
  readonly random?: number;
  readonly from?: { readonly path: string };
}

function fireEffect(key: string) {
  return (sink: PdxEntry[]) =>
    (args: FireCallArgs): void => {
      const entries: PdxEntry[] = [kv("id", args.id.id)];
      for (const field of ["days", "months", "years", "random"] as const) {
        const value = args[field];
        if (value !== undefined) {
          entries.push(kv(field, value));
        }
      }
      // `from: ctx.self` is the natural FROM (the firing event's own scope) —
      // nothing to emit. Any other ref is the game's own override mechanism.
      if (args.from !== undefined && args.from.path !== "this") {
        entries.push(block("scopes", [kv("from", args.from.path)]));
      }
      sink.push(block(key, entries));
    };
}

function methodName(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

for (const kind of Object.values(EVENT_KINDS)) {
  STRUCTURAL[methodName(kind.key)] = fireEffect(kind.key);
}

function makeAnyScope(sink: PdxEntry[], refs: ContentRefUse[]): unknown {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      const structural = STRUCTURAL[prop];
      if (structural !== undefined) {
        return structural(sink, refs);
      }
      const meta = EFFECT_META[prop];
      if (meta === undefined) {
        throw new Error(
          `Unknown effect "${prop}" — not in the generated effect meta table. ` +
            `Nothing is recorded silently; if this is a real effect, codegen is missing it.`
        );
      }
      const shape = meta.shape;
      switch (shape.kind) {
        case "bool":
          return (value: boolean = true) => sink.push(kv(meta.key, value));
        case "value":
          return (value: unknown) => {
            const scalar = toScalar(value);
            recordRef(refs, shape.refTypes, meta.key, scalar);
            sink.push(kv(meta.key, scalar));
          };
        case "fields":
          return (args: Record<string, unknown>) =>
            sink.push(block(meta.key, fieldEntries(shape.fields ?? [], args, meta.key, refs)));
        case "wrapper":
          if (shape.fields === null) {
            return (body: (scope: unknown) => void) => {
              sink.push(block(meta.key, recordEffects(refs, body)));
            };
          }
          return (args: Record<string, unknown>, body: (scope: unknown) => void) => {
            const child: PdxEntry[] = fieldEntries(shape.fields ?? [], args, meta.key, refs);
            recordEffects(refs, body, child);
            sink.push(block(meta.key, child));
          };
      }
    },
  });
}

/**
 * Builds the scope object an effect closure receives. The recorder is
 * scope-agnostic at runtime — the interface named by S is what restricts
 * which effects exist in which scope. This is the design's one cast.
 *
 * `refs` collects the content references the closure writes, so an id reaching
 * the output through a script closure faces the same integrity check as one
 * written into a declarative content field. Callers that have no build to
 * check against (the testing helpers) can let it default and discard them.
 */
/**
 * The PDXScript keys the generated effect table knows, by the name they are
 * *written* as — `set_country_flag`, not `setCountryFlag`.
 *
 * Built once, lazily, because the table has a few thousand entries and most
 * builds never ask this question.
 */
let effectKeys: Set<string> | undefined;

/**
 * Is `key` a real game effect the SDK knows how to write?
 *
 * Exists so a consumer can tell "a real effect this tool has not implemented"
 * apart from "not an effect at all" — a distinction that changes what the
 * reader should do about it, and the only thing outside this module has ever
 * wanted from `EFFECT_META`. Narrow on purpose: the meta table is generated
 * output whose shape belongs to codegen, and exporting it would freeze that
 * shape into the public API to answer a yes/no question.
 */
export function isEffectKey(key: string): boolean {
  effectKeys ??= new Set(
    Object.values(EFFECT_META).flatMap((meta) => (meta === undefined ? [] : [meta.key]))
  );
  return effectKeys.has(key);
}

export function makeScope<S extends ScopeName>(
  sink: PdxEntry[],
  refs: ContentRefUse[] = []
): ScopeObjOf<S> {
  return makeAnyScope(sink, refs) as ScopeObjOf<S>;
}

/**
 * Runs one effect closure against a fresh block, and returns its entries.
 *
 * The single entry point for "record effects into a new block", used by the
 * recorder's own nested blocks and by every caller that starts one — an
 * event's `immediate`, a content definition's effect field. Going through here
 * is what keeps {@link ScopeRef.effects} writing into the innermost block: the
 * recording is on the stack for exactly as long as the body runs.
 */
export function recordEffects<S extends ScopeName>(
  refs: ContentRefUse[],
  body: (scope: ScopeObjOf<S>) => void,
  into: PdxEntry[] = []
): PdxEntry[] {
  RECORDINGS.push({ sink: into, refs });
  try {
    body(makeAnyScope(into, refs) as ScopeObjOf<S>);
  } finally {
    // Popped even when the body throws: an author's error inside one closure
    // must not leave every later closure recording into a dead block.
    RECORDINGS.pop();
  }
  return into;
}
