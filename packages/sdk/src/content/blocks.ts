/** Reusable PDXScript encoders for content block shapes. */
import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { refId } from "../generated/refs.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { underField, type ContentRefSink, type ContentRefUse } from "../references.ts";
import {
  complexTriggerModifierEntry,
  modifierEntry,
  weightOperationEntries,
} from "../script/effects/modifiers.ts";
import { assertSynchronousClosure } from "../script/effects/recorder.ts";
import type { ComplexTriggerModifier, Modifier } from "../script/effects/types.ts";
import { scriptValueScalar, type ScriptValue } from "../script/trigger-core.ts";
import type {
  EconomicResourceBlock,
  EconomicResourceBlockNoProduce,
  EconomicResourceOperation,
  ModifierClosure,
  ScaledModifier,
  TriggeredModifier,
  WeightBlock,
  WeightBlockRow,
} from "./types.ts";

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

function descOwnerKey(ctx: LoweringContext, key: string): string {
  return `${ctx.ownerId}::${key}`;
}

function joinPath(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

function collectRefs(ctx: LoweringContext, refs: readonly ContentRefUse[], segment: string): void {
  if (ctx.collect === undefined) {
    return;
  }
  for (const use of underField(refs, joinPath(ctx.path, segment))) {
    ctx.collect(use);
  }
}

function modifierRecorder(
  record: (name: string, amount: number) => void,
  live: { value: boolean }
): unknown {
  const assertLive = (member: string): void => {
    if (live.value) {
      return;
    }
    // Same hazard, and the same fix, as `assertLive` in the effect recorder: the
    // recorder closes over an entry array that is finished data once the
    // closure returns, so a recorder stored somewhere longer-lived would edit
    // an already-built mod and change only what the *next* render emits.
    throw new Error(
      `'${member}' was recorded on a modifier closure that has already returned, so its ` +
        "entry has nowhere to land: the closure's modifiers were lowered into the definition " +
        "when it returned, and writing one now would change what an already-built mod " +
        "renders, silently and only on the next render(). Write every modifier inside the " +
        "closure the recorder is handed to, rather than storing the recorder and using it later."
    );
  };
  const node = (path: readonly string[]): unknown =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        assertLive(prop);
        if (path.length === 0 && (prop === "raw" || prop === "unchecked")) {
          return (name: string, amount: number) => {
            assertLive(name);
            record(name, amount);
          };
        }
        return node([...path, prop]);
      },
      apply(_target, _thisArg, args) {
        assertLive(path.join("_"));
        record(path.join("_"), args[0] as number);
      },
    });
  return node([]);
}

export function modifierEntries(closure: ModifierClosure): PdxEntry[] {
  const entries: PdxEntry[] = [];
  const live = { value: true };
  let result: unknown;
  try {
    result = closure(
      modifierRecorder((name, amount) => entries.push(kv(name, amount)), live) as never
    );
  } finally {
    // Dead as soon as the closure returns, however it returns — an author's
    // error inside one modifier closure must not leave the recorder it was
    // handed able to write into a finished definition.
    live.value = false;
  }
  // The same hazard `recordEffects` checks for, at the other closure entry
  // point: an `async` modifier closure records its sync prefix, ends the
  // recording at its first await, and loses the rest.
  assertSynchronousClosure(result, "A modifier closure");
  return entries;
}

export function modifierBlock(key: string, value: ModifierClosure): PdxEntry {
  return block(key, modifierEntries(value));
}

/**
 * Discriminates a {@link WeightBlockRow} structurally: {@link
 * ComplexTriggerModifier} is the only row kind with a required `trigger`
 * member, `Modifier`/`ModifierWithLoc` the only kind with a required `when` —
 * the same shape-from-presence approach `dualArm` uses for content fields,
 * rather than a runtime brand neither row kind otherwise needs.
 *
 * `WeightBlockRow`'s two arms forbid each other's characteristic members
 * (`ExclusiveModifierRow`/`ExclusiveComplexTriggerModifierRow` below), so a
 * row authored with both `when` and `trigger`/`mode` is a compile error for
 * any author going through the exported types. That check is erased at
 * runtime, though — an untyped call site, an `as any`, or a value built by
 * hand and threaded through JavaScript can still reach here with both
 * present. Silently classifying it as one row kind and dropping the other's
 * fields (what a bare presence check would do) is worse than a build
 * failure, so this throws instead of guessing.
 */
export function isComplexTriggerModifier(
  row: WeightBlockRow<ScopeName>
): row is ComplexTriggerModifier<ScopeName> {
  const hasTrigger = "trigger" in row && row.trigger !== undefined;
  const hasWhen = "when" in row && row.when !== undefined;
  if (hasTrigger && hasWhen) {
    throw new Error(
      "A WeightBlock row has both a Modifier's `when` and a ComplexTriggerModifier's " +
        "`trigger`/`mode` — the exported types forbid this combination, so reaching it here " +
        "means it was built outside them (an `as any`, an untyped call site, or similar). " +
        "Author it as one row kind or the other; a row cannot be both."
    );
  }
  return hasTrigger;
}

