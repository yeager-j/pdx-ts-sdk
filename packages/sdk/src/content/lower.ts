/** Recursive interpretation of generated content field metadata. */
import {
  block,
  container,
  kv,
  quoted,
  scalar,
  varRef,
  type PdxEntry,
  type PdxItem,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { refId, type TypedRef } from "../generated/refs.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { underField, type ContentRefSink, type ContentRefUse } from "../references.ts";
import { recordEffects, scriptCtx } from "../script/effects/recorder.ts";
import type { ScriptCtx } from "../script/effects/types.ts";
import { scriptValueScalar, type ScriptValue, type Trigger } from "../script/trigger-core.ts";
import {
  ECONOMIC_RESOURCE_OPERATIONS,
  ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE,
  economicResourceBlock,
  modifierBlock,
  modifierEntries,
  triggeredModifierBlock,
  weightBlock,
} from "./blocks.ts";
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
    case "weightBlock":
    case "weightBlockWithLoc":
    case "economicResources":
    case "economicResourcesNoProduce":
    case "triggeredModifierBlock":
      return true;
    case "dual":
      return field.arms.some(acceptsFromClosure);
    default:
      return false;
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
  return (value as (ctx: ScriptCtx<ScopeName, ScopeName>) => unknown)(
    scriptCtx<ScopeName, ScopeName>()
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
    if (acceptsFromClosure(field)) {
      resolved[field.member] = resolveFromClosure(field, value);
      continue;
    }
    if (field.shape === "struct") {
      resolved[field.member] = field.repeated
        ? (value as readonly Readonly<Record<string, unknown>>[]).map((item) =>
            resolveFromClosures(item, field.fields)
          )
        : resolveFromClosures(value as Readonly<Record<string, unknown>>, field.fields);
      continue;
    }
    if (field.shape === "repeatedStruct") {
      const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      resolved[field.member] = Object.fromEntries(
        Object.entries(record).map(([id, nested]) => [
          id,
          resolveFromClosures(nested, field.fields),
        ])
      );
    }
  }
  return resolved;
}

interface LoweringContext {
  readonly collect?: ContentRefSink;
  readonly path: string;
  readonly ownerId: string;
}

function childContext(ctx: LoweringContext, segment: string, ownerId?: string): LoweringContext {
  return {
    collect: ctx.collect,
    path: joinPath(ctx.path, segment),
    ownerId: ownerId ?? ctx.ownerId,
  };
}

/**
 * The token a `WeightBlock` field's desc-bearing rows register and resolve
 * their localisation key under: the nearest enclosing identity plus the
 * field's own key, so a row shared across two definitions — or across two
 * `WeightBlock` fields of one definition — resolves its own occurrence's key
 * rather than whichever registration happened to run last (PR #16 review
 * finding 3).
 */
function descOwnerKey(ctx: LoweringContext, key: string): string {
  return `${ctx.ownerId}::${key}`;
}

