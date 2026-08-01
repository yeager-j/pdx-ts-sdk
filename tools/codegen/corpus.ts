/**
 * What the shipped game and installed mods actually write, per registry.
 *
 * The curated field allowlists asked a reviewer to vouch for fields the
 * evidence already settles: `component_template.size` is `enum[weapon_slot_size]`,
 * a closed set in the rules, present on all 1388 vanilla component templates.
 * There is nothing there for a human to add, and doubt about whether the SDK
 * lowers it correctly is a testing gap rather than something curation fixes.
 *
 * The parser already proves itself against a full-vanilla fixpoint. This gives
 * the content emitter the same standard: parse every real definition and
 * measure the emitted interface against it.
 *
 * The corpus is a LOWER bound. A field vanilla never writes may still be legal,
 * so absence is reported, never failed. What it does prove is the converse — a
 * field the SDK emits that nothing in the corpus writes is a misreading.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "@pdx-ts/pdxscript";

export interface RegistryCorpus {
  /** Definitions found, across every file at the registry's path. */
  readonly definitions: number;
  readonly files: number;
  /** Top-level field key -> how many definitions write it. */
  readonly occurrences: ReadonlyMap<string, number>;
}

export interface ConformanceReport {
  readonly registry: string;
  readonly corpus: RegistryCorpus;
  /** Emitted fields no definition in the corpus writes: likely a misreading. */
  readonly invented: readonly string[];
  /** Observed fields the emitted interface cannot express, most frequent first. */
  readonly unexpressed: readonly { readonly field: string; readonly count: number }[];
  /** Share of observed field occurrences the emitted interface covers, 0-1. */
  readonly coverage: number;
}

/**
 * Reads every definition a registry's directory contains.
 *
 * `keyword` distinguishes the two layouts. Normally each top-level entry is one
 * definition keyed by its id. Where the rules set `name_field`, the top-level
 * key is a repeated keyword instead and the id sits in a body field — so only
 * entries under that keyword count, and the name field is not a field.
 */
export function readRegistryCorpus(
  root: string,
  registryPath: string,
  keyword: string | null,
  nameField: string | null
): RegistryCorpus {
  const dir = path.join(root, registryPath);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".txt"));
  } catch {
    return { definitions: 0, files: 0, occurrences: new Map() };
  }
  const occurrences = new Map<string, number>();
  let definitions = 0;
  for (const name of names) {
    const parsed = parse(readFileSync(path.join(dir, name), "utf8"));
    for (const item of parsed.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      if (keyword !== null && item.key !== keyword) {
        continue;
      }
      definitions += 1;
      // Count each key once per definition: a definition repeating `modifier`
      // twice is still one definition that uses `modifier`, and weighting by
      // repetition would let one verbose entry dominate the coverage figure.
      const seen = new Set<string>();
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.key === nameField) {
          continue;
        }
        seen.add(field.key);
      }
      for (const key of seen) {
        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
      }
    }
  }
  return { definitions, files: names.length, occurrences };
}

export function conformance(
  registry: string,
  corpus: RegistryCorpus,
  emitted: readonly string[]
): ConformanceReport {
  const emittedSet = new Set(emitted);
  const invented = emitted.filter((field) => !corpus.occurrences.has(field)).sort();
  const unexpressed = [...corpus.occurrences]
    .filter(([field]) => !emittedSet.has(field))
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
  let total = 0;
  let covered = 0;
  for (const [field, count] of corpus.occurrences) {
    total += count;
    if (emittedSet.has(field)) {
      covered += count;
    }
  }
  return {
    registry,
    corpus,
    invented,
    unexpressed,
    coverage: total === 0 ? 1 : covered / total,
  };
}
