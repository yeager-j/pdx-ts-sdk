/** Reusable PDXScript encoders for content block shapes. */
import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { MODIFIER_REFERENCE_FAMILIES } from "../generated/modifiers.ts";
import type { ScopeName } from "../generated/scopes.ts";
import { isVanillaRef } from "../identifiers/trie.ts";
import { underField, type RecordedRefUse, type RefUseSink } from "../references.ts";
import {
  complexTriggerModifierEntry,
  modifierEntry,
  weightOperationEntries,
} from "../script/effects/modifiers.ts";
import { assertSynchronousClosure } from "../script/effects/recorder.ts";
import type { ComplexTriggerModifier, Modifier } from "../script/effects/types.ts";
import { refId, type TypedRef } from "../script/scalar.ts";
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
  readonly collect?: RefUseSink;
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
  if (segment === "") {
    return path;
  }
  return path === "" ? segment : `${path}.${segment}`;
}

function collectRefs(ctx: LoweringContext, refs: readonly RecordedRefUse[], segment: string): void {
  if (ctx.collect === undefined) {
    return;
  }
  for (const use of underField(refs, joinPath(ctx.path, segment))) {
    ctx.collect(use);
  }
}

interface DynamicModifierFamily {
  readonly target: string;
  readonly placeholder: string;
  readonly operations: Readonly<Record<string, string>>;
  readonly id: string;
  readonly verifiedVanilla: boolean;
}

interface ModifierReference {
  readonly target: string;
  readonly id: string;
  readonly verifiedVanilla: boolean;
}

const ECONOMIC_TRIGGERED_OPERATIONS = ["cost", "produces", "upkeep", "logistics"] as const;
type EconomicTriggeredOperation = (typeof ECONOMIC_TRIGGERED_OPERATIONS)[number];

type ModifierRecord = (
  name: string,
  amount: number,
  reference?: ModifierReference | readonly ModifierReference[]
) => void;

function economicTriggeredRows(id: string, def: Record<string, unknown>): Map<string, Set<string>> {
  const rowsByKey = new Map<string, Set<string>>();
  const fields: readonly (readonly [EconomicTriggeredOperation, string])[] = [
    ["cost", "triggeredCostModifier"],
    ["produces", "triggeredProducesModifier"],
    ["upkeep", "triggeredUpkeepModifier"],
    ["logistics", "triggeredLogisticsModifier"],
  ];
  for (const [operation, member] of fields) {
    const rows = def[member];
    if (rows === undefined) {
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new Error(
        `Economic category "${id}" has malformed ${member}; expected an array of rows`
      );
    }
    for (const row of rows) {
      if (row === null || typeof row !== "object") {
        throw new Error(
          `Economic category "${id}" has malformed ${member}; each row must be an object`
        );
      }
      const key = refId((row as { readonly key?: unknown }).key as never);
      if (typeof key !== "string" || key.length === 0) {
        throw new Error(
          `Economic category "${id}" has malformed ${member}; each row requires a key`
        );
      }
      const modifierTypes = (row as { readonly modifierTypes?: unknown }).modifierTypes;
      if (!Array.isArray(modifierTypes)) {
        throw new Error(
          `Economic category "${id}" has malformed ${member} row "${key}"; ` +
            "modifierTypes must be an array"
        );
      }
      const capabilities = rowsByKey.get(`${key}\u0000${operation}`) ?? new Set<string>();
      for (const modifierType of modifierTypes) {
        if (modifierType !== "add" && modifierType !== "mult") {
          throw new Error(
            `Economic category "${id}" has malformed ${member} row "${key}"; ` +
              `unknown modifier type "${String(modifierType)}"`
          );
        }
        capabilities.add(modifierType);
      }
      rowsByKey.set(`${key}\u0000${operation}`, capabilities);
    }
  }
  return rowsByKey;
}

