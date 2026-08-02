/**
 * Probe runtime for the recorded-closure effects model.
 *
 * This is the hand-written prototype of what `src/effect-core.ts` would become
 * if the model holds: ONE runtime recorder (a Proxy over an entry sink) with
 * generated interface types layered over it. Nothing here is generated; the
 * meta table below stands in for the future `src/generated/effect-meta.ts`.
 *
 * The one deliberate cast in the design lives in `makeScope`: the Proxy is
 * scope-agnostic at runtime (types alone restrict which effects exist in which
 * scope), so it is asserted to the per-scope interface. Consumers never cast.
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import type { ScopeName } from "../../packages/sdk/src/generated/scopes.ts";
import type { Trigger } from "../../packages/sdk/src/trigger-core.ts";
import type { KnownScope, ScopeObjOf } from "./scopes-sample.ts";

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
 * save site then enforces it (`PlanetScope.saveEventTargetAs` only accepts an
 * `EventTarget<"planet">`), so reads through the target are scope-safe.
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
// Events
// ---------------------------------------------------------------------------

declare const eventFromBrand: unique symbol;

/**
 * A defined event, usable as the `id` of a fire effect. `From` is the scope
 * the event declared it will be fired from — the phantom that makes firing a
 * `from: "country"` event without a country witness a compile error.
 */
export interface EventRef<
  K extends KnownScope = KnownScope,
  From extends ScopeName | undefined = ScopeName | undefined,
> {
  readonly kind: "event-ref";
  readonly eventKind: K;
  /** The full id, e.g. `hello_probe.2`. */
  readonly id: string;
  readonly [eventFromBrand]?: From;
}

/**
 * The sentinel behind `ctx.from` on an event with no `from:` declaration.
 * Deliberately NOT a `ScopeRef` (and not `never`, which would assign
 * anywhere), so every use site fails with this type's name in the message.
 */
export interface UndeclaredFrom {
  readonly kind: "undeclared-from";
  readonly hint: 'Declare the FROM contract on the event (`from: "country"`) to read FROM.';
}

/**
 * The second argument every event closure receives. `self` doubles as the
 * FROM witness at fire sites: passing `from: ctx.self` proves the fired
 * event's declared FROM matches this event's own scope.
 */
export interface EventCtx<Self extends ScopeName, From extends ScopeName | undefined> {
  readonly self: ScopeRef<Self>;
  /**
   * FROM, as declared by this event's `from:` field. Undeclared events get
   * an inert sentinel — touching FROM without declaring it is a compile error.
   */
  readonly from: [From] extends [ScopeName] ? ScopeRef<From> : UndeclaredFrom;
}

// ---------------------------------------------------------------------------
// Weight modifiers (random_list arms, MTTH, ai_chance)
// ---------------------------------------------------------------------------

/** One `modifier = { ... }` rule: a numeric change gated by a trigger. */
export interface Modifier<S extends ScopeName> {
  readonly factor?: number;
  readonly add?: number;
  readonly weight?: number;
  /** The gating condition, spliced inline per `modifier_rule.cwt`. */
  readonly when: Trigger<S>;
}

