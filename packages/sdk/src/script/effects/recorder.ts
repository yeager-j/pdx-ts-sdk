/** The scope-agnostic effect recorder behind generated scope interfaces. */

import { block, cmp, kv, type PdxEntry, type PdxOp, type PdxScalar } from "@pdx-ts/pdxscript";

import { EFFECT_META, type EffectFieldMeta } from "../../generated/effect-meta.ts";
import type { ScopeObjOf } from "../../generated/effects.ts";
import { EVENT_KINDS } from "../../generated/events.ts";
import { refId } from "../../generated/refs.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { ContentRefUse } from "../../references.ts";
import { toScalar } from "../scalar.ts";
import type { ScriptedEffectCall } from "../scripted.ts";
import { trigger, type Trigger } from "../trigger-core.ts";
import { modifierEntry } from "./modifiers.ts";

import "./event-chains.ts";

import { conditionalBlock, IfChainRecorder, type RecordingState } from "./structural.ts";
import type {
  EventTarget,
  Modifier,
  RandomListArm,
  ScopeRef,
  ScopeValue,
  ScriptCtx,
} from "./types.ts";

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
interface Recording extends RecordingState {
  readonly sink: PdxEntry[];
  readonly refs: ContentRefUse[];
  /**
   * False once {@link recordEffects} has popped this recording — the closure
   * returned, and its entries are finished data the caller has already put in
   * a block. The scope object handed to that closure keeps a reference to the
   * sink, so an author who stores it somewhere outliving the closure can still
   * reach it; every dispatch path of the scope object checks this flag so that
   * reaches {@link assertLive} instead of the sink.
   */
  live: boolean;
}

const RECORDINGS: Recording[] = [];

/**
 * Refuses a call on a scope object whose closure has already returned.
 *
 * Without this the call succeeds: the entry lands in an array `block()` stored
 * by reference, so a `PureMod` that `buildMod` already froze and returned
 * renders different bytes on the *next* `render` — a build with no error and
 * no symptom until someone compares two renders. `undefined` is the
 * {@link makeScope} seam, whose caller owns the sink it passed in and so has
 * no closure to escape from.
 */
function assertLive(recording: RecordingState | undefined, member: string): void {
  if (recording === undefined || recording.live) {
    return;
  }
  throw new Error(
    `'${member}' was called on a scope object whose effect closure has already returned, so ` +
      "there is no longer a block for its entries to land in. The closure's entries were " +
      "finished and handed to the caller when it returned; recording into them now would " +
      "change what an already-built mod renders, silently and only on the next render(). " +
      "Record every effect inside the closure that receives the scope — a definition's " +
      "effect field, an event's immediate/after/option — rather than storing the scope " +
      "object and using it later."
  );
}

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

export function scriptCtx<Self extends ScopeName, From extends ScopeName | undefined>(): ScriptCtx<
  Self,
  From
> {
  return { self: scopeValue("this"), from: scopeRef("from") } as ScriptCtx<Self, From>;
}

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

// `recording` is the third parameter only `if` reads — the chain it returns
// outlives the call that made it, so it has to carry the liveness the scope
// object checks. Every other entry ignores it.
const STRUCTURAL: Record<
  string,
  | ((sink: PdxEntry[], refs: ContentRefUse[], recording: Recording | undefined) => unknown)
  | undefined
> = {
  if:
    (sink, refs, recording) => (condition: Trigger<ScopeName>, body: (scope: unknown) => void) => {
      sink.push(conditionalBlock("if", condition, body, refs, recordEffects));
      return new IfChainRecorder(sink, refs, recording, recordEffects, assertLive);
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

  addEventChainCounter: eventChainCounterEffect("add_event_chain_counter", true),

  resetEventChainCounter: eventChainCounterEffect("reset_event_chain_counter", false),
};

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
  readonly from?: { readonly path: string };
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
  return (sink: PdxEntry[]) =>
    (args: FireCallArgs): void => {
      const entries: PdxEntry[] = [kv("id", refId(args.id))];
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

/**
 * A scope object over a sink the caller already holds — no recording, so no
 * liveness to check: there is no closure for it to escape, and its owner can
 * read the entries it records whenever it likes. The closure-facing path is
 * {@link recordEffects}, whose scope objects die with their closure.
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
 * The single entry point for "record effects into a new block", used by the
 * recorder's own nested blocks and by every caller that starts one — an
 * event's `immediate`, a content definition's effect field. Going through here
 * is what keeps {@link ScopeRef.effects} writing into the innermost block: the
 * recording is on the stack for exactly as long as the body runs.
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
  const recording: Recording = { sink: into, refs, live: true };
  RECORDINGS.push(recording);
  let result: unknown;
  try {
    result = body(makeAnyScope(into, refs, recording) as ScopeObjOf<S>);
  } finally {
    // Popped even when the body throws: an author's error inside one closure
    // must not leave every later closure recording into a dead block. Marked
    // dead for the same reason it is popped — the entries are finished either
    // way, so a scope object that outlived the closure must not reach them.
    RECORDINGS.pop();
    recording.live = false;
  }
  assertSynchronousClosure(result, "An effect closure");
  return into;
}

/**
 * SDK-internal: refuses a recording closure that returned a promise.
 *
 * `(scope) => void` accepts an `async` function — TypeScript allows any return
 * type where `void` is expected — and the return value used to be discarded,
 * so an author who wrote `async` got a mod that built cleanly and was quietly
 * wrong: everything before the first `await` recorded, the recording ended
 * when the closure returned at that `await`, and everything after it either
 * vanished or (since recorders die with their recording) threw into a floating
 * promise as an unhandled rejection. Neither failed the build.
 *
 * Callers check *after* closing their recording, so a throw here cannot leave
 * one open. Thenable rather than `instanceof Promise`, so a non-native promise
 * is caught too; anything else a closure happens to return is ignored, since
 * returning a value from a void-typed closure is harmless and common
 * (`(s) => s.log("x")` returns whatever `log` returns).
 *
 * The abandoned promise is *observed* before the throw, because refusing it is
 * not the same as containing it. Its continuation still runs, still reaches
 * for a recorder that is now dead, and still rejects — with nothing attached,
 * that is an `unhandledRejection`, which by default terminates the process.
 * A caller who catches the build error this throws would have had their
 * process killed anyway, moments later, by the very failure they caught. The
 * no-op handler makes this diagnostic the whole of the failure.
 */
export function assertSynchronousClosure(result: unknown, subject: string): void {
  if (
    result === null ||
    (typeof result !== "object" && typeof result !== "function") ||
    typeof (result as { then?: unknown }).then !== "function"
  ) {
    return;
  }
  // `Promise.resolve` adopts the thenable rather than calling `then` here, so
  // a thenable that misbehaves — throwing from `then`, resolving twice —
  // rejects this wrapper instead of escaping, and the wrapper is handled.
  void Promise.resolve(result as PromiseLike<unknown>).catch(() => {});
  throw new Error(
    `${subject} returned a promise, which means it was declared \`async\` or returned a ` +
      "thenable. Authoring is recorded synchronously: the recording ended the moment the " +
      "closure returned at its first `await`, so only what was recorded before that await was " +
      "captured, and anything after it is silently lost or throws where nothing can catch it. " +
      "Do the asynchronous work before authoring — await it, then pass the result into the " +
      "definition — and keep the closure itself synchronous. A recording closure describes " +
      "what the game should do; it never waits for anything at build time."
  );
}
