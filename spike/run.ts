/**
 * SPIKE: PDXScript -> TypeScript importer feasibility measurement.
 *
 * Not product code. Parses a real shipped mod, classifies its files against
 * the SDK's content registries, raises each covered definition into the
 * Def shape by inverting the generated ContentField tables, then lowers the
 * raised fields back through the SDK's real `fieldEntries` and tree-compares
 * against the original — measuring exactly where a mechanical import is
 * lossless, where it must carry raw PDXScript, and where it fails.
 *
 * Run: node --conditions=pdx-source spike/run.ts [modDir]
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import {
  classifyUnquoted,
  parse,
  serialize,
  type PdxEntry,
  type PdxItem,
  type PdxScalar,
} from "@pdx-ts/pdxscript";

import { fieldEntries } from "../packages/sdk/src/content/lower.ts";
import type {
  ContentField,
  ContentRegistryDescriptor,
} from "../packages/sdk/src/content/schema.ts";
import { CONTENT_REGISTRIES } from "../packages/sdk/src/generated/content-registry.ts";
import { MODIFIER_OPERATIONS } from "../packages/sdk/src/generated/modifier-policy.ts";
import { trigger } from "../packages/sdk/src/script/trigger-core.ts";

const MOD_DIR =
  process.argv[2] ??
  join(homedir(), "Library/Application Support/Steam/steamapps/workshop/content/281990/2816360131");

// ---------------------------------------------------------------- inventory

interface FileRecord {
  readonly rel: string;
  readonly dir: string;
  readonly source: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(MOD_DIR).map((full) => relative(MOD_DIR, full));
const txtFiles: FileRecord[] = allFiles
  .filter((rel) => rel.endsWith(".txt") && (rel.startsWith("common/") || rel.startsWith("events/")))
  .map((rel) => ({
    rel,
    dir: rel.slice(0, rel.lastIndexOf("/")),
    source: readFileSync(join(MOD_DIR, rel), "utf8").replace(/^\uFEFF/, ""),
  }));

const byOutputDir = new Map<string, ContentRegistryDescriptor[]>();
for (const descriptor of CONTENT_REGISTRIES) {
  const list = byOutputDir.get(descriptor.outputDir) ?? [];
  list.push(descriptor);
  byOutputDir.set(descriptor.outputDir, list);
}

// ------------------------------------------------------------ localisation

const locText = new Map<string, string>();
for (const rel of allFiles.filter(
  (rel) => rel.startsWith("localisation") && rel.endsWith(".yml") && rel.includes("english")
)) {
  const source = readFileSync(join(MOD_DIR, rel), "utf8");
  for (const line of source.split("\n")) {
    const match = /^\s*([\w.\-']+):\d*\s+"(.*)"\s*$/.exec(line);
    if (match) {
      locText.set(match[1]!, match[2]!);
    }
  }
}

// ------------------------------------------------------------------ raise

type Outcome =
  | "mapped-reordered" // typed member; lowering reorders keys within a block, same content
  | "mapped" // raised to a typed member, lowered back identically
  | "mapped-drift" // raised to a typed member, lowering produced a different tree
  | "script-carried" // trigger/effect body carried as a raw tree (lossless by construction)
  | "raw-carried" // shape the raiser doesn't type yet; carried as raw tree
  | "unmapped"; // key the registry's field table doesn't know; would land in rest

interface FieldResult {
  readonly registry: string;
  readonly key: string;
  readonly shape: string | undefined;
  readonly outcome: Outcome;
  readonly file: string;
  readonly id: string;
  readonly detail?: string;
}

const fieldResults: FieldResult[] = [];

function normalizeQuoting(item: PdxItem): PdxItem {
  switch (item.kind) {
    case "str":
      // Quoting a bare-safe token is cosmetic; the game reads both the same.
      return item.quoted && classifyUnquoted(item.value)?.kind === "str"
        ? { kind: "str", value: item.value, quoted: false }
        : item;
    case "entry":
      return {
        kind: "entry",
        key: item.key,
        op: item.op,
        value: normalizeQuoting(item.value) as PdxEntry["value"],
      };
    case "container":
      return { kind: "container", header: item.header, items: item.items.map(normalizeQuoting) };
    case "param":
      return { kind: "param", leading: item.leading, items: item.items.map(normalizeQuoting) };
    default:
      return item;
  }
}

function canonical(items: readonly PdxItem[]): string {
  return serialize(items.map(normalizeQuoting));
}

/**
 * Order-insensitive canonical form: inside an entries-only container, entry
 * order is not author data (ADR-0005 — the game reads keys, the SDK emits in
 * schema order), so entries sort by (key, value). Mixed containers (bare
 * scalars, planet arrays) keep their order — there, order IS the data.
 */
