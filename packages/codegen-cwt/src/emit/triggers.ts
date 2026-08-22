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
import {
  camelCase,
  docComment,
  isPlainName,
  pascalCase,
  propertyAccess,
  propertyName,
  safeIdentifier,
} from "../naming.ts";
import { TRIGGER_DOC_SUMMARY_OVERRIDES } from "../overlay.ts";
import { HAND_WRITTEN_TRIGGER_RULES_BY_KEY } from "../trigger-policy.ts";
import {
  bareBlockValue,
  cardinalityArrayType,
  comparisonValue,
  mergeFields,
  skippedRule,
  skipReason,
  type ArgField,
  type ArgValue,
  type ClauseCategory,
  type SkippedRule,
  type SkipReason,
} from "./shape.ts";
import { Emitter, type TsValue } from "./types.ts";
import { member as renderMember } from "./writer.ts";

const TRIGGER_CLAUSES = new Set<ClauseCategory>(["trigger"]);

export interface TriggerEmission {
  readonly code: string;
  readonly emitted: number;
  readonly byShape: ReadonlyMap<string, number>;
  readonly skipped: readonly SkippedRule[];
  readonly docOverrides: readonly string[];
  /** Every emitted function name, for the scope-link collision guard. */
  readonly names: ReadonlySet<string>;
}

type Shape =
  | { readonly kind: "bool" }
  | { readonly kind: "comparison"; readonly value: TsValue }
  | { readonly kind: "value"; readonly value: TsValue }
  | {
      readonly kind: "valueList";
      readonly value: Extract<ArgValue, { readonly kind: "valueList" }>;
    }
  /** A localisation scalar or a typed trigger block, dispatched by `typeof`. */
  | { readonly kind: "stringOrFields"; readonly fields: readonly ArgField[] }
  /** A block whose entire content is a nested trigger, i.e. a scope change. */
  | { readonly kind: "wrapper"; readonly scope: string }
  | { readonly kind: "fields"; readonly fields: readonly ArgField[] };

