/**
 * The scope-agnostic effect recorder behind generated scope interfaces: the
 * Proxy that dispatches a method name to what it writes, the scope values and
 * refs an author navigates, and the entry points that record one closure.
 *
 * The two halves it is assembled from are `recording.ts`, which owns the
 * recording lifecycle, and `field-encoding.ts`, which reads the generated
 * field metadata.
 */

import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { assertNever } from "../../assert-never.ts";
import { EFFECT_META } from "../../generated/effect-meta.ts";
import { FIRE_EFFECT_KEYS, type StructuralEffectMethod } from "../../generated/effect-policy.ts";
import type { ScopeObjOf } from "../../generated/effects.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { ContentRefUse } from "../../references.ts";
import { refId, toScalar } from "../scalar.ts";
import type { ScriptedEffectCall } from "../scripted.ts";
import { trigger, type Trigger } from "../trigger-core.ts";
import { fieldEntries, recordRef } from "./field-encoding.ts";
import { modifierEntry } from "./modifiers.ts";

import "./event-chains.ts";

import {
  activeRecording,
  assertLive,
  assertOwnedBy,
  assertSynchronousClosure,
  closeRecording,
  hasEscaped,
  openRecording,
  withLease,
  type Recording,
  type ScriptLease,
} from "./recording.ts";
import { conditionalBlock, IfChainRecorder, type RecordEffects } from "./structural.ts";
import type {
  EventTarget,
  Modifier,
  RandomListArm,
  ScopeRef,
  ScopeValue,
  ScriptCtx,
} from "./types.ts";

const cannotWitnessNaturalFrom = Symbol("cannotWitnessNaturalFrom");
const scopeLease = Symbol("scopeLease");
interface RuntimeScopeValue {
  readonly [cannotWitnessNaturalFrom]?: true;
  readonly [scopeLease]?: ScriptLease;
}

export function eventTarget<S extends ScopeName>(name: string): EventTarget<S> {
  return { ...scopeRef<S>(`event_target:${name}`), name };
}

/** SDK-internal: an unchecked value for a well-known path (`this`). */
export function scopeValue<S extends ScopeName>(
  path: string,
  canWitnessNaturalFrom = true
): ScopeValue<S> {
  return {
    kind: "scope-ref",
    path,
    ...(canWitnessNaturalFrom ? {} : { [cannotWitnessNaturalFrom]: true as const }),
  };
}

/**
 * SDK-internal: an unchecked openable ref for absolute paths (`from`).
 *
 * A ref made with a lease can only be opened inside a recording of the
 * authoring call that holds that lease; one made without a lease — an event
 * target, a bare path — is openable in any recording, which is what makes a
 * declared target reusable across definitions.
 */
export function scopeRef<S extends ScopeName>(path: string, lease?: ScriptLease): ScopeRef<S> {
  return {
    ...scopeValue<S>(path),
    ...(lease === undefined ? {} : { [scopeLease]: lease }),
    effects(body) {
      const recording = activeRecording(path);
      assertOwnedBy(recording, lease, path);
      recording.sink.push(block(path, recordBlock(recording, recording.refs, body)));
    },
    // No lease check: a trigger is a value built with nothing recording, so it
    // reaches output only where its holder writes it.
    trigger(condition) {
      return trigger([block(path, [...condition.entries])], [...condition.refs]);
    },
  };
}

/**
 * SDK-internal: the value form of one generated scope link — `root.owner`.
 *
 * The generated links call this with the base an author wrote and their own
 * script key; the path composition and the ref-ness rule live here rather than
 * in a few hundred identical generated bodies.
 *
 * Two rules, both read off what the game writes. A relative base contributes
 * no prefix — vanilla writes `capital_scope`, never `this.capital_scope` — and
 * navigation preserves absoluteness rather than conferring it: `from.owner`
 * still names the same scope wherever it is written, so it stays openable,
 * while `this.owner` does not and must not.
 */