function economicTriggeredRecorder(
  id: string,
  sourceReference: ModifierReference,
  triggeredRows: ReadonlyMap<string, ReadonlySet<string>>,
  assertLive: (member: string) => void,
  record: ModifierRecord
): (selected: unknown) => unknown {
  return (selected: unknown) => {
    assertLive("economic.triggered");
    const selectedId = refId(selected as never);
    if (typeof selectedId !== "string" || selectedId.length === 0) {
      throw new Error(`modifier.economic.triggered requires an economic category reference or id`);
    }
    const selectedReference: ModifierReference = {
      target: "economic_category",
      id: selectedId,
      verifiedVanilla: isVanillaRef(selected),
    };
    let declared = false;
    for (const operation of ECONOMIC_TRIGGERED_OPERATIONS) {
      const capabilities = triggeredRows.get(`${selectedId}\u0000${operation}`);
      if (capabilities !== undefined) {
        declared = true;
      }
    }
    if (!declared) {
      throw new Error(
        `Economic category "${id}" has no triggered modifier row for key "${selectedId}"`
      );
    }
    return new Proxy(
      {},
      {
        get: (_target, operation: string) => {
          if (operation === "resource") {
            return (resource: unknown) => {
              assertLive(`economic.triggered(${selectedId}).resource`);
              const resourceId = typeof resource === "string" ? resource : refId(resource as never);
              if (typeof resourceId !== "string") {
                throw new Error(
                  "modifier.economic.triggered.resource requires a resource reference"
                );
              }
              return new Proxy(
                {},
                {
                  get: (_resourceTarget, resourceOperation: string) => {
                    const capabilities = triggeredRows.get(
                      `${selectedId}\u0000${resourceOperation}`
                    );
                    if (capabilities === undefined) {
                      throw new Error(
                        `Economic category triggered key "${selectedId}" has no ` +
                          `"${resourceOperation}" modifier family`
                      );
                    }
                    return new Proxy(
                      {},
                      {
                        get: (_operationTarget, modifierType: string) => {
                          if (!capabilities.has(modifierType)) {
                            throw new Error(
                              `Economic category triggered key "${selectedId}" ` +
                                `does not support ${resourceOperation}.${modifierType}`
                            );
                          }
                          return (amount: number) => {
                            assertLive(
                              `economic.triggered(${selectedId}).resource.${resourceOperation}.${modifierType}`
                            );
                            record(
                              `${selectedId}_${resourceId}_${resourceOperation}_${modifierType}`,
                              amount,
                              [sourceReference, selectedReference]
                            );
                          };
                        },
                      }
                    );
                  },
                }
              );
            };
          }
          if (!ECONOMIC_TRIGGERED_OPERATIONS.includes(operation as EconomicTriggeredOperation)) {
            throw new Error(
              `Economic category triggered key "${selectedId}" has unknown ` +
                `modifier operation "${operation}"`
            );
          }
          const capabilities = triggeredRows.get(`${selectedId}\u0000${operation}`);
          if (capabilities === undefined) {
            throw new Error(
              `Economic category triggered key "${selectedId}" has no ` +
                `"${operation}" modifier family`
            );
          }
          if (!capabilities.has("mult")) {
            throw new Error(
              `Economic category triggered key "${selectedId}" does not support ` +
                `${operation}.mult`
            );
          }
          return {
            mult: (amount: number) => {
              assertLive(`economic.triggered(${selectedId}).${operation}.mult`);
              record(`${selectedId}_${operation}_mult`, amount, [
                sourceReference,
                selectedReference,
              ]);
            },
          };
        },
      }
    );
  };
}

function modifierRecorder(record: ModifierRecord, live: { value: boolean }): unknown {
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
  const node = (path: readonly string[], dynamicFamily?: DynamicModifierFamily): unknown =>
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
        if (path.length === 0 && prop === "scripted") {
          return (item: { readonly id: string; readonly type: string }) => {
            assertLive("scripted");
            if (item.type !== "scripted_modifier") {
              throw new Error("modifier.scripted requires a scripted modifier item");
            }
            const id = refId(item as never);
            if (typeof id !== "string") {
              throw new Error("modifier.scripted requires a content reference");
            }
            return {
              set: (amount: number) => {
                assertLive("scripted.set");
                record(id, amount, {
                  target: "scripted_modifier",
                  id,
                  verifiedVanilla: false,
                });
              },
            };
          };
        }
        if (path.length === 0 && prop === "economic") {
          return (item: {
            readonly id: string;
            readonly type: string;
            readonly def: Record<string, unknown>;
          }) => {
            assertLive("economic");
            if (item.type !== "economic_category") {
              throw new Error("modifier.economic requires an economic category item");
            }
            const id = refId(item as never);
            if (typeof id !== "string") {
              throw new Error("modifier.economic requires a content reference");
            }
            const def = item.def;
            if (def === null || typeof def !== "object") {
              throw new Error("modifier.economic requires an economic category definition");
            }
            const sourceReference: ModifierReference = {
              target: "economic_category",
              id,
              verifiedVanilla: isVanillaRef(item),
            };
            const add = new Set((def.generateAddModifiers as readonly string[] | undefined) ?? []);
            const mult = new Set(
              (def.generateMultModifiers as readonly string[] | undefined) ?? []
            );
            const triggeredRows = economicTriggeredRows(id, def);
            return new Proxy(
              {},
              {
                get: (_target, key: string) => {
                  if (key === "resource") {
                    return (resource: unknown) => {
                      assertLive("economic.resource");
                      const resourceId =
                        typeof resource === "string" ? resource : refId(resource as never);
                      if (typeof resourceId !== "string") {
                        throw new Error("modifier.economic.resource requires a resource reference");
                      }
                      return new Proxy(
                        {},
                        {
                          get: (_target, kind: string) => {
                            assertLive(`economic.resource.${kind}`);
                            if (!add.has(kind) && !mult.has(kind)) {
                              return undefined;
                            }
                            return {
                              ...(add.has(kind)
                                ? {
                                    add: (amount: number) => {
                                      assertLive(`economic.resource.${kind}.add`);
                                      record(
                                        `${id}_${resourceId}_${kind}_add`,
                                        amount,
                                        sourceReference
                                      );
                                    },
                                  }
                                : {}),
                              ...(mult.has(kind)
                                ? {
                                    mult: (amount: number) => {
                                      assertLive(`economic.resource.${kind}.mult`);
                                      record(
                                        `${id}_${resourceId}_${kind}_mult`,
                                        amount,
                                        sourceReference
                                      );
                                    },
                                  }
                                : {}),
                            };
                          },
                        }
                      );
                    };
                  }
                  if (key === "triggered") {
                    return economicTriggeredRecorder(
                      id,
                      sourceReference,
                      triggeredRows,
                      assertLive,
                      record
                    );
                  }
                  if (mult.has(key)) {
                    return {
                      mult: (amount: number) => {
                        assertLive(`economic.${key}.mult`);
                        record(`${id}_${key}_mult`, amount, sourceReference);
                      },
                    };
                  }
                  return undefined;
                },
              }
            );
          };
        }
        return node([...path, prop], dynamicFamily);
      },
      apply(_target, _thisArg, args) {
        if (path.length === 1) {
          const selector = path[0] as keyof typeof MODIFIER_REFERENCE_FAMILIES;
          const family = MODIFIER_REFERENCE_FAMILIES[selector];
          if (family !== undefined) {
            assertLive(path[0]!);
            const reference = args[0] as TypedRef<string>;
            const id = refId(reference);
            if (typeof id !== "string") {
              throw new Error(`Dynamic modifier family "${selector}" requires a content reference`);
            }
            return node(path, { ...family, id, verifiedVanilla: isVanillaRef(reference) });
          }
        }
        assertLive(path.join("_"));
        const flat = path.join("_");
        if (dynamicFamily !== undefined) {
          const operation = path.slice(1).join(".");
          const template = dynamicFamily.operations[operation];
          if (template === undefined) {
            throw new Error(`Unknown dynamic modifier operation "${path[0]}.${operation}"`);
          }
          record(
            template.replace(dynamicFamily.placeholder, dynamicFamily.id),
            args[0] as number,
            dynamicFamily
          );
          return;
        }
        record(flat, args[0] as number);
      },
    });
  return node([]);
}

