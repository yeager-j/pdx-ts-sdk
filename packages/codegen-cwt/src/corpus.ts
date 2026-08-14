/**
 * What the committed vanilla-game fixture observes, per registry.
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
 * The corpus is an observed LOWER bound, not evidence of completeness. A field
 * vanilla never writes may still be legal, so absence is reported, never
 * failed. A field vanilla does write in a shape authors cannot express is
 * concrete evidence of a lowering gap.
 *
 * Two questions, not one. {@link conformance} asks whether a field is *present*
 * in the emitted interface; {@link shapeConformance} asks whether its lowered
 * type can hold what real definitions put there. Only the second sees a
 * block-typed field against 254 scalar writes, or a required condition no
 * author can satisfy.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  isScalar,
  parse,
  scalarText as renderScalarText,
  type PdxContainer,
  type PdxItem,
  type PdxValue,
} from "@pdx-ts/pdxscript";

import type { EmittedField } from "./emit/fields.ts";
import type { RuleScopes } from "./scope-facts.ts";

/**
 * What the corpus writes under one key, counted once per definition.
 *
 * Presence alone — the single number this used to be — is what let a
 * block-typed `stages.end` sit at full coverage against 254 scalar writes.
 * Every other member here exists so a lowered type can be measured rather than
 * merely located: block versus scalar, repeated versus single, which scalars,
 * which inner keys.
 */
export interface FieldObservation {
  /** Definitions writing the key at least once. */
  readonly definitions: number;
  /** Definitions writing it more than once at the sibling level. */
  readonly repeated: number;
  /** Definitions writing a scalar value at least once. */
  readonly scalars: number;
  /** Definitions writing a block value at least once. */
  readonly blocks: number;
  /**
   * Definitions whose block value holds a bare scalar rather than entries —
   * `field = { foo bar }`, where a `valueList`'s scalars live.
   */
  readonly bareValues: number;
  /**
   * Definitions whose block value holds a bare, anonymous sub-block —
   * `field = { { key = … } { key = … } }`, what a wrapped struct writes.
   *
   * Counted apart from {@link bareValues} because the two are different
   * evidence about opposite lowerings, and one flag for both hid a real defect:
   * a field misread as a wrapped struct against a corpus of bare *scalars*
   * satisfied the wrapped check and reported nothing.
   */
  readonly bareBlocks: number;
  /**
   * Definitions whose block value holds nothing at all — no entries and no bare
   * items. Reported rather than checked: an empty block is compatible with
   * every block lowering, which is why the interior form check stays silent
   * where it is all the corpus has (see {@link shapeConformance}).
   *
   * At a `weightModifiers` path it counts after the strip, so it is the number
   * of definitions writing an *ungated* modifier row — a row the SDK could not
   * author at all while `Modifier.when` was required.
   */
  readonly emptyBlocks: number;
  /** Every scalar written, as the game spells it, capped at {@link VALUE_SAMPLE}. */
  readonly values: ReadonlySet<string>;
  /** Every key written directly inside a block value. */
  readonly keys: ReadonlySet<string>;
  /**
   * The same keys, still grouped by the definition that wrote them and
   * deduplicated across definitions writing the same set.
   *
   * {@link keys} merges every definition together, which cannot answer "could
   * one scope have been declared for *this* definition" — a field where one
   * definition writes a planet-only rule and another a ship-only rule looks
   * identical to one definition writing both. Only the second is a defect, and
   * only this can tell them apart.
   */
  readonly keysByDefinition: readonly ReadonlySet<string>[];
}

/**
 * How many distinct scalars to remember per field. Enough to catch a value
 * outside a closed union, few enough that an open `<technology>` field does not
 * carry a thousand ids around.
 *
 * Exported because the cap is a hole in the `literal` verdict as well as a
 * memory bound: a field that reaches it before a later out-of-union spelling
 * never records that spelling, so the stray would go unreported and the
 * baseline would stay green over a value nobody reviewed. Below the cap the
 * sample is the whole set and the verdict is complete, so the corpus gate
 * asserts every field with a closed union stays under it — the one way this
 * stays a bound rather than a silent filter.
 */
export const VALUE_SAMPLE = 64;

export interface RegistryCorpus {
  /** Definitions found, across every file at the registry's path. */
  readonly definitions: number;
  readonly files: number;
  /**
   * Field key -> what definitions write there. A field written inside a block
   * the reader descends into (see {@link DescentNode}) is reported under a
   * dotted path (`stages.icon`, `term_data.discrete_terms.key`) alongside the
   * owning field's own top-level occurrence, so coverage inside the block is
   * visible and attributable instead of collapsing into the single top-level
   * key.
   */
  readonly occurrences: ReadonlyMap<string, FieldObservation>;
}

