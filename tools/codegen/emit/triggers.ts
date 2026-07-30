/**
 * Emits one builder per trigger.
 *
 * Argument shapes and scopes both come from the `.cwt` rules, which annotate
 * `## scopes` on all but five trigger declarations. The game's doc dump supplies
 * the usage examples, covers those five, and stays the cross-check. A trigger
 * with no scope in either source is skipped and reported, never guessed at.
 */

import { isOptional, type RuleField, type RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import type { DocEntry } from "../logs/trigger-docs.ts";
import { camelCase, docComment, isPlainName, pascalCase, safeIdentifier } from "../naming.ts";
import { HAND_WRITTEN_TRIGGERS, UNIVERSAL_SCOPES } from "../overlay.ts";
import { Emitter, type TsValue } from "./types.ts";

export interface SkippedTrigger {
  readonly name: string;
  readonly reason: string;
}

export interface TriggerEmission {
  readonly code: string;
  readonly emitted: number;
  readonly byShape: ReadonlyMap<string, number>;
  readonly skipped: readonly SkippedTrigger[];
}

interface ArgField {
  readonly name: string;
  readonly value: TsValue;
  readonly optional: boolean;
  readonly docs: readonly string[];
}

type Shape =
  | { readonly kind: "bool" }
  | { readonly kind: "comparison" }
  | { readonly kind: "value"; readonly value: TsValue }
  /** A block whose entire content is a nested trigger, i.e. a scope change. */
  | { readonly kind: "wrapper"; readonly scope: string }
  | { readonly kind: "fields"; readonly fields: readonly ArgField[] };

function scopeType(scopes: readonly string[], index: ReadonlyMap<string, string>): string | null {
  if (scopes.some((scope) => UNIVERSAL_SCOPES.has(scope))) {
    return "ScopeName";
  }
  const canonical = scopes.map((scope) => index.get(scope));
  if (canonical.some((scope) => scope === undefined)) {
    return null;
  }
  return [...new Set(canonical as string[])]
    .sort()
    .map((scope) => JSON.stringify(scope))
    .join(" | ");
}

/** Merges the repeated keys an overloaded rule produces into one field each. */
function mergeFields(emitter: Emitter, fields: readonly RuleField[]): ArgField[] | null {
  const grouped = new Map<string, { types: RuleType[]; optional: boolean; docs: string[] }>();
  for (const field of fields) {
    if (field.key.kind !== "name") {
      return null;
    }
    const existing = grouped.get(field.key.name);
    if (existing === undefined) {
      grouped.set(field.key.name, {
        types: [field.type],
        optional: isOptional(field.cardinality),
        docs: [...field.docs],
      });
      continue;
    }
    existing.types.push(field.type);
    existing.optional ||= isOptional(field.cardinality);
    existing.docs.push(...field.docs);
  }
  const merged: ArgField[] = [];
  for (const [name, group] of grouped) {
    const value = emitter.unionFor(group.types);
    if (value === null) {
      return null;
    }
    merged.push({ name, value, optional: group.optional, docs: group.docs });
  }
  return merged;
}

function shapeOf(emitter: Emitter, declarations: readonly AliasDecl[]): Shape | string {
  if (declarations.some((declaration) => declaration.comparison)) {
    return { kind: "comparison" };
  }
  const blocks = declarations.filter((declaration) => declaration.type.kind === "block");
  if (blocks.length === 0) {
    const value = emitter.unionFor(declarations.map((declaration) => declaration.type));
    if (value === null) {
      return `unsupported value type (${declarations.map((d) => d.type.kind).join(", ")})`;
    }
    return declarations.every((declaration) => declaration.type.kind === "bool")
      ? { kind: "bool" }
      : { kind: "value", value };
  }
  if (declarations.length > 1) {
    return "overloaded between a block and a scalar";
  }
  const declaration = blocks[0]!;
  const body = declaration.type;
  if (body.kind !== "block") {
    return "unreachable";
  }
  const splices = body.fields.filter((field) => field.key.kind === "aliasName");
  if (splices.length > 0) {
    if (body.fields.length > splices.length || body.bare.length > 0) {
      return "scope change with extra rule fields";
    }
    const pushed = declaration.scope?.this;
    if (pushed === undefined || pushed === null) {
      return "scope change with no push_scope annotation";
    }
    const scope = emitter.canonicalScope(pushed);
    return scope === null
      ? `push_scope names no known scope (${pushed})`
      : { kind: "wrapper", scope };
  }
  const fields = mergeFields(emitter, body.fields);
  if (fields === null || fields.length === 0 || body.bare.length > 0) {
    return "block with rule fields the emitter cannot type";
  }
  return { kind: "fields", fields };
}

function tsDoc(declarations: readonly AliasDecl[], doc: DocEntry | undefined): string[] {
  const summary = declarations.flatMap((declaration) => declaration.docs)[0] ?? doc?.summary ?? "";
  const lines = [summary];
  if (doc !== undefined && doc.usage !== "") {
    lines.push("", "```", ...doc.usage.split("\n"), "```");
  }
  return lines;
}

function emitBoolean(fn: string, key: string, scope: string, docs: string[]): string {
  return (
    docComment(docs) +
    `export function ${fn}(value: boolean = true): Trigger<${scope}> {\n` +
    `  return trigger([kv(${JSON.stringify(key)}, value)]);\n}\n`
  );
}

function emitComparison(fn: string, key: string, scope: string, docs: string[]): string {
  return (
    docComment(docs) +
    `export function ${fn}(op: PdxOp, value: number): Trigger<${scope}> {\n` +
    `  return trigger([cmp(${JSON.stringify(key)}, op, value)]);\n}\n`
  );
}

function emitValue(fn: string, key: string, scope: string, docs: string[], value: TsValue): string {
  return (
    docComment(docs) +
    `export function ${fn}(value: ${value.type}): Trigger<${scope}> {\n` +
    `  return trigger([kv(${JSON.stringify(key)}, ${value.toScalar("value")})]);\n}\n`
  );
}

function emitWrapper(
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  inner: string
): string {
  return (
    docComment(docs) +
    `export function ${fn}(condition: Trigger<${JSON.stringify(inner)}>): Trigger<${scope}> {\n` +
    `  return trigger([block(${JSON.stringify(key)}, [...condition.entries])]);\n}\n`
  );
}

function emitFields(
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  fields: readonly ArgField[]
): string {
  const name = `${pascalCase(key)}Args`;
  const members = fields
    .map(
      (field) =>
        docComment(field.docs, "  ") +
        `  ${camelCase(field.name)}${field.optional ? "?" : ""}: ${field.value.type};\n`
    )
    .join("");
  const pushes = fields
    .map((field) => {
      const access = `args.${camelCase(field.name)}`;
      const push = `    entries.push(kv(${JSON.stringify(field.name)}, ${field.value.toScalar(access)}));\n`;
      return field.optional ? `  if (${access} !== undefined) {\n  ${push}  }\n` : push.slice(2);
    })
    .join("");
  return (
    `export interface ${name} {\n${members}}\n\n` +
    docComment(docs) +
    `export function ${fn}(args: ${name}): Trigger<${scope}> {\n` +
    `  const entries: PdxEntry[] = [];\n${pushes}` +
    `  return trigger([block(${JSON.stringify(key)}, entries)]);\n}\n`
  );
}

function emitOne(key: string, shape: Shape, scope: string, docs: string[]): string {
  const fn = safeIdentifier(camelCase(key));
  switch (shape.kind) {
    case "bool":
      return emitBoolean(fn, key, scope, docs);
    case "comparison":
      return emitComparison(fn, key, scope, docs);
    case "value":
      return emitValue(fn, key, scope, docs, shape.value);
    case "wrapper":
      return emitWrapper(fn, key, scope, docs, shape.scope);
    case "fields":
      return emitFields(fn, key, scope, docs, shape.fields);
  }
}

export function emitTriggers(
  emitter: Emitter,
  docs: ReadonlyMap<string, DocEntry>,
  scopeIndex: ReadonlyMap<string, string>
): TriggerEmission {
  const skipped: SkippedTrigger[] = [];
  const byShape = new Map<string, number>();
  const chunks: string[] = [];
  let emitted = 0;

  for (const key of [...emitter.rules.triggers.keys()].sort()) {
    const declarations = emitter.rules.triggers.get(key)!;
    if (HAND_WRITTEN_TRIGGERS.has(key.toLowerCase())) {
      skipped.push({ name: key, reason: "hand-written combinator" });
      continue;
    }
    if (!isPlainName(key)) {
      skipped.push({ name: key, reason: "not a plain rule name" });
      continue;
    }
    const doc = docs.get(key);
    // The rules are authoritative where they carry `## scopes`; the dump is the
    // fallback for the handful of rules that do not, and stays the cross-check.
    const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
    const supported = declared.length > 0 ? declared : (doc?.scopes ?? []);
    if (supported.length === 0) {
      skipped.push({ name: key, reason: "no scopes in either the rules or the game's dump" });
      continue;
    }
    const scope = scopeType(supported, scopeIndex);
    if (scope === null) {
      skipped.push({ name: key, reason: `unknown scope in ${supported.join(" ")}` });
      continue;
    }
    const shape = shapeOf(emitter, declarations);
    if (typeof shape === "string") {
      skipped.push({ name: key, reason: shape });
      continue;
    }
    chunks.push(emitOne(key, shape, scope, tsDoc(declarations, doc)));
    byShape.set(shape.kind, (byShape.get(shape.kind) ?? 0) + 1);
    emitted += 1;
  }

  return { code: chunks.join("\n"), emitted, byShape, skipped };
}
