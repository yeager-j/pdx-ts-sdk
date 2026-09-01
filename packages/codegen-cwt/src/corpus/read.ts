import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isScalar,
  parse,
  scalarText as renderScalarText,
  type PdxContainer,
  type PdxEntry,
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
 * The values and arity one definition's descents collect, with the rule a mixed
 * trigger struct needs to tell its own members from the trigger keys it splices.
 */
interface DescentContext {
  /** Collected values by dotted field path. */
  readonly valuesByField: Map<string, PdxValue[]>;
  /** Whether a path was written more than once inside one block. */
  readonly blockArity: Map<string, boolean>;
  /** {@link RegistryRead.isTriggerKey}. */
  readonly isTriggerKey: (key: string) => boolean;
}

/** Records a block's entries and their nested descendant fields. */
function recordBlock(
  block: PdxContainer,
  path: string,
  children: ReadonlyMap<string, DescentNode>,
  skip: string | undefined,
  context: DescentContext
): void {
  const withinThisBlock = new Set<string>();
  for (const leaf of block.items) {
    if (leaf.kind !== "entry" || leaf.key === skip) {
      continue;
    }
    const leafPath = `${path}.${leaf.key}`;
    context.blockArity.set(
      leafPath,
      (context.blockArity.get(leafPath) ?? false) || withinThisBlock.has(leafPath)
    );
    withinThisBlock.add(leafPath);
    context.valuesByField.set(leafPath, [
      ...(context.valuesByField.get(leafPath) ?? []),
      leaf.value,
    ]);
    const child = children.get(leaf.key);
    if (child !== undefined && leaf.value.kind === "container") {
      descend(leaf.value, child, path, context);
    }
  }
}

