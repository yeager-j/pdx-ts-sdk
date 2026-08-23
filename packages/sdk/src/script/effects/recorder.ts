/** The scope-agnostic effect recorder behind generated scope interfaces. */

import {
  block,
  cmp,
  container,
  kv,
  scalar as pdxScalar,
  type PdxEntry,
  type PdxItem,
  type PdxOp,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { EFFECT_META, type EffectFieldMeta } from "../../generated/effect-meta.ts";
import { FIRE_EFFECT_KEYS, type StructuralEffectMethod } from "../../generated/effect-policy.ts";
import type { ScopeObjOf } from "../../generated/effects.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import type { ContentRefUse } from "../../references.ts";
import {
  isComparisonList,
  isStructuredValue,
  refId,
  toScalar,
  type ComparisonArg,
} from "../scalar.ts";
import type { ScriptedEffectCall } from "../scripted.ts";
import { trigger, type Trigger } from "../trigger-core.ts";
import { modifierEntry } from "./modifiers.ts";

import "./event-chains.ts";

import {
  conditionalBlock,
  IfChainRecorder,
  type RecordEffects,
  type RecordingState,
} from "./structural.ts";
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

/**
 * One authoring call's identity — one {@link withScriptCtx} body, which is one
 * definition's or event's lowering.
 *
 * The ctx that call hands out carries its lease, and so does every recording
 * opened while it runs. Comparing the two is how {@link assertOwnedBy} tells a
 * ctx used where it was given from one that escaped into another definition.
 */
type ScriptLease = symbol;

/** The authoring calls currently running, innermost last. */
const LEASES: ScriptLease[] = [];

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
  /**
   * The authoring call this recording was opened under, or `undefined` for a
   * recording started outside one. A leased ctx ref may only be opened here
   * when the two leases match.
   */
  readonly lease: ScriptLease | undefined;
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

/**
 * Whether `lease` came from an authoring call other than the one `recording`
 * belongs to.
 *
 * A ctx is handed to one definition's closures, and `root` and `from` mean
 * whatever that definition's rules say they hold; used against another
 * definition's recording, they still write, under scopes the game supplies
 * from that definition's rules instead. A value with no lease is reusable by
 * contract — an event target names its scope absolutely — and is never an
 * escape. Each site states its own harm, since what a ctx path writes differs
 * between opening a block and witnessing an event fire.
 */
function hasEscaped(recording: Recording, lease: ScriptLease | undefined): boolean {
  return lease !== undefined && recording.lease !== lease;
}

/** Refuses to open a ctx ref inside another authoring call's recording. */
function assertOwnedBy(recording: Recording, lease: ScriptLease | undefined, path: string): void {
  if (!hasEscaped(recording, lease)) {
    return;
  }
  throw new Error(
    `'${path}' was opened with .effects() from a ScriptCtx belonging to a different ` +
      "definition, so the context escaped the closure it was handed to. Its entries would " +
      `land in this recording as a '${path}' block while keeping the FROM and ROOT scopes ` +
      "of the definition the context came from — scopes the game does not supply here. Use " +
      "the ctx the closure being written receives, rather than one kept from an earlier one."
  );
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
 * later reaches {@link assertOwnedBy}, which is why the ctx is built here
 * rather than handed out as a value the caller keeps.
 */
export function withScriptCtx<
  Self extends ScopeName,
  From extends ScopeName | undefined,
  Root extends ScopeName | undefined = Self,
  T = void,
>(options: { readonly splitRoot?: boolean }, body: (ctx: ScriptCtx<Self, From, Root>) => T): T {
  const lease: ScriptLease = Symbol("scriptCtx");
  const ctx = {
    self: scopeValue("this", options.splitRoot !== true),
    root: scopeRef("root", lease),
    from: scopeRef("from", lease),
  } as ScriptCtx<Self, From, Root>;

  LEASES.push(lease);
  try {
    return body(ctx);
  } finally {
    LEASES.pop();
  }
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

/**
 * The occurrences one authored argument writes, one entry per script key.
 *
 * A repeated field authors an array of values. A comparison instead carries
 * its repetition as a list of operator/operand pairs, since an array of bare
 * operands cannot be told from the single pair `[">", 2]`.
 */
function fieldOccurrences(
  field: EffectFieldMeta,
  value: unknown,
  path: string
): readonly unknown[] {
  if (field.kind === "comparison") {
    const comparison = value as ComparisonArg;
    return isComparisonList(comparison, `${path}.${field.key}`) ? comparison : [comparison];
  }
  return field.repeated === true ? (value as readonly unknown[]) : [value];
}

/**
 * The entries one args object writes for a generated field table, in table
 * order. Reference-bearing ids are appended to `refs` as they are written.
 */
export function fieldEntries(
  fields: readonly EffectFieldMeta[],
  args: Record<string, unknown>,
  path: string,
  refs: ContentRefUse[],
  owner: Recording | undefined
): PdxEntry[] {
  const entries: PdxEntry[] = [];
  for (const field of fields) {
    const value = args[field.prop];
    if (value === undefined) {
      continue;
    }
    const occurrences = fieldOccurrences(field, value, path);
    for (const value of occurrences) {
      switch (field.kind) {
        case "value": {
          const scalar = toScalar(value, field.booleanLiterals);
          recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
          entries.push(kv(field.key, scalar));
          break;
        }
        case "scalar-or-fields":
          if (isStructuredValue(value, field.scalar?.objectKinds ?? [])) {
            entries.push(
              block(
                field.key,
                fieldEntries(
                  field.fields ?? [],
                  value as Record<string, unknown>,
                  `${path}.${field.key}`,
                  refs,
                  owner
                )
              )
            );
          } else {
            const scalar = toScalar(value, field.scalar?.booleanLiterals);
            recordRef(refs, field.scalar?.refTypes, `${path}.${field.key}`, scalar);
            entries.push(kv(field.key, scalar));
          }
          break;
        case "fields":
          entries.push(
            block(
              field.key,
              fieldEntries(
                field.fields ?? [],
                value as Record<string, unknown>,
                `${path}.${field.key}`,
                refs,
                owner
              )
            )
          );
          break;
        case "value-list": {
          const items: PdxItem[] = [];
          for (const item of value as readonly unknown[]) {
            if (
              field.fields !== undefined &&
              (field.scalar === undefined ||
                isStructuredValue(item, field.scalar.objectKinds ?? []))
            ) {
              items.push(
                container(
                  fieldEntries(
                    field.fields,
                    item as Record<string, unknown>,
                    `${path}.${field.key}`,
                    refs,
                    owner
                  )
                )
              );
              continue;
            }
            const scalar = toScalar(item, field.scalar?.booleanLiterals);
            recordRef(refs, field.scalar?.refTypes, `${path}.${field.key}`, scalar);
            items.push(typeof scalar === "object" ? scalar : pdxScalar(scalar));
          }
          entries.push(kv(field.key, container(items)));
          break;
        }
        case "comparison":
          if (Array.isArray(value)) {
            entries.push(cmp(field.key, value[0] as PdxOp, toScalar(value[1])));
          } else {
            const scalar = toScalar(value, field.booleanLiterals);
            recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
            entries.push(kv(field.key, scalar));
          }
          break;
        case "trigger":
          entries.push(block(field.key, [...(value as Trigger).entries]));
          refs.push(...(value as Trigger).refs);
          break;
        case "effect":
          entries.push(
            block(field.key, recordBlock(owner, refs, value as (scope: unknown) => void))
          );
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
  }
  return entries;
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

  previewModifier: (sink, refs) => (modifier: { readonly id: string } | string) => {
    const id = String(refId(modifier));
    refs.push({ targets: ["static_modifier"], id, field: "tooltip.add_modifier.modifier" });
    sink.push(block("tooltip", [block("add_modifier", [kv("modifier", id)])]));
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
 * A recorder bound to the recording that owns `sink`, for the seam that hands
 * one to {@link IfChainRecorder}: blocks the chain opens are inside that sink,
 * so they inherit its lease rather than the ambient one.
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
      case "fields":
        return (args: Record<string, unknown>) =>
          sink.push(
            block(meta.key, fieldEntries(shape.fields ?? [], args, meta.key, refs, recording))
          );
      case "wrapper":
        if (shape.fields === null) {
          return (body: (scope: unknown) => void) => {
            sink.push(block(meta.key, recordBlock(recording, refs, body)));
          };
        }
        return (args: Record<string, unknown>, body: (scope: unknown) => void) => {
          const child: PdxEntry[] = fieldEntries(
            shape.fields ?? [],
            args,
            meta.key,
            refs,
            recording
          );
          recordBlock(recording, refs, body, child);
          sink.push(block(meta.key, child));
        };
      case "scope-link":
        return makeEffectPath(sink, refs, recording, [meta.key]);
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
  const recording: Recording = {
    sink: into,
    refs,
    live: true,
    lease: owner === undefined ? LEASES.at(-1) : owner.lease,
  };
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