function shapeOf(emitter: Emitter, rule: LoweredRule): Shape | SkipReason {
  if (rule.comparison) {
    const value = comparisonValue(
      emitter,
      rule.declarations
        .filter((declaration) => declaration.comparison)
        .map((declaration) => declaration.type)
    );
    return "category" in value ? value : { kind: "comparison", value };
  }
  if (rule.blocks.length === 0) {
    const value = emitter.unionFor(rule.scalars.map((declaration) => declaration.type));
    if (value === null) {
      return skipReason(
        "unsupported-value",
        `unsupported value type (${rule.scalars.map((d) => d.type.kind).join(", ")})`
      );
    }
    return rule.scalars.every((declaration) => declaration.type.kind === "bool")
      ? { kind: "bool" }
      : { kind: "value", value };
  }
  if (rule.blocks.length > 1) {
    return skipReason("multiple-block-forms", "overloaded between multiple block forms");
  }
  if (
    rule.scalars.length > 0 &&
    !rule.scalars.every((declaration) => declaration.type.kind === "localisation")
  ) {
    return skipReason(
      "scalar-block-overload",
      "overloaded between a block and a non-localisation scalar"
    );
  }
  const block = rule.blocks[0]!;
  const body = block.type;
  if (body.bare.length > 0) {
    if (body.fields.length > 0) {
      return skipReason("bare-value-block", "block mixes bare values with named fields");
    }
    const value = bareBlockValue(emitter, body.bare, block.inheritedScope, TRIGGER_CLAUSES);
    if ("detail" in value) {
      return value;
    }
    return value.kind === "valueList"
      ? { kind: "valueList", value }
      : skipReason("unsupported-clause", "top-level bare block contains a clause");
  }
  const splices = block.splices;
  const named = block.named;
  const pushedRaw = block.inheritedScope;

  if (splices.length > 0) {
    const categories = new Set(
      splices.map((splice) => (splice.key.kind === "aliasName" ? splice.key.category : ""))
    );
    if (categories.size !== 1 || !categories.has("trigger")) {
      return skipReason(
        "unsupported-alias-splice",
        `splices a category the emitter cannot type (${[...categories].sort().join(", ")})`
      );
    }
    if (named.length === 0) {
      if (pushedRaw === null) {
        return skipReason("missing-push-scope", "scope change with no push_scope annotation");
      }
      const scope = emitter.canonicalScope(pushedRaw);
      return scope === null
        ? skipReason("unknown-push-scope", `push_scope names no known scope (${pushedRaw})`)
        : { kind: "wrapper", scope };
    }
    // A splice alongside named fields (`calc_true_if = { amount == int ... }`):
    // the splice becomes an implicit `conditions` clause argument.
    const fields = mergeFields(emitter, named, pushedRaw, TRIGGER_CLAUSES);
    if (!Array.isArray(fields)) {
      return fields;
    }
    if (fields.some((field) => field.name === "conditions")) {
      return skipReason("reserved-field-collision", 'a rule field is already named "conditions"');
    }
    let scope: string | null = null;
    if (pushedRaw !== null) {
      scope = emitter.canonicalScope(pushedRaw);
      if (scope === null) {
        return skipReason("unknown-push-scope", `push_scope names no known scope (${pushedRaw})`);
      }
    }
    const shape: Shape = {
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
    return stringOrFields(rule, shape);
  }

  const fields = mergeFields(emitter, named, pushedRaw, TRIGGER_CLAUSES);
  if (!Array.isArray(fields)) {
    return fields;
  }
  if (fields.length === 0) {
    return skipReason("empty-block", "block with no typeable fields");
  }
  return stringOrFields(rule, { kind: "fields", fields });
}

/**
 * Localisation scalars and blocks can share one export because `typeof`
 * separates their authored forms at runtime. Other scalar/block combinations
 * remain visible skips rather than receiving an unsound object dispatch.
 */
function stringOrFields(
  rule: LoweredRule,
  shape: Extract<Shape, { readonly kind: "fields" }>
): Shape {
  if (rule.scalars.length === 0) {
    return shape;
  }
  return { kind: "stringOrFields", fields: shape.fields };
}

export function tsDoc(declarations: readonly AliasDecl[], doc: DocEntry | undefined): string[] {
  const summary = declarations.flatMap((declaration) => declaration.docs)[0] ?? doc?.summary ?? "";
  const lines = [summary];
  if (doc !== undefined && doc.usage !== "") {
    lines.push("", "```", ...doc.usage.split("\n"), "```");
  }
  return lines;
}

function emitBoolean(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[]
): string {
  return (
    docComment(docs) +
    `export function ${fn}(value: boolean = true): ${emitter.use("Trigger")}<${scope}> {\n` +
    `  return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, ` +
    `value)]);\n}\n`
  );
}

function emitComparison(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  value: TsValue
): string {
  return (
    docComment(docs) +
    `export function ${fn}(op: ${emitter.use("PdxOp")}, ` +
    `value: ${emitter.useValue(value).type}): ${emitter.use("Trigger")}<${scope}> {\n` +
    `  return ${emitter.use("trigger")}([${emitter.use("cmp")}(${JSON.stringify(key)}, op, ` +
    `${pushExpr(emitter, value, "value")})]);\n}\n`
  );
}

/**
 * The expression a scalar `TsValue` pushes into `kv()`, `scriptValueScalar`-
 * wrapped when the value is a `ScriptValue` (see `TsValue.scriptValue`) so a
 * `@name` input becomes a `var` node rather than a defensively-quoted string.
 */
function pushExpr(emitter: Emitter, value: TsValue, expr: string): string {
  if (value.scalarSymbol !== undefined) {
    emitter.use(value.scalarSymbol);
  }
  const scalar = value.toScalar(expr);
  return value.scriptValue === true ? `${emitter.use("scriptValueScalar")}(${scalar})` : scalar;
}

function emitValue(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  value: TsValue
): string {
  const signature =
    docComment(docs) +
    `export function ${fn}(value: ${emitter.useValue(value).type}): ` +
    `${emitter.use("Trigger")}<${scope}> {\n`;
  if (value.refTypes === undefined) {
    return (
      signature +
      `  return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, ` +
      `${pushExpr(emitter, value, "value")})]);\n}\n`
    );
  }
  // The id is bound once and both written and recorded, so the emitted entry
  // and the reference the build checks can never drift apart.
  if (value.scalarSymbol !== undefined) {
    emitter.use(value.scalarSymbol);
  }
  return (
    signature +
    `  const id = ${value.toScalar("value")};\n` +
    `  return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, id)], ` +
    `[{ targets: ${JSON.stringify(value.refTypes)}, id, field: ${JSON.stringify(key)} }]);\n}\n`
  );
}

function emitWrapper(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  inner: string
): string {
  const type = emitter.use("Trigger");
  return (
    docComment(docs) +
    `export function ${fn}(condition: ${type}<${JSON.stringify(inner)}>): ${type}<${scope}> {\n` +
    `  return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
    `[...condition.entries])], [...condition.refs]);\n}\n`
  );
}

function memberType(emitter: Emitter, field: ArgField, outerScope: string): string {
  const value = field.value;
  switch (value.kind) {
    case "scalar":
      return emitter.useValue(value.value).type;
    case "fields":
      return `{ ${value.fields.map((nested) => `${camelCase(nested.name)}${nested.optional ? "?" : ""}: ${memberType(emitter, nested, outerScope)}`).join("; ")} }`;
    case "scalarOrFields":
      return `${emitter.useValue(value.scalar).type} | { ${value.fields.map((nested) => `${camelCase(nested.name)}${nested.optional ? "?" : ""}: ${memberType(emitter, nested, outerScope)}`).join("; ")} }`;
    case "valueList":
      return valueListType(emitter, value, outerScope);
    case "clause":
      return `${emitter.use("Trigger")}<${value.scope === null ? outerScope : JSON.stringify(value.scope)}>`;
    case "comparison": {
      const literals = value.literals.map((literal) => JSON.stringify(literal));
      const scalar = emitter.useValue(value.value).type;
      return [scalar, `readonly [${emitter.use("PdxOp")}, ${scalar}]`, ...literals].join(" | ");
    }
  }
}

function valueListType(
  emitter: Emitter,
  value: Extract<ArgValue, { readonly kind: "valueList" }>,
  outerScope: string
): string {
  const arms = [
    value.scalar === null ? undefined : emitter.useValue(value.scalar).type,
    value.fields === null
      ? null
      : `{ ${value.fields.map((field) => `${propertyName(camelCase(field.name))}${field.optional ? "?" : ""}: ${memberType(emitter, field, outerScope)}`).join("; ")} }`,
  ].filter((arm): arm is string => arm !== null && arm !== undefined);
  const item = arms.length === 1 && !arms[0]!.includes(" | ") ? arms[0]! : `(${arms.join(" | ")})`;
  return cardinalityArrayType(item, value.cardinality);
}

/** Whether this field can put a content reference into the emitted tree: a
 * whole-reference scalar directly, a nested condition through its own refs. */
function contributesRefs(field: ArgField): boolean {
  if (field.value.kind === "clause") {
    return true;
  }
  if (field.value.kind === "scalar") {
    return field.value.value.refTypes !== undefined;
  }
  if (field.value.kind === "valueList") {
    return (
      field.value.scalar?.refTypes !== undefined ||
      (field.value.fields?.some(contributesRefs) ?? false)
    );
  }
  return (
    (field.value.kind === "fields" || field.value.kind === "scalarOrFields") &&
    field.value.fields.some(contributesRefs)
  );
}

function pushCode(
  emitter: Emitter,
  field: ArgField,
  access: string,
  owner: string,
  index: number,
  sink = "entries"
): string {
  const key = JSON.stringify(field.name);
  switch (field.value.kind) {
    case "scalar": {
      const { refTypes } = field.value.value;
      if (refTypes === undefined) {
        return (
          `${sink}.push(${emitter.use("kv")}(${key}, ` +
          `${pushExpr(emitter, field.value.value, access)}));`
        );
      }
      // Indexed rather than named after the field, so the local can never
      // collide with `args`, `entries`, `refs`, or a sibling field's name.
      const local = `id${index}`;
      const field_ = JSON.stringify(`${owner}.${field.name}`);
      if (field.value.value.scalarSymbol !== undefined) {
        emitter.use(field.value.value.scalarSymbol);
      }
      return (
        `const ${local} = ${field.value.value.toScalar(access)};\n` +
        `    ${sink}.push(${emitter.use("kv")}(${key}, ${local}));\n` +
        `    refs.push({ targets: ${JSON.stringify(refTypes)}, id: ${local}, field: ${field_} });`
      );
    }
    case "scalarOrFields": {
      const nested = field.value.fields
        .map((nestedField, nestedIndex) => {
          const nestedAccess = propertyAccess(access, camelCase(nestedField.name));
          const code = pushCode(
            emitter,
            nestedField,
            nestedAccess,
            `${owner}.${field.name}`,
            nestedIndex,
            "nestedEntries"
          );
          return nestedField.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
        })
        .join("\n");
      return (
        `if (${emitter.use("isStructuredValue")}(${access}, ${JSON.stringify(field.value.scalar.objectKinds ?? [])})) {\n` +
        `  const nestedEntries: ${emitter.use("PdxEntry")}[] = [];\n` +
        `${nested}\n` +
        `  ${sink}.push(${emitter.use("block")}(${key}, nestedEntries));\n` +
        `} else {\n` +
        `  ${sink}.push(${emitter.use("kv")}(${key}, ${pushExpr(emitter, field.value.scalar, access)}));\n` +
        `}`
      );
    }
    case "fields": {
      const nested = field.value.fields
        .map((nestedField, nestedIndex) => {
          const nestedAccess = propertyAccess(access, camelCase(nestedField.name));
          const code = pushCode(
            emitter,
            nestedField,
            nestedAccess,
            `${owner}.${field.name}`,
            nestedIndex,
            "nestedEntries"
          );
          return nestedField.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
        })
        .join("\n");
      return (
        `const nestedEntries: ${emitter.use("PdxEntry")}[] = [];\n` +
        `${nested}\n` +
        `${sink}.push(${emitter.use("block")}(${key}, nestedEntries));`
      );
    }
    case "valueList":
      return pushValueListCode(
        emitter,
        field.value,
        access,
        `${owner}.${field.name}`,
        index,
        key,
        sink
      );
    case "clause":
      return (
        (field.value.splice
          ? `${sink}.push(...${access}.entries);\n`
          : `${sink}.push(block(${key}, [...${access}.entries]));\n`) +
        `    refs.push(...${access}.refs);`
      );
    case "comparison":
      return (
        `${sink}.push(typeof ${access} === "object" ` +
        `? ${emitter.use("cmp")}(${key}, ${access}[0], ` +
        `${pushExpr(emitter, field.value.value, `${access}[1]`)}) : ` +
        `${emitter.use("kv")}(${key}, ${pushExpr(emitter, field.value.value, access)}));`
      );
  }
}

function pushValueListCode(
  emitter: Emitter,
  value: Extract<ArgValue, { readonly kind: "valueList" }>,
  access: string,
  owner: string,
  index: number,
  key: string,
  sink: string
): string {
  const items = `items${index}`;
  const item = `item${index}`;
  const scalar = value.scalar;
  const structured = value.fields;
  const scalarPush = (() => {
    if (scalar === null) {
      return "";
    }
    const expression = pushExpr(emitter, scalar, item);
    const pdxScalar =
      scalar.scriptValue === true ? expression : `${emitter.use("scalar")}(${expression})`;
    if (scalar.refTypes === undefined) {
      return `${items}.push(${pdxScalar});`;
    }
    const id = `id${index}`;
    if (scalar.scalarSymbol !== undefined) {
      emitter.use(scalar.scalarSymbol);
    }
    return (
      `const ${id} = ${scalar.toScalar(item)};\n` +
      `${items}.push(${emitter.use("scalar")}(${id}));\n` +
      `refs.push({ targets: ${JSON.stringify(scalar.refTypes)}, id: ${id}, field: ${JSON.stringify(owner)} });`
    );
  })();
  const structuredPush = (() => {
    if (structured === null) {
      return "";
    }
    const nested = structured
      .map((field, nestedIndex) => {
        const nestedAccess = propertyAccess(item, camelCase(field.name));
        const code = pushCode(emitter, field, nestedAccess, owner, nestedIndex, "nestedEntries");
        return field.optional ? `if (${nestedAccess} !== undefined) {\n  ${code}\n}` : code;
      })
      .join("\n");
    return (
      `const nestedEntries: ${emitter.use("PdxEntry")}[] = [];\n${nested}\n` +
      `${items}.push(${emitter.use("container")}(nestedEntries));`
    );
  })();
  const body =
    scalar !== null && structured !== null
      ? `if (${emitter.use("isStructuredValue")}(${item}, ${JSON.stringify(scalar.objectKinds ?? [])})) {\n${structuredPush}\n} else {\n${scalarPush}\n}`
      : structuredPush || scalarPush;
  return (
    `const ${items}: ${emitter.use("PdxItem")}[] = [];\n` +
    `for (const ${item} of ${access}) {\n${body}\n}\n` +
    `${sink}.push(${emitter.use("kv")}(${key}, ${emitter.use("container")}(${items})));`
  );
}

function emitValueList(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  value: Extract<ArgValue, { readonly kind: "valueList" }>
): string {
  const field: ArgField = { name: key, value, optional: false, docs: [] };
  const withRefs = contributesRefs(field);
  return (
    docComment(docs) +
    `export function ${fn}(values: ${valueListType(emitter, value, scope)}): ` +
    `${emitter.use("Trigger")}<${scope}> {\n` +
    `  const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
    (withRefs ? `  const refs: ${emitter.use("ContentRefUse")}[] = [];\n` : "") +
    `  ${pushValueListCode(emitter, value, "values", key, 0, JSON.stringify(key), "entries")}\n` +
    `  return ${emitter.use("trigger")}(entries${withRefs ? ", refs" : ""});\n}\n`
  );
}