export function navigateScope<S extends ScopeName>(base: ScopeValue, key: string): ScopeValue<S> {
  const path = base.path === "this" ? key : `${base.path}.${key}`;
  return "effects" in base && base.path !== "this"
    ? // Navigation carries the base's lease too: `owner(ctx.from)` opens a
      // block of the same authoring call `ctx.from` came from.
      scopeRef<S>(path, (base as RuntimeScopeValue)[scopeLease])
    : scopeValue<S>(path);
}

/**
 * Refuses a ctx ref that witnesses an event fire in another call's recording.
 * `undefined` is the {@link makeScope} seam, which has no authoring call to
 * escape from.
 */
function assertWitnessOwnedBy(
  recording: Recording | undefined,
  witness: FireCallArgs["from"],
  key: string
): void {
  if (recording === undefined || witness === undefined) {
    return;
  }
  if (!hasEscaped(recording, witness[scopeLease])) {
    return;
  }
  throw new Error(
    `'${witness.path}' was passed as the FROM witness of '${key}' from a ScriptCtx belonging ` +
      "to a different definition, so the context escaped the closure it was handed to. The " +
      "fire site would write it as this definition's FROM override while the scope it names " +
      "is the one the earlier definition's rules supply. Use the ctx the closure being " +
      "written receives, rather than one kept from an earlier one."
  );
}

/**
 * Runs one authoring call's body with the three ambient scopes.
 *
 * The three are the fixed script paths they always are. `Root` defaults to
 * `Self` on {@link ScriptCtx}'s terms — an event's blocks are the top level,
 * so ROOT is the event's own scope — and a caller whose rules say otherwise
 * names it. Which of the three a given closure may *read* is the type
 * argument's business; the object handed over carries all three either way,
 * since they are the same three words in the output regardless.
 *
 * The ctx lives for this call: `root` and `from` may be opened as blocks in
 * any recording started while the body runs — one event's ctx serves its
 * `immediate`, its `after` and every option — and nowhere else. Opening one
 * later reaches `assertOwnedBy`, which is why the ctx is built here rather
 * than handed out as a value the caller keeps.
 */
export function withScriptCtx<
  Self extends ScopeName,
  From extends ScopeName | undefined,
  Root extends ScopeName | undefined = Self,
  T = void,
>(options: { readonly splitRoot?: boolean }, body: (ctx: ScriptCtx<Self, From, Root>) => T): T {
  return withLease((lease) => {
    const ctx = {
      self: scopeValue("this", options.splitRoot !== true),
      root: scopeRef("root", lease),
      from: scopeRef("from", lease),
    } as ScriptCtx<Self, From, Root>;

    return body(ctx);
  });
}

function weightedList(
  key: string,
  sink: PdxEntry[],
  refs: ContentRefUse[],
  owner: Recording | undefined
) {
  return (arms: ReadonlyArray<RandomListArm<ScopeName>>): void => {
    const armBlocks = arms.map((arm) => {
      const child: PdxEntry[] = (arm.modifiers ?? []).map((modifier) =>
        modifierEntry(modifier, refs)
      );
      recordBlock(owner, refs, arm.do as (scope: unknown) => void, child);
      return block(String(arm.weight), child);
    });
    sink.push(block(key, armBlocks));
  };
}

// `recording` is the third parameter: the recording that owns `sink`. Entries
// that open a block need it so the block inherits its owner's lease, and `if`
// also passes it to the chain it returns, which outlives the call that made it
// and has to carry the liveness the scope object checks.
type StructuralFactory = (
  sink: PdxEntry[],
  refs: ContentRefUse[],
  recording: Recording | undefined
) => unknown;