export function weightBlock(
  key: string,
  value: WeightBlock<ScopeName>,
  ctx: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.base !== undefined) {
    entries.push(kv("base", value.base));
  }
  entries.push(...weightOperationEntries(value));
  const refs: ContentRefUse[] = [];
  const ownerKey = descOwnerKey(ctx, key);
  entries.push(
    ...(value.modifiers ?? []).map((row) =>
      isComplexTriggerModifier(row)
        ? complexTriggerModifierEntry(row, refs, ownerKey)
        : modifierEntry(row, refs, ownerKey)
    )
  );
  for (const modifier of value.scaledModifiers ?? []) {
    entries.push(scaledModifierEntry(modifier, refs));
  }
  collectRefs(ctx, refs, key);
  return block(key, entries);
}

function scaledModifierEntry(modifier: ScaledModifier, refs: ContentRefUse[]): PdxEntry {
  const entries: PdxEntry[] = [];
  if (modifier.limit !== undefined) {
    entries.push(block("limit", [...modifier.limit.entries]));
    refs.push(...modifier.limit.refs);
  }
  entries.push(kv("scope", modifier.scope), kv("calc", modifier.calc));
  for (const key of ["factor", "add", "div", "mul"] as const) {
    if (modifier[key] !== undefined) {
      entries.push(kv(key, modifier[key]));
    }
  }
  return block("scaled_modifier", entries);
}

function repeatedNumbers(
  key: string,
  value: ScriptValue | readonly ScriptValue[] | undefined
): PdxEntry[] {
  if (value === undefined) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map((item) => kv(key, scriptValueScalar(item)));
}

export function economicOperation(
  key: string,
  value: EconomicResourceOperation<ScopeName>,
  ctx: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.when !== undefined) {
    entries.push(block("trigger", [...value.when.entries]));
    collectRefs(ctx, value.when.refs, `${key}.trigger`);
  }
  entries.push(...Object.entries(value.amounts).map(([resource, amount]) => kv(resource, amount)));
  entries.push(...repeatedNumbers("multiplier", value.multiplier));
  entries.push(...repeatedNumbers("mult", value.mult));
  return block(key, entries);
}

/** Every operation {@link economicResourceBlock} can iterate, in emission order. */
type EconomicResourceOperationKey = "cost" | "produces" | "upkeep" | "logistics";

/** The full arm list — every registry splicing plain `economic_template`. */
export const ECONOMIC_RESOURCE_OPERATIONS: readonly EconomicResourceOperationKey[] = [
  "cost",
  "produces",
  "upkeep",
  "logistics",
];

/**
 * `economic_template_no_produce`'s arm list — `produces` left out entirely.
 *
 * `economicResourcesNoProduce` fields are typed as
 * {@link EconomicResourceBlockNoProduce}, which already keeps `produces`
 * uncompilable, but a cast can still force one past that type. Iterating this
 * shorter list rather than filtering the four-element one at the value level
 * is what keeps a cast-forced `produces` unemitted too: the loop below never
 * reads the key, so it does not matter whether the object carries it.
 */
export const ECONOMIC_RESOURCE_OPERATIONS_NO_PRODUCE: readonly EconomicResourceOperationKey[] = [
  "cost",
  "upkeep",
  "logistics",
];

export function economicResourceBlock(
  key: string,
  value: EconomicResourceBlock<ScopeName>,
  operations: readonly EconomicResourceOperationKey[],
  ctx: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.category !== undefined) {
    const category = refId(value.category);
    // The one reference this shared shape holds; its registry is written into
    // the interface above rather than into any generated field table.
    ctx.collect?.({
      targets: ["economic_category"],
      id: category,
      field: joinPath(ctx.path, `${key}.category`),
    });
    entries.push(kv("category", category));
  }
  for (const operation of operations) {
    const arm = value[operation];
    if (arm !== undefined) {
      entries.push(economicOperation(operation, arm, childContext(ctx, key)));
    }
  }
  return block(key, entries);
}

export function triggeredModifierBlock(
  key: string,
  value: TriggeredModifier<ScopeName>,
  ctx: LoweringContext
): PdxEntry {
  const entries: PdxEntry[] = [];
  if (value.when !== undefined) {
    entries.push(block("potential", [...value.when.entries]));
    collectRefs(ctx, value.when.refs, `${key}.potential`);
  }
  if (value.key !== undefined) {
    entries.push(kv("key", value.key));
  }
  if (value.showIfNotPotential !== undefined) {
    entries.push(kv("show_if_not_potential", value.showIfNotPotential));
  }
  if (value.notPotentialOverrideTextKey !== undefined) {
    entries.push(kv("not_potential_override_text_key", value.notPotentialOverrideTextKey));
  }
  if (value.modifier !== undefined) {
    entries.push(modifierBlock("modifier", value.modifier));
  }
  if (value.modifiers !== undefined) {
    entries.push(...modifierEntries(value.modifiers));
  }
  if (value.description !== undefined) {
    entries.push(kv("description", value.description));
  }
  if (value.descriptionParameters !== undefined) {
    entries.push(
      block(
        "description_parameters",
        Object.entries(value.descriptionParameters).map(([name, parameter]) => kv(name, parameter))
      )
    );
  }
  if (value.showOnlyCustomTooltip !== undefined) {
    entries.push(kv("show_only_custom_tooltip", value.showOnlyCustomTooltip));
  }
  if (value.customTooltip !== undefined) {
    entries.push(kv("custom_tooltip", value.customTooltip));
  }
  entries.push(...repeatedNumbers("mult", value.mult));
  entries.push(...repeatedNumbers("multiplier", value.multiplier));
  return block(key, entries);
}