function modifierEntry(modifier: Modifier<ScopeName>): PdxEntry {
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
export interface IfChain<S extends KnownScope> {
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
// The effect meta table (stand-in for src/generated/effect-meta.ts)
// ---------------------------------------------------------------------------

type EffectShape =
  | { readonly kind: "noArg" }
  | { readonly kind: "value" }
  /** Ordered [property, scriptKey] pairs for an options-object argument. */
  | { readonly kind: "fields"; readonly order: readonly (readonly [string, string])[] }
  /** `{ limit? }` + closure; the closure records into the pushed scope. */
  | { readonly kind: "iterator" };

interface EffectMeta {
  readonly key: string;
  readonly shape: EffectShape;
}

const EFFECT_META: Record<string, EffectMeta | undefined> = {
  log: { key: "log", shape: { kind: "value" } },
  setCountryFlag: { key: "set_country_flag", shape: { kind: "value" } },
  addDeposit: { key: "add_deposit", shape: { kind: "value" } },
  destroyColony: { key: "destroy_colony", shape: { kind: "noArg" } },
  addModifier: {
    key: "add_modifier",
    shape: {
      kind: "fields",
      order: [
        ["modifier", "modifier"],
        ["days", "days"],
      ],
    },
  },
  everyOwnedPlanet: { key: "every_owned_planet", shape: { kind: "iterator" } },
};

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

// ---------------------------------------------------------------------------
// Structural effects (the future SPECIAL set next to the Proxy)
// ---------------------------------------------------------------------------

interface FireArgs {
  readonly id: { readonly id: string };
  readonly days?: number;
  readonly months?: number;
  readonly years?: number;
  readonly random?: number;
  readonly from?: { readonly path: string };
}

function fireEvent(key: string) {
  return (sink: PdxEntry[]) =>
    (args: FireArgs): void => {
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

const SPECIALS: Record<string, ((sink: PdxEntry[]) => unknown) | undefined> = {
  if: (sink) => (condition: Trigger<ScopeName>, body: (scope: unknown) => void) => {
    sink.push(conditionalBlock("if", condition, body));
    return new IfChainRecorder(sink);
  },

  within: (sink) => (ref: ScopeRef, body: (scope: unknown) => void) => {
    const child: PdxEntry[] = [];
    body(makeAnyScope(child));
    sink.push(block(ref.path, child));
  },

  saveEventTargetAs: (sink) => (target: EventTarget) => {
    sink.push(kv("save_event_target_as", target.name));
  },

  addResource: (sink) => (args: { resource: string; amount: number; mult?: number }) => {
    const entries: PdxEntry[] = [kv(args.resource, args.amount)];
    if (args.mult !== undefined) {
      entries.push(kv("mult", args.mult));
    }
    sink.push(block("add_resource", entries));
  },

  randomList:
    (sink) =>
    (
      arms: ReadonlyArray<{
        readonly weight: number;
        readonly modifiers?: readonly Modifier<ScopeName>[];
        readonly do: (scope: unknown) => void;
      }>
    ) => {
      const armBlocks = arms.map((arm) => {
        const child: PdxEntry[] = (arm.modifiers ?? []).map(modifierEntry);
        arm.do(makeAnyScope(child));
        return block(String(arm.weight), child);
      });
      sink.push(block("random_list", armBlocks));
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

  countryEvent: fireEvent("country_event"),
  planetEvent: fireEvent("planet_event"),
};

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

function makeAnyScope(sink: PdxEntry[]): unknown {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      const special = SPECIALS[prop];
      if (special !== undefined) {
        return special(sink);
      }
      const meta = EFFECT_META[prop];
      if (meta === undefined) {
        throw new Error(
          `Unknown effect "${prop}" — not in the effect meta table. ` +
            `Nothing is recorded silently; if this is a real effect, it is missing from codegen.`
        );
      }
      const shape = meta.shape;
      switch (shape.kind) {
        case "noArg":
          return () => sink.push(kv(meta.key, true));
        case "value":
          return (value: unknown) => sink.push(kv(meta.key, toScalar(value)));
        case "fields":
          return (args: Record<string, unknown>) => {
            const entries: PdxEntry[] = [];
            for (const [prop, scriptKey] of shape.order) {
              const value = args[prop];
              if (value !== undefined) {
                entries.push(kv(scriptKey, toScalar(value)));
              }
            }
            sink.push(block(meta.key, entries));
          };
        case "iterator":
          return (args: { limit?: Trigger<ScopeName> }, body: (scope: unknown) => void) => {
            const child: PdxEntry[] = [];
            if (args.limit !== undefined) {
              child.push(block("limit", [...args.limit.entries]));
            }
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
export function makeScope<S extends KnownScope>(sink: PdxEntry[]): ScopeObjOf<S> {
  return makeAnyScope(sink) as ScopeObjOf<S>;
}