const STRUCTURAL_BASE = {
  if:
    (sink, refs, recording) => (condition: Trigger<ScopeName>, body: (scope: unknown) => void) => {
      const record = nestedRecorder(recording);
      sink.push(conditionalBlock("if", condition, body, refs, record));
      return new IfChainRecorder(sink, refs, recording, record, assertLive);
    },

  target: (sink, refs, recording) => (body: (scope: unknown) => void) => {
    sink.push(block("target", recordBlock(recording, refs, body)));
  },

  hiddenEffect: (sink, refs, recording) => makeEffectPath(sink, refs, recording, ["hidden_effect"]),

  randomList: (sink, refs, recording) => weightedList("random_list", sink, refs, recording),
  lockedRandomList: (sink, refs, recording) =>
    weightedList("locked_random_list", sink, refs, recording),

  random:
    (sink, refs, recording) =>
    (
      args: { chance: number; modifiers?: readonly Modifier<ScopeName>[] },
      body: (scope: unknown) => void
    ) => {
      const child: PdxEntry[] = [kv("chance", args.chance)];
      child.push(...(args.modifiers ?? []).map((modifier) => modifierEntry(modifier, refs)));
      recordBlock(recording, refs, body, child);
      sink.push(block("random", child));
    },

  whileLoop:
    (sink, refs, recording) =>
    (args: { count?: number; limit?: Trigger<ScopeName> }, body: (scope: unknown) => void) => {
      const child: PdxEntry[] = [];
      if (args.count !== undefined) {
        child.push(kv("count", args.count));
      }
      if (args.limit !== undefined) {
        child.push(block("limit", [...args.limit.entries]));
        refs.push(...args.limit.refs);
      }
      recordBlock(recording, refs, body, child);
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

  addEventChainCounter: eventChainCounterEffect("add_event_chain_counter", true),

  resetEventChainCounter: eventChainCounterEffect("reset_event_chain_counter", false),
} satisfies Record<StructuralEffectMethod, StructuralFactory>;

const STRUCTURAL: Record<string, StructuralFactory | undefined> = { ...STRUCTURAL_BASE };

// The `target` scope link's landing scope varies per definition
// (`output_scope = any` in links.cwt) and is declared nowhere the SDK can
// read, so — unlike the generated links — the author asserts it. The method
// exists only on the four scopes the link is valid in; the runtime entry in
// STRUCTURAL is scope-agnostic like everything else.
declare module "../../generated/effects.ts" {
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
  readonly id: { readonly id: string } | string;
  readonly days?: number;
  readonly months?: number;
  readonly years?: number;
  readonly random?: number;
  readonly from?: { readonly path: string } & RuntimeScopeValue;
}

interface EventChainCounterCallArgs {
  readonly eventChain: { readonly id: string } | string;
  readonly counter: string;
  readonly amount?: unknown;
}

function eventChainCounterEffect(key: string, needsAmount: boolean) {
  return (sink: PdxEntry[], refs: ContentRefUse[]) =>
    (args: EventChainCounterCallArgs): void => {
      const id = String(refId(args.eventChain));
      const entries = [kv("event_chain", id), kv("counter", args.counter)];
      refs.push({ targets: ["event_chain"], id, field: `${key}.event_chain` });
      if (needsAmount) {
        entries.push(kv("amount", toScalar(args.amount!)));
      }
      sink.push(block(key, entries));
    };
}

function fireEffect(key: string) {
  return (sink: PdxEntry[], _refs: ContentRefUse[], recording: Recording | undefined) =>
    (args: FireCallArgs): void => {
      const entries: PdxEntry[] = [kv("id", refId(args.id))];
      for (const field of ["days", "months", "years", "random"] as const) {
        const value = args[field];
        if (value !== undefined) {
          entries.push(kv(field, value));
        }
      }
      if (args.from?.[cannotWitnessNaturalFrom] === true) {
        throw new Error(
          "A split-root effect block cannot use `from: ctx.self` as an event's natural FROM: " +
            "the game supplies ROOT, which differs from this block's THIS scope. Pass `ctx.root` " +
            "when the event expects ROOT, or an absolute scope reference for an explicit override."
        );
      }
      // The witness is the other place a ctx path reaches output, so it
      // carries the same lease rule opening a block does.
      assertWitnessOwnedBy(recording, args.from, key);
      // Natural FROM is the firing execution's ROOT. `ctx.self` can witness
      // that omission only where SELF and ROOT are not known to differ; any
      // other ref uses the game's explicit override mechanism.
      if (args.from !== undefined && args.from.path !== "this") {
        entries.push(block("scopes", [kv("from", args.from.path)]));
      }
      sink.push(block(key, entries));
    };
}

/**
 * A recorder bound to the recording that owns `sink`, for the seams that take
 * one — {@link IfChainRecorder} and {@link fieldEntries}: blocks they open are
 * inside that sink, so they inherit its lease rather than the ambient one.
 */
function nestedRecorder(owner: Recording | undefined): RecordEffects {
  return (refs, body, into) => recordBlock(owner, refs, body, into);
}

function methodName(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

for (const key of FIRE_EFFECT_KEYS) {
  STRUCTURAL[methodName(key)] = fireEffect(key);
}

/**
 * Wraps a dispatched method so the liveness check runs at *call* time as well
 * as at property-access time. Both matter: reading the property is what a
 * leaked scope object usually does late, but a method plucked off a live scope
 * object (`const log = country.log`) and called later would otherwise slip
 * past a check made only in `get`. One wrapper in the dispatcher covers every
 * path below — structural, fire effects, and all four meta shapes — rather
 * than a check repeated in each.
 */
function guarded(recording: Recording | undefined, member: string, dispatch: unknown): unknown {
  if (recording === undefined || typeof dispatch !== "function") {
    return dispatch;
  }
  const call = dispatch as (...args: unknown[]) => unknown;
  return (...args: unknown[]): unknown => {
    assertLive(recording, member);
    return call(...args);
  };
}

/**
 * Builds one lazy effect-block path.
 *
 * Property reads only extend `keys`; the path writes nothing until `effects`
 * records its one leaf closure. Wrapping from the leaf outward keeps the
 * authoring order and PDXScript nesting identical without one recorder per
 * hop. The generated meta table is the runtime authority for which properties
 * are scope navigation rather than ordinary effect methods.
 */
function makeEffectPath(
  sink: PdxEntry[],
  refs: ContentRefUse[],
  recording: Recording | undefined,
  keys: readonly string[]
): unknown {
  const label = keys.join(".");
  const dispatch = (prop: string): unknown => {
    if (prop === "effects") {
      return (body: (scope: unknown) => void): void => {
        let nested = recordBlock(recording, refs, body);
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          nested = [block(keys[index]!, nested)];
        }
        sink.push(...nested);
      };
    }
    if (prop === "hiddenEffect") {
      return makeEffectPath(sink, refs, recording, [...keys, "hidden_effect"]);
    }
    const meta = EFFECT_META[prop];
    if (meta?.shape.kind !== "scope-link") {
      throw new Error(
        `Unknown effect path "${label}.${prop}" — "${prop}" is not a generated scope link. ` +
          "Only hiddenEffect, generated scope links, and the effects() terminal compose."
      );
    }
    return makeEffectPath(sink, refs, recording, [...keys, meta.key]);
  };

  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      // `recordEffects` checks a closure's returned value for a callable
      // `then`. A concise closure may return an unterminated path expression;
      // it is still an unused lazy node, not a promise or a late recording.
      if (prop === "then") {
        return undefined;
      }
      const member = `${label}.${prop}`;
      assertLive(recording, member);
      return guarded(recording, member, dispatch(prop));
    },
  });
}

