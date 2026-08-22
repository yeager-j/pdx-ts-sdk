/** Recursive interpretation of generated content field metadata. */
import {
  block,
  container,
  isScalar,
  kv,
  quoted,
  scalar,
  type PdxEntry,
  type PdxItem,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { assertNever } from "../assert-never.ts";
import type { AssetFileItem } from "../authoring/assets.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type { ContentRefUse } from "../references.ts";
import { recordEffects, withScriptCtx } from "../script/effects/recorder.ts";
import type { ScriptCtx } from "../script/effects/types.ts";
import { refId, type TypedRef } from "../script/scalar.ts";
import { scriptValueScalar, type ScriptValue, type Trigger } from "../script/trigger-core.ts";
import {
  ECONOMIC_RESOURCE_OPERATIONS,
  ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE,
  economicOperation,
  economicResourceBlock,
  triggeredModifierBlock,
  weightBlock,
} from "./blocks.ts";
import { childContext, collectRefs, joinPath, type LoweringContext } from "./lowering-context.ts";
import { modifierBlock, modifierEntries } from "./modifier-recorders.ts";
import {
  aliasStructFieldsOf,
  authoredForm,
  type ContentDualArm,
  type ContentDualField,
  type ContentField,
  type ContentFieldBase,
  type ContentRefTypes,
} from "./schema.ts";
import type {
  EconomicResourceBlock,
  EconomicResourceBlockNoProduce,
  EconomicResourceOperation,
  EffectBlock,
  ModifierClosure,
  TriggeredModifier,
  WeightBlock,
} from "./types.ts";

/**
 * Whether a value is a content reference: `TypedRef` is `{ id }`, which is an
 * object at runtime and a scalar in the file.
 *
 * The brand is a phantom property and absent at runtime, so `id` is the only
 * signature there is. That is why this alone cannot place a value — see
 * {@link dualArm}, which asks it only once an arm has claimed references.
 */
function isReference(value: unknown): value is TypedRef<string> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly id?: unknown }).id === "string"
  );
}

/**
 * The arm of a dual field that accepts what the author passed.
 *
 * A reference is the one value whose own shape cannot place it: `refId` unwraps
 * either an id string or a `{ id }` object, so an authored reference looks like
 * a block and belongs on a scalar arm. The arm's declared `conversion` settles
 * it — asking the metadata rather than guessing from the value keeps the
 * decision where the emitter already made it. Passing a reference where no arm
 * takes one falls through to the ordinary form matching, so a struct arm still
 * gets a struct that happens to carry an `id` member.
 *
 * Throws rather than guessing when nothing matches. The generated types make
 * the wrong form a compile error, so reaching there means either a cast or an
 * arm pair the emitter should not have produced, and both deserve to be loud.
 */
export function dualArm(field: ContentDualField, value: unknown): ContentDualArm {
  if (isReference(value)) {
    const reference = field.arms.find(
      (candidate) =>
        candidate.form === "scalar" && "conversion" in candidate && candidate.conversion === "ref"
    );
    if (reference !== undefined) {
      return reference;
    }
  }
  const form = authoredForm(value);
  const arm = field.arms.find((candidate) => candidate.form === form);
  if (arm === undefined) {
    const declared = field.arms.map((candidate) => candidate.form).join(" or ");
    throw new Error(
      `Field "${field.key}" was given a ${form} value, and its declarations accept ${declared}`
    );
  }
  return arm;
}

/**
 * Shapes a {@link WithFrom} closure can stand in for: the declarative values
 * that can hold a condition, and so can want FROM.
 *
 * `effect` and `modifierBlock` are closures already and are not in this set —
 * their closure *is* the value, not a way of computing one.
 */
function acceptsFromClosure(field: ContentField): boolean {
  switch (field.shape) {
    case "trigger":
    case "inlineTrigger":
    case "weightBlock":
    case "weightBlockWithLoc":
    case "economicResources":
    case "economicResourcesNoProduce":
    case "economicResourceOperation":
    case "triggeredModifierBlock":
      return true;
    case "dual":
      return field.arms.some(acceptsFromClosure);
    case "value":
    case "valueList":
    case "effect":
    case "modifierBlock":
    case "inlineModifiers":
    case "weightedEvents":
    case "struct":
    case "triggerStruct":
    case "aliasStruct":
    case "structMap":
    case "scalarMap":
    case "repeatedStruct":
      return false;
    default:
      return assertNever(field, "content field");
  }
}

