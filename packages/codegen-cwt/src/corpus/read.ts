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

/** Records a block's entries and their nested descendant fields. */
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

/** Records fields from one descended block. */
function descend(
  value: PdxContainer,
  node: DescentNode,
  prefix: string,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const path = prefix === "" ? node.field : `${prefix}.${node.field}`;
  const children = new Map(node.children.map((child) => [child.field, child]));
  switch (node.mode) {
    case "struct":
      recordBlock(value, path, children, undefined, seen, blockArity);
      return;
    case "wrappedStruct":
      for (const item of value.items) {
        if (item.kind === "container") {
          recordBlock(item, path, children, undefined, seen, blockArity);
        }
      }
      return;
    case "structMap":
      for (const item of value.items) {
        if (item.kind === "entry" && item.value.kind === "container") {
          recordBlock(item.value, path, children, undefined, seen, blockArity);
        }
      }
      return;
    case "repeatedStruct":
      if (node.keying === "container") {
        for (const sub of value.items) {
          if (sub.kind === "entry" && sub.value.kind === "container") {
            recordBlock(sub.value, path, children, undefined, seen, blockArity);
          }
        }
        return;
      }
      recordBlock(value, path, children, node.identityKey, seen, blockArity);
      return;
    case "weightModifiers":
      recordWeightModifiers(value, path, node.strippedKeys, seen, blockArity);
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
      const unreachable: never = node;
      throw new Error(`Unhandled descent node: ${JSON.stringify(unreachable)}`);
    }
  }
}

function recordTriggerStruct(
  value: PdxContainer,
  path: string,
  node: Extract<DescentNode, { mode: "triggerStruct" }>,
  children: ReadonlyMap<string, DescentNode>,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const ordinaryKeys = new Set(node.ordinaryKeys);
  const ordinaryEntries = value.items.filter(
    (item): item is Extract<(typeof value.items)[number], { kind: "entry" }> =>
      item.kind === "entry" && ordinaryKeys.has(item.key)
  );
  recordBlock(
    { kind: "container", items: ordinaryEntries },
    path,
    children,
    undefined,
    seen,
    blockArity
  );
  const triggerEntries = value.items.filter(
    (item): item is Extract<(typeof value.items)[number], { kind: "entry" }> =>
      item.kind === "entry" && !ordinaryKeys.has(item.key)
  );
  if (triggerEntries.length > 0) {
    const when = `${path}.when`;
    blockArity.set(when, false);
    seen.set(when, [...(seen.get(when) ?? []), { kind: "container", items: triggerEntries }]);
  }
}

