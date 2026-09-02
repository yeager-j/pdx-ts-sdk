/** The scope-agnostic effect recorder behind generated scope interfaces. */

import {
  block,
  cmp,
  container,
  kv,
  scalar as pdxScalar,
  type PdxContainer,
  type PdxEntry,
  type PdxItem,
  type PdxOp,
  type PdxScalar,
  type PdxValue,
} from "@pdx-ts/pdxscript";

import { fieldEntries as contentFieldEntries } from "../../content/lower.ts";
import { aliasStructFieldsOf } from "../../content/schema.ts";
import {
  ALIAS_LIST_META,
  EFFECT_META,
  type EffectBlockMeta,
  type EffectFieldMeta,
  type EffectMapMeta,
  type EffectScalarMeta,
  type EffectShapeMeta,
} from "../../generated/effect-meta.ts";
import { FIRE_EFFECT_KEYS, type StructuralEffectMethod } from "../../generated/effect-policy.ts";
import type { ScopeObjOf } from "../../generated/effects.ts";
import type { ScopeName } from "../../generated/scopes.ts";
import { recordLocalization, type RecordedRefUse } from "../../references.ts";
import {
  deferredScopePath,
  isComparisonList,
  isEffectBlockValue,
  isStructuredValue,
  localizationScalar,
  mapEntries,
  refId,
  toScalar,
  type ComparisonArg,
  type DeferredScopePathResolver,
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
import {
  AMBIENT_SCOPE_KEYS,
  type AmbientScopeContext,
  type EventTarget,
  type Modifier,
  type RandomListArm,
  type ScopeRef,
  type ScopeValue,
  type ScriptCtx,
} from "./types.ts";

const cannotWitnessNaturalFrom = Symbol("cannotWitnessNaturalFrom");
const lexicalScope = Symbol("lexicalScope");
const scopeLease = Symbol("scopeLease");
const contextPrevDepth = Symbol("contextPrevDepth");
const contextPrevEntry = Symbol("contextPrevEntry");
type ScopeTransition = "same" | "push" | "replace" | "unknown";
type ScopeIdentity = symbol;
interface RuntimeScopeValue {
  readonly [cannotWitnessNaturalFrom]?: true;
  readonly [deferredScopePath]?: DeferredScopePathResolver;
  readonly [lexicalScope]?: true;
  readonly [scopeLease]?: ScriptLease;
  readonly [contextPrevDepth]?: number;
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

/** A declared PREV trigger path deferred until its receiving effect block is known. */
interface ContextPrevEntry {
  readonly [contextPrevEntry]?: {
    readonly path: string;
    readonly declaredDepth: number;
    readonly lease: ScriptLease | undefined;
  };
}

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

function lexicalScopeValue<S extends ScopeName>(
  recording: Recording | undefined
): ScopeValue<S> & RuntimeScopeValue {
  return {
    kind: "scope-ref",
    get path() {
      return lexicalScopePath(recording);
    },
    [deferredScopePath](consumer) {
      return lexicalScopePath(recording, consumer as Recording | undefined);
    },
    [lexicalScope]: true,
  };
}

/**
 * SDK-internal: an openable ref for absolute paths and declared PREV paths.
 *
 * A ref made with a lease can only be opened inside a recording of the
 * authoring call that holds that lease; one made without a lease — an event
 * target, a bare path — is openable in any recording, which is what makes a
 * declared target reusable across definitions.
 */
export function scopeRef<S extends ScopeName>(
  path: string,
  lease?: ScriptLease,
  declaredPrevDepth?: number
): ScopeRef<S> {
  return {
    ...scopeValue<S>(path),
    ...(lease === undefined ? {} : { [scopeLease]: lease }),
    ...(declaredPrevDepth === undefined ? {} : { [contextPrevDepth]: declaredPrevDepth }),
    effects(body) {
      const recording = activeRecording(path);
      assertOwnedBy(recording, lease, path);
      const resolvedPath = resolveContextPrevPath(path, declaredPrevDepth, recording, lease);
      recording.sink.push(
        block(resolvedPath, recordBlock(recording, recording.refs, body, [], "push"))
      );
    },
    trigger(condition) {
      const entry = block(path, [...condition.entries]);
      const contextualEntry =
        declaredPrevDepth === undefined
          ? entry
          : ({
              ...entry,
              [contextPrevEntry]: { path, declaredDepth: declaredPrevDepth, lease },
            } satisfies PdxEntry & ContextPrevEntry);
      return trigger([contextualEntry], [...condition.refs]);
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
  if ("effects" in base && base.path !== "this") {
    const path = `${base.path}.${key}`;
    // Navigation carries the base's lease too: `owner(ctx.from)` opens a
    // block of the same authoring call `ctx.from` came from.
    return scopeRef<S>(
      path,
      (base as RuntimeScopeValue)[scopeLease],
      (base as RuntimeScopeValue)[contextPrevDepth]
    );
  }
  return {
    kind: "scope-ref",
    get path() {
      const path = base.path;
      return path === "this" ? key : `${path}.${key}`;
    },
  };
}

function resolveContextPrevPath(
  path: string,
  declaredDepth: number | undefined,
  recording: Recording,
  lease: ScriptLease | undefined
): string {
  if (declaredDepth === undefined) {
    return path;
  }
  assertOwnedBy(recording, lease, path);
  if (recording.blockedAncestors.length > 0) {
    throw new Error(
      "A context PREV reference crosses a replacement or unknown scope transition. " +
        "The game does not provide a verified PREV path across that boundary; use ROOT, FROM, " +
        "or a saved target reference instead."
    );
  }
  const depth = declaredDepth + recording.ancestors.length;
  if (depth > 4) {
    throw new Error(
      `A context PREV reference is ${depth} scopes away from its declaring block. ` +
        "Stellaris exposes only PREV through PREVPREVPREVPREV; keep the effect within four " +
        "verified scope pushes or open an explicit saved scope reference."
    );
  }
  const declaredPath = prevKey(declaredDepth);
  return `${prevKey(depth)}${path.slice(declaredPath.length)}`;
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
  readonly refs: RecordedRefUse[];
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
  /** The game scope this closure-facing proxy represents. */
  readonly scope: ScopeIdentity;
  /** Lexically reachable game scopes, nearest first. */
  readonly ancestors: readonly ScopeIdentity[];
  /** Ancestors a replacement made unavailable to PREV routing. */
  readonly blockedAncestors: readonly ScopeIdentity[];
  /** An outer effect sequence that a routed structural chain must remain adjacent within. */
  readonly adjacencyWitness?: {
    readonly sink: readonly PdxEntry[];
    readonly mark: number;
  };
}

function resolveRecordingEntries(
  entries: readonly PdxEntry[],
  recording: Recording | undefined
): PdxEntry[] {
  return recording === undefined
    ? [...entries]
    : entries.map((entry) => resolveRecordingEntry(entry, recording));
}

function resolveRecordingEntry(entry: PdxEntry, recording: Recording): PdxEntry {
  const context = (entry as PdxEntry & ContextPrevEntry)[contextPrevEntry];
  const key =
    context === undefined
      ? entry.key
      : resolveContextPrevPath(context.path, context.declaredDepth, recording, context.lease);
  return {
    kind: "entry",
    key,
    op: entry.op,
    value: resolveRecordingValue(entry.value, recording),
    ...(entry.line === undefined ? {} : { line: entry.line }),
  };
}

function resolveRecordingValue(value: PdxValue, recording: Recording): PdxValue {
  if (value.kind === "container") {
    return resolveRecordingContainer(value, recording);
  }
  const resolver = (value as PdxScalar & RuntimeScopeValue)[deferredScopePath];
  return resolver === undefined ? value : pdxScalar(resolver(recording));
}

function resolveRecordingContainer(value: PdxContainer, recording: Recording): PdxContainer {
  return {
    kind: "container",
    items: value.items.map((item) => resolveRecordingItem(item, recording)),
    ...(value.header === undefined ? {} : { header: value.header }),
  };
}

function resolveRecordingItem(item: PdxItem, recording: Recording): PdxItem {
  if (item.kind === "entry") {
    return resolveRecordingEntry(item, recording);
  }
  if (item.kind === "container") {
    return resolveRecordingContainer(item, recording);
  }
  if (item.kind === "param") {
    return { ...item, items: item.items.map((child) => resolveRecordingItem(child, recording)) };
  }
  return item;
}

const RECORDINGS: Recording[] = [];

interface EffectDestination {
  readonly sink: PdxEntry[];
  readonly refs: RecordedRefUse[];
  readonly owner: Recording | undefined;
}

interface EffectReceiver extends EffectDestination {
  readonly commit: () => void;
}

function prevKey(depth: number): string {
  return depth === 1 ? "prev" : `prev${"prev".repeat(depth - 1)}`;
}

type LexicalRoute =
  | { readonly kind: "same" }
  | { readonly kind: "ancestor"; readonly depth: number }
  | { readonly kind: "blocked" }
  | { readonly kind: "unrelated" };

function lexicalRoute(active: Recording, target: Recording): LexicalRoute {
  if (active.scope === target.scope) {
    return { kind: "same" };
  }
  const ancestorIndex = active.ancestors.indexOf(target.scope);
  if (ancestorIndex !== -1) {
    return { kind: "ancestor", depth: ancestorIndex + 1 };
  }
  return active.blockedAncestors.includes(target.scope)
    ? { kind: "blocked" }
    : { kind: "unrelated" };
}

function lexicalScopePath(
  recording: Recording | undefined,
  consumer: Recording | undefined = RECORDINGS.at(-1)
): string {
  // A recording resolves its own deferred values immediately after its body
  // returns. It is already closed to author code at that point, but it is
  // still the valid consumer of references authored inside that body.
  if (recording !== consumer) {
    assertLive(recording, "ref");
  }
  if (recording === undefined) {
    return "this";
  }
  const active = consumer;
  if (active === undefined) {
    return "this";
  }
  const route = lexicalRoute(active, recording);
  if (route.kind === "same") {
    return "this";
  }
  if (route.kind === "blocked") {
    throw new Error(
      "A lexical scope reference crosses a replacement or unknown scope transition. " +
        "The game does not provide a verified PREV path across that boundary; use ROOT, FROM, " +
        "or a saved target reference instead."
    );
  }
  if (route.kind === "unrelated") {
    throw new Error(
      "A lexical scope reference was consumed in a recording that is not its scope or a " +
        "verified descendant. The recorder cannot prove a relative path between those blocks; " +
        "use this callback's scope, ROOT, FROM, or a saved target reference instead."
    );
  }
  if (route.depth > 4) {
    throw new Error(
      `A lexical scope reference is ${route.depth} pushed scopes away from the active block. ` +
        "Stellaris exposes only PREV through PREVPREVPREVPREV; keep the value within four " +
        "scope pushes or use an explicit saved scope reference."
    );
  }
  return prevKey(route.depth);
}

function routedRecording(
  active: Recording,
  target: Recording,
  sink: PdxEntry[],
  refs: RecordedRefUse[],
  adjacencyWitness: NonNullable<Recording["adjacencyWitness"]>
): Recording {
  return {
    sink,
    refs,
    get live() {
      return active.live && target.live;
    },
    lease: target.lease,
    scope: target.scope,
    ancestors: [active.scope, ...active.ancestors],
    blockedAncestors: active.blockedAncestors,
    adjacencyWitness,
  };
}

/** Selects the live lexical receiver for one captured scope proxy. */
function effectReceiver(
  recording: Recording | undefined,
  fallback: EffectDestination
): EffectReceiver {
  const direct = (destination: EffectDestination): EffectReceiver => ({
    ...destination,
    commit: () => undefined,
  });
  if (recording === undefined) {
    return direct(fallback);
  }
  const active = RECORDINGS.at(-1);
  if (active === undefined) {
    return direct(fallback);
  }
  const route = lexicalRoute(active, recording);
  if (route.kind === "same") {
    return direct({ sink: active.sink, refs: active.refs, owner: active });
  }
  if (route.kind === "blocked") {
    throw new Error(
      "A captured scope proxy crosses a replacement or unknown scope transition. " +
        "The game does not provide a verified PREV path across that boundary; use ROOT, FROM, " +
        "or a saved target reference instead."
    );
  }
  if (route.kind === "unrelated") {
    return direct(fallback);
  }
  const depth = route.depth;
  if (depth > 4) {
    throw new Error(
      `A captured scope proxy is ${depth} pushed scopes away from the active block. ` +
        "Stellaris exposes only PREV through PREVPREVPREVPREV; keep the effect within four " +
        "scope pushes or open an explicit saved scope reference."
    );
  }
  const sink: PdxEntry[] = [];
  const refs: RecordedRefUse[] = [];
  const adjacencyWitness = { sink: active.sink, mark: active.sink.length + 1 };
  const owner = routedRecording(active, recording, sink, refs, adjacencyWitness);
  return {
    sink,
    refs,
    owner,
    commit: () => {
      if (sink.length === 0) {
        return;
      }
      sink.splice(0, sink.length, ...resolveRecordingEntries(sink, owner));
      active.sink.push(block(prevKey(depth), sink));
      active.refs.push(...refs);
    },
  };
}

/** Runs one lowering operation with its routed receiver as the scalar consumer. */
function withActiveRecording<T>(recording: Recording | undefined, body: () => T): T {
  if (recording === undefined || RECORDINGS.at(-1) === recording) {
    return body();
  }
  RECORDINGS.push(recording);
  try {
    return body();
  } finally {
    RECORDINGS.pop();
  }
}

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
  witness: FireScopeWitness | undefined,
  key: string
): void {
  if (recording === undefined || witness === undefined) {
    return;
  }
  if (!hasEscaped(recording, witness[scopeLease])) {
    return;
  }
  throw new Error(
    `'${witness.path}' was passed as a scope witness of '${key}' from a ScriptCtx belonging ` +
      "to a different definition, so the context escaped the closure it was handed to. The " +
      "fire site would write it as this definition's FROM override while the scope it names " +
      "is the one the earlier definition's rules supply. Use the ctx the closure being " +
      "written receives, rather than one kept from an earlier one."
  );
}

/**
 * Runs one authoring call's body with the declared ambient scopes.
 *
 * ROOT and FROM paths are fixed. PREV paths stay relative to the declaring
 * block, so a verified nested push increases their emitted PREV depth. ROOT
 * defaults to `Self` on {@link ScriptCtx}'s terms — an event's blocks are the
 * top level, so ROOT is the event's own scope — and a caller whose rules say
 * otherwise names it. The context map controls which declared ambient slots a
 * closure may read; the object carries the complete map in its canonical order.
 *
 * The ctx lives for this call: every declared ambient ref may be opened as a
 * block in any recording started while the body runs — one event's ctx serves
 * its `immediate`, its `after` and every option — and nowhere else. Opening
 * one later reaches {@link assertOwnedBy}, which is why the ctx is built here
 * rather than handed out as a value the caller keeps.
 */
export function withScriptCtx<
  Self extends ScopeName,
  Context extends AmbientScopeContext = { readonly root: Self },
  T = void,
>(options: { readonly splitRoot?: boolean }, body: (ctx: ScriptCtx<Self, Context>) => T): T {
  const lease: ScriptLease = Symbol("scriptCtx");
  const ctx = {
    self: scopeValue("this", options.splitRoot !== true),
    ...Object.fromEntries(
      AMBIENT_SCOPE_KEYS.map((key) => [
        key,
        key.startsWith("prev")
          ? scopeRef(key, lease, key === "prev" ? 1 : key.length / "prev".length)
          : scopeRef(key, lease),
      ])
    ),
  } as ScriptCtx<Self, Context>;

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
  refs: RecordedRefUse[],
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
 * Lowers one scalar-valued position to what the AST accepts.
 *
 * A position the rules type as a localisation key goes through
 * `localizationScalar`, which is the only lowering that can produce a deferred
 * marker for inline display text; every other position lowers as it always
 * did. The generated `locInput` flag decides, so the recorder follows the
 * rules rather than guessing a localisation key from the value's shape.
 */
function loweredScalar(
  meta: EffectScalarMeta | undefined,
  value: unknown,
  path: string
): string | number | boolean | PdxScalar {
  return meta?.locInput === true
    ? localizationScalar(value, path, meta.locLiterals)
    : toScalar(value, meta?.booleanLiterals);
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

/** The map table a `map` field carries; generated meta always supplies one. */
function mapMetaOf(field: EffectFieldMeta): EffectMapMeta {
  if (field.map === undefined) {
    throw new Error(`Effect field "${field.key}" is an open-keyed block with no map metadata`);
  }
  return field.map;
}

/** The block arm a `scalar-or-block` field carries; generated meta always supplies one. */
function blockArmOf(field: EffectFieldMeta): EffectBlockMeta {
  if (field.block === undefined) {
    throw new Error(`Effect field "${field.key}" is overloaded with a block but names no arm`);
  }
  return field.block;
}

/** Reads the generated identity transition for a nested effect closure. */
function effectFieldTransition(field: EffectFieldMeta): ScopeTransition {
  if (field.transition === undefined) {
    throw new Error(
      `Effect field "${field.key}" has no scope transition metadata. Regenerate the SDK output; ` +
        "the recorder cannot safely infer whether its callback preserves or changes scope."
    );
  }
  return field.transition;
}

/**
 * The entries one open-keyed argument writes, in authoring order. Both the
 * key and the value are recorded as references when the generated meta says
 * every form they admit is one.
 */
function mapValueEntries(
  map: EffectMapMeta,
  values: Record<string, unknown>,
  path: string,
  refs: RecordedRefUse[]
): PdxEntry[] {
  return mapEntries(values, path, map.min).map(([key, value]) => {
    recordRef(refs, map.keyRefTypes, path, key);
    if (map.comparison === true && Array.isArray(value)) {
      return cmp(key, value[0] as PdxOp, toScalar(value[1]));
    }
    const scalar = loweredScalar(map.value, value, path);
    recordRef(refs, map.value.refTypes, path, scalar);
    recordLocalization(refs, value, path);
    return kv(key, scalar);
  });
}

/**
 * The items one braced list of anonymous values writes, in authoring order.
 * A mixed list picks each item's arm from the scalar arm's object kinds.
 */
function valueListItems(
  arm: { readonly scalar?: EffectScalarMeta; readonly fields?: readonly EffectFieldMeta[] },
  values: readonly unknown[],
  path: string,
  refs: RecordedRefUse[],
  owner: Recording | undefined
): PdxItem[] {
  return values.map((item) => {
    if (
      arm.fields !== undefined &&
      (arm.scalar === undefined || isStructuredValue(item, arm.scalar.objectKinds ?? []))
    ) {
      return container(
        fieldEntries(arm.fields, item as Record<string, unknown>, path, refs, owner)
      );
    }
    const scalar = loweredScalar(arm.scalar, item, path);
    recordRef(refs, arm.scalar?.refTypes, path, scalar);
    recordLocalization(refs, item, path);
    return typeof scalar === "object" ? scalar : pdxScalar(scalar);
  });
}

/**
 * The entry the block half of an overloaded field writes under its key.
 * The three arms are the three shapes the generator lowers a braced arm to.
 */
function blockEntry(
  arm: EffectBlockMeta,
  value: unknown,
  key: string,
  path: string,
  refs: RecordedRefUse[],
  owner: Recording | undefined
): PdxEntry {
  switch (arm.kind) {
    case "map":
      return block(key, mapValueEntries(arm.map, value as Record<string, unknown>, path, refs));
    case "fields":
      return block(
        key,
        fieldEntries(arm.fields, value as Record<string, unknown>, path, refs, owner)
      );
    case "value-list":
      return kv(
        key,
        container(valueListItems(arm, value as readonly unknown[], path, refs, owner))
      );
  }
}

function scalarEffectEntry(
  key: string,
  scalar: Extract<EffectShapeMeta, { readonly kind: "bool" | "value" }>,
  value: unknown,
  refs: RecordedRefUse[]
): PdxEntry {
  if (scalar.kind === "bool") {
    return kv(key, (value as boolean | undefined) ?? true);
  }
  const lowered = loweredScalar(scalar, value, key);
  recordRef(refs, scalar.refTypes, key, lowered);
  recordLocalization(refs, value, key);
  return kv(key, lowered);
}

function scalarOrBlockEffect(
  key: string,
  shape: Extract<EffectShapeMeta, { readonly kind: "scalar-or-block" }>,
  args: readonly unknown[],
  sink: PdxEntry[],
  refs: RecordedRefUse[],
  recording: Recording | undefined
): void {
  const [value, body] = args;
  const objectKinds = shape.scalar.kind === "value" ? (shape.scalar.objectKinds ?? []) : [];
  if (!isEffectBlockValue(value, objectKinds, shape.block)) {
    sink.push(scalarEffectEntry(key, shape.scalar, value, refs));
    return;
  }
  switch (shape.block.kind) {
    case "fields":
      sink.push(
        block(
          key,
          fieldEntries(shape.block.fields, value as Record<string, unknown>, key, refs, recording)
        )
      );
      return;
    case "map":
      sink.push(
        block(key, mapValueEntries(shape.block.map, value as Record<string, unknown>, key, refs))
      );
      return;
    case "alias-list":
      sink.push(
        block(
          key,
          aliasListEntries(shape.block.category, value as readonly unknown[], key, refs, recording)
        )
      );
      return;
    case "wrapper": {
      if (shape.block.fields === null) {
        sink.push(
          block(
            key,
            recordBlock(
              recording,
              refs,
              value as (scope: unknown) => void,
              [],
              shape.block.transition
            )
          )
        );
        return;
      }
      const child = fieldEntries(
        shape.block.fields,
        value as Record<string, unknown>,
        key,
        refs,
        recording
      );
      recordBlock(recording, refs, body as (scope: unknown) => void, child, shape.block.transition);
      sink.push(block(key, child));
    }
  }
}

/**
 * The entries one field contributes to its block: under the field's key, or
 * bare when the rules splice the field's content into the block itself.
 */
function spliced(field: EffectFieldMeta, entries: readonly PdxEntry[]): PdxEntry[] {
  return field.splice === true ? [...entries] : [block(field.key, entries)];
}

/** The members of one spliced alias category, by the name the meta gives it. */
function aliasMembers(category: string | undefined, where: string): readonly EffectFieldMeta[] {
  const members = category === undefined ? undefined : ALIAS_LIST_META[category];
  if (members === undefined) {
    throw new Error(
      `The generated metadata for '${where}' names no alias-category member table, so its ` +
        "items cannot be written. This is a codegen fault, not an authoring one."
    );
  }
  return members;
}

/**
 * The entries an alias list writes, in the authored order.
 *
 * Each item is an object naming exactly one member of the category, which is
 * what keeps the list ordered and lets one member repeat; the member itself is
 * then written exactly as a field of that shape is written anywhere else.
 */
function aliasListEntries(
  category: string | undefined,
  items: readonly unknown[],
  where: string,
  refs: RecordedRefUse[],
  owner: Recording | undefined
): PdxEntry[] {
  const members = aliasMembers(category, where);
  return items.flatMap((item, index) => {
    const props =
      typeof item !== "object" || item === null || Array.isArray(item) ? [] : Object.keys(item);
    if (props.length !== 1) {
      throw new Error(
        `Item ${index} of '${where}' must be an object naming exactly one ${category}, such as ` +
          `{ ${members[0]!.prop}: ... }, and it names ${props.length}. The list is ordered and a ` +
          "member may repeat, so each one is written as its own item."
      );
    }
    const prop = props[0]!;
    const member = members.find((candidate) => candidate.prop === prop);
    if (member === undefined) {
      throw new Error(
        `Item ${index} of '${where}' names "${prop}", which is not a ${category}. The members ` +
          `are: ${members.map((candidate) => candidate.prop).join(", ")}.`
      );
    }
    return fieldEntries([member], item as Record<string, unknown>, where, refs, owner);
  });
}

/**
 * The entries one args object writes for a generated field table, in table
 * order. Reference-bearing ids are appended to `refs` as they are written.
 */
export function fieldEntries(
  fields: readonly EffectFieldMeta[],
  args: Record<string, unknown>,
  path: string,
  refs: RecordedRefUse[],
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
          const scalar = loweredScalar(field, value, `${path}.${field.key}`);
          recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
          recordLocalization(refs, value, `${path}.${field.key}`);
          entries.push(kv(field.key, scalar));
          break;
        }
        case "scalar-or-block": {
          const arm = blockArmOf(field);
          const takesBlock =
            arm.kind === "value-list"
              ? Array.isArray(value)
              : isStructuredValue(value, field.scalar?.objectKinds ?? []);
          if (takesBlock) {
            entries.push(blockEntry(arm, value, field.key, `${path}.${field.key}`, refs, owner));
            break;
          }
          const scalar = loweredScalar(field.scalar, value, `${path}.${field.key}`);
          recordRef(refs, field.scalar?.refTypes, `${path}.${field.key}`, scalar);
          recordLocalization(refs, value, `${path}.${field.key}`);
          entries.push(kv(field.key, scalar));
          break;
        }
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
        case "map": {
          const map = mapMetaOf(field);
          const written = mapValueEntries(
            map,
            value as Record<string, unknown>,
            `${path}.${field.key}`,
            refs
          );
          entries.push(...(map.splice === true ? written : [block(field.key, written)]));
          break;
        }
        case "value-list":
          entries.push(
            kv(
              field.key,
              container(
                valueListItems(
                  field,
                  value as readonly unknown[],
                  `${path}.${field.key}`,
                  refs,
                  owner
                )
              )
            )
          );
          break;
        case "comparison":
          if (Array.isArray(value)) {
            entries.push(cmp(field.key, value[0] as PdxOp, toScalar(value[1])));
          } else {
            const scalar = loweredScalar(field, value, `${path}.${field.key}`);
            recordRef(refs, field.refTypes, `${path}.${field.key}`, scalar);
            recordLocalization(refs, value, `${path}.${field.key}`);
            entries.push(kv(field.key, scalar));
          }
          break;
        case "trigger": {
          const condition = value as Trigger;
          entries.push(...spliced(field, [...condition.entries]));
          refs.push(...condition.refs);
          break;
        }
        case "effect":
          entries.push(
            ...spliced(
              field,
              recordBlock(
                owner,
                refs,
                value as (scope: unknown) => void,
                [],
                effectFieldTransition(field)
              )
            )
          );
          break;
        case "alias-list":
          entries.push(
            ...spliced(
              field,
              aliasListEntries(
                field.category,
                value as readonly unknown[],
                `${path}.${field.key}`,
                refs,
                owner
              )
            )
          );
          break;
        case "alias-struct":
          entries.push(
            block(
              field.key,
              contentFieldEntries(
                value as Record<string, unknown>,
                aliasStructFieldsOf(field.category!),
                {
                  path: `${path}.${field.key}`,
                  collect: (use) => refs.push(use),
                  // The nearest enclosing identity a `WeightBlock` row would
                  // register its localisation token under. An effect block has no
                  // definition id, so its field path stands in; no member of a
                  // spliced alias block carries such a row today.
                  ownerId: `${path}.${field.key}`,
                  // No definition walk ran in front of these values, so a
                  // key-typed member here is still whatever the author wrote.
                  unresolvedKeys: true,
                }
              )
            )
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
  refs: RecordedRefUse[],
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
  refs: RecordedRefUse[],
  recording: Recording | undefined
) => unknown;

const STRUCTURAL_BASE = {
  if:
    (sink, refs, recording) => (condition: Trigger<ScopeName>, body: (scope: unknown) => void) => {
      const record = nestedRecorder(recording);
      sink.push(conditionalBlock("if", condition, body, refs, record));
      return new IfChainRecorder(
        sink,
        refs,
        recording,
        record,
        assertLive,
        recording?.adjacencyWitness?.sink,
        recording?.adjacencyWitness?.mark
      );
    },

  target: (sink, refs, recording) => (body: (scope: unknown) => void) => {
    sink.push(block("target", recordBlock(recording, refs, body, [], "push")));
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
  readonly scopes?: Readonly<Record<string, FireScopeWitness>>;
}

type FireScopeWitness = { readonly path: string } & RuntimeScopeValue;

interface EventChainCounterCallArgs {
  readonly eventChain: { readonly id: string } | string;
  readonly counter: string;
  readonly amount?: unknown;
}

function eventChainCounterEffect(key: string, needsAmount: boolean) {
  return (sink: PdxEntry[], refs: RecordedRefUse[]) =>
    (args: EventChainCounterCallArgs): void => {
      const id = String(refId(args.eventChain));
      const entries = [kv("event_chain", id), kv("counter", args.counter)];
      if (needsAmount) {
        entries.push(kv("amount", toScalar(args.amount!)));
      }
      refs.push({ targets: ["event_chain"], id, field: `${key}.event_chain` });
      sink.push(block(key, entries));
    };
}

function fireEffect(key: string) {
  return (sink: PdxEntry[], refs: RecordedRefUse[], recording: Recording | undefined) =>
    (args: FireCallArgs): void => {
      const id = String(refId(args.id));
      const entries: PdxEntry[] = [kv("id", id)];
      for (const field of ["days", "months", "years", "random"] as const) {
        const value = args[field];
        if (value !== undefined) {
          entries.push(kv(field, value));
        }
      }
      if (args.scopes?.from?.[cannotWitnessNaturalFrom] === true) {
        throw new Error(
          "A split-root effect block cannot use `scopes: { from: ctx.self }` as an event's natural FROM: " +
            "the game supplies ROOT, which differs from this block's THIS scope. Pass `ctx.root` " +
            "when the event expects ROOT, or an absolute scope reference for an explicit override."
        );
      }
      const relativeDeeperFrom = Object.entries(args.scopes ?? {}).find(
        ([slot, witness]) =>
          slot !== "from" &&
          slot.startsWith("from") &&
          witness[lexicalScope] !== true &&
          witness.path === "this"
      );
      if (relativeDeeperFrom !== undefined) {
        throw new Error(
          `Event scope witness "${relativeDeeperFrom[0]}" uses relative THIS. Deeper FROM ` +
            "overrides must use an absolute scope reference such as ROOT, FROM, or a saved target, " +
            "because THIS changes inside nested effect callbacks."
        );
      }
      // The witness is the other place a ctx path reaches output, so it
      // carries the same lease rule opening a block does.
      Object.values(args.scopes ?? {}).forEach((witness) =>
        assertWitnessOwnedBy(recording, witness, key)
      );
      // Natural FROM is the firing execution's ROOT. `ctx.self` can witness
      // that omission only where SELF and ROOT are not known to differ; any
      // other ref uses the game's explicit override mechanism.
      const overrides = AMBIENT_SCOPE_KEYS.flatMap((slot) => {
        if (slot === "root" || slot.startsWith("prev")) {
          return [];
        }
        const witness = args.scopes?.[slot];
        return witness === undefined ||
          (slot === "from" && witness[lexicalScope] !== true && witness.path === "this")
          ? []
          : [kv(slot, witness.path)];
      });
      if (overrides.length > 0) {
        entries.push(block("scopes", overrides));
      }
      // Recorded where the entry is committed, not where the id is read: every
      // refusal above is an ordinary throw an author can catch, and a reference
      // recorded for a call that wrote nothing would have the fold demand an
      // event the emitted script never names.
      refs.push({ targets: ["event"], id, field: `${key}.id` });
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
  refs: RecordedRefUse[],
  recording: Recording | undefined,
  keys: readonly string[],
  transitions: readonly ScopeTransition[] = []
): unknown {
  const label = keys.join(".");
  const dispatch = (prop: string): unknown => {
    if (prop === "effects") {
      return (body: (scope: unknown) => void): void => {
        const receiver = effectReceiver(recording, { sink, refs, owner: recording });
        let nested = recordPathLeaf(receiver.owner, receiver.refs, body, transitions);
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          nested = [block(keys[index]!, nested)];
        }
        receiver.sink.push(...nested);
        receiver.commit();
      };
    }
    if (prop === "hiddenEffect") {
      return makeEffectPath(
        sink,
        refs,
        recording,
        [...keys, "hidden_effect"],
        [...transitions, "same"]
      );
    }
    const meta = EFFECT_META[prop];
    if (meta?.shape.kind !== "scope-link") {
      throw new Error(
        `Unknown effect path "${label}.${prop}" — "${prop}" is not a generated scope link. ` +
          "Only hiddenEffect, generated scope links, and the effects() terminal compose."
      );
    }
    return makeEffectPath(
      sink,
      refs,
      recording,
      [...keys, meta.key],
      [...transitions, meta.shape.transition]
    );
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

function recordPathLeaf(
  owner: Recording | undefined,
  refs: RecordedRefUse[],
  body: (scope: unknown) => void,
  transitions: readonly ScopeTransition[]
): PdxEntry[] {
  const [transition, ...remaining] = transitions;
  if (transition === undefined) {
    return recordBlock(owner, refs, body);
  }
  let leaf: PdxEntry[] = [];
  recordBlock(
    owner,
    refs,
    () => {
      leaf = recordPathLeaf(RECORDINGS.at(-1), refs, body, remaining);
    },
    [],
    transition
  );
  return leaf;
}

function makeAnyScope(sink: PdxEntry[], refs: RecordedRefUse[], recording?: Recording): unknown {
  const dispatch = (prop: string, receiver: EffectReceiver): unknown => {
    const structural = STRUCTURAL[prop];
    if (structural !== undefined) {
      return structural(receiver.sink, receiver.refs, receiver.owner);
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
        return (value: boolean = true) => receiver.sink.push(kv(meta.key, value));
      case "value":
        return (value: unknown) =>
          receiver.sink.push(scalarEffectEntry(meta.key, shape, value, receiver.refs));
      case "fields":
        return (args: Record<string, unknown>) =>
          receiver.sink.push(
            block(
              meta.key,
              fieldEntries(shape.fields ?? [], args, meta.key, receiver.refs, receiver.owner)
            )
          );
      case "map":
        return (values: Record<string, unknown>) =>
          receiver.sink.push(
            block(meta.key, mapValueEntries(shape.map, values, meta.key, receiver.refs))
          );
      case "wrapper":
        if (shape.fields === null) {
          return (body: (scope: unknown) => void) => {
            receiver.sink.push(
              block(
                meta.key,
                recordBlock(receiver.owner, receiver.refs, body, [], shape.transition)
              )
            );
          };
        }
        return (args: Record<string, unknown>, body: (scope: unknown) => void) => {
          const child: PdxEntry[] = fieldEntries(
            shape.fields ?? [],
            args,
            meta.key,
            receiver.refs,
            receiver.owner
          );
          recordBlock(receiver.owner, receiver.refs, body, child, shape.transition);
          receiver.sink.push(block(meta.key, child));
        };
      case "alias-list":
        return (items: readonly unknown[]) => {
          receiver.sink.push(
            block(
              meta.key,
              aliasListEntries(shape.category, items, meta.key, receiver.refs, receiver.owner)
            )
          );
        };
      case "scalar-or-block":
        return (...args: unknown[]) =>
          scalarOrBlockEffect(meta.key, shape, args, receiver.sink, receiver.refs, receiver.owner);
      case "scope-link":
        return makeEffectPath(sink, refs, recording, [meta.key], [shape.transition]);
    }
  };

  const invoke = (prop: string, args: readonly unknown[]): unknown => {
    const receiver = effectReceiver(recording, { sink, refs, owner: recording });
    const method = dispatch(prop, receiver) as (...parameters: unknown[]) => unknown;
    const result = withActiveRecording(receiver.owner, () => method(...args));
    receiver.commit();
    return result;
  };

  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      // Access-time as well as call-time (see `guarded`): a dead scope object
      // fails on the property read, before the dispatcher builds anything.
      assertLive(recording, prop);
      if (prop === "ref") {
        return lexicalScopeValue(recording);
      }
      if (prop === "hiddenEffect") {
        return makeEffectPath(sink, refs, recording, ["hidden_effect"], ["same"]);
      }
      if (STRUCTURAL[prop] !== undefined) {
        return guarded(recording, prop, (...args: unknown[]) => invoke(prop, args));
      }
      const meta = EFFECT_META[prop];
      if (meta?.shape.kind === "scope-link") {
        return makeEffectPath(sink, refs, recording, [meta.key], [meta.shape.transition]);
      }
      return guarded(recording, prop, (...args: unknown[]) => invoke(prop, args));
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
  refs: RecordedRefUse[] = []
): ScopeObjOf<S> {
  const recording: Recording = {
    sink,
    refs,
    live: true,
    lease: undefined,
    scope: Symbol("effectScope"),
    ancestors: [],
    blockedAncestors: [],
  };
  return makeAnyScope(sink, refs, recording) as ScopeObjOf<S>;
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
  refs: RecordedRefUse[],
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
  refs: RecordedRefUse[],
  body: (scope: ScopeObjOf<S>) => void,
  into: PdxEntry[] = [],
  transition: ScopeTransition = "same"
): PdxEntry[] {
  const scope = transition === "same" && owner !== undefined ? owner.scope : Symbol("effectScope");
  const resetsScope = transition === "replace" || transition === "unknown";
  const ancestors =
    owner === undefined || resetsScope
      ? []
      : transition === "same"
        ? owner.ancestors
        : [owner.scope, ...owner.ancestors];
  const blockedAncestors =
    owner === undefined
      ? []
      : resetsScope
        ? [owner.scope, ...owner.ancestors, ...owner.blockedAncestors]
        : owner.blockedAncestors;
  const recording: Recording = {
    sink: into,
    refs,
    live: true,
    lease: owner === undefined ? LEASES.at(-1) : owner.lease,
    scope,
    ancestors,
    blockedAncestors,
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
  // Trigger arguments are evaluated before a pushed callback opens. Resolve
  // declared PREV paths only now, against the block that will contain them.
  into.splice(0, into.length, ...resolveRecordingEntries(into, recording));
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