function sortEntries(item: PdxItem): PdxItem {
  if (item.kind === "entry") {
    return { ...item, value: sortEntries(item.value) as PdxEntry["value"] };
  }
  if (item.kind !== "container") {
    return item;
  }
  const items = item.items.map(sortEntries);
  if (!items.every((inner) => inner.kind === "entry")) {
    return { ...item, items };
  }
  const keyed = items.map((inner) => ({ inner, text: serialize([inner]) }));
  keyed.sort((a, b) =>
    a.inner.key < b.inner.key
      ? -1
      : a.inner.key > b.inner.key
        ? 1
        : a.text < b.text
          ? -1
          : a.text > b.text
            ? 1
            : 0
  );
  return { ...item, items: keyed.map((entry) => entry.inner) };
}

function canonicalSemantic(items: readonly PdxItem[]): string {
  return serialize(
    [...items]
      .map(normalizeQuoting)
      .map(sortEntries)
      .sort((a, b) => {
        const left = serialize([a]);
        const right = serialize([b]);
        return left < right ? -1 : left > right ? 1 : 0;
      })
  );
}

function raiseScalar(value: PdxScalar): unknown {
  switch (value.kind) {
    case "num":
      return value.value;
    case "bool":
      return value.value;
    case "str":
      return value.value;
    case "var":
      return value.name; // includes the leading "@"; scriptValueScalar re-lowers it to a var node
    default:
      return undefined; // math — not raisable to a typed member
  }
}

function isScalarKind(item: PdxItem): item is PdxScalar {
  return item.kind === "str" || item.kind === "num" || item.kind === "bool" || item.kind === "var";
}

/** Raise one field's occurrences; returns the member value or a symbol for fallback. */
const RAW = Symbol("carry-raw");

function entriesOf(value: PdxItem): PdxEntry[] | typeof RAW {
  if (value.kind !== "container" || value.header !== undefined) {
    return RAW;
  }
  return value.items.every((item) => item.kind === "entry") ? (value.items as PdxEntry[]) : RAW;
}

function raiseTrigger(value: PdxItem): unknown {
  const entries = entriesOf(value);
  return entries === RAW ? RAW : trigger(entries);
}

const OPERATION_MEMBER = new Map(MODIFIER_OPERATIONS.map((op) => [op.scriptKey, op.member]));

/** `modifier = { <ops> <trigger entries> }` -> a Modifier row. */
function raiseModifierRow(value: PdxItem): unknown {
  const entries = entriesOf(value);
  if (entries === RAW) {
    return RAW;
  }
  const row: Record<string, unknown> = {};
  const when: PdxEntry[] = [];
  for (const entry of entries) {
    const member = OPERATION_MEMBER.get(entry.key);
    if (member !== undefined && isScalarKind(entry.value)) {
      if (row[member] !== undefined) {
        return RAW;
      }
      row[member] = raiseScalar(entry.value);
    } else if (entry.key === "desc") {
      return RAW; // desc requires a registered localisation key; carry raw
    } else {
      when.push(entry);
    }
  }
  if (when.length > 0) {
    row.when = trigger(when);
  }
  return row;
}

function raiseWeightBlock(value: PdxItem): unknown {
  const entries = entriesOf(value);
  if (entries === RAW) {
    return RAW;
  }
  const blockValue: Record<string, unknown> = {};
  const modifiers: unknown[] = [];
  for (const entry of entries) {
    if (entry.key === "base" && isScalarKind(entry.value)) {
      blockValue.base = raiseScalar(entry.value);
      continue;
    }
    const member = OPERATION_MEMBER.get(entry.key);
    if (member !== undefined && isScalarKind(entry.value)) {
      blockValue[member] = raiseScalar(entry.value);
      continue;
    }
    if (entry.key === "modifier") {
      const row = raiseModifierRow(entry.value);
      if (row === RAW) {
        return RAW;
      }
      modifiers.push(row);
      continue;
    }
    return RAW; // complex_trigger_modifier / scaled_modifier / anything else
  }
  if (modifiers.length > 0) {
    blockValue.modifiers = modifiers;
  }
  return blockValue;
}