/** Records the trigger keys from `modifier` rows in a weight block. */
function recordWeightModifiers(
  weights: PdxContainer,
  path: string,
  strippedKeys: ReadonlySet<string>,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const rowPath = `${path}.modifier`;
  let hasEarlierRow = false;
  for (const item of weights.items) {
    if (item.kind !== "entry" || item.key !== "modifier" || item.value.kind !== "container") {
      continue;
    }
    blockArity.set(rowPath, (blockArity.get(rowPath) ?? false) || hasEarlierRow);
    hasEarlierRow = true;
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

/** Records potential conditions from triggered-modifier rows. */
function recordTriggeredModifierPotential(
  modifier: PdxContainer,
  path: string,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const potentialPath = `${path}.potential`;
  let hasEarlierPotential = false;
  for (const item of modifier.items) {
    if (item.kind !== "entry" || item.key !== "potential") {
      continue;
    }
    blockArity.set(potentialPath, (blockArity.get(potentialPath) ?? false) || hasEarlierPotential);
    hasEarlierPotential = true;
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
  let hasEarlierTrigger = false;
  for (const item of operation.items) {
    if (item.kind !== "entry" || item.key !== "trigger") {
      continue;
    }
    blockArity.set(triggerPath, (blockArity.get(triggerPath) ?? false) || hasEarlierTrigger);
    hasEarlierTrigger = true;
    seen.set(triggerPath, [...(seen.get(triggerPath) ?? []), item.value]);
  }
}

/** Records a spliced member and its recursively nested members. */
function descendSplice(
  value: PdxContainer,
  member: SpliceMember,
  seen: Map<string, PdxValue[]>,
  blockArity: Map<string, boolean>
): void {
  const nested = new Map(member.members().map((inner) => [inner.key, inner]));
  const children = new Map(member.descents.map((child) => [child.field, child]));
  const withinThisBlock = new Set<string>();
  for (const leaf of value.items) {
    if (leaf.kind !== "entry") {
      continue;
    }
    const path = `${member.key}.${leaf.key}`;
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
    const child = children.get(leaf.key);
    if (child !== undefined) {
      descend(leaf.value, child, member.key, seen, blockArity);
    }
  }
}

type SpliceCategory = {
  readonly memberKey: string;
  readonly spliceCategories: readonly string[];
  readonly corpusDescents: readonly DescentNode[];
};

/**
 * Builds structural alias splice members from emitter category metadata.
 *
 * Pass the categories admitted by one registry and a resolver that returns each category's emitted
 * member key, nested splice categories, and descent nodes. Missing categories are omitted; nested
 * members stay lazy so recursive aliases terminate.
 */
export function spliceMembersOf(
  categories: readonly string[],
  resolveCategory: (category: string) => SpliceCategory | null
): SpliceMember[] {
  return categories.flatMap((category) => {
    const resolved = resolveCategory(category);
    return resolved === null
      ? []
      : [
          {
            key: resolved.memberKey,
            members: () => spliceMembersOf(resolved.spliceCategories, resolveCategory),
            descents: resolved.corpusDescents,
          },
        ];
  });
}

function sameKeySet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** Returns the source spelling for a concrete scalar value. */
function scalarText(value: PdxValue): string | null {
  if (!isScalar(value) || value.kind === "var" || value.kind === "math") {
    return null;
  }
  if (value.kind === "str") {
    return value.value;
  }
  return renderScalarText(value);
}

type FieldValueSummary = {
  readonly scalarValues: readonly string[];
  readonly directKeys: ReadonlySet<string>;
  readonly writesScalar: boolean;
  readonly writesBlock: boolean;
  readonly writesBareValue: boolean;
  readonly writesBareBlock: boolean;
  readonly writesEmptyBlock: boolean;
};

/** Summarizes the values one definition writes for one field. */
function summarizeFieldValues(values: readonly PdxValue[]): FieldValueSummary {
  const scalarValues: string[] = [];
  const directKeys = new Set<string>();
  let writesScalar = false;
  let writesBlock = false;
  let writesBareValue = false;
  let writesBareBlock = false;
  let writesEmptyBlock = false;
  for (const value of values) {
    if (value.kind !== "container") {
      writesScalar = true;
      const text = scalarText(value);
      if (text !== null) {
        scalarValues.push(text);
      }
      continue;
    }
    writesBlock = true;
    let hasContent = false;
    for (const item of value.items) {
      if (item.kind === "entry") {
        directKeys.add(item.key);
        hasContent = true;
        continue;
      }
      if (item.kind === "param" || item.kind === "param-text") {
        continue;
      }
      if (item.kind === "container") {
        writesBareBlock = true;
        hasContent = true;
        continue;
      }
      writesBareValue = true;
      hasContent = true;
      const text = scalarText(item);
      if (text !== null) {
        scalarValues.push(text);
      }
    }
    writesEmptyBlock = writesEmptyBlock || !hasContent;
  }
  return {
    scalarValues,
    directKeys,
    writesScalar,
    writesBlock,
    writesBareValue,
    writesBareBlock,
    writesEmptyBlock,
  };
}

function sampleValues(
  observedValues: ReadonlySet<string>,
  scalarValues: readonly string[]
): ReadonlySet<string> {
  const values = new Set(observedValues);
  for (const value of scalarValues) {
    if (values.size >= VALUE_SAMPLE) {
      break;
    }
    values.add(value);
  }
  return values;
}

/** Merges one definition's summary with an existing field observation. */
function mergeFieldObservation(
  previous: FieldObservation | undefined,
  summary: FieldValueSummary,
  repeats: boolean
): FieldObservation {
  const observedKeySets = previous?.keysByDefinition ?? [];
  const keysByDefinition = observedKeySets.some((keys) => sameKeySet(keys, summary.directKeys))
    ? observedKeySets
    : [...observedKeySets, summary.directKeys];
  return {
    definitions: (previous?.definitions ?? 0) + 1,
    repeated: (previous?.repeated ?? 0) + (repeats ? 1 : 0),
    scalars: (previous?.scalars ?? 0) + (summary.writesScalar ? 1 : 0),
    blocks: (previous?.blocks ?? 0) + (summary.writesBlock ? 1 : 0),
    bareValues: (previous?.bareValues ?? 0) + (summary.writesBareValue ? 1 : 0),
    bareBlocks: (previous?.bareBlocks ?? 0) + (summary.writesBareBlock ? 1 : 0),
    emptyBlocks: (previous?.emptyBlocks ?? 0) + (summary.writesEmptyBlock ? 1 : 0),
    values: sampleValues(previous?.values ?? new Set(), summary.scalarValues),
    keys: new Set([...(previous?.keys ?? []), ...summary.directKeys]),
    keysByDefinition,
  };
}

/** Adds one definition's field observations to the registry corpus. */
function addDefinitionObservations(
  occurrences: Map<string, FieldObservation>,
  valuesByField: ReadonlyMap<string, PdxValue[]>,
  blockArity: ReadonlyMap<string, boolean>
): void {
  for (const [field, values] of valuesByField) {
    const repeats = blockArity.get(field) ?? values.length > 1;
    const summary = summarizeFieldValues(values);
    occurrences.set(field, mergeFieldObservation(occurrences.get(field), summary, repeats));
  }
}

/**
 * Describes where a registry's definitions live in the install.
 *
 * Provide this through {@link RegistryRead.layout}; omitted properties use the game's normal
 * `.txt`, recursive layout.
 */
export interface RegistryLayout {
  /** File extension. Defaults to `.txt`. */
  readonly extension?: string;
  /** Whether subdirectories belong to other registries. Set from the CWT `path_strict` rule. */
  readonly pathStrict?: boolean;
  /** Root-key path leading to definitions. `any` matches every key at one level. */
  readonly skipRootKeys?: readonly string[];
}

/** Returns items below the configured root-key path. */
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

/** Replaces every entry key in a definition with its canonical spelling. */
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

/**
 * Configures corpus collection for one generated registry.
 *
 * Build this from the registry's CWT-derived emission metadata, then pass it to
 * {@link readRegistryCorpus}. The configuration defines both what counts as a definition and which
 * nested fields are measured.
 */
export interface RegistryRead {
  /** Generated registry name. It selects audited casing rules when the registry has them. */
  readonly registry: string;
  /** Path under the install root. */
  readonly registryPath: string;
  /** Repeated top-level definition key, when definitions use a name field. Set `null` for id-keyed entries. */
  readonly keyword: string | null;
  /** Field carrying a definition's name, excluded from observations. */
  readonly nameField: string | null;
  /** Block-valued fields whose contents are observed. Supply the emitter-derived descent nodes. */
  readonly descents?: readonly DescentNode[];
  /** Structural alias splices whose contents are observed. Create the members with {@link spliceMembersOf}. */
  readonly spliceMembers?: readonly SpliceMember[];
  /** Top-level sibling-type key excluded from definitions. */
  readonly excludedKey?: string | null;
  /** File layout for the registry. */
  readonly layout?: RegistryLayout;
}

/** Selects definition bodies from one parsed registry file. */
function definitionBodies(
  items: readonly PdxItem[],
  skipRootKeys: readonly string[],
  keyword: string | null,
  excludedKey: string | null | undefined,
  matches: (spelling: string, canonical: string) => boolean
): readonly PdxContainer[] {
  return rootDefinitions(items, skipRootKeys, matches).flatMap((item) => {
    if (item.kind !== "entry" || item.value.kind !== "container") {
      return [];
    }
    if (keyword !== null && !matches(item.key, keyword)) {
      return [];
    }
    if (item.key === excludedKey) {
      return [];
    }
    return [item.value];
  });
}

type DefinitionObservations = {
  readonly valuesByField: Map<string, PdxValue[]>;
  readonly blockArity: Map<string, boolean>;
};

/** Collects one canonical definition's top-level and descended field values. */
function collectDefinitionObservations(
  definition: PdxContainer,
  nameField: string | null,
  descentsByField: ReadonlyMap<string, DescentNode>,
  splicesByKey: ReadonlyMap<string, SpliceMember>
): DefinitionObservations {
  const valuesByField = new Map<string, PdxValue[]>();
  const blockArity = new Map<string, boolean>();
  for (const field of definition.items) {
    if (field.kind !== "entry" || field.key === nameField) {
      continue;
    }
    valuesByField.set(field.key, [...(valuesByField.get(field.key) ?? []), field.value]);
    const descent = descentsByField.get(field.key);
    if (descent !== undefined && field.value.kind === "container") {
      descend(field.value, descent, "", valuesByField, blockArity);
    }
    const splice = splicesByKey.get(field.key);
    if (splice !== undefined && field.value.kind === "container") {
      descendSplice(field.value, splice, valuesByField, blockArity);
    }
  }
  return { valuesByField, blockArity };
}

/**
 * Reads definitions from an installed registry into field observations.
 *
 * Pass the install root and CWT-derived {@link RegistryRead} configuration. The result is suitable
 * for {@link conformance} and `shapeConformance`; absent registry directories return an empty corpus.
 */
export function readRegistryCorpus(root: string, registryRead: RegistryRead): RegistryCorpus {
  const layout = registryRead.layout ?? {};
  const registryDirectory = path.join(root, registryRead.registryPath);
  const files = walkRegistryFiles(
    registryDirectory,
    layout.extension ?? ".txt",
    layout.pathStrict !== true
  );
  if (files.length === 0) {
    return { definitions: 0, files: 0, occurrences: new Map() };
  }
  const skipRootKeys = layout.skipRootKeys ?? [];
  const casings = OBSERVED_CASINGS.get(registryRead.registry);
  const folder = casings === undefined ? null : new CasingFolder(registryRead.registry, casings);
  const descentsByField = new Map((registryRead.descents ?? []).map((node) => [node.field, node]));
  const splicesByKey = new Map(
    (registryRead.spliceMembers ?? []).map((member) => [member.key, member])
  );
  const occurrences = new Map<string, FieldObservation>();
  let definitions = 0;
  for (const filePath of files) {
    const relativePath = relativeRegistryPath(registryDirectory, filePath);
    const matchesCanonicalKey = (spelling: string, canonical: string): boolean =>
      folder === null ? spelling === canonical : folder.matches(spelling, canonical, relativePath);
    const foldKey = (spelling: string): string =>
      folder === null ? spelling : folder.fold(spelling, relativePath);
    const document = parse(readFileSync(filePath, "utf8"));
    for (const body of definitionBodies(
      document.items,
      skipRootKeys,
      registryRead.keyword,
      registryRead.excludedKey,
      matchesCanonicalKey
    )) {
      definitions += 1;
      const definition = folder === null ? body : foldKeys(body, foldKey);
      const definitionObservations = collectDefinitionObservations(
        definition,
        registryRead.nameField,
        descentsByField,
        splicesByKey
      );
      addDefinitionObservations(
        occurrences,
        definitionObservations.valuesByField,
        definitionObservations.blockArity
      );
    }
  }
  return { definitions, files: files.length, occurrences };
}