function emitFields(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  fields: readonly ArgField[]
): string {
  const name = `${pascalCase(key)}Args`;
  const members = fields
    .map((field) =>
      renderMember({
        name: camelCase(field.name),
        type: memberType(emitter, field, scope),
        optional: field.optional,
        docs: field.docs,
      })
    )
    .join("");
  const pushes = fields
    .map((field, index) => {
      const access = propertyAccess("args", camelCase(field.name));
      const push = `    ${pushCode(emitter, field, access, key, index)}\n`;
      return field.optional ? `  if (${access} !== undefined) {\n${push}  }\n` : push.slice(2);
    })
    .join("");
  const withRefs = fields.some(contributesRefs);
  return (
    `export interface ${name} {\n${members}}\n\n` +
    docComment(docs) +
    `export function ${fn}(args: ${name}): ${emitter.use("Trigger")}<${scope}> {\n` +
    `  const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
    (withRefs ? `  const refs: ${emitter.use("ContentRefUse")}[] = [];\n` : "") +
    pushes +
    `  return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
    `entries)]${withRefs ? ", refs" : ""});\n}\n`
  );
}

function emitStringOrFields(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  fields: readonly ArgField[]
): string {
  const name = `${pascalCase(key)}Args`;
  const preservesEnclosingScope = fields.some(
    (field) => field.value.kind === "clause" && field.value.splice && field.value.scope === null
  );
  const typeParameter = preservesEnclosingScope ? `<S extends ${scope} = ${scope}>` : "";
  const argsType = `${name}${preservesEnclosingScope ? "<S>" : ""}`;
  const returnScope = preservesEnclosingScope ? "S" : scope;
  const members = fields
    .map((field) =>
      renderMember({
        name: camelCase(field.name),
        type: memberType(emitter, field, returnScope),
        optional: field.optional,
        docs: field.docs,
      })
    )
    .join("");
  const pushes = fields
    .map((field, index) => {
      const access = propertyAccess("args", camelCase(field.name));
      const push = `    ${pushCode(emitter, field, access, key, index)}\n`;
      return field.optional ? `  if (${access} !== undefined) {\n${push}  }\n` : push.slice(2);
    })
    .join("");
  const withRefs = fields.some(contributesRefs);
  const condition = emitter.use("Trigger");
  return (
    `export interface ${name}${typeParameter} {\n${members}}\n\n` +
    docComment(docs) +
    `export function ${fn}(value: string): ${condition}<${scope}>;\n` +
    `export function ${fn}${typeParameter}(args: ${argsType}): ${condition}<${returnScope}>;\n` +
    `export function ${fn}${preservesEnclosingScope ? `<S extends ${scope}>` : ""}(value: string | ${argsType}): ${condition}<${scope}> {\n` +
    `  if (typeof value === "string") {\n` +
    `    return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, ` +
    `value)]);\n` +
    `  }\n` +
    `  const args = value;\n` +
    `  const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
    (withRefs ? `  const refs: ${emitter.use("ContentRefUse")}[] = [];\n` : "") +
    pushes +
    `  return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
    `entries)]${withRefs ? ", refs" : ""});\n}\n`
  );
}

