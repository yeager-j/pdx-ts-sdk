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
import { parse, type PdxContainer } from "@pdx-ts/pdxscript";

export interface RegistryCorpus {
  /** Definitions found, across every file at the registry's path. */
  readonly definitions: number;
  readonly files: number;
  /**
   * Field key -> how many definitions write it. A nested field inside a
   * repeated-struct field (see {@link RepeatedStructField}) is reported under
   * a dotted path (`stages.icon`, `approach.on_select`) alongside the owning
   * field's own top-level occurrence, so coverage inside the struct is visible
   * and attributable instead of collapsing into the single top-level key.
   */
  readonly occurrences: ReadonlyMap<string, number>;
}

/**
 * Identifies one of a registry's repeated-struct fields (see
 * `docs/roadmap.md`'s "Repeated-struct field shape") so the corpus reader can
 * descend into it. Mirrors `REPEATED_STRUCT_DEFINITIONS`' `keying` /
 * `identityKey` exactly — the two are meant to be built from the same overlay
 * entries, not redefine the split.
 */
export interface RepeatedStructField {
  /** The top-level field key, e.g. "stages" or "approach". */
  readonly field: string;
  readonly keying: "container" | "siblings";
  /** Required for "siblings" — the body field carrying the id, skipped when descending. */
  readonly identityKey?: string;
}

/**
 * Adds one occurrence of every nested field found inside a repeated-struct
 * field to `seen`, deduplicated exactly like the top level: a definition
 * writing `icon` in two different stages, or the same field in two `approach`
 * blocks, still counts once.
 *
 * "container" (`stages = { stage_1 = { icon = ... } }`): the outer container's
 * items are themselves id-keyed blocks, so descend once more into each and
 * report their fields under `<field>.<name>`.
 *
 * "siblings" (`approach = { name = approach_a icon = ... }`): the container
 * passed in already holds the entry's own fields directly — the caller is
 * invoked once per occurrence, since duplicate keys at the top level (several
 * `approach = { ... }` blocks) already arrive as separate items. The identity
 * field itself is skipped, the same reason the top level drops `nameField`.
 */
function descendRepeatedStruct(
  value: PdxContainer,
  struct: RepeatedStructField,
  seen: Set<string>
): void {
  if (struct.keying === "container") {
    for (const sub of value.items) {
      if (sub.kind !== "entry" || sub.value.kind !== "container") {
        continue;
      }
      for (const leaf of sub.value.items) {
        if (leaf.kind !== "entry") {
          continue;
        }
        seen.add(`${struct.field}.${leaf.key}`);
      }
    }
    return;
  }
  for (const leaf of value.items) {
    if (leaf.kind !== "entry" || leaf.key === struct.identityKey) {
      continue;
    }
    seen.add(`${struct.field}.${leaf.key}`);
  }
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
 *
 * `repeatedStructFields` names this registry's repeated-struct fields (if
 * any), so their contents are visible too instead of collapsing into one
 * opaque top-level key — see {@link descendRepeatedStruct}.
 */
export function readRegistryCorpus(
  root: string,
  registryPath: string,
  keyword: string | null,
  nameField: string | null,
  repeatedStructFields: readonly RepeatedStructField[] = []
): RegistryCorpus {
  const dir = path.join(root, registryPath);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".txt"));
  } catch {
    return { definitions: 0, files: 0, occurrences: new Map() };
  }
  const structByField = new Map(repeatedStructFields.map((field) => [field.field, field]));
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
      // The same rule applies one level down inside a repeated-struct field:
      // two stages both writing `icon` still count as one definition using
      // `stages.icon`.
      const seen = new Set<string>();
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.key === nameField) {
          continue;
        }
        seen.add(field.key);
        const struct = structByField.get(field.key);
        if (struct !== undefined && field.value.kind === "container") {
          descendRepeatedStruct(field.value, struct, seen);
        }
      }
      for (const key of seen) {
        occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
      }
    }
  }
  return { definitions, files: names.length, occurrences };
}

/**
 * Measures the emitted interface against the corpus.
 *
 * `spliced` names keys the interface admits without enumerating them: an alias
 * category spliced unkeyed into the definition body (`static_modifier`'s
 * modifier names) is one authoring member covering thousands of legal keys. They
 * count as covered, but never as `invented` — the emitter did not claim each
 * one individually, so "the corpus never writes it" says nothing about whether
 * the shape was read correctly.
 */
export function conformance(
  registry: string,
  corpus: RegistryCorpus,
  emitted: readonly string[],
  spliced: ReadonlySet<string> = new Set()
): ConformanceReport {
  const emittedSet = new Set(emitted);
  const expressible = (field: string): boolean => emittedSet.has(field) || spliced.has(field);
  const invented = emitted.filter((field) => !corpus.occurrences.has(field)).sort();
  const unexpressed = [...corpus.occurrences]
    .filter(([field]) => !expressible(field))
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
  let total = 0;
  let covered = 0;
  for (const [field, count] of corpus.occurrences) {
    total += count;
    if (expressible(field)) {
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