function joinPath(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

/** Reports references a spliced trigger or effect closure recorded, re-rooted
 * under the field that holds them so the diagnostic names the whole path. */
function collectRefs(ctx: LoweringContext, refs: readonly ContentRefUse[], segment: string): void {
  if (ctx.collect === undefined) {
    return;
  }
  for (const use of underField(refs, joinPath(ctx.path, segment))) {
    ctx.collect(use);
  }
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
  return (
    kind === "entry" ||
    kind === "container" ||
    kind === "param" ||
    kind === "str" ||
    kind === "num" ||
    kind === "bool" ||
    kind === "var" ||
    kind === "math"
  );
}

function passthroughEntry(value: unknown): PdxEntry | undefined {
  return isPassthrough(value) && value.kind === "entry" ? value : undefined;
}

function contentScalar(
  value: unknown,
  field: ContentFieldBase & ContentRefTypes & { readonly conversion: "identity" | "ref" },
  quote: boolean,
  ctx?: LoweringContext
): PdxScalar {
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
  // A `@name` scripted-variable reference has to become a `var` node to write
  // bare (`base = @name`) — passed through as a plain string, pdxscript's
  // serializer quotes it defensively, and the game reads a literal instead of
  // evaluating the variable. Every `value_field`-typed field (a `ScriptValue`)
  // can carry this form, and no other field's real vanilla domain admits a
  // leading `@`, so the check is safe unconditionally rather than gated on
  // which field this is.
  if (typeof converted === "string" && converted.startsWith("@")) {
    return varRef(converted);
  }
  return scalar(converted as string | number | boolean);
}

/**
 * The recorder behind {@link ModifierClosure}: property access extends the
 * path, a call joins it with `_` into the flat name the game reads. One proxy
 * shape serves every scope — the generated recorder interfaces are the only
 * thing keeping paths honest, exactly like the effect recorder.
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
    // A repeated member whose array mixes parsed occurrences with fresh inputs
    // is emitted one element at a time, in the author's order: the parsed ones
    // splice in as they stand, and each fresh one lowers through this same
    // field. A list-shaped field is not this case — its elements are items
    // inside one container, handled where that container is built.
    if (
      Array.isArray(value) &&
      field.shape !== "valueList" &&
      value.some((item) => passthroughEntry(item) !== undefined)
    ) {
      for (const item of value as readonly unknown[]) {
        const parsed = passthroughEntry(item);
        entries.push(
          ...(parsed !== undefined
            ? [parsed]
            : fieldEntries({ [field.member]: [item] }, [field], ctx))
        );
      }
      continue;
    }
    switch (field.shape) {
      case "value": {
        const values = field.repeated ? (value as readonly unknown[]) : [value];
        for (const item of values) {
          entries.push(kv(field.key, contentScalar(item, field, false, ctx)));
        }
        break;
      }
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
        // Every effect block gets the same ctx object: `this` and `from` are
        // fixed script paths, and which of them the block may *read* is the
        // generated signature's business, settled before this runs.
        const child = recordEffects(recorded, (scope) =>
          (value as EffectBlock<ScopeName, ScopeName>)(scope, scriptCtx<ScopeName, ScopeName>())
        );
        entries.push(block(field.key, child));
        collectRefs(ctx, recorded, field.key);
        break;
      }
      case "economicResources": {
        const values = field.repeated
          ? (value as readonly EconomicResourceBlock<ScopeName>[])
          : [value as EconomicResourceBlock<ScopeName>];
        entries.push(
          ...values.map((item) =>
            economicResourceBlock(field.key, item, ECONOMIC_RESOURCE_OPERATIONS, ctx)
          )
        );
        break;
      }
      case "economicResourcesNoProduce": {
        const values = field.repeated
          ? (value as readonly EconomicResourceBlockNoProduce<ScopeName>[])
          : [value as EconomicResourceBlockNoProduce<ScopeName>];
        entries.push(
          ...values.map((item) =>
            economicResourceBlock(
              field.key,
              item as EconomicResourceBlock<ScopeName>,
              ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE,
              ctx
            )
          )
        );
        break;
      }
      case "triggeredModifierBlock": {
        const values = field.repeated
          ? (value as readonly TriggeredModifier<ScopeName>[])
          : [value as TriggeredModifier<ScopeName>];
        entries.push(...values.map((item) => triggeredModifierBlock(field.key, item, ctx)));
        break;
      }
      case "modifierBlock":
        entries.push(modifierBlock(field.key, value as ModifierClosure));
        break;
      case "inlineModifiers":
        entries.push(...modifierEntries(value as ModifierClosure));
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
        const values = field.repeated
          ? (value as readonly Readonly<Record<string, unknown>>[])
          : [value as Readonly<Record<string, unknown>>];
        entries.push(
          ...values.map((item) =>
            block(field.key, fieldEntries(item, field.fields, childContext(ctx, field.key)))
          )
        );
        break;
      }
      case "aliasStruct": {
        const nested = aliasStructFieldsOf(field.category);
        const values = field.repeated
          ? (value as readonly Readonly<Record<string, unknown>>[])
          : [value as Readonly<Record<string, unknown>>];
        entries.push(
          ...values.map((item) =>
            block(field.key, fieldEntries(item, nested, childContext(ctx, field.key)))
          )
        );
        break;
      }
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
      case "repeatedStruct": {
        const record = value as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        if (field.keying === "container") {
          entries.push(
            block(
              field.key,
              // The entry's own id becomes the nearest enclosing identity for
              // anything nested inside it (a WeightBlock's desc keys among
              // them) — the render-side mirror of
              // `collectRepeatedStructs`'s identical rebind.
              Object.entries(record).map(([id, item]) =>
                block(id, fieldEntries(item, field.fields, childContext(ctx, field.key, id)))
              )
            )
          );
          break;
        }
        for (const [id, item] of Object.entries(record)) {
          entries.push(
            block(field.key, [
              kv(field.identityKey!, id),
              ...fieldEntries(item, field.fields, childContext(ctx, field.key, id)),
            ])
          );
        }
        break;
      }
    }
  }
  return entries;
}