/**
 * One block-valued field the reader descends into, and the nodes for whatever
 * it in turn contains.
 *
 * Emitter-produced, never hand-written: `ContentEmission.corpusDescents` builds
 * these out of the same lowerings that produce `nestedEmittedFields`, so the
 * paths the reader records and the paths the emitter claims cannot drift apart.
 * A descent the emitter did not lower would manufacture "unexpressed" entries
 * for interiors no side ever promised.
 *
 * `mode` says how the container reaches the blocks whose entries are recorded,
 * which is the only thing the arms differ in:
 *
 * - `struct` — the container *is* the block:
 *   `forbidden_peace_offers = { demand_surrender = ... }`.
 * - `wrappedStruct` — its items are bare anonymous blocks:
 *   `resource_terms = { { key = ... value = ... } { ... } }`.
 * - `structMap` — its items are engine-keyed blocks:
 *   `section_slots = { mid = { locator = ... } }`. The engine key stays out of
 *   the path, since the emitter has one field table for every key.
 * - `repeatedStruct` — `keying` decides, taken from the emission rather than
 *   re-derived: "container" holds one id-keyed block per entry, "siblings"
 *   holds the entry's own fields directly and carries the id in `identityKey`,
 *   skipped for the same reason the top level drops `nameField`.
 * - `weightModifiers` — a weight block's `modifier` rows, recorded under
 *   `<field>.modifier` with `strippedKeys` (the maths operations and `desc`)
 *   removed, so what remains is the row's gating trigger. The one mode that
 *   does not record the container's own entries: `base` and the weight
 *   operations are the weight block's own top-level shape, already observed
 *   under the owning key, and recording them here would manufacture interior
 *   paths no emitted field claims.
 * - `triggeredModifierPotential` — a triggered-modifier block's `potential`
 *   condition, recorded under `<field>.potential`. Modifier keys are not
 *   conditions and remain intentionally opaque.
 * - `economicResourceOperationTrigger` — an economic operation's direct
 *   `trigger` condition, recorded under `<field>.trigger`. Resource and
 *   complex-maths keys are operation data, not trigger clauses.
 * - `triggerStruct` — named sibling entries stay at their own paths, while
 *   every other direct entry is observed as the synthetic flattened `when`
 *   trigger.
 */
export interface DescentNode {
  /** The game's key at this level; the corpus path grows `<prefix>.<field>`. */
  readonly field: string;
  readonly mode:
    | "struct"
    | "wrappedStruct"
    | "structMap"
    | "repeatedStruct"
    | "weightModifiers"
    | "triggeredModifierPotential"
    | "economicResourceOperationTrigger"
    | "triggerStruct";
  /** `repeatedStruct` only. */
  readonly keying?: "container" | "siblings";
  /** `repeatedStruct` with "siblings" keying only — the field carrying the id. */
  readonly identityKey?: string;
  /** `weightModifiers` only — the gating keys stripped before the rest is recorded. */
  readonly strippedKeys?: ReadonlySet<string>;
  /** `triggerStruct` only — direct keys authored as ordinary struct members. */
  readonly ordinaryKeys?: readonly string[];
  readonly children: readonly DescentNode[];
}

/**
 * Records one block's entries under `<path>.<key>`, recursing into whichever
 * of them a child node names.
 *
 * The block boundary is this call. Arity is a property of one block and the
 * accumulated `seen` map has already flattened every block of a definition into
 * one list, so `blockArity` has to be decided here — see {@link observe}. Two
 * stages each writing `icon` once are two blocks, not a repetition.
 */
function recordBlock(
  block: PdxContainer,
  path: string,
  children: ReadonlyMap<string, DescentNode>,
  skip: string | undefined,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const withinThisBlock = new Set<string>();
  for (const leaf of block.items) {
    if (leaf.kind !== "entry" || leaf.key === skip) {
      continue;
    }
    const leafPath = `${path}.${leaf.key}`;
    blockArity.set(leafPath, (blockArity.get(leafPath) ?? false) || withinThisBlock.has(leafPath));
    withinThisBlock.add(leafPath);
    seen.set(leafPath, [...(seen.get(leafPath) ?? []), leaf.value]);
    const child = children.get(leaf.key);
    if (child !== undefined && leaf.value.kind === "container") {
      descend(leaf.value, child, path, seen, blockArity);
    }
  }
}

/**
 * Adds one occurrence of every field written inside a descended block to
 * `seen`, deduplicated exactly like the top level: a definition writing `icon`
 * in two different stages, or the same field in two `approach` blocks, still
 * counts once.
 *
 * `prefix` is the owning path, empty at the definition's own level, so one
 * recursion handles a struct inside a struct without the caller tracking depth.
 */