const ECONOMIC_KEYS = ["cost", "produces", "upkeep", "logistics"];

function raiseEconomicBlock(value: PdxItem): unknown {
  const entries = entriesOf(value);
  if (entries === RAW) {
    return RAW;
  }
  const blockValue: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.key === "category" && isScalarKind(entry.value)) {
      blockValue.category = raiseScalar(entry.value);
      continue;
    }
    if (!ECONOMIC_KEYS.includes(entry.key) || blockValue[entry.key] !== undefined) {
      return RAW;
    }
    const opEntries = entriesOf(entry.value);
    if (opEntries === RAW) {
      return RAW;
    }
    const operation: Record<string, unknown> = {};
    const amounts: Record<string, unknown> = {};
    for (const opEntry of opEntries) {
      if (opEntry.key === "trigger") {
        const raisedWhen = raiseTrigger(opEntry.value);
        if (raisedWhen === RAW || operation.when !== undefined) {
          return RAW;
        }
        operation.when = raisedWhen;
      } else if (opEntry.key === "multiplier" || opEntry.key === "mult") {
        if (!isScalarKind(opEntry.value)) {
          return RAW;
        }
        operation[opEntry.key] = raiseScalar(opEntry.value);
      } else if (isScalarKind(opEntry.value)) {
        // `economicOperation` lowers amounts with kv() directly (no
        // scriptValueScalar), so a "@var" string would be defensively quoted —
        // an SDK gap this spike surfaced. Pass the parsed var node through.
        amounts[opEntry.key] =
          opEntry.value.kind === "var" ? opEntry.value : raiseScalar(opEntry.value);
      } else {
        return RAW;
      }
    }
    operation.amounts = amounts;
    blockValue[entry.key] = operation;
  }
  return blockValue;
}

/** Raise a struct body: every entry must land on a declared nested field. */
function raiseStruct(value: PdxItem, fields: readonly ContentField[]): unknown {
  const entries = entriesOf(value);
  if (entries === RAW) {
    return RAW;
  }
  const byKey = new Map<string, PdxEntry[]>();
  for (const entry of entries) {
    const list = byKey.get(entry.key) ?? [];
    list.push(entry);
    byKey.set(entry.key, list);
  }
  const members: Record<string, unknown> = {};
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  for (const [key, occurrences] of byKey) {
    const field = fieldByKey.get(key);
    if (field === undefined) {
      return RAW;
    }
    const raisedMember = raiseField(field, occurrences);
    if (raisedMember === RAW) {
      return RAW;
    }
    members[field.member] = raisedMember;
  }
  return members;
}

function raiseField(field: ContentField, occurrences: readonly PdxEntry[]): unknown {
  switch (field.shape) {
    case "value": {
      const values = occurrences.map((entry) =>
        isScalarKind(entry.value) ? raiseScalar(entry.value) : undefined
      );
      if (values.some((value) => value === undefined)) {
        return RAW;
      }
      return field.repeated ? values : occurrences.length === 1 ? values[0] : RAW;
    }
    case "valueList": {
      if (occurrences.length !== 1) {
        return RAW;
      }
      const value = occurrences[0]!.value;
      if (value.kind !== "container" || value.header !== undefined) {
        return RAW;
      }
      const items = value.items.map((item) => (isScalarKind(item) ? raiseScalar(item) : item));
      return items.some((item) => item === undefined) ? RAW : items;
    }
    case "trigger":
      return occurrences.length === 1 ? raiseTrigger(occurrences[0]!.value) : RAW;
    case "weightBlock":
    case "weightBlockWithLoc": {
      return occurrences.length === 1 ? raiseWeightBlock(occurrences[0]!.value) : RAW;
    }
    case "economicResources":
    case "economicResourcesNoProduce": {
      const blocks = occurrences.map((entry) => raiseEconomicBlock(entry.value));
      if (blocks.some((blockValue) => blockValue === RAW)) {
        return RAW;
      }
      return field.repeated ? blocks : occurrences.length === 1 ? blocks[0] : RAW;
    }
    case "struct":
    case "triggerStruct": {
      const structs = occurrences.map((entry) => raiseStruct(entry.value, field.fields));
      if (structs.some((structValue) => structValue === RAW)) {
        return RAW;
      }
      return field.repeated ? structs : occurrences.length === 1 ? structs[0] : RAW;
    }
    case "dual": {
      for (const arm of field.arms) {
        const raisedArm = raiseField(
          { ...arm, key: field.key, member: field.member } as ContentField,
          occurrences
        );
        if (raisedArm !== RAW) {
          return raisedArm;
        }
      }
      return RAW;
    }
    default:
      return RAW;
  }
}

