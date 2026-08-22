/**
 * The corpus reading engine: parses every real definition a registry's
 * directory holds and folds what it writes into per-field observations. The
 * vocabulary lives in `./observations.ts`, the verdicts in `./conformance.ts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isScalar,
  parse,
  scalarText as renderScalarText,
  type PdxContainer,
  type PdxItem,
  type PdxValue,
} from "@pdx-ts/pdxscript";

import { CasingFolder, OBSERVED_CASINGS } from "./casing.ts";
import {
  VALUE_SAMPLE,
  type DescentNode,
  type FieldObservation,
  type RegistryCorpus,
  type SpliceMember,
} from "./observations.ts";
import { relativeRegistryPath, walkRegistryFiles } from "./registry-files.ts";

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
    default: {
      // Exhaustiveness, not defensiveness: `node.mode` is only assignable to
      // `never` here because every DESCENT_MODES member has its own case
      // above. Add a mode without a case and this line fails to compile,
      // rather than the switch silently returning void for it — which is
      // exactly what a bare `switch (node.mode) { ... }` with no default did
      // before this arm existed.
      const unreachable: never = node.mode;
      throw new Error(`Unhandled descent mode: ${String(unreachable)}`);
    }
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

/** One registry's file layout, as its CWT type declares it. */
export interface RegistryLayout {
  /** `path_extension`, dotted. Absent means the game's `.txt` default. */
  readonly extension?: string;
  /**
   * `path_strict = yes`: the registry's files are the ones directly in its
   * directory, and its subdirectories belong to other CWT types. Absent means
   * the reader descends, which is what `interface/` and `gfx/models/` need.
   */
  readonly pathStrict?: boolean;
  /**
   * `skip_root_key` as a descent path: one segment per level the definitions
   * sit below the file's top level, outermost first. `any` is a wildcard
   * segment matching every block key at its own level — `swapped_job` declares
   * `{ any swappable_data }`, which is any job id, then that job's
   * `swappable_data` block, whose children are the definitions.
   */
  readonly skipRootKeys?: readonly string[];
}

/**
 * The items a file offers as definitions.
 *
 * Without `skip_root_key` that is the file's own top level. With one, each
 * segment selects the blocks to descend into at its own level and the
 * definitions are what lies under the last segment. An entry matching no
 * segment at its level belongs to something else in the same file, so it drops
 * out and nothing below it is counted either.
 */
function rootDefinitions(
  items: readonly PdxItem[],
  skipRootKeys: readonly string[],
  matches: (spelling: string, canonical: string) => boolean
): PdxItem[] {
  let level = [...items];
  for (const segment of skipRootKeys) {
    level = level.flatMap((item) =>
      item.kind === "entry" &&
      item.value.kind === "container" &&
      (segment === "any" || matches(item.key, segment))
        ? item.value.items
        : []
    );
  }
  return level;
}

/**
 * One definition with every key at every depth replaced by its canonical
 * spelling.
 *
 * Whole-tree rather than key-by-key at the point of use: the same variant
 * shows up inside a descended block as readily as at the top level — the game
 * writes `animationtexturefile` 575 times inside `spriteType.animation` and
 * never the `animationtextureFile` the rules declare — and a reader that folded
 * only the outer level would report the interior as a field no author can
 * write. Values are shared, not copied; only the entry spine is rebuilt.
 */
function foldKeys(container: PdxContainer, fold: (spelling: string) => string): PdxContainer {
  return {
    ...container,
    items: container.items.map((item) => {
      if (item.kind === "container") {
        return foldKeys(item, fold);
      }
      if (item.kind !== "entry") {
        return item;
      }
      return {
        ...item,
        key: fold(item.key),
        value: item.value.kind === "container" ? foldKeys(item.value, fold) : item.value,
      };
    }),
  };
}

/** Everything {@link readRegistryCorpus} needs about one registry. */
export interface RegistryRead {
  /** Generated registry name — the key {@link OBSERVED_CASINGS} is looked up by. */
  readonly registry: string;
  /** Directory under the install root the corpus reads, e.g. `common/technology`. */
  readonly registryPath: string;
  /**
   * The repeated top-level key each definition is written under, for registries
   * CWT marks with `name_field`. Normally each top-level entry is one definition
   * keyed by its id; with a keyword the id sits in a body field instead, so only
   * entries under that keyword count and the name field is not a field.
   */
  readonly keyword: string | null;
  readonly nameField: string | null;
  /**
   * This registry's block-valued fields, so their contents are visible instead
   * of collapsing into one opaque top-level key — see {@link DescentNode}.
   */
  readonly descents?: readonly DescentNode[];
  readonly spliceMembers?: readonly SpliceMember[];
  /**
   * A top-level key belonging to a sibling type that shares this directory,
   * from a negated `## type_key_filter <> key` — `random_list` under
   * `common/solar_system_initializers`. Counting one as a definition would
   * measure another type's body against this registry's fields.
   */
  readonly excludedKey?: string | null;
  /**
   * The registry's file layout as the rules declare it: which extension its
   * files carry, whether its subdirectories are its own, and how far inside a
   * file the definitions sit. All three change what counts as a definition, so
   * a reader given none of them would measure a `.gfx` registry as empty
   * rather than as unread.
   */
  readonly layout?: RegistryLayout;
}

/**
 * Reads every definition a registry's directory holds.
 *
 * Key spellings are folded through {@link OBSERVED_CASINGS} for the registries
 * that have a table — the keyword, the envelope segments, and every observed
 * field key — so the game's own mixed casing lands on one observation instead
 * of two, and an unaudited near-miss fails loudly. Registries with no table are
 * read exactly as written, which is every `common/` registry.
 */
export function readRegistryCorpus(root: string, read: RegistryRead): RegistryCorpus {
  const layout = read.layout ?? {};
  const dir = path.join(root, read.registryPath);
  const files = walkRegistryFiles(dir, layout.extension ?? ".txt", layout.pathStrict !== true);
  if (files.length === 0) {
    return { definitions: 0, files: 0, occurrences: new Map() };
  }
  const skipRootKeys = layout.skipRootKeys ?? [];
  const casings = OBSERVED_CASINGS.get(read.registry);
  const folder = casings === undefined ? null : new CasingFolder(read.registry, casings);
  const descentByField = new Map((read.descents ?? []).map((node) => [node.field, node]));
  const spliceByKey = new Map((read.spliceMembers ?? []).map((member) => [member.key, member]));
  const occurrences = new Map<string, FieldObservation>();
  let definitions = 0;
  for (const file of files) {
    const relative = relativeRegistryPath(dir, file);
    const matches = (spelling: string, canonical: string): boolean =>
      folder === null ? spelling === canonical : folder.matches(spelling, canonical, relative);
    const fold = (spelling: string): string =>
      folder === null ? spelling : folder.fold(spelling, relative);
    const parsed = parse(readFileSync(file, "utf8"));
    for (const item of rootDefinitions(parsed.items, skipRootKeys, matches)) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      if (read.keyword !== null && !matches(item.key, read.keyword)) {
        continue;
      }
      if (item.key === read.excludedKey) {
        continue;
      }
      definitions += 1;
      // Folded once, over the whole definition, so every level below is read
      // in canonical spellings — `descend` and its `record*` helpers never see
      // a variant and need to know nothing about casing.
      const definition = folder === null ? item.value : foldKeys(item.value, fold);
      const written = new Map<string, PdxValue[]>();
      const blockArity = new Map<string, boolean>();
      for (const field of definition.items) {
        if (field.kind !== "entry" || field.key === read.nameField) {
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
  return { definitions, files: files.length, occurrences };
}
