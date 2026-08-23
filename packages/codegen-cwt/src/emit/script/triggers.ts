/**
 * Emits one builder per trigger.
 *
 * Argument shapes and scopes both come from the `.cwt` rules, which annotate
 * `## scopes` on all but five trigger declarations. The game's doc dump supplies
 * the usage examples, covers those five, and stays the cross-check. A trigger
 * with no scope in either source is skipped and reported, never guessed at.
 */

import type { AliasDecl } from "../../cwt/rules.ts";
import type { DocEntry } from "../../logs/trigger-docs.ts";
import type { LoweredRule } from "../../lower/lowered-rule.ts";
import {
  bareBlockValue,
  cardinalityArrayType,
  comparisonValue,
  mergeFields,
  repeatedMemberType,
  skippedRule,
  skipReason,
  type ArgField,
  type ArgValue,
  type ClauseCategory,
  type SkippedRule,
  type SkipReason,
} from "../../lower/script-shape.ts";
import {
  camelCase,
  docComment,
  isPlainName,
  pascalCase,
  propertyAccess,
  propertyName,
  safeIdentifier,
} from "../../naming.ts";
import {
  ENCLOSING_SCOPE_TRIGGER_WRAPPERS,
  TRIGGER_DOC_SUMMARY_OVERRIDES,
} from "../../overlay/index.ts";
import { HAND_WRITTEN_TRIGGER_RULES_BY_KEY } from "../../policy/triggers.ts";
import { Emitter, type TsValue } from "../../render/emitter.ts";
import { member as renderMember } from "../../render/writer.ts";
import {
  contributesRefs,
  pushCode,
  pushExpr,
  pushValueListCode,
  unauthorableAliasValue,
} from "./trigger-push-code.ts";

const TRIGGER_CLAUSES = new Set<ClauseCategory>(["trigger"]);

/** Generated trigger module text and its lowering report. */
export interface TriggerEmission {
  /** Complete generated trigger builder module text. */
  readonly code: string;
  /** Number of trigger rules represented by generated builders. */
  readonly emitted: number;
  /** Emitted trigger count grouped by lowered argument shape. */
  readonly byShape: ReadonlyMap<string, number>;
  /** Trigger rules excluded from generation, with stable reasons. */
  readonly skipped: readonly SkippedRule[];
  /** Applied documentation override rows for the codegen report. */
  readonly docOverrides: readonly string[];
  /** Applied enclosing-scope wrapper override rows for the codegen report. */
  readonly enclosingScopeWrappers: readonly string[];
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
  /** A scalar or a typed trigger block, dispatched by the scalar arm's object kinds. */
  | {
      readonly kind: "scalarOrFields";
      readonly scalar: TsValue;
      readonly fields: readonly ArgField[];
    }
  /**
   * A block whose entire content is a nested trigger. `scope` is the scope the
   * rule pushes; `null` means the nested trigger stays in the enclosing scope,
   * which only an `ENCLOSING_SCOPE_TRIGGER_WRAPPERS` row permits.
   */
  | { readonly kind: "wrapper"; readonly scope: string | null }
  | { readonly kind: "fields"; readonly fields: readonly ArgField[] };

function shapeOf(emitter: Emitter, key: string, rule: LoweredRule): Shape | SkipReason {
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
        return ENCLOSING_SCOPE_TRIGGER_WRAPPERS.has(key)
          ? { kind: "wrapper", scope: null }
          : skipReason("missing-push-scope", "scope change with no push_scope annotation");
      }
      const scope = emitter.canonicalScope(pushedRaw);
      return scope === null
        ? skipReason("unknown-push-scope", `push_scope names no known scope (${pushedRaw})`)
        : { kind: "wrapper", scope };
    }
  }

  // A splice alongside named fields (`calc_true_if = { amount == int ... }`)
  // becomes one more argument, which `mergeFields` names for what it splices.
  const fields = mergeFields(emitter, body.fields, pushedRaw, TRIGGER_CLAUSES);
  if (!Array.isArray(fields)) {
    return fields;
  }
  if (fields.length === 0) {
    return skipReason("empty-block", "block with no typeable fields");
  }
  return scalarOrFields(emitter, rule, { kind: "fields", fields });
}

/**
 * Pairs a rule's block shape with its scalar declarations as one overload.
 * The arms stay separable at runtime because the scalar type says which SDK
 * object forms it admits, so nothing has to guess from the authored shape.
 */
function scalarOrFields(
  emitter: Emitter,
  rule: LoweredRule,
  shape: Extract<Shape, { readonly kind: "fields" }>
): Shape | SkipReason {
  if (rule.scalars.length === 0) {
    return shape;
  }
  const scalar = emitter.unionFor(rule.scalars.map((declaration) => declaration.type));
  if (scalar === null) {
    return skipReason(
      "unsupported-scalar-arm",
      "overloaded with a scalar arm the emitter cannot express"
    );
  }
  return { kind: "scalarOrFields", scalar, fields: shape.fields };
}