function descend(
  value: PdxContainer,
  node: DescentNode,
  prefix: string,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const path = prefix === "" ? node.field : `${prefix}.${node.field}`;
  const children = new Map(node.children.map((child) => [child.field, child]));
  const record = (block: PdxContainer, skip?: string): void => {
    recordBlock(block, path, children, skip, seen, blockArity);
  };
  switch (node.mode) {
    case "struct":
      record(value);
      return;
    case "wrappedStruct":
      for (const item of value.items) {
        if (item.kind === "container") {
          record(item);
        }
      }
      return;
    case "structMap":
      for (const item of value.items) {
        if (item.kind === "entry" && item.value.kind === "container") {
          record(item.value);
        }
      }
      return;
    case "repeatedStruct":
      if (node.keying !== "container") {
        // The caller is invoked once per occurrence: duplicate keys at the
        // owning level (several `approach = { ... }` blocks) already arrive as
        // separate items, so this container holds one entry's fields.
        record(value, node.identityKey);
        return;
      }
      for (const sub of value.items) {
        if (sub.kind === "entry" && sub.value.kind === "container") {
          record(sub.value);
        }
      }
      return;
    case "weightModifiers":
      recordWeightModifiers(value, path, node.strippedKeys ?? new Set(), seen, blockArity);
      return;
    case "triggeredModifierPotential":
      recordTriggeredModifierPotential(value, path, seen, blockArity);
      return;
    case "economicResourceOperationTrigger":
      recordEconomicResourceOperationTrigger(value, path, seen, blockArity);
      return;
    case "triggerStruct":
      recordTriggerStruct(value, path, node, children, seen, blockArity);
      return;
  }
}

function recordTriggerStruct(
  value: PdxContainer,
  path: string,
  node: DescentNode,
  children: ReadonlyMap<string, DescentNode>,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const ordinary = new Set(node.ordinaryKeys ?? []);
  const named = value.items.filter(
    (item): item is Extract<(typeof value.items)[number], { kind: "entry" }> =>
      item.kind === "entry" && ordinary.has(item.key)
  );
  recordBlock({ kind: "container", items: named }, path, children, undefined, seen, blockArity);
  const trigger = value.items.filter(
    (item): item is Extract<(typeof value.items)[number], { kind: "entry" }> =>
      item.kind === "entry" && !ordinary.has(item.key)
  );
  if (trigger.length > 0) {
    const when = `${path}.when`;
    blockArity.set(when, false);
    seen.set(when, [...(seen.get(when) ?? []), { kind: "container", items: trigger }]);
  }
}

/**
 * Records each `modifier` row of one weight block under `<path>.modifier`,
 * stripped down to the keys that gate it.
 *
 * A row is `modifier = { <maths operation> … desc = … alias_name[trigger] }`
 * (`modifier_rule.cwt:5-13`), so removing the operations and `desc` leaves
 * exactly the trigger keys — which is what the emitted `Trigger<S>` is measured
 * against. The strip set comes from the emitter, off the same two enums the
 * grammar names; an empty one would record `add` and `factor` as conditions.
 *
 * `complex_trigger_modifier` and `scaled_modifier` rows are left alone. They
 * are sibling row kinds with their own shapes rather than a gated adjustment,
 * and reading them through this filter would report their members as trigger
 * keys (SDK-82).
 */
function recordWeightModifiers(
  weights: PdxContainer,
  path: string,
  strippedKeys: ReadonlySet<string>,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const rowPath = `${path}.modifier`;
  let previous = false;
  for (const item of weights.items) {
    if (item.kind !== "entry" || item.key !== "modifier" || item.value.kind !== "container") {
      continue;
    }
    // The weight block is the arity boundary, exactly as a struct's block is in
    // {@link recordBlock}: two rows in one block repeat, one row in each of two
    // blocks does not.
    blockArity.set(rowPath, (blockArity.get(rowPath) ?? false) || previous);
    previous = true;
    seen.set(rowPath, [
      ...(seen.get(rowPath) ?? []),
      {
        kind: "container",
        items: item.value.items.filter(
          (entry) => entry.kind !== "entry" || !strippedKeys.has(entry.key)
        ),
      },
    ]);
  }
}

/**
 * Records only the potential value from each triggered-modifier row.
 *
 * The outer field can repeat, but arity belongs to a single row: two rows with
 * one potential each are not a repeated `potential` field. Modifier names are
 * deliberately ignored because the hand-written block models them through its
 * closure rather than as trigger keys.
 */
function recordTriggeredModifierPotential(
  modifier: PdxContainer,
  path: string,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const potentialPath = `${path}.potential`;
  let previous = false;
  for (const item of modifier.items) {
    if (item.kind !== "entry" || item.key !== "potential") {
      continue;
    }
    blockArity.set(potentialPath, (blockArity.get(potentialPath) ?? false) || previous);
    previous = true;
    seen.set(potentialPath, [...(seen.get(potentialPath) ?? []), item.value]);
  }
}