interface RaisedDefinition {
  readonly registry: string;
  readonly id: string;
  readonly file: string;
  readonly members: Record<string, unknown>;
  readonly carried: PdxEntry[]; // raw-carried + script bodies + unmapped, original order
  readonly outcomes: FieldResult[];
  readonly locName: string | undefined;
}

const raised: RaisedDefinition[] = [];
const uncovered = new Map<string, { files: number; defs: number }>();
let eventFiles = 0;
let eventDefs = 0;
let parseFailures = 0;

for (const file of txtFiles) {
  let items;
  try {
    const doc = parse(file.source, file.rel);
    if (doc.diagnostics.length > 0) {
      console.warn(`repaired: ${file.rel}: ${doc.diagnostics.map((d) => d.kind).join(", ")}`);
    }
    items = doc.items;
  } catch (error) {
    parseFailures += 1;
    console.warn(`parse failure: ${file.rel}: ${(error as Error).message}`);
    continue;
  }

  if (file.rel.startsWith("events/")) {
    eventFiles += 1;
    eventDefs += items.filter(
      (item) => item.kind === "entry" && item.key !== "namespace" && !item.key.startsWith("@")
    ).length;
    continue;
  }

  const descriptors = byOutputDir.get(file.dir);
  if (descriptors === undefined) {
    const bucket = uncovered.get(file.dir) ?? { files: 0, defs: 0 };
    bucket.files += 1;
    bucket.defs += items.filter(
      (item) => item.kind === "entry" && !item.key.startsWith("@")
    ).length;
    uncovered.set(file.dir, bucket);
    continue;
  }

  for (const item of items) {
    if (item.kind !== "entry" || item.key.startsWith("@")) {
      continue;
    }
    // Pick the descriptor: keyed registries match on the keyword, id registries
    // take the (single) un-keyed descriptor for the directory.
    const keyed = descriptors.find((d) => d.keyedBy?.keyword === item.key);
    const plain = descriptors.find((d) => d.keyedBy === undefined);
    const descriptor = keyed ?? plain;
    if (descriptor === undefined || item.value.kind !== "container") {
      continue;
    }
    const body = item.value.items.filter((i): i is PdxEntry => i.kind === "entry");
    const skipped = item.value.items.length - body.length;

    let id = item.key;
    let effectiveBody = body;
    if (descriptor.keyedBy !== undefined) {
      const nameEntry = body.find((entry) => entry.key === descriptor.keyedBy!.nameField);
      if (nameEntry === undefined || !isScalarKind(nameEntry.value)) {
        continue;
      }
      id = String(raiseScalar(nameEntry.value));
      effectiveBody = body.filter((entry) => entry !== nameEntry);
    }

    const byKey = new Map<string, PdxEntry[]>();
    for (const entry of effectiveBody) {
      const list = byKey.get(entry.key) ?? [];
      list.push(entry);
      byKey.set(entry.key, list);
    }

    const members: Record<string, unknown> = {};
    const carried: PdxEntry[] = [];
    const outcomes: FieldResult[] = [];
    const fieldByKey = new Map(descriptor.fields.map((field) => [field.key, field]));

    for (const [key, occurrences] of byKey) {
      const field = fieldByKey.get(key);
      const base = { registry: descriptor.type, key, file: file.rel, id };
      if (field === undefined) {
        outcomes.push({ ...base, shape: undefined, outcome: "unmapped" });
        carried.push(...occurrences);
        continue;
      }
      if (field.shape === "effect") {
        outcomes.push({ ...base, shape: "effect", outcome: "script-carried" });
        carried.push(...occurrences);
        continue;
      }
      const value = raiseField(field, occurrences);
      if (value === RAW) {
        outcomes.push({
          ...base,
          shape: field.shape,
          outcome: field.shape === "trigger" ? "script-carried" : "raw-carried",
        });
        carried.push(...occurrences);
        continue;
      }
      // Parity: lower the raised member back through the SDK's real lowering
      // and compare canonical trees.
      let lowered: PdxEntry[];
      try {
        lowered = fieldEntries({ [field.member]: value }, [field], { path: "", ownerId: id });
      } catch (error) {
        outcomes.push({
          ...base,
          shape: field.shape,
          outcome: "mapped-drift",
          detail: `lowering threw: ${(error as Error).message}`,
        });
        carried.push(...occurrences);
        continue;
      }
      const before = canonical(occurrences);
      const after = canonical(lowered);
      if (before === after) {
        members[field.member] = value;
        outcomes.push({ ...base, shape: field.shape, outcome: "mapped" });
      } else if (canonicalSemantic(occurrences) === canonicalSemantic(lowered)) {
        members[field.member] = value;
        outcomes.push({ ...base, shape: field.shape, outcome: "mapped-reordered" });
      } else {
        outcomes.push({
          ...base,
          shape: field.shape,
          outcome: "mapped-drift",
          detail: `\n--- original\n${before}\n--- relowered\n${after}`,
        });
        carried.push(...occurrences);
      }
    }
    if (skipped > 0) {
      outcomes.push({
        registry: descriptor.type,
        key: "(bare items)",
        shape: undefined,
        outcome: "unmapped",
        file: file.rel,
        id,
      });
    }

    const namePattern = descriptor.localisation.find((slot) => slot.member === "name")?.pattern;
    const locName = namePattern ? locText.get(namePattern.replace("$", id)) : undefined;

    fieldResults.push(...outcomes);
    raised.push({
      registry: descriptor.type,
      id,
      file: file.rel,
      members,
      carried,
      outcomes,
      locName,
    });
  }
}