/**
 * The audit failure an `ENCLOSING_SCOPE_TRIGGER_WRAPPERS` row causes, or `null`
 * when the row still describes its rule. The row claims the rule is a trigger
 * splice whose omitted `push_scope` means the enclosing scope, so any other
 * lowering makes it stale and its generated signature a false claim.
 */
function staleEnclosingScopeWrapper(key: string, shape: Shape | SkipReason): string | null {
  const row = `ENCLOSING_SCOPE_TRIGGER_WRAPPERS names "${key}"`;
  if ("category" in shape) {
    return `${row}, which no longer generates (${shape.detail})`;
  }
  if (shape.kind !== "wrapper") {
    return `${row}, which is not a pure trigger splice (${shape.kind})`;
  }
  return shape.scope === null ? null : `${row}, which now declares push_scope ${shape.scope}`;
}

/**
 * Builds generated JSDoc lines from CWT declarations and the game documentation fallback.
 * CWT supplies the first available summary; a non-empty usage example is appended as a code block.
 */
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
 * The `return` statement that writes one whole-value trigger entry, also
 * recording a content reference when every form the value admits is one.
 */
function scalarEntryReturn(
  emitter: Emitter,
  key: string,
  value: TsValue,
  access: string,
  indent: string
): string {
  if (value.refTypes === undefined) {
    return (
      `${indent}return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, ` +
      `${pushExpr(emitter, value, access)})]);\n`
    );
  }
  // The id is bound once and both written and recorded, so the emitted entry
  // and the reference the build checks can never drift apart.
  if (value.scalarSymbol !== undefined) {
    emitter.use(value.scalarSymbol);
  }
  return (
    `${indent}const id = ${value.toScalar(access)};\n` +
    `${indent}return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, id)], ` +
    `[{ targets: ${JSON.stringify(value.refTypes)}, id, field: ${JSON.stringify(key)} }]);\n`
  );
}

function emitValue(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  value: TsValue
): string {
  return (
    docComment(docs) +
    `export function ${fn}(value: ${emitter.useValue(value).type}): ` +
    `${emitter.use("Trigger")}<${scope}> {\n` +
    scalarEntryReturn(emitter, key, value, "value", "  ") +
    "}\n"
  );
}

/**
 * A `null` inner scope means the rule pushes no scope, so the nested trigger
 * runs in whatever scope encloses the wrapper. That is generic over the
 * enclosing scope rather than fixed to the rule's own scope type.
 */
