/**
 * Emits one builder per trigger.
 *
 * Argument shapes and scopes both come from the `.cwt` rules, which annotate
 * `## scopes` on all but five trigger declarations. The game's doc dump supplies
 * the usage examples, covers those five, and stays the cross-check. A trigger
 * with no scope in either source is skipped and reported, never guessed at.
 */

import { isOptional } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import type { DocEntry } from "../logs/trigger-docs.ts";
import type { LoweredRule } from "../lowered-rule.ts";
import { camelCase, docComment, isPlainName, pascalCase, safeIdentifier } from "../naming.ts";
import { HAND_WRITTEN_TRIGGER_RULES_BY_KEY } from "../trigger-policy.ts";
import { mergeFields, type ArgField, type ClauseCategory, type SkippedRule } from "./shape.ts";
import { Emitter, type TsValue } from "./types.ts";

const TRIGGER_CLAUSES = new Set<ClauseCategory>(["trigger"]);

export interface TriggerEmission {
  readonly code: string;
  readonly emitted: number;
  readonly byShape: ReadonlyMap<string, number>;
  readonly skipped: readonly SkippedRule[];
  /** Every emitted function name, for the scope-link collision guard. */
  readonly names: ReadonlySet<string>;
}

type Shape =
  | { readonly kind: "bool" }
  | { readonly kind: "comparison" }
  | { readonly kind: "value"; readonly value: TsValue }
  /** A block whose entire content is a nested trigger, i.e. a scope change. */
  | { readonly kind: "wrapper"; readonly scope: string }
  | { readonly kind: "fields"; readonly fields: readonly ArgField[] };

