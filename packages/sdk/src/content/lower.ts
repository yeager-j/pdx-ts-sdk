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

import type { AssetFileItem } from "../authoring/assets.ts";
import { resolveDeferredLocalization } from "../authoring/deferred-localization.ts";
import { snapshotAuthoredValue } from "../authoring/snapshot.ts";
import { weightedEventBlock } from "../events/weighted-events.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type { RecordedRefUse } from "../references.ts";
import { recordEffects, withScriptCtx } from "../script/effects/recorder.ts";
import type { AmbientScopeContext, ScriptCtx } from "../script/effects/types.ts";
import {
  assertReferenceValue,
  localizationScalar,
  refId,
  type TypedRef,
} from "../script/scalar.ts";
import { scriptValueScalar, type ScriptValue, type Trigger } from "../script/trigger-core.ts";
import {
  ECONOMIC_RESOURCE_OPERATIONS,
  ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE,
  economicOperation,
  economicResourceBlock,
  modifierBlock,
  modifierEntries,
  triggeredModifierBlock,
  weightBlock,
} from "./blocks.ts";
import { contentFieldDescent, mapContentFieldRecords } from "./field-descent.ts";
import { childContext, collectRefs, joinPath, type LoweringContext } from "./lowering-context.ts";
import { type ContentField, type ContentFieldBase, type ContentRefTypes } from "./schema.ts";
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
  // Snapshotted, because what a closure returns is as caller-owned as a plain
  // field value: a closure that hands back an object it shares with its caller
  // would otherwise have that object frozen in place when the definition is
  // built (SDK-325). The copy is taken before the definition walk registers
  // desc keys against the rows in it, so registration and lowering still key
  // on one set of objects.
  return snapshotAuthoredValue(
    withScriptCtx<ScopeName, AmbientScopeContext, unknown>({}, (scriptCtx) =>
      (value as (ctx: ScriptCtx<ScopeName, AmbientScopeContext>) => unknown)(scriptCtx)
    )
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
 * Structural descent comes from the same field model as definition rewriting,
 * emission, and patch localization, so every nested shape resolves closures.
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
    const descent = contentFieldDescent(field, value);
    if (descent.kind === "field") {
      const nested = resolveFromClosures({ [descent.field.member]: value }, [descent.field]);
      resolved[field.member] = nested[descent.field.member];
      continue;
    }
    if (acceptsFromClosure(field)) {
      resolved[field.member] = resolveFromClosure(field, value);
      continue;
    }
    if (descent.kind === "records") {
      resolved[field.member] = mapContentFieldRecords(descent, (occurrence) =>
        resolveFromClosures(occurrence.value as Readonly<Record<string, unknown>>, descent.fields)
      );
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
export function isPassthrough(value: unknown): value is PdxItem {
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
    ContentRefTypes & {
      readonly conversion: "identity" | "ref" | "assetPath";
      readonly locKey?: true;
      readonly locKeyLiterals?: readonly string[];
    },
  quote: boolean,
  ctx?: LoweringContext
): PdxScalar {
  if (field.locKey === true && ctx?.unresolvedKeys === true) {
    return localizationScalar(value, joinPath(ctx.path, field.key), field.locKeyLiterals);
  }
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
  if (field.conversion === "ref") {
    // `refId` refuses a non-reference on its own; this adds the field name it
    // has no way to know, so the author reads which member holds the value
    // rather than only that some reference position did.
    assertReferenceValue(value, joinPath(ctx?.path ?? "", field.key));
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
  /**
   * Resolves the entries one field just wrote, before the walk leaves the
   * level whose `ownerId` those entries' inline localization keys hang off.
   *
   * Per field rather than per definition: a `repeatedStruct` entry rebinds
   * `ownerId` on the way down, and a one-pass sweep over a finished top-level
   * entry would key every marker under the outermost id instead.
   */
  const resolveField = (from: number): void => {
    if (ctx.localization === undefined || entries.length === from) {
      return;
    }
    const written = entries.slice(from);
    const resolved = resolveDeferredLocalization(written, ctx.ownerId, ctx.localization);
    if (resolved !== written) {
      entries.length = from;
      entries.push(...resolved);
    }
  };
  for (const field of fields) {
    const value = def[field.member];
    if (value === undefined) {
      continue;
    }
    const writtenFrom = entries.length;
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
      const key = "key" in field ? field.key : undefined;
      for (const item of value as readonly unknown[]) {
        const parsed = passthroughEntry(item);
        if (parsed !== undefined && parsed.key !== key) {
          // The splice writes the parsed entry as it stands, key and all, so an
          // entry from a different field would replace this member's
          // occurrences with something the game reads as another key entirely.
          throw new Error(
            `"${field.member}" was given a parsed "${parsed.key}" entry, and this member ` +
              `writes "${key}": a passthrough carries its own key, so only an occurrence of ` +
              "this member's own key can ride through it"
          );
        }
        entries.push(
          ...(parsed !== undefined
            ? [parsed]
            : fieldEntries({ [field.member]: [item] }, [field], ctx))
        );
      }
      continue;
    }
    const descent = contentFieldDescent(field, value);
    if (descent.kind === "field") {
      entries.push(...fieldEntries({ [descent.field.member]: value }, [descent.field], ctx));
      resolveField(writtenFrom);
      continue;
    }
    if (descent.kind === "records") {
      const nestedEntries = descent.occurrences.map((occurrence) =>
        fieldEntries(
          occurrence.value as Readonly<Record<string, unknown>>,
          descent.fields,
          childContext(
            ctx,
            descent.field.key,
            descent.field.shape === "repeatedStruct" ? occurrence.key : undefined
          )
        )
      );
      switch (descent.field.shape) {
        case "struct":
          if (descent.field.wrapped === true) {
            entries.push(
              kv(descent.field.key, container(nestedEntries.map((nested) => container(nested))))
            );
          } else {
            entries.push(...nestedEntries.map((nested) => block(descent.field.key, nested)));
          }
          break;
        case "triggerStruct":
        case "aliasStruct":
          entries.push(...nestedEntries.map((nested) => block(descent.field.key, nested)));
          break;
        case "structMap":
          entries.push(
            block(
              descent.field.key,
              nestedEntries.map((nested, index) => block(descent.occurrences[index]!.key!, nested))
            )
          );
          break;
        case "repeatedStruct":
          const repeatedStructField = descent.field;
          if (repeatedStructField.keying === "container") {
            entries.push(
              block(
                repeatedStructField.key,
                nestedEntries.map((nested, index) =>
                  block(descent.occurrences[index]!.key!, nested)
                )
              )
            );
          } else {
            entries.push(
              ...nestedEntries.map((nested, index) =>
                block(repeatedStructField.key, [
                  kv(repeatedStructField.identityKey!, descent.occurrences[index]!.key!),
                  ...nested,
                ])
              )
            );
          }
          break;
      }
      resolveField(writtenFrom);
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
        const recorded: RecordedRefUse[] = [];
        // The ctx is leased to this field's lowering, so the recording it
        // wraps has to be opened inside it. `this`, `root` and `from` are
        // fixed script paths, and which of them the block may *read* is the
        // generated signature's business, settled before this runs.
        const child = withScriptCtx<ScopeName, AmbientScopeContext, PdxEntry[]>(
          { splitRoot: field.splitRoot === true },
          (scriptCtx) =>
            recordEffects(recorded, (scope) =>
              (value as EffectBlock<ScopeName, AmbientScopeContext>)(scope, scriptCtx)
            )
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
      case "economicResourceOperation": {
        const values = field.repeated
          ? (value as readonly EconomicResourceOperation<ScopeName>[])
          : [value as EconomicResourceOperation<ScopeName>];
        entries.push(...values.map((item) => economicOperation(field.key, item, ctx)));
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
      case "weightedEvents": {
        const arms = value as readonly { weight: number; event?: unknown }[];
        entries.push(
          weightedEventBlock(
            field.key,
            arms,
            (event) => contentScalar(event, field, false, ctx),
            `"${joinPath(ctx.path, field.key)}"`
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
    }
    resolveField(writtenFrom);
  }
  return entries;
}