function emitWrapper(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  inner: string | null
): string {
  const type = emitter.use("Trigger");
  const signature =
    inner === null
      ? `export function ${fn}<S extends ${scope}>(condition: ${type}<S>): ${type}<S>`
      : `export function ${fn}(condition: ${type}<${JSON.stringify(inner)}>): ${type}<${scope}>`;
  return (
    docComment(docs) +
    `${signature} {\n` +
    `  return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
    `[...condition.entries])], [...condition.refs]);\n}\n`
  );
}

/** The type text one lowered argument contributes before repetition applies. */
function baseMemberType(emitter: Emitter, value: ArgValue, outerScope: string): string {
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
    case "aliasList":
    case "aliasStruct":
      return unauthorableAliasValue(value);
    case "comparison": {
      const literals = value.literals.map((literal) => JSON.stringify(literal));
      const scalar = emitter.useValue(value.value).type;
      return [scalar, `readonly [${emitter.use("PdxOp")}, ${scalar}]`, ...literals].join(" | ");
    }
  }
}

/** The type text one argument member emits, widened when the field repeats. */
function memberType(emitter: Emitter, field: ArgField, outerScope: string): string {
  const single = baseMemberType(emitter, field.value, outerScope);
  return field.repeated === undefined
    ? single
    : repeatedMemberType(emitter, field.value, single, field.repeated);
}

function argumentMembers(
  emitter: Emitter,
  fields: readonly ArgField[],
  outerScope: string
): string {
  return fields
    .map((field) =>
      renderMember({
        name: camelCase(field.name),
        type: memberType(emitter, field, outerScope),
        optional: field.optional,
        docs: field.docs,
      })
    )
    .join("");
}

function pushStatements(emitter: Emitter, fields: readonly ArgField[], triggerKey: string): string {
  return fields
    .map((field, index) => {
      const access = propertyAccess("args", camelCase(field.name));
      const push = `    ${pushCode(emitter, field, access, triggerKey, index)}\n`;
      return field.optional ? `  if (${access} !== undefined) {\n${push}  }\n` : push.slice(2);
    })
    .join("");
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
  return cardinalityArrayType(arms.join(" | "), value.cardinality);
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

/** The doc line every generated argument object carries. */
function argsDoc(fn: string): string {
  return docComment([`The arguments \`${fn}\` takes, as the rules declare them.`]);
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
  const members = argumentMembers(emitter, fields, scope);
  const pushes = pushStatements(emitter, fields, key);
  const withRefs = fields.some(contributesRefs);
  return (
    argsDoc(fn) +
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

/**
 * Emits a rule overloaded between one scalar and one block as two signatures
 * over a runtime dispatch on the scalar arm's admitted object kinds.
 *
 * The argument type is emitted as a type alias rather than an interface
 * because only an anonymous object type is removed from the implementation
 * parameter's union when `isStructuredValue` narrows it, which is what keeps
 * both arms of the body typed without a cast.
 */
function emitScalarOrFields(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  scalar: TsValue,
  fields: readonly ArgField[]
): string {
  const name = `${pascalCase(key)}Args`;
  const preservesEnclosingScope = fields.some(
    (field) => field.value.kind === "clause" && field.value.splice && field.value.scope === null
  );
  const typeParameter = preservesEnclosingScope ? `<S extends ${scope} = ${scope}>` : "";
  const argsType = `${name}${preservesEnclosingScope ? "<S>" : ""}`;
  const returnScope = preservesEnclosingScope ? "S" : scope;
  const members = argumentMembers(emitter, fields, returnScope);
  const pushes = pushStatements(emitter, fields, key);
  const withRefs = fields.some(contributesRefs);
  const condition = emitter.use("Trigger");
  const scalarType = emitter.useValue(scalar).type;
  return (
    argsDoc(fn) +
    `export type ${name}${typeParameter} = {\n${members}};\n\n` +
    docComment(docs) +
    `export function ${fn}(value: ${scalarType}): ${condition}<${scope}>;\n` +
    `export function ${fn}${typeParameter}(args: ${argsType}): ${condition}<${returnScope}>;\n` +
    `export function ${fn}${preservesEnclosingScope ? `<S extends ${scope}>` : ""}(value: ${scalarType} | ${argsType}): ${condition}<${scope}> {\n` +
    `  if (${emitter.use("isStructuredValue")}(value, ` +
    `${JSON.stringify(scalar.objectKinds ?? [])})) {\n` +
    `    const args = value;\n` +
    `    const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
    (withRefs ? `    const refs: ${emitter.use("ContentRefUse")}[] = [];\n` : "") +
    pushes +
    `    return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
    `entries)]${withRefs ? ", refs" : ""});\n` +
    `  }\n` +
    scalarEntryReturn(emitter, key, scalar, "value", "  ") +
    "}\n"
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
    case "scalarOrFields":
      return emitScalarOrFields(emitter, fn, key, scope, docs, shape.scalar, shape.fields);
    case "wrapper":
      return emitWrapper(emitter, fn, key, scope, docs, shape.scope);
    case "fields":
      return emitFields(emitter, fn, key, scope, docs, shape.fields);
  }
}

/**
 * Emits trigger builders from generated-owned rules and reports every excluded rule.
 * Rule scopes and documentation fallbacks are resolved before any builder text is committed.
 * Throws when hand-written policy owns a rule the rules declare removed.
 */
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
  const appliedWrapperRows = new Set<string>();
  let emitted = 0;

  for (const key of [...rules.keys()].sort()) {
    const rule = rules.get(key)!;
    const declarations = rule.declarations;
    const handWritten = HAND_WRITTEN_TRIGGER_RULES_BY_KEY.get(key.toLowerCase());
    if (handWritten !== undefined) {
      if (rule.removed) {
        throw new Error(
          `${key}: the rules declare the trigger removed (## api_status = removed), ` +
            `but hand-written ${handWritten.kind} policy still owns it`
        );
      }
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
    if (rule.removed) {
      skipped.push(
        skippedRule(key, "removed-api", "declared removed by the rules (## api_status = removed)")
      );
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
    const shape = shapeOf(emitter, key, rule);
    if (ENCLOSING_SCOPE_TRIGGER_WRAPPERS.has(key)) {
      const stale = staleEnclosingScopeWrapper(key, shape);
      if (stale !== null) {
        throw new Error(stale);
      }
      appliedWrapperRows.add(key);
    }
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

  for (const key of ENCLOSING_SCOPE_TRIGGER_WRAPPERS.keys()) {
    if (!appliedWrapperRows.has(key)) {
      throw new Error(
        `ENCLOSING_SCOPE_TRIGGER_WRAPPERS names "${key}", which no trigger rule declares`
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
    enclosingScopeWrappers: [...ENCLOSING_SCOPE_TRIGGER_WRAPPERS].map(
      ([key, override]) => `${key} ← ${override.source} — ${override.reason}`
    ),
  };
}