function shapeOf(emitter: Emitter, rule: LoweredRule): Shape | string {
  if (rule.comparison) {
    return { kind: "comparison" };
  }
  if (rule.blocks.length === 0) {
    const value = emitter.unionFor(rule.scalars.map((declaration) => declaration.type));
    if (value === null) {
      return `unsupported value type (${rule.scalars.map((d) => d.type.kind).join(", ")})`;
    }
    return rule.scalars.every((declaration) => declaration.type.kind === "bool")
      ? { kind: "bool" }
      : { kind: "value", value };
  }
  if (rule.declarations.length > 1) {
    return "overloaded between a block and a scalar";
  }
  const block = rule.blocks[0]!;
  const body = block.type;
  if (body.bare.length > 0) {
    return "block with bare values";
  }
  const splices = block.splices;
  const named = block.named;
  const pushedRaw = block.inheritedScope;

  if (splices.length > 0) {
    const categories = new Set(
      splices.map((splice) => (splice.key.kind === "aliasName" ? splice.key.category : ""))
    );
    if (categories.size !== 1 || !categories.has("trigger")) {
      return `splices a category the emitter cannot type (${[...categories].sort().join(", ")})`;
    }
    if (named.length === 0) {
      if (pushedRaw === null) {
        return "scope change with no push_scope annotation";
      }
      const scope = emitter.canonicalScope(pushedRaw);
      return scope === null
        ? `push_scope names no known scope (${pushedRaw})`
        : { kind: "wrapper", scope };
    }
    // A splice alongside named fields (`calc_true_if = { amount == int ... }`):
    // the splice becomes an implicit `conditions` clause argument.
    const fields = mergeFields(emitter, named, pushedRaw, TRIGGER_CLAUSES);
    if (typeof fields === "string") {
      return fields;
    }
    if (fields.some((field) => field.name === "conditions")) {
      return 'a rule field is already named "conditions"';
    }
    let scope: string | null = null;
    if (pushedRaw !== null) {
      scope = emitter.canonicalScope(pushedRaw);
      if (scope === null) {
        return `push_scope names no known scope (${pushedRaw})`;
      }
    }
    return {
      kind: "fields",
      fields: [
        ...fields,
        {
          name: "conditions",
          value: { kind: "clause", category: "trigger", scope, splice: true },
          optional: splices.every((splice) => isOptional(splice.cardinality)),
          docs: [],
        },
      ],
    };
  }

  const fields = mergeFields(emitter, named, pushedRaw, TRIGGER_CLAUSES);
  if (typeof fields === "string") {
    return fields;
  }
  if (fields.length === 0) {
    return "block with no typeable fields";
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

/**
 * The expression a scalar `TsValue` pushes into `kv()`, `scriptValueScalar`-
 * wrapped when the value is a `ScriptValue` (see `TsValue.scriptValue`) so a
 * `@name` input becomes a `var` node rather than a defensively-quoted string.
 */
function pushExpr(value: TsValue, expr: string): string {
  const scalar = value.toScalar(expr);
  return value.scriptValue === true ? `scriptValueScalar(${scalar})` : scalar;
}

function emitValue(fn: string, key: string, scope: string, docs: string[], value: TsValue): string {
  const signature =
    docComment(docs) + `export function ${fn}(value: ${value.type}): Trigger<${scope}> {\n`;
  if (value.refTypes === undefined) {
    return (
      signature +
      `  return trigger([kv(${JSON.stringify(key)}, ${pushExpr(value, "value")})]);\n}\n`
    );
  }
  // The id is bound once and both written and recorded, so the emitted entry
  // and the reference the build checks can never drift apart.
  return (
    signature +
    `  const id = ${value.toScalar("value")};\n` +
    `  return trigger([kv(${JSON.stringify(key)}, id)], ` +
    `[{ targets: ${JSON.stringify(value.refTypes)}, id, field: ${JSON.stringify(key)} }]);\n}\n`
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
    `  return trigger([block(${JSON.stringify(key)}, [...condition.entries])], ` +
    `[...condition.refs]);\n}\n`
  );
}

function memberType(field: ArgField, outerScope: string): string {
  const value = field.value;
  switch (value.kind) {
    case "scalar":
      return value.value.type;
    case "clause":
      return `Trigger<${value.scope === null ? outerScope : JSON.stringify(value.scope)}>`;
    case "comparison": {
      const literals = value.literals.map((literal) => JSON.stringify(literal));
      return ["number", "readonly [PdxOp, number]", ...literals].join(" | ");
    }
  }
}

/** Whether this field can put a content reference into the emitted tree: a
 * whole-reference scalar directly, a nested condition through its own refs. */
function contributesRefs(field: ArgField): boolean {
  if (field.value.kind === "clause") {
    return true;
  }
  return field.value.kind === "scalar" && field.value.value.refTypes !== undefined;
}

function pushCode(field: ArgField, access: string, owner: string, index: number): string {
  const key = JSON.stringify(field.name);
  switch (field.value.kind) {
    case "scalar": {
      const { refTypes } = field.value.value;
      if (refTypes === undefined) {
        return `entries.push(kv(${key}, ${pushExpr(field.value.value, access)}));`;
      }
      // Indexed rather than named after the field, so the local can never
      // collide with `args`, `entries`, `refs`, or a sibling field's name.
      const local = `id${index}`;
      const field_ = JSON.stringify(`${owner}.${field.name}`);
      return (
        `const ${local} = ${field.value.value.toScalar(access)};\n` +
        `    entries.push(kv(${key}, ${local}));\n` +
        `    refs.push({ targets: ${JSON.stringify(refTypes)}, id: ${local}, field: ${field_} });`
      );
    }
    case "clause":
      return (
        (field.value.splice
          ? `entries.push(...${access}.entries);\n`
          : `entries.push(block(${key}, [...${access}.entries]));\n`) +
        `    refs.push(...${access}.refs);`
      );
    case "comparison":
      return (
        `entries.push(typeof ${access} === "object" ` +
        `? cmp(${key}, ${access}[0], ${access}[1]) : kv(${key}, ${access}));`
      );
  }
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
        `  ${camelCase(field.name)}${field.optional ? "?" : ""}: ${memberType(field, scope)};\n`
    )
    .join("");
  const pushes = fields
    .map((field, index) => {
      const access = `args.${camelCase(field.name)}`;
      const push = `    ${pushCode(field, access, key, index)}\n`;
      return field.optional ? `  if (${access} !== undefined) {\n${push}  }\n` : push.slice(2);
    })
    .join("");
  const withRefs = fields.some(contributesRefs);
  return (
    `export interface ${name} {\n${members}}\n\n` +
    docComment(docs) +
    `export function ${fn}(args: ${name}): Trigger<${scope}> {\n` +
    `  const entries: PdxEntry[] = [];\n` +
    (withRefs ? `  const refs: ContentRefUse[] = [];\n` : "") +
    pushes +
    `  return trigger([block(${JSON.stringify(key)}, entries)]${withRefs ? ", refs" : ""});\n}\n`
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
  rules: ReadonlyMap<string, LoweredRule>
): TriggerEmission {
  const skipped: SkippedRule[] = [];
  const byShape = new Map<string, number>();
  const chunks: string[] = [];
  const names = new Set<string>();
  let emitted = 0;

  for (const key of [...rules.keys()].sort()) {
    const rule = rules.get(key)!;
    const declarations = rule.declarations;
    const handWritten = HAND_WRITTEN_TRIGGER_RULES_BY_KEY.get(key.toLowerCase());
    if (handWritten !== undefined) {
      skipped.push({
        name: key,
        reason: `hand-written ${handWritten.kind}: ${handWritten.reason}`,
      });
      continue;
    }
    if (!isPlainName(key)) {
      skipped.push({ name: key, reason: "not a plain rule name" });
      continue;
    }
    const doc = docs.get(key);
    // The rules are authoritative where they carry `## scopes`; the dump is the
    // fallback for the handful of rules that do not, and stays the cross-check.
    if (rule.supportedScopes.length === 0) {
      skipped.push({ name: key, reason: "no scopes in either the rules or the game's dump" });
      continue;
    }
    const scope = rule.scopeType;
    if (scope === null) {
      skipped.push({ name: key, reason: `unknown scope in ${rule.supportedScopes.join(" ")}` });
      continue;
    }
    const shape = shapeOf(emitter, rule);
    if (typeof shape === "string") {
      skipped.push({ name: key, reason: shape });
      continue;
    }
    chunks.push(emitOne(key, shape, scope, tsDoc(declarations, doc)));
    names.add(safeIdentifier(camelCase(key)));
    byShape.set(shape.kind, (byShape.get(shape.kind) ?? 0) + 1);
    emitted += 1;
  }

  return { code: chunks.join("\n"), emitted, byShape, skipped, names };
}