/**
 * Collapses a field's closure form to the value it returns.
 *
 * A `Trigger` is itself callable — the poisoned signature that makes
 * `if (someTrigger)` a compile error — so `typeof value === "function"` is not
 * enough to tell a closure from a condition, exactly as in {@link authoredForm}.
 */
function resolveFromClosure(field: ContentField, value: unknown): unknown {
  if (typeof value !== "function" || !acceptsFromClosure(field)) {
    return value;
  }
  if ((value as { readonly kind?: unknown }).kind === "trigger") {
    return value;
  }
  return withScriptCtx<ScopeName, ScopeName, ScopeName, unknown>({}, (scriptCtx) =>
    (value as (ctx: ScriptCtx<ScopeName, ScopeName, ScopeName>) => unknown)(scriptCtx)
  );
}

/**
 * Runs every {@link WithFrom} closure in a definition, once, and returns the
 * definition with their results in their place.
 *
 * Once, and here, because a modifier row's generated `desc` key is registered
 * against the row's object identity — running the closure again at write time
 * would produce a different object and lose the key. Resolving at definition
 * time also keeps what `DefinedContent.def` carries plain data: everything
 * downstream sees the same value the plain form would have produced.
 *
 * Recurses the same three ways the definition walk does — `dual` arms, plain
 * and repeated `struct` nesting, and `repeatedStruct` entries — since a
 * condition several levels down is scoped by the rules just the same.
 */
export function resolveFromClosures(
  def: Readonly<Record<string, unknown>>,
  fields: readonly ContentField[]
): Readonly<Record<string, unknown>> {
  const resolved: Record<string, unknown> = { ...def };
  for (const field of fields) {
    const value = def[field.member];
    if (value === undefined) {
      continue;
    }
    switch (field.shape) {
      case "dual": {
        const arm = dualArm(field, value);
        const nested = resolveFromClosures({ [arm.member]: value }, [arm]);
        resolved[field.member] = nested[arm.member];
        break;
      }
      // The shapes `acceptsFromClosure` admits, named again so a shape added
      // there has to be placed here too rather than falling into the
      // pass-through arm below and losing its closure.
      case "trigger":
      case "inlineTrigger":
      case "weightBlock":
      case "weightBlockWithLoc":
      case "economicResources":
      case "economicResourcesNoProduce":
      case "economicResourceOperation":
      case "triggeredModifierBlock":
        resolved[field.member] = resolveFromClosure(field, value);
        break;
      case "struct":
      case "triggerStruct":
        resolved[field.member] = field.repeated
          ? (value as readonly Readonly<Record<string, unknown>>[]).map((item) =>
              resolveFromClosures(item, field.fields)
            )
          : resolveFromClosures(value as Readonly<Record<string, unknown>>, field.fields);
        break;
      case "repeatedStruct": {
        const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        resolved[field.member] = Object.fromEntries(
          Object.entries(record).map(([id, nested]) => [
            id,
            resolveFromClosures(nested, field.fields),
          ])
        );
        break;
      }
      // Nothing for this walk to do: no closure form, and no nested field
      // table it descends — an `aliasStruct` names its table rather than
      // carrying it, and the definition walk does not follow it either.
      case "value":
      case "valueList":
      case "effect":
      case "modifierBlock":
      case "inlineModifiers":
      case "weightedEvents":
      case "aliasStruct":
      case "structMap":
      case "scalarMap":
        break;
      default:
        assertNever(field, "content field");
    }
  }
  return resolved;
}

/**
 * Whether a value is already a PDXScript node, and so is spliced rather than
 * lowered.
 *
 * The one authored value carrying a `kind` is a `Trigger`, and no node kind is
 * `"trigger"`, so the discriminant alone settles it. This is what lets a patch
 * carry a parsed occurrence of a repeated field back out unchanged beside
 * freshly authored ones.
 */