// ------------------------------------------------------------------ report

function count<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  }
  return new Map([...out.entries()].sort((a, b) => b[1] - a[1]));
}

const coveredDefs = raised.length;
const uncoveredDefs = [...uncovered.values()].reduce((sum, bucket) => sum + bucket.defs, 0);

console.log(`\n=== INVENTORY (${MOD_DIR.split("/").pop()}) ===`);
console.log(`script files parsed: ${txtFiles.length}, parse failures: ${parseFailures}`);
console.log(`events: ${eventFiles} files, ${eventDefs} events (no registry surface yet)`);
console.log(`covered definitions (manifest registries): ${coveredDefs}`);
console.log(`uncovered definitions: ${uncoveredDefs}`);
for (const [dir, bucket] of [...uncovered.entries()].sort((a, b) => b[1].defs - a[1].defs)) {
  console.log(`  ${dir}: ${bucket.files} files, ${bucket.defs} defs`);
}

console.log(`\n=== COVERED DEFINITIONS BY REGISTRY ===`);
for (const [registry, n] of count(raised, (d) => d.registry)) {
  console.log(`  ${registry}: ${n}`);
}

console.log(`\n=== FIELD OUTCOMES (${fieldResults.length} field groups) ===`);
for (const [outcome, n] of count(fieldResults, (r) => r.outcome)) {
  console.log(`  ${outcome}: ${n} (${((100 * n) / fieldResults.length).toFixed(1)}%)`);
}

console.log(`\n=== RAW-CARRIED BY SHAPE ===`);
for (const [shape, n] of count(
  fieldResults.filter((r) => r.outcome === "raw-carried"),
  (r) => `${r.shape}`
)) {
  console.log(`  ${shape}: ${n}`);
}