export function modifierEntries(closure: ModifierClosure, collect?: RefUseSink): PdxEntry[] {
  const entries: PdxEntry[] = [];
  const live = { value: true };
  let result: unknown;
  try {
    result = closure(
      modifierRecorder((name, amount, reference) => {
        entries.push(kv(name, amount));
        if (reference !== undefined) {
          const references = Array.isArray(reference) ? reference : [reference];
          for (const use of references) {
            collect?.({
              targets: [use.target],
              id: use.id,
              field: name,
              verifiedVanilla: use.verifiedVanilla ? true : undefined,
            });
          }
        }
      }, live) as never
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

export function modifierBlock(key: string, value: ModifierClosure, collect?: RefUseSink): PdxEntry {
  return block(key, modifierEntries(value, collect));
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
  const refs: RecordedRefUse[] = [];
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

function scaledModifierEntry(modifier: ScaledModifier, refs: RecordedRefUse[]): PdxEntry {
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

/**
 * The triggered-modifier members CWT types `localisation` (`aliases.cwt:37-65`),
 * paired with the key each writes.
 *
 * One list, read by the definition walk that resolves them to keys and by the
 * lowering below that writes those keys, so the two cannot disagree about which
 * members carry text.
 */
export const TRIGGERED_MODIFIER_TEXT_MEMBERS = [
  ["key", "key"],
  ["notPotentialOverrideTextKey", "not_potential_override_text_key"],
  ["description", "description"],
  ["customTooltip", "custom_tooltip"],
] as const satisfies readonly (readonly [keyof TriggeredModifier<ScopeName>, string])[];

/**
 * Writes a member the definition walk already resolved to a localization key.
 * A value that is still text never reached that walk, which would ship the
 * author's prose as a key.
 */
function resolvedKeyEntry(key: string, value: unknown): PdxEntry {
  if (typeof value !== "string") {
    throw new Error(
      `"${key}" holds display text that no definition walk resolved to a localization key. ` +
        "A triggered modifier authored outside a content definition has no identity to mint " +
        "one from; pass a localization reference instead."
    );
  }
  return kv(key, value);
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
    entries.push(resolvedKeyEntry("key", value.key));
  }
  if (value.showIfNotPotential !== undefined) {
    entries.push(kv("show_if_not_potential", value.showIfNotPotential));
  }
  if (value.notPotentialOverrideTextKey !== undefined) {
    entries.push(
      resolvedKeyEntry("not_potential_override_text_key", value.notPotentialOverrideTextKey)
    );
  }
  if (value.modifier !== undefined) {
    entries.push(
      modifierBlock("modifier", value.modifier, (use) => collectRefs(ctx, [use], `${key}.modifier`))
    );
  }
  if (value.modifiers !== undefined) {
    entries.push(...modifierEntries(value.modifiers, (use) => collectRefs(ctx, [use], key)));
  }
  if (value.description !== undefined) {
    entries.push(resolvedKeyEntry("description", value.description));
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
    entries.push(resolvedKeyEntry("custom_tooltip", value.customTooltip));
  }
  entries.push(...repeatedNumbers("mult", value.mult));
  entries.push(...repeatedNumbers("multiplier", value.multiplier));
  return block(key, entries);
}
