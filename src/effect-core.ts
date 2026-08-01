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

import { block, cmp, kv, type PdxEntry, type PdxOp } from "@pdx-ts/pdxscript";

import { EFFECT_META, type EffectFieldMeta } from "./generated/effect-meta.ts";
import type { ScopeObjOf } from "./generated/effects.ts";
import { EVENT_KINDS } from "./generated/events.ts";
import type { ScopeName } from "./generated/scopes.ts";
import type { Trigger } from "./trigger-core.ts";

// ---------------------------------------------------------------------------
// Scope references
// ---------------------------------------------------------------------------

declare const refScopeBrand: unique symbol;

/**
 * A reference to a scope reachable by name from inside script: an event
 * target, `from`, `this`, or (later) `prev`. Usable wherever the rules expect
 * a `scope[X]` value, and openable as a block via `within`.
 *
 * The brand is covariant: a ref of unknown scope does not assign where a
 * specific scope is required.
 */
export interface ScopeRef<S extends ScopeName = ScopeName> {
  readonly kind: "scope-ref";
  /** The script path this serializes to: `this`, `from`, `event_target:x`. */
  readonly path: string;
  readonly [refScopeBrand]?: S;
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
  return { kind: "scope-ref", path: `event_target:${name}`, name };
}

/** SDK-internal: an unchecked ref for well-known paths (`this`, `from`). */
export function scopeRef<S extends ScopeName>(path: string): ScopeRef<S> {
  return { kind: "scope-ref", path };
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
 */
export interface Modifier<S extends ScopeName> {
  readonly factor?: number;
  readonly add?: number;
  readonly weight?: number;
  readonly subtract?: number;
  readonly mult?: number;
  readonly multiplier?: number;
  readonly divide?: number;
  readonly minValue?: number;
  readonly maxValue?: number;
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

/** SDK-internal shared lowering for a `modifier_rule`/`modifier_rule_with_loc` row. */
export function modifierEntry(modifier: Modifier<ScopeName>): PdxEntry {
  const entries: PdxEntry[] = [];
  if (modifier.factor !== undefined) {
    entries.push(kv("factor", modifier.factor));
  }
  if (modifier.add !== undefined) {
    entries.push(kv("add", modifier.add));
  }
  if (modifier.weight !== undefined) {
    entries.push(kv("weight", modifier.weight));
  }
  if (modifier.subtract !== undefined) {
    entries.push(kv("subtract", modifier.subtract));
  }
  if (modifier.mult !== undefined) {
    entries.push(kv("mult", modifier.mult));
  }
  if (modifier.multiplier !== undefined) {
    entries.push(kv("multiply", modifier.multiplier));
  }
  if (modifier.divide !== undefined) {
    entries.push(kv("divide", modifier.divide));
  }
  if (modifier.minValue !== undefined) {
    entries.push(kv("min", modifier.minValue));
  }
  if (modifier.maxValue !== undefined) {
    entries.push(kv("max", modifier.maxValue));
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
  return block("modifier", entries);
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
  private mark: number;

  constructor(sink: PdxEntry[]) {
    this.sink = sink;
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
    this.sink.push(conditionalBlock("else_if", condition, body));
    this.mark = this.sink.length;
    return this;
  }

  else(body: (scope: unknown) => void): void {
    this.guard("else");
    const child: PdxEntry[] = [];
    body(makeAnyScope(child));
    this.sink.push(block("else", child));
    this.mark = this.sink.length;
  }
}

function conditionalBlock(
  key: string,
  condition: Trigger<ScopeName>,
  body: (scope: unknown) => void
): PdxEntry {
  const child: PdxEntry[] = [block("limit", [...condition.entries])];
  body(makeAnyScope(child));
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

  /** Opens a saved target / FROM ref as a block and records inside it. */
  within<S2 extends ScopeName>(ref: ScopeRef<S2>, body: (scope: ScopeObjOf<S2>) => void): void;

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

  /** Adds resources to the scope's stockpile: `add_resource = { energy = 50 }`. */
  addResource(args: { resource: string; amount: number; mult?: number }): void;
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

function toScalar(value: unknown): string | number | boolean {
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

function fieldEntries(
  fields: readonly EffectFieldMeta[],
  args: Record<string, unknown>
): PdxEntry[] {
  const entries: PdxEntry[] = [];
  for (const field of fields) {
    const value = args[field.prop];
    if (value === undefined) {
      continue;
    }
    switch (field.kind) {
      case "value":
        entries.push(kv(field.key, toScalar(value)));
        break;
      case "comparison":
        entries.push(
          Array.isArray(value)
            ? cmp(field.key, value[0] as PdxOp, value[1] as number)
            : kv(field.key, toScalar(value))
        );
        break;
      case "trigger":
        entries.push(block(field.key, [...(value as Trigger).entries]));
        break;
      case "effect": {
        const child: PdxEntry[] = [];
        (value as (scope: unknown) => void)(makeAnyScope(child));
        entries.push(block(field.key, child));
        break;
      }
      case "modifiers":
        entries.push(
          block(field.key, (value as readonly Modifier<ScopeName>[]).map(modifierEntry))
        );
        break;
    }
  }
  return entries;
}

function weightedList(key: string, sink: PdxEntry[]) {
  return (arms: ReadonlyArray<RandomListArm<ScopeName>>): void => {
    const armBlocks = arms.map((arm) => {
      const child: PdxEntry[] = (arm.modifiers ?? []).map(modifierEntry);
      (arm.do as (scope: unknown) => void)(makeAnyScope(child));
      return block(String(arm.weight), child);
    });
    sink.push(block(key, armBlocks));
  };
}

const STRUCTURAL: Record<string, ((sink: PdxEntry[]) => unknown) | undefined> = {
  if: (sink) => (condition: Trigger<ScopeName>, body: (scope: unknown) => void) => {
    sink.push(conditionalBlock("if", condition, body));
    return new IfChainRecorder(sink);
  },

  within: (sink) => (ref: ScopeRef, body: (scope: unknown) => void) => {
    const child: PdxEntry[] = [];
    body(makeAnyScope(child));
    sink.push(block(ref.path, child));
  },

  randomList: (sink) => weightedList("random_list", sink),
  lockedRandomList: (sink) => weightedList("locked_random_list", sink),

  random:
    (sink) =>
    (
      args: { chance: number; modifiers?: readonly Modifier<ScopeName>[] },
      body: (scope: unknown) => void
    ) => {
      const child: PdxEntry[] = [kv("chance", args.chance)];
      child.push(...(args.modifiers ?? []).map(modifierEntry));
      body(makeAnyScope(child));
      sink.push(block("random", child));
    },

  whileLoop:
    (sink) =>
    (args: { count?: number; limit?: Trigger<ScopeName> }, body: (scope: unknown) => void) => {
      const child: PdxEntry[] = [];
      if (args.count !== undefined) {
        child.push(kv("count", args.count));
      }
      if (args.limit !== undefined) {
        child.push(block("limit", [...args.limit.entries]));
      }
      body(makeAnyScope(child));
      sink.push(block("while", child));
    },

  saveEventTargetAs: (sink) => (target: EventTarget) => {
    sink.push(kv("save_event_target_as", target.name));
  },

  saveGlobalEventTargetAs: (sink) => (target: EventTarget) => {
    sink.push(kv("save_global_event_target_as", target.name));
  },

  addResource: (sink) => (args: { resource: string; amount: number; mult?: number }) => {
    const entries: PdxEntry[] = [kv(args.resource, args.amount)];
    if (args.mult !== undefined) {
      entries.push(kv("mult", args.mult));
    }
    sink.push(block("add_resource", entries));
  },
};

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

function makeAnyScope(sink: PdxEntry[]): unknown {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      const structural = STRUCTURAL[prop];
      if (structural !== undefined) {
        return structural(sink);
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
          return (value: unknown) => sink.push(kv(meta.key, toScalar(value)));
        case "fields":
          return (args: Record<string, unknown>) =>
            sink.push(block(meta.key, fieldEntries(shape.fields ?? [], args)));
        case "wrapper":
          if (shape.fields === null) {
            return (body: (scope: unknown) => void) => {
              const child: PdxEntry[] = [];
              body(makeAnyScope(child));
              sink.push(block(meta.key, child));
            };
          }
          return (args: Record<string, unknown>, body: (scope: unknown) => void) => {
            const child: PdxEntry[] = fieldEntries(shape.fields ?? [], args);
            body(makeAnyScope(child));
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
 */
export function makeScope<S extends ScopeName>(sink: PdxEntry[]): ScopeObjOf<S> {
  return makeAnyScope(sink) as ScopeObjOf<S>;
}