function emitOne(
  emitter: Emitter,
  key: string,
  shape: Shape,
  scope: string,
  docs: string[]
): string {
  const fn = safeIdentifier(camelCase(key));
  switch (shape.kind) {
    case "bool":
      return emitBoolean(emitter, fn, key, scope, docs);
    case "comparison":
      return emitComparison(emitter, fn, key, scope, docs, shape.value);
    case "value":
      return emitValue(emitter, fn, key, scope, docs, shape.value);
    case "valueList":
      return emitValueList(emitter, fn, key, scope, docs, shape.value);
    case "stringOrFields":
      return emitStringOrFields(emitter, fn, key, scope, docs, shape.fields);
    case "wrapper":
      return emitWrapper(emitter, fn, key, scope, docs, shape.scope);
    case "fields":
      return emitFields(emitter, fn, key, scope, docs, shape.fields);
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
  const appliedDocOverrides = new Set<string>();
  let emitted = 0;

  for (const key of [...rules.keys()].sort()) {
    const rule = rules.get(key)!;
    const declarations = rule.declarations;
    const handWritten = HAND_WRITTEN_TRIGGER_RULES_BY_KEY.get(key.toLowerCase());
    if (handWritten !== undefined) {
      skipped.push(
        skippedRule(
          key,
          "handwritten-trigger",
          `hand-written ${handWritten.kind}: ${handWritten.reason}`
        )
      );
      continue;
    }
    if (key === "<scripted_trigger>") {
      skipped.push(
        skippedRule(key, "abstract-placeholder", "abstract scripted-trigger placeholder")
      );
      continue;
    }
    if (!isPlainName(key)) {
      skipped.push(skippedRule(key, "invalid-rule-name", "not a plain rule name"));
      continue;
    }
    const doc = docs.get(key);
    // The rules are authoritative where they carry `## scopes`; the dump is the
    // fallback for the handful of rules that do not, and stays the cross-check.
    if (rule.supportedScopes.length === 0) {
      skipped.push(
        skippedRule(key, "missing-rule-scope", "no scopes in either the rules or the game's dump")
      );
      continue;
    }
    const scope = rule.scopeType;
    if (scope === null) {
      skipped.push(
        skippedRule(key, "unknown-scope", `unknown scope in ${rule.supportedScopes.join(" ")}`)
      );
      continue;
    }
    const shape = shapeOf(emitter, rule);
    if ("category" in shape) {
      skipped.push({ name: key, ...shape });
      continue;
    }
    const docsForRule = tsDoc(declarations, doc);
    const docOverride = TRIGGER_DOC_SUMMARY_OVERRIDES.get(key);
    if (docOverride !== undefined) {
      if (doc?.summary.trim() !== docOverride.summary) {
        throw new Error(
          `TRIGGER_DOC_SUMMARY_OVERRIDES names "${key}", but its source summary changed`
        );
      }
      if (docsForRule[0]?.trim() === docOverride.summary) {
        throw new Error(
          `TRIGGER_DOC_SUMMARY_OVERRIDES names "${key}", but CWT now has the corrected summary`
        );
      }
      docsForRule[0] = docOverride.summary;
      appliedDocOverrides.add(key);
    }
    // The rule's own scope reaches the emitted signature as `Trigger<...>`: a
    // universal rule spells the SDK's `ScopeName`, a scoped one a literal union
    // that imports nothing. Declared here, where the chunk is committed, rather
    // than where the token was computed — a skipped rule computes one too.
    if (rule.scopes === "universal") {
      emitter.use("ScopeName");
    }
    chunks.push(emitOne(emitter, key, shape, scope, docsForRule));
    names.add(safeIdentifier(camelCase(key)));
    byShape.set(shape.kind, (byShape.get(shape.kind) ?? 0) + 1);
    emitted += 1;
  }

  for (const key of TRIGGER_DOC_SUMMARY_OVERRIDES.keys()) {
    if (!appliedDocOverrides.has(key)) {
      throw new Error(
        `TRIGGER_DOC_SUMMARY_OVERRIDES names "${key}", which no generated trigger matches`
      );
    }
  }

  return {
    code: chunks.join("\n"),
    emitted,
    byShape,
    skipped,
    names,
    docOverrides: [...TRIGGER_DOC_SUMMARY_OVERRIDES].map(
      ([key, override]) => `${key} ← ${override.source} — ${override.reason}`
    ),
  };
}