/** Records only direct trigger clauses from an economic resource operation. */
function recordEconomicResourceOperationTrigger(
  operation: PdxContainer,
  path: string,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const triggerPath = `${path}.trigger`;
  let previous = false;
  for (const item of operation.items) {
    if (item.kind !== "entry" || item.key !== "trigger") {
      continue;
    }
    blockArity.set(triggerPath, (blockArity.get(triggerPath) ?? false) || previous);
    previous = true;
    seen.set(triggerPath, [...(seen.get(triggerPath) ?? []), item.value]);
  }
}

/**
 * One structural alias splice the reader descends into, e.g. `planet`.
 *
 * `members` is a thunk because these are mutually recursive: a `planet` holds
 * `planet` and `moon`, and a `moon` holds `moon`.
 *
 * `descents` are the category's own block-valued fields — `planet`'s
 * `count = { min = ... max = ... }` — from the same emission that produced the
 * category's emitted fields, for the same reason {@link DescentNode} is
 * emitter-produced everywhere else.
 */
export interface SpliceMember {
  readonly key: string;
  readonly members: () => readonly SpliceMember[];
  readonly descents: readonly DescentNode[];
}

/**
 * Records everything written inside a spliced block, at any depth, under that
 * block's own key.
 *
 * The flattening is the point rather than a shortcut. The emitter produces one
 * field table per alias category and reuses it at every level — a third-level
 * moon's `size` is described by the same lowering as a first-level one — so the
 * corpus has to aggregate the same way for the two sides to line up. Recursion
 * terminates on the data, since real files nest three deep, not on a cap.
 */
function descendSplice(
  value: PdxContainer,
  member: SpliceMember,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const nested = new Map(member.members().map((inner) => [inner.key, inner]));
  const children = new Map(member.descents.map((child) => [child.field, child]));
  // Per block, not per definition. A system with eight planets that each write
  // `size` once must not read as `planet.size` repeating — arity is a property
  // of one block, and the accumulated `seen` map cannot express that because
  // every planet at every depth pours into the same path. Counting here, where
  // the block boundary still exists, is the only place it can be seen.
  const withinThisBlock = new Set<string>();
  for (const leaf of value.items) {
    if (leaf.kind !== "entry") {
      continue;
    }
    const path = `${member.key}.${leaf.key}`;
    // Presence marks the path as descent-owned even when it never repeats, so
    // `observe` knows to take its arity from here rather than from the
    // flattened value list.
    blockArity.set(path, (blockArity.get(path) ?? false) || withinThisBlock.has(path));
    withinThisBlock.add(path);
    seen.set(path, [...(seen.get(path) ?? []), leaf.value]);
    if (leaf.value.kind !== "container") {
      continue;
    }
    const inner = nested.get(leaf.key);
    if (inner !== undefined) {
      descendSplice(leaf.value, inner, seen, blockArity);
      continue;
    }
    // Rooted at the member key rather than the category, so a `min` inside a
    // third-level moon's `count` records the same path a first-level planet's
    // does — the flattening above, one level further in.
    const child = children.get(leaf.key);
    if (child !== undefined) {
      descend(leaf.value, child, member.key, seen, blockArity);
    }
  }
}

/**
 * Builds the splice tree for a set of categories, tying the recursive knot.
 *
 * Takes a resolver rather than the emitter itself, so the corpus reader stays a
 * reader: the emitter is the authority on which categories are structural and
 * what key each is written under, and this only needs the answer.
 */