function makeAnyScope(sink: PdxEntry[], refs: ContentRefUse[], recording?: Recording): unknown {
  const dispatch = (prop: string): unknown => {
    const structural = STRUCTURAL[prop];
    if (structural !== undefined) {
      return structural(sink, refs, recording);
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
          const scalar = toScalar(value, shape.booleanLiterals);
          recordRef(refs, shape.refTypes, meta.key, scalar);
          sink.push(kv(meta.key, scalar));
        };
      case "fields": {
        // `null` is the rules naming no fields at all, which writes an empty
        // block. Codegen's own `fields` shape cannot be null, so this branch
        // exists because the generated type admits the state, not because a
        // row uses it.
        const fields = shape.fields;
        if (fields === null) {
          return () => sink.push(block(meta.key, []));
        }
        return (args: Record<string, unknown>) =>
          sink.push(
            block(meta.key, fieldEntries(fields, args, meta.key, refs, nestedRecorder(recording)))
          );
      }
      case "wrapper": {
        const fields = shape.fields;
        if (fields === null) {
          return (body: (scope: unknown) => void) => {
            sink.push(block(meta.key, recordBlock(recording, refs, body)));
          };
        }
        return (args: Record<string, unknown>, body: (scope: unknown) => void) => {
          const child: PdxEntry[] = fieldEntries(
            fields,
            args,
            meta.key,
            refs,
            nestedRecorder(recording)
          );
          recordBlock(recording, refs, body, child);
          sink.push(block(meta.key, child));
        };
      }
      case "scope-link":
        return makeEffectPath(sink, refs, recording, [meta.key]);
      default:
        return assertNever(shape, "effect shape");
    }
  };

  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      // Access-time as well as call-time (see `guarded`): a dead scope object
      // fails on the property read, before the dispatcher builds anything.
      assertLive(recording, prop);
      return guarded(recording, prop, dispatch(prop));
    },
  });
}