/** Records fields from one descended block. */
function descend(
  value: PdxContainer,
  node: DescentNode,
  prefix: string,
  context: DescentContext
): void {
  const path = prefix === "" ? node.field : `${prefix}.${node.field}`;
  const children = new Map(node.children.map((child) => [child.field, child]));
  switch (node.mode) {
    case "struct":
      recordBlock(value, path, children, undefined, context);
      return;
    case "wrappedStruct":
      for (const item of value.items) {
        if (item.kind === "container") {
          recordBlock(item, path, children, undefined, context);
        }
      }
      return;
    case "structMap":
      for (const item of value.items) {
        if (item.kind === "entry" && item.value.kind === "container") {
          recordBlock(item.value, path, children, undefined, context);
        }
      }
      return;
    case "repeatedStruct":
      if (node.keying === "container") {
        for (const sub of value.items) {
          if (sub.kind === "entry" && sub.value.kind === "container") {
            recordBlock(sub.value, path, children, undefined, context);
          }
        }
        return;
      }
      recordBlock(value, path, children, node.identityKey, context);
      return;
    case "weightModifiers":
      recordWeightModifiers(value, path, node.strippedKeys, context);
      return;
    case "triggeredModifierPotential":
      recordTriggeredModifierPotential(value, path, context);
      return;
    case "economicResourceOperationTrigger":
      recordEconomicResourceOperationTrigger(value, path, context);
      return;
    case "triggerStruct":
      recordTriggerStruct(value, path, node, children, context);
      return;
    default: {
      const unreachable: never = node;
      throw new Error(`Unhandled descent node: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Records a mixed trigger struct: its members at their own paths, and the
 * trigger keys it splices folded into one synthetic `when` container.
 *
 * A direct key that is neither declared ordinary nor a trigger key counts as a
 * member. It is a field the game writes and the rules have yet to declare, and
 * folding it into `when` would present it as a condition an author already has
 * a way to write.
 */
function recordTriggerStruct(
  value: PdxContainer,
  path: string,
  node: Extract<DescentNode, { mode: "triggerStruct" }>,
  children: ReadonlyMap<string, DescentNode>,
  context: DescentContext
): void {
  const ordinaryKeys = new Set(node.ordinaryKeys);
  const memberEntries: PdxEntry[] = [];
  const triggerEntries: PdxEntry[] = [];
  for (const item of value.items) {
    if (item.kind !== "entry") {
      continue;
    }
    if (!ordinaryKeys.has(item.key) && context.isTriggerKey(item.key)) {
      triggerEntries.push(item);
      continue;
    }
    memberEntries.push(item);
  }
  recordBlock({ kind: "container", items: memberEntries }, path, children, undefined, context);
  if (triggerEntries.length === 0) {
    return;
  }
  const when = `${path}.when`;
  context.blockArity.set(when, false);
  context.valuesByField.set(when, [
    ...(context.valuesByField.get(when) ?? []),
    { kind: "container", items: triggerEntries },
  ]);
}

/** Records the trigger keys from `modifier` rows in a weight block. */
function recordWeightModifiers(
  weights: PdxContainer,
  path: string,
  strippedKeys: ReadonlySet<string>,
  context: DescentContext
): void {
  const rowPath = `${path}.modifier`;
  let hasEarlierRow = false;
  for (const item of weights.items) {
    if (item.kind !== "entry" || item.key !== "modifier" || item.value.kind !== "container") {
      continue;
    }
    context.blockArity.set(rowPath, (context.blockArity.get(rowPath) ?? false) || hasEarlierRow);
    hasEarlierRow = true;
    context.valuesByField.set(rowPath, [
      ...(context.valuesByField.get(rowPath) ?? []),
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
  context: DescentContext
): void {
  const potentialPath = `${path}.potential`;
  let hasEarlierPotential = false;
  for (const item of modifier.items) {
    if (item.kind !== "entry" || item.key !== "potential") {
      continue;
    }
    context.blockArity.set(
      potentialPath,
      (context.blockArity.get(potentialPath) ?? false) || hasEarlierPotential
    );
    hasEarlierPotential = true;
    context.valuesByField.set(potentialPath, [
      ...(context.valuesByField.get(potentialPath) ?? []),
      item.value,
    ]);
  }
}

/** Records only direct trigger clauses from an economic resource operation. */
function recordEconomicResourceOperationTrigger(
  operation: PdxContainer,
  path: string,
  context: DescentContext
): void {
  const triggerPath = `${path}.trigger`;
  let hasEarlierTrigger = false;
  for (const item of operation.items) {
    if (item.kind !== "entry" || item.key !== "trigger") {
      continue;
    }
    context.blockArity.set(
      triggerPath,
      (context.blockArity.get(triggerPath) ?? false) || hasEarlierTrigger
    );
    hasEarlierTrigger = true;
    context.valuesByField.set(triggerPath, [
      ...(context.valuesByField.get(triggerPath) ?? []),
      item.value,
    ]);
  }
}

/** Records a spliced member and its recursively nested members. */
function descendSplice(value: PdxContainer, member: SpliceMember, context: DescentContext): void {
  const nested = new Map(member.members().map((inner) => [inner.key, inner]));
  const children = new Map(member.descents.map((child) => [child.field, child]));
  const withinThisBlock = new Set<string>();
  for (const leaf of value.items) {
    if (leaf.kind !== "entry") {
      continue;
    }
    const path = `${member.key}.${leaf.key}`;
    context.blockArity.set(
      path,
      (context.blockArity.get(path) ?? false) || withinThisBlock.has(path)
    );
    withinThisBlock.add(path);
    context.valuesByField.set(path, [...(context.valuesByField.get(path) ?? []), leaf.value]);
    if (leaf.value.kind !== "container") {
      continue;
    }
    const inner = nested.get(leaf.key);
    if (inner !== undefined) {
      descendSplice(leaf.value, inner, context);
      continue;
    }
    const child = children.get(leaf.key);
    if (child !== undefined) {
      descend(leaf.value, child, member.key, context);
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
  /**
   * Whether a key is one a trigger clause admits: a trigger rule, a scope link, a structural
   * combinator, or a scripted trigger. Implement it case-insensitively; the reader passes the key
   * as the game writes it.
   *
   * In a mixed trigger struct, a key that is neither ordinary nor a trigger key is recorded at its
   * own path so conformance reports it as unauthorable instead of hiding it inside the synthetic
   * `when` block.
   */
  readonly isTriggerKey: (key: string) => boolean;
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

/** Collects one canonical definition's top-level and descended field values. */
function collectDefinitionObservations(
  definition: PdxContainer,
  nameField: string | null,
  descentsByField: ReadonlyMap<string, DescentNode>,
  splicesByKey: ReadonlyMap<string, SpliceMember>,
  isTriggerKey: (key: string) => boolean
): DescentContext {
  const context: DescentContext = {
    valuesByField: new Map<string, PdxValue[]>(),
    blockArity: new Map<string, boolean>(),
    isTriggerKey,
  };
  for (const field of definition.items) {
    if (field.kind !== "entry" || field.key === nameField) {
      continue;
    }
    context.valuesByField.set(field.key, [
      ...(context.valuesByField.get(field.key) ?? []),
      field.value,
    ]);
    const descent = descentsByField.get(field.key);
    if (descent !== undefined && field.value.kind === "container") {
      descend(field.value, descent, "", context);
    }
    const splice = splicesByKey.get(field.key);
    if (splice !== undefined && field.value.kind === "container") {
      descendSplice(field.value, splice, context);
    }
  }
  return context;
}

/**
 * Reads definitions from an installed registry into field observations.
 *
 * Pass the install root and CWT-derived {@link RegistryRead} configuration. The result is suitable
 * for {@link conformance} and `shapeConformance`; absent registry directories return an empty corpus.
 *
 * The reader carries no rules of its own, so {@link RegistryRead.isTriggerKey} is what decides
 * whether a mixed trigger struct's direct key is a condition or a member of the struct.
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
      const observed = collectDefinitionObservations(
        definition,
        registryRead.nameField,
        descentsByField,
        splicesByKey,
        registryRead.isTriggerKey
      );
      addDefinitionObservations(occurrences, observed.valuesByField, observed.blockArity);
    }
  }
  return { definitions, files: files.length, occurrences };
}