function isPassthrough(value: unknown): value is PdxItem {
  const kind = (value as { readonly kind?: unknown } | null)?.kind;
  if (kind === "entry" || kind === "container" || kind === "param" || kind === "param-text") {
    return true;
  }
  return typeof value === "object" && value !== null && isScalar(value as PdxItem);
}

function passthroughEntry(value: unknown): PdxEntry | undefined {
  return isPassthrough(value) && value.kind === "entry" ? value : undefined;
}

/**
 * Whether an authored filepath value is a captured Asset rather than a raw
 * string. `itemKind` is the same discriminant `flattenItems` places on, so an
 * Item is recognised here exactly as it is recognised there.
 */
function isAssetFileItem(value: unknown): value is AssetFileItem {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly itemKind?: unknown }).itemKind === "asset"
  );
}

function contentScalar(
  value: unknown,
  field: ContentFieldBase &
    ContentRefTypes & { readonly conversion: "identity" | "ref" | "assetPath" },
  quote: boolean,
  ctx?: LoweringContext
): PdxScalar {
  if (field.conversion === "assetPath") {
    // Both forms write a path and both are recorded: an Item is a path this
    // build ships and can prove, a string is a path only the fold's evidence
    // can speak to. Which one it was is the recorded `kind`, so the two
    // fold-time checks — a placed-Asset proof and an existence warning — are
    // told apart there rather than by re-inspecting the emitted scalar.
    const item = isAssetFileItem(value) ? value : undefined;
    const path = item?.path ?? (value as string);
    if (ctx?.collectPath !== undefined) {
      const where = { path, field: joinPath(ctx.path, field.key) };
      ctx.collectPath(
        item === undefined ? { kind: "string", ...where } : { kind: "item", item, ...where }
      );
    }
    return quote ? quoted(path) : scalar(path);
  }
  const converted = field.conversion === "ref" ? refId(value as TypedRef<string> | string) : value;
  if (
    ctx?.collect !== undefined &&
    field.refTypes !== undefined &&
    typeof converted === "string" &&
    // A `@name` scripted-variable reference is not an id, so it names no
    // content and must not be held to the dangling-reference guard.
    !converted.startsWith("@")
  ) {
    ctx.collect({
      targets: field.refTypes,
      id: converted,
      field: joinPath(ctx.path, field.key),
    });
  }
  if (quote) {
    return quoted(String(converted));
  }
  if (typeof converted === "string") {
    const lowered = scriptValueScalar(converted);
    return typeof lowered === "object" ? lowered : scalar(lowered);
  }
  return scalar(converted as number | boolean);
}

/** The rows a field was authored with: the array itself when it repeats, the lone value otherwise. */
function rowsOf<T>(field: ContentFieldBase, value: unknown): readonly T[] {
  return field.repeated ? (value as readonly T[]) : [value as T];
}

/**
 * Emits a repeated member whose array mixes parsed occurrences with fresh
 * inputs, one element at a time in the author's order: the parsed ones splice
 * in as they stand, and each fresh one lowers through this same field.
 *
 * Returns undefined when the member is not that mixture, which a list-shaped
 * field never is — its elements are items inside one container, handled where
 * that container is built.
 */
function spliceParsedOccurrences(
  field: ContentField,
  value: unknown,
  ctx: LoweringContext
): PdxEntry[] | undefined {
  if (
    !Array.isArray(value) ||
    field.shape === "valueList" ||
    !value.some((item) => passthroughEntry(item) !== undefined)
  ) {
    return undefined;
  }
  const key = "key" in field ? field.key : undefined;
  const entries: PdxEntry[] = [];
  for (const item of value as readonly unknown[]) {
    const parsed = passthroughEntry(item);
    if (parsed !== undefined && parsed.key !== key) {
      // The splice writes the parsed entry as it stands, key and all, so an
      // entry from a different field would replace this member's occurrences
      // with something the game reads as another key entirely.
      throw new Error(
        `"${field.member}" was given a parsed "${parsed.key}" entry, and this member ` +
          `writes "${key}": a passthrough carries its own key, so only an occurrence of ` +
          "this member's own key can ride through it"
      );
    }
    entries.push(
      ...(parsed !== undefined ? [parsed] : fieldEntries({ [field.member]: [item] }, [field], ctx))
    );
  }
  return entries;
}