let eventFireKeys: ReadonlySet<string> | undefined;

/** Is `key` one of the generated event-delivery effects? */
export function isEventFireKey(key: string): boolean {
  eventFireKeys ??= new Set(FIRE_EFFECT_KEYS);
  return eventFireKeys.has(key);
}

/**
 * A scope object over a sink the caller already holds — no recording, so no
 * liveness to check: there is no closure for it to escape, and its owner can
 * read the entries it records whenever it likes. The closure-facing path is
 * {@link recordEffects}, whose scope objects die with their closure.
 *
 * The recorder is scope-agnostic at runtime — the interface named by S is what
 * restricts which effects exist in which scope, and this is the design's one
 * cast. `refs` collects the content references the closure writes, so an id
 * reaching the output through a script closure faces the same integrity check
 * as one written into a declarative content field; callers that have no build
 * to check against (the testing helpers) can let it default and discard them.
 */
export function makeScope<S extends ScopeName>(
  sink: PdxEntry[],
  refs: ContentRefUse[] = []
): ScopeObjOf<S> {
  return makeAnyScope(sink, refs) as ScopeObjOf<S>;
}

/**
 * Runs one effect closure against a fresh block, and returns its entries.
 *
 * The entry point for "start a block nothing else is inside" — an event's
 * `immediate`, a content definition's effect field. The recorder's own nested
 * blocks go through {@link recordBlock} with the recording that owns their
 * sink. Going through either is what keeps {@link ScopeRef.effects} writing
 * into the innermost block: the recording is on the stack for exactly as long
 * as the body runs.
 *
 * The scope object the body receives is tied to *this* recording, so nesting
 * works out on its own: a transition's closure gets a scope object of its own
 * recording, and the enclosing one stays live for as long as it is still on
 * the stack — which is exactly as long as writing to it is still meaningful.
 */
export function recordEffects<S extends ScopeName>(
  refs: ContentRefUse[],
  body: (scope: ScopeObjOf<S>) => void,
  into: PdxEntry[] = []
): PdxEntry[] {
  return recordBlock(undefined, refs, body, into);
}

/**
 * {@link recordEffects}, told which recording owns the sink the new block is
 * being written into.
 *
 * The owner settles the lease, because a block belongs to the tree its sink is
 * in rather than to whatever authoring call happens to be running. Definition
 * B can be authored inside definition A's live closure — the SDK is ordinary
 * TypeScript — and a method kept from A's scope object still opens blocks in
 * A's tree while B's call is on the stack. Inheriting the owner's lease is
 * what keeps B's ctx out of A's tree in that case. An owner is absent for a
 * root block and for the {@link makeScope} seam, and both belong to the
 * authoring call now running.
 */
function recordBlock<S extends ScopeName>(
  owner: Recording | undefined,
  refs: ContentRefUse[],
  body: (scope: ScopeObjOf<S>) => void,
  into: PdxEntry[] = []
): PdxEntry[] {
  const recording = openRecording(owner, into, refs);
  let result: unknown;
  try {
    result = body(makeAnyScope(into, refs, recording) as ScopeObjOf<S>);
  } finally {
    closeRecording(recording);
  }
  assertSynchronousClosure(result, "An effect closure");
  return into;
}
