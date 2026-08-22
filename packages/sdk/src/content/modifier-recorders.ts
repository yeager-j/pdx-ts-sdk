/**
 * The Proxy recorders behind {@link ModifierClosure}: property access extends
 * the path, a call joins it with `_` into the flat name the game reads. One
 * proxy shape serves every scope — the generated recorder interfaces are the
 * only thing keeping paths honest, exactly like the effect recorder, so a
 * generated method per modifier would buy nothing the types do not already
 * give.
 *
 * A recorder is live only while the closure it was handed to runs. Every
 * member throws once that closure has returned: the entries it writes into are
 * finished data by then, and a later write would change an already-built mod.
 */
import { block, kv, type PdxEntry } from "@pdx-ts/pdxscript";

import { MODIFIER_REFERENCE_FAMILIES } from "../generated/modifiers.ts";
import { isVanillaRef } from "../identifiers/trie.ts";
import type { ContentRefSink } from "../references.ts";
import { assertSynchronousClosure } from "../script/effects/recording.ts";
import { refId, type TypedRef } from "../script/scalar.ts";
import type { ModifierClosure } from "./types.ts";

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

export function modifierEntries(closure: ModifierClosure, collect?: ContentRefSink): PdxEntry[] {
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

export function modifierBlock(
  key: string,
  value: ModifierClosure,
  collect?: ContentRefSink
): PdxEntry {
  return block(key, modifierEntries(value, collect));
}