/** Writes one block per authored row of a struct-shaped field, each body lowered against `fields`. */
function structEntries(
  field: ContentFieldBase,
  fields: readonly ContentField[],
  value: unknown,
  ctx: LoweringContext
): PdxEntry[] {
  return rowsOf<Readonly<Record<string, unknown>>>(field, value).map((item) =>
    block(field.key, fieldEntries(item, fields, childContext(ctx, field.key)))
  );
}

type RepeatedStructField = Extract<ContentField, { readonly shape: "repeatedStruct" }>;

/**
 * Writes a repeated struct in the keying its field declares: one wrapping
 * block of individually keyed entries, or one block per entry carrying its id
 * in `identityKey`.
 *
 * An entry's own id becomes the nearest enclosing identity for anything nested
 * inside it (a WeightBlock's desc keys among them) — the render-side mirror of
 * `collectRepeatedStructs`'s identical rebind.
 */
function repeatedStructEntries(
  field: RepeatedStructField,
  record: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  ctx: LoweringContext
): PdxEntry[] {
  const rows = Object.entries(record).map(([id, item]) => ({
    id,
    body: fieldEntries(item, field.fields, childContext(ctx, field.key, id)),
  }));
  if (field.keying === "container") {
    return [
      block(
        field.key,
        rows.map(({ id, body }) => block(id, body))
      ),
    ];
  }
  return rows.map(({ id, body }) => block(field.key, [kv(field.identityKey!, id), ...body]));
}

/**
 * Lowers a definition's members into PDXScript entries, in the order the
 * generated field table declares them.
 */