export function spliceMembersOf(
  categories: readonly string[],
  resolve: (category: string) => {
    readonly memberKey: string;
    readonly spliceCategories: readonly string[];
    readonly corpusDescents: readonly DescentNode[];
  } | null
): SpliceMember[] {
  return categories.flatMap((category) => {
    const resolved = resolve(category);
    return resolved === null
      ? []
      : [
          {
            key: resolved.memberKey,
            // Lazily, and re-entering `spliceMembersOf` rather than caching a
            // node per category: `planet_initializer` reaches itself, so
            // building the children eagerly would not terminate.
            members: () => spliceMembersOf(resolved.spliceCategories, resolve),
            descents: resolved.corpusDescents,
          },
        ];
  });
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** One semantic scalar value, with game spellings for booleans and numbers. */
function scalarText(value: PdxValue): string | null {
  if (!isScalar(value) || value.kind === "var" || value.kind === "math") {
    return null;
  }
  if (value.kind === "str") {
    return value.value;
  }
  return renderScalarText(value);
}

/**
 * Folds one definition's writes into the running observations.
 *
 * Everything counts once per definition, at every level: a definition
 * repeating `modifier` twice is still one definition that uses `modifier`, and
 * weighting by repetition would let one verbose entry dominate coverage. The
 * repetition itself is not lost — it is what `repeated` records.
 */
function observe(
  into: Map<string, FieldObservation>,
  written: ReadonlyMap<string, PdxValue[]>,
  /**
   * Descent-owned paths, each mapped to whether it repeated inside a single
   * block — counted at a boundary the accumulated `written` map has already
   * flattened away, see {@link recordBlock} and {@link descendSplice}. For
   * these, `values.length` is the count across every block in the definition
   * and says nothing about arity, so this decides it instead. Only the
   * definition's own top-level keys are absent here, and the definition is
   * their block, so they keep the ordinary rule.
   */
  blockArity: ReadonlyMap<string, boolean> = new Map()
) {
  for (const [key, values] of written) {
    const previous = into.get(key);
    const repeats = blockArity.get(key) ?? values.length > 1;
    const observation = {
      definitions: (previous?.definitions ?? 0) + 1,
      repeated: (previous?.repeated ?? 0) + (repeats ? 1 : 0),
      scalars: previous?.scalars ?? 0,
      blocks: previous?.blocks ?? 0,
      bareValues: previous?.bareValues ?? 0,
      bareBlocks: previous?.bareBlocks ?? 0,
      emptyBlocks: previous?.emptyBlocks ?? 0,
      values: new Set(previous?.values ?? []),
      keys: new Set(previous?.keys ?? []),
    };
    const written = new Set<string>();
    let scalar = false;
    let block = false;
    let bareValue = false;
    let bareBlock = false;
    let emptyBlock = false;
    for (const value of values) {
      if (value.kind !== "container") {
        scalar = true;
        const text = scalarText(value);
        if (text !== null && observation.values.size < VALUE_SAMPLE) {
          observation.values.add(text);
        }
        continue;
      }
      block = true;
      let content = false;
      for (const item of value.items) {
        if (item.kind === "entry") {
          observation.keys.add(item.key);
          written.add(item.key);
          content = true;
          continue;
        }
        if (item.kind === "param" || item.kind === "param-text") {
          continue;
        }
        // An anonymous sub-block is where a wrapped struct's entries live; a
        // bare scalar is where a `valueList`'s do, and the only place a closed
        // union can be checked for one. Never the same count: each is what the
        // other's lowering being wrong looks like.
        if (item.kind === "container") {
          bareBlock = true;
          content = true;
          continue;
        }
        bareValue = true;
        content = true;
        const text = scalarText(item);
        if (text !== null && observation.values.size < VALUE_SAMPLE) {
          observation.values.add(text);
        }
      }
      emptyBlock = emptyBlock || !content;
    }
    const seen = previous?.keysByDefinition ?? [];
    into.set(key, {
      ...observation,
      scalars: observation.scalars + (scalar ? 1 : 0),
      blocks: observation.blocks + (block ? 1 : 0),
      bareValues: observation.bareValues + (bareValue ? 1 : 0),
      bareBlocks: observation.bareBlocks + (bareBlock ? 1 : 0),
      emptyBlocks: observation.emptyBlocks + (emptyBlock ? 1 : 0),
      // Deduplicated: most definitions of a registry write the same handful of
      // keys, so the distinct sets stay far smaller than the definition count.
      keysByDefinition: seen.some((keys) => sameKeys(keys, written)) ? seen : [...seen, written],
    });
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

/** One registry's file layout, as its CWT type declares it. */
export interface RegistryLayout {
  /** `path_extension`, dotted. Absent means the game's `.txt` default. */
  readonly extension?: string;
  /**
   * `skip_root_key`: the definitions sit one level inside a root block with one
   * of these keys. `any` matches every top-level block.
   */
  readonly skipRootKeys?: readonly string[];
}

/**
 * The items a file offers as definitions.
 *
 * Without `skip_root_key` that is the file's own top level. With one, the
 * definitions are the children of the matching root blocks, and a top-level
 * entry matching no root key belongs to something else in the same file, so it
 * is not counted at all.
 */
function rootDefinitions(items: readonly PdxItem[], skipRootKeys: readonly string[]): PdxItem[] {
  if (skipRootKeys.length === 0) {
    return [...items];
  }
  const any = skipRootKeys.includes("any");
  return items.flatMap((item) =>
    item.kind === "entry" &&
    item.value.kind === "container" &&
    (any || skipRootKeys.includes(item.key))
      ? item.value.items
      : []
  );
}

/**
 * Reads every definition a registry's directory contains.
 *
 * `keyword` distinguishes the two layouts. Normally each top-level entry is one
 * definition keyed by its id. Where the rules set `name_field`, the top-level
 * key is a repeated keyword instead and the id sits in a body field — so only
 * entries under that keyword count, and the name field is not a field.
 *
 * `descents` names this registry's block-valued fields (if any), so their
 * contents are visible too instead of collapsing into one opaque top-level key
 * — see {@link DescentNode}.
 *
 * `layout` is the registry's file layout as the rules declare it: which
 * extension its files carry, and which root block its definitions sit inside.
 * Both change what counts as a definition, so a reader given neither would
 * measure a `.gfx` registry as empty rather than as unread.
 */
export function readRegistryCorpus(
  root: string,
  registryPath: string,
  keyword: string | null,
  nameField: string | null,
  descents: readonly DescentNode[] = [],
  spliceMembers: readonly SpliceMember[] = [],
  /**
   * A top-level key belonging to a sibling type that shares this directory,
   * from a negated `## type_key_filter <> key` — `random_list` under
   * `common/solar_system_initializers`. Counting one as a definition would
   * measure another type's body against this registry's fields.
   */
  excludedKey: string | null = null,
  layout: RegistryLayout = {}
): RegistryCorpus {
  const dir = path.join(root, registryPath);
  const extension = layout.extension ?? ".txt";
  let names: string[];
  try {
    // Sorted because `readdirSync` order is filesystem-dependent and the
    // observations are committed as a fixture: the capped value sample keeps
    // whichever scalars arrive first, so an unstable read order would diff on
    // every re-extraction of an unchanged install.
    names = readdirSync(dir)
      .filter((name) => name.endsWith(extension))
      .sort();
  } catch {
    return { definitions: 0, files: 0, occurrences: new Map() };
  }
  const descentByField = new Map(descents.map((node) => [node.field, node]));
  const spliceByKey = new Map(spliceMembers.map((member) => [member.key, member]));
  const occurrences = new Map<string, FieldObservation>();
  let definitions = 0;
  for (const name of names) {
    const parsed = parse(readFileSync(path.join(dir, name), "utf8"));
    for (const item of rootDefinitions(parsed.items, layout.skipRootKeys ?? [])) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      if (keyword !== null && item.key !== keyword) {
        continue;
      }
      if (item.key === excludedKey) {
        continue;
      }
      definitions += 1;
      const written = new Map<string, PdxValue[]>();
      const blockArity = new Map<string, boolean>();
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.key === nameField) {
          continue;
        }
        written.set(field.key, [...(written.get(field.key) ?? []), field.value]);
        const node = descentByField.get(field.key);
        if (node !== undefined && field.value.kind === "container") {
          descend(field.value, node, "", written, blockArity);
        }
        const splice = spliceByKey.get(field.key);
        if (splice !== undefined && field.value.kind === "container") {
          descendSplice(field.value, splice, written, blockArity);
        }
      }
      observe(occurrences, written, blockArity);
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
    .map(([field, observation]) => ({ field, count: observation.definitions }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
  let total = 0;
  let covered = 0;
  for (const [field, observation] of corpus.occurrences) {
    total += observation.definitions;
    if (expressible(field)) {
      covered += observation.definitions;
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

// The single declaration lives in `scope-facts.ts`; re-exported here because
// `@pdx-ts/codegen-cwt/corpus` is the subpath its consumers import from.
export type { RuleScopes };

/**
 * The four ways a lowered type can disagree with the values behind it.
 *
 * `form` is hard: the corpus writes something no value of the emitted type can
 * express, so the field is unfillable however legal it is. `scope` is hard in
 * one of its two cases only — a pinned scope rejects the rule, and the field is
 * unfillable the same way, but an unpinned trigger clause is widened to
 * `Trigger<never>` (see `contravariantScopeType`), which accepts the rule with
 * nothing checked. What the corpus proves there is that the emitted type
 * carries no claim, not that an author is stuck; both are reported, and the
 * detail says which. `arity` and `literal` are softer — a list where the game
 * happens never to repeat is legal, and a value outside a closed union may be
 * an upstream spelling quirk. Softer is not unreviewed: the gate holds the two
 * of them against a committed baseline of classified rows, so a *new or
 * changed* observation fails until somebody says which kind of legal it is.
 */
export type ConformanceMismatchKind = "form" | "arity" | "literal" | "scope";

export interface ShapeMismatch {
  readonly field: string;
  readonly kind: ConformanceMismatchKind;
  /**
   * The finding in prose, for a human reading a failure. Deliberately volatile:
   * it carries definition counts that move with every game patch and samples
   * that truncate, so nothing may treat it as an identity.
   */
  readonly detail: string;
  /**
   * The values that produced the verdict — every stray for `literal`, and empty
   * for the kinds whose verdict is its own evidence. This is the half a
   * baseline compares, as a set: a seventh stray the prose does not show still
   * has to be reviewed, and a definition count that moved is not a new
   * observation.
   *
   * Untruncated, unlike {@link detail} — but drawn from a value set the reader
   * caps at {@link VALUE_SAMPLE}, so "every stray" holds only while the field
   * stays under that cap. The corpus gate asserts it does.
   */
  readonly evidence: readonly string[];
}

/**
 * What the writer puts on the right of each runtime shape's key. `both` is a
 * field lowered to a union of a scalar and a block, dispatched at write time by
 * what the author passed.
 *
 * A shape missing here gets no form verdict rather than a guessed one.
 */
const WRITTEN_FORM = new Map<string, "scalar" | "block" | "both">([
  ["value", "scalar"],
  ["dual", "both"],
  ["valueList", "block"],
  ["trigger", "block"],
  ["effect", "block"],
  ["economicResources", "block"],
  ["economicResourcesNoProduce", "block"],
  ["triggeredModifierBlock", "block"],
  ["modifierBlock", "block"],
  ["weightBlock", "block"],
  ["weightBlockWithLoc", "block"],
  ["weightModifier", "block"],
  ["weightedEvents", "block"],
  ["struct", "block"],
  ["aliasStruct", "block"],
  ["structMap", "block"],
  ["scalarMap", "block"],
  ["repeatedStruct", "block"],
]);

/**
 * Whether a rule legal in `rule` can be written into a field typed for `field`.
 *
 * `Trigger<S>` is contravariant in its scope, so the field admits exactly the
 * rules legal in *every* scope it names, and `"any"` — nothing pinned it —
 * names every scope there is, so only a universal rule satisfies it. That is a
 * question about the declared scopes rather than about the emitted type: what a
 * failure costs depends on how the field lowered, which is
 * {@link scopeVerdict}'s job to say.
 */
function fieldAdmits(field: readonly string[] | "any", rule: RuleScopes): boolean {
  if (rule === "universal") {
    return true;
  }
  if (field === "any") {
    return false;
  }
  return field.every((scope) => rule.includes(scope));
}

/**
 * How a rejected key reads against the type the field really lowered to.
 *
 * A pinned scope rejects the rule, so the field is unfillable. An unpinned one
 * need not: a trigger clause nothing pinned is widened to `Trigger<never>` (see
 * `contravariantScopeType`), which accepts every condition and checks none, so
 * the defect there is a lost check rather than a value no author can write. An
 * unpinned effect keeps `EffectBlock<ScopeName>` — no such widening — and does
 * reject, which is why the two clauses do not read alike.
 */
function scopeVerdict(scope: readonly string[] | "any", clause: "trigger" | "effect"): string {
  if (scope !== "any") {
    return `typed for scope ${scope.join("/")}, which rejects`;
  }
  return clause === "trigger"
    ? "unchecked (Trigger<never>): no declared scope admits"
    : "typed for EffectBlock<ScopeName>, which rejects";
}

/**
 * The declared scopes under which one definition's writes are all expressible.
 *
 * A parameterised field's scope is chosen once per *definition*, so this is the
 * question the gate has to ask per definition rather than per key: asking
 * whether each key is legal under *some* declared scope would pass a definition
 * that writes a planet-only rule beside a ship-only one, which no single choice
 * of S can express. Keys nothing knows are skipped, as everywhere else.
 */
function workableScopes(
  declared: readonly string[],
  keys: ReadonlySet<string>,
  scopesOf: (key: string) => RuleScopes | null
): readonly string[] {
  const scoped = [...keys].flatMap((key) => {
    const rule = scopesOf(key);
    return rule === null ? [] : [rule];
  });
  return declared.filter((scope) => scoped.every((rule) => fieldAdmits([scope], rule)));
}

/**
 * Measures each lowered type against the values the corpus writes under it.
 *
 * The other half of {@link conformance}, which only asks whether a field is
 * present. Fields the corpus never writes are silent here: the corpus is a
 * lower bound, so absence proves nothing about shape either.
 *
 * `scopesOf` resolves one trigger or effect key to the scopes it is legal in,
 * or `null` when nothing knows it — a vanilla scripted trigger, a scope link, a
 * rule the emitter skipped. Unknown keys are skipped rather than counted
 * against the field, since they are a coverage gap in the rules rather than
 * evidence about this field's scope.
 */
export function shapeConformance(
  corpus: RegistryCorpus,
  emitted: readonly EmittedField[],
  scopesOf: (clause: "trigger" | "effect", key: string) => RuleScopes | null
): readonly ShapeMismatch[] {
  const mismatches: ShapeMismatch[] = [];
  for (const field of emitted) {
    const observation = corpus.occurrences.get(field.field);
    if (observation === undefined) {
      continue;
    }
    const report = (
      kind: ConformanceMismatchKind,
      detail: string,
      evidence: readonly string[] = []
    ): void => {
      mismatches.push({ field: field.field, kind, detail, evidence });
    };
    const form = WRITTEN_FORM.get(field.shape);
    const seen = `${observation.definitions} defs`;
    if (form === "block" && observation.scalars > 0) {
      report(
        "form",
        `lowered as ${field.shape}, but ${observation.scalars}/${seen} write a scalar ` +
          `(${[...observation.values].slice(0, 4).join(" ")})`
      );
    }
    if (form === "scalar" && observation.blocks > 0) {
      report(
        "form",
        `lowered as a scalar, but ${observation.blocks}/${seen} write a block ` +
          `(${[...observation.keys].slice(0, 4).join(" ") || "bare values"})`
      );
    }
    // A block whose interior form is wrong is the same defect one level in: a
    // list type against `{ trigger = { … } }`, or a struct against `{ a b c }`.
    // A dual is exempt: admitting two interiors is the whole point of it, and
    // the arms were each checked against the rules that produced them.
    //
    // Three interiors, one per lowering, and each is what the other two being
    // wrong looks like: a value list holds bare scalars, a wrapped struct holds
    // bare sub-blocks, every other block shape holds named keys. The three are
    // asked separately — one "is it bare" flag passed a wrapped struct against
    // a corpus of bare scalars — and none is asked when every block is empty,
    // since `resources = { }` written 16 times is compatible with all three and
    // is absence of interior evidence rather than evidence of a defect.
    const interior = [
      ...(observation.keys.size > 0
        ? [`named keys (${[...observation.keys].slice(0, 4).join(" ")})`]
        : []),
      ...(observation.bareValues > 0
        ? [`bare scalars (${[...observation.values].slice(0, 4).join(" ")})`]
        : []),
      ...(observation.bareBlocks > 0 ? ["bare blocks"] : []),
    ];
    if (observation.blocks > 0 && form === "block" && interior.length > 0) {
      const found = interior.join(" and ");
      if (field.shape === "valueList") {
        if (observation.bareValues === 0) {
          report(
            "form",
            `lowered as a value list, but its ${observation.blocks} blocks hold ${found}`
          );
        }
      } else if (field.wrapped === true) {
        if (observation.bareBlocks === 0) {
          report(
            "form",
            `lowered as a wrapped struct, but its ${observation.blocks} blocks hold ${found}`
          );
        }
      } else if (observation.keys.size === 0) {
        report(
          "form",
          `lowered as ${field.shape}, but its ${observation.blocks} blocks hold ${found}`
        );
      }
    }
    if (field.repeated && observation.repeated === 0) {
      // No evidence beyond the verdict: the definition count is context a reader
      // wants and a baseline must not key on, since it moves with every patch
      // while the finding — this list is never repeated — does not.
      report("arity", `lowered as a list, but no definition writes it twice (${seen})`);
    }
    // A dual carries its *scalar* arm's literals (see `lowerDual`), while
    // `values` merges every scalar the field wrote — the scalar arm's, and the
    // bare values inside the block arm's blocks. Nothing in the observation says
    // which position a value came from, so a closed scalar union cannot judge
    // them: `ship_size.graphical_culture` is `bool` beside
    // `{ <graphical_culture> }`, and reading its 25 culture ids as strays
    // outside `yes`/`no` measured one arm against the other. Same exemption, and
    // the same reason, as the interior form check's.
    const unattributable = field.shape === "dual" && observation.bareValues > 0;
    if (field.literals !== undefined && !unattributable) {
      const closed = new Set(field.literals);
      const stray = [...observation.values].filter((value) => !closed.has(value));
      if (stray.length > 0) {
        // The prose truncates and the evidence does not: a seventh stray is a
        // value nobody has classified, and hiding it behind the sample would let
        // it ride along under a row written for the first six.
        report("literal", `outside the emitted union: ${stray.slice(0, 6).join(" ")}`, stray);
      }
    }
    if (field.clause !== undefined && field.scope !== undefined) {
      const clause = field.clause;
      const rules = (key: string): RuleScopes | null => scopesOf(clause, key);
      if (typeof field.scope === "object" && "parameter" in field.scope) {
        // Per definition, not per key: the author picks one scope for the whole
        // definition, so a definition whose writes have no scope in common is
        // unfillable even though each rule alone is fine under some choice.
        const declared = field.scope.parameter;
        const stranded = observation.keysByDefinition.filter(
          (keys) => workableScopes(declared, keys, rules).length === 0
        );
        if (stranded.length > 0) {
          const worst = stranded[0]!;
          report(
            "scope",
            `no single scope of ${declared.join("/")} expresses one definition's ` +
              `own conditions here (${[...worst].slice(0, 6).join(" ")})`
          );
        }
      } else {
        const scope = field.scope;
        const rejected = [...observation.keys].filter((key) => {
          const scopes = rules(key);
          return scopes !== null && !fieldAdmits(scope, scopes);
        });
        if (rejected.length > 0) {
          report(
            "scope",
            `${scopeVerdict(scope, clause)} ` +
              rejected.slice(0, 6).join(" ") +
              (rejected.length > 6 ? ` +${rejected.length - 6}` : "")
          );
        }
      }
    }
  }
  return mismatches;
}