console.log(`\n=== UNMAPPED KEYS (top 15) ===`);
for (const [key, n] of [
  ...count(
    fieldResults.filter((r) => r.outcome === "unmapped"),
    (r) => `${r.registry}.${r.key}`
  ),
].slice(0, 15)) {
  console.log(`  ${key}: ${n}`);
}

const drift = fieldResults.filter((r) => r.outcome === "mapped-drift");
console.log(`\n=== MAPPED-DRIFT (${drift.length}) ===`);
for (const [key, n] of count(drift, (r) => `${r.registry}.${r.key} [${r.shape}]`)) {
  console.log(`  ${key}: ${n}`);
}
for (const example of drift.slice(0, 5)) {
  console.log(
    `\n  ${example.registry} ${example.id} (${example.file}) ${example.key}:${example.detail}`
  );
}

const fullyTyped = raised.filter((d) =>
  d.outcomes.every(
    (o) =>
      o.outcome === "mapped" || o.outcome === "mapped-reordered" || o.outcome === "script-carried"
  )
);
const withName = raised.filter((d) => d.locName !== undefined);
console.log(`\n=== DEFINITION-LEVEL SUMMARY ===`);
console.log(
  `fully representable (typed members + lossless script bodies): ${fullyTyped.length}/${coveredDefs}`
);
console.log(`definitions with recovered English name text: ${withName.length}/${coveredDefs}`);

mkdirSync(join(MOD_DIR, "..").length > 0 ? "spike/out" : "spike/out", { recursive: true });
writeFileSync(
  "spike/out/field-results.json",
  JSON.stringify(
    fieldResults.map(({ detail, ...rest }) => rest),
    null,
    2
  )
);

// ------------------------------------------- sample emitted TypeScript

function tsLiteral(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(tsLiteral).join(", ")}]`;
  }
  if ((typeof value === "object" || typeof value === "function") && value !== null) {
    if ((value as { kind?: string }).kind === "trigger") {
      const entries = (value as { entries: PdxEntry[] }).entries;
      const body = serialize(entries).replace(/`/g, "\\`").trimEnd().split("\n").join("\n    ");
      return `rawTrigger(\`\n    ${body}\`)`;
    }
    if ((value as { kind?: string }).kind !== undefined) {
      return `rawItem(\`${serialize([value as PdxItem])
        .trim()
        .replace(/`/g, "\\`")}\`)`;
    }
    const record = value as Record<string, unknown>;
    const inner = Object.entries(record)
      .map(([member, memberValue]) => `${member}: ${tsLiteral(memberValue)}`)
      .join(", ");
    return `{ ${inner} }`;
  }
  return JSON.stringify(value);
}

function emitDefinition(def: RaisedDefinition): string {
  const lines: string[] = [];
  const method = def.registry.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  lines.push(
    `export const ${def.id.replace(/[^a-zA-Z0-9_$]/g, "_")} = mod.${method}(${JSON.stringify(def.id)}, {`
  );
  if (def.locName !== undefined) {
    lines.push(`  name: ${JSON.stringify(def.locName)},`);
  }
  for (const [member, value] of Object.entries(def.members)) {
    lines.push(`  ${member}: ${tsLiteral(value)},`);
  }
  if (def.carried.length > 0) {
    lines.push(`  // Carried as raw PDXScript — no typed surface (yet) for these:`);
    lines.push(`  ...raw(\`\n${serialize(def.carried).replace(/`/g, "\\`")}\`),`);
  }
  lines.push(`});`);
  return lines.join("\n");
}

const sampleSource = raised.find((d) => d.registry === "technology")?.file ?? raised[0]?.file;
const sampleFile = raised.filter((d) => d.file === sampleSource).slice(0, 6);
if (sampleFile.length > 0) {
  const sample = [
    `// Generated by the import spike from ${sampleFile[0]!.file}`,
    `// (illustrative output — raw()/rawTrigger()/rawItem() are proposed escape hatches)`,
    ``,
    ...sampleFile.map(emitDefinition),
  ].join("\n\n");
  writeFileSync("spike/out/sample.generated.ts.txt", sample);
  console.log(
    `\nsample TypeScript written to spike/out/sample.generated.ts.txt (${sampleFile[0]!.file})`
  );
}