export function fieldEntries(
  def: Readonly<Record<string, unknown>>,
  fields: readonly ContentField[],
  ctx: LoweringContext
) {
  const entries: PdxEntry[] = [];
  for (const field of fields) {
    const value = def[field.member];
    if (value === undefined) {
      continue;
    }
    // Asked before the shape switch, because a mixed array is emitted element
    // by element and each fresh element reaches the switch on its own.
    const spliced = spliceParsedOccurrences(field, value, ctx);
    if (spliced !== undefined) {
      entries.push(...spliced);
      continue;
    }
    switch (field.shape) {
      case "value":
        for (const item of rowsOf<unknown>(field, value)) {
          entries.push(kv(field.key, contentScalar(item, field, false, ctx)));
        }
        break;
      case "valueList": {
        const values = Array.isArray(value) ? value : [value];
        if (values.length > 0) {
          // `list` is `kv(key, container(items))` over scalars; a passthrough
          // item may be a whole entry (vanilla's `OR = { ... }` alternation
          // inside a reference list), which the same container holds
          // unchanged — a mixed container is ordinary PDXScript, not an error.
          const items: PdxItem[] = values.map((item) =>
            isPassthrough(item) ? item : contentScalar(item, field, field.quoted ?? false, ctx)
          );
          entries.push(kv(field.key, container(items)));
        }
        break;
      }
      case "trigger":
        entries.push(block(field.key, [...(value as Trigger<ScopeName>).entries]));
        collectRefs(ctx, (value as Trigger<ScopeName>).refs, field.key);
        break;
      case "effect": {
        // A reference written inside a script closure is a reference like any
        // other; the recorder reports them here so they face the same
        // integrity check as the declarative fields around them.
        const recorded: ContentRefUse[] = [];
        // The ctx is leased to this field's lowering, so the recording it
        // wraps has to be opened inside it. `this`, `root` and `from` are
        // fixed script paths, and which of them the block may *read* is the
        // generated signature's business, settled before this runs.
        const child = withScriptCtx<ScopeName, ScopeName, ScopeName, PdxEntry[]>(
          { splitRoot: field.splitRoot === true },
          (scriptCtx) =>
            recordEffects(recorded, (scope) =>
              (value as EffectBlock<ScopeName, ScopeName, ScopeName>)(scope, scriptCtx)
            )
        );
        entries.push(block(field.key, child));
        collectRefs(ctx, recorded, field.key);
        break;
      }
      case "economicResources":
        entries.push(
          ...rowsOf<EconomicResourceBlock<ScopeName>>(field, value).map((item) =>
            economicResourceBlock(field.key, item, ECONOMIC_RESOURCE_OPERATIONS, ctx)
          )
        );
        break;
      case "economicResourcesNoProduce":
        entries.push(
          ...rowsOf<EconomicResourceBlockNoProduce<ScopeName>>(field, value).map((item) =>
            economicResourceBlock(
              field.key,
              item as EconomicResourceBlock<ScopeName>,
              ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE,
              ctx
            )
          )
        );
        break;
      case "economicResourceOperation":
        entries.push(
          ...rowsOf<EconomicResourceOperation<ScopeName>>(field, value).map((item) =>
            economicOperation(field.key, item, ctx)
          )
        );
        break;
      case "triggeredModifierBlock":
        entries.push(
          ...rowsOf<TriggeredModifier<ScopeName>>(field, value).map((item) =>
            triggeredModifierBlock(field.key, item, ctx)
          )
        );
        break;
      case "modifierBlock":
        entries.push(
          modifierBlock(field.key, value as ModifierClosure, (use) =>
            collectRefs(ctx, [use], field.key)
          )
        );
        break;
      case "inlineModifiers":
        entries.push(
          ...modifierEntries(value as ModifierClosure, (use) => collectRefs(ctx, [use], ""))
        );
        break;
      case "inlineTrigger":
        entries.push(...(value as Trigger<ScopeName>).entries);
        collectRefs(ctx, (value as Trigger<ScopeName>).refs, field.member);
        break;
      case "weightBlock":
      case "weightBlockWithLoc":
        entries.push(weightBlock(field.key, value as WeightBlock<ScopeName>, ctx));
        break;
      case "dual": {
        // The arm is an ordinary field under the same member, so writing it is
        // one more turn of this same loop rather than a second implementation
        // of every shape a dual can reach.
        const arm = dualArm(field, value);
        entries.push(...fieldEntries({ [arm.member]: value }, [arm], ctx));
        break;
      }
      case "weightedEvents": {
        const arms = value as readonly { weight: number; event?: unknown }[];
        entries.push(
          block(
            field.key,
            arms.map((arm) =>
              kv(
                String(arm.weight),
                arm.event === undefined ? 0 : contentScalar(arm.event, field, false, ctx)
              )
            )
          )
        );
        break;
      }
      case "struct": {
        if (field.wrapped) {
          const items = value as readonly Readonly<Record<string, unknown>>[];
          entries.push(
            kv(
              field.key,
              container(
                items.map((item) =>
                  container(fieldEntries(item, field.fields, childContext(ctx, field.key)))
                )
              )
            )
          );
          break;
        }
        entries.push(...structEntries(field, field.fields, value, ctx));
        break;
      }
      case "triggerStruct":
        entries.push(...structEntries(field, field.fields, value, ctx));
        break;
      case "aliasStruct":
        entries.push(...structEntries(field, aliasStructFieldsOf(field.category), value, ctx));
        break;
      case "structMap": {
        const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        entries.push(
          block(
            field.key,
            Object.entries(record).map(([name, item]) =>
              block(name, fieldEntries(item, field.fields, childContext(ctx, field.key)))
            )
          )
        );
        break;
      }
      case "scalarMap": {
        const record = value as Readonly<Record<string, number | string>>;
        entries.push(
          block(
            field.key,
            Object.entries(record).map(([name, amount]) => kv(name, amount))
          )
        );
        break;
      }
      case "repeatedStruct":
        entries.push(
          ...repeatedStructEntries(
            field,
            value as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
            ctx
          )
        );
        break;
      default:
        assertNever(field, "content field");
    }
  }
  return entries;
}
