/**
 * Emits one builder per trigger.
 *
 * Argument shapes and scopes both come from the `.cwt` rules, which annotate
 * `## scopes` on all but five trigger declarations. The game's doc dump supplies
 * the usage examples, covers those five, and stays the cross-check. A trigger
 * with no scope in either source is skipped and reported, never guessed at.
 */

import type { RuleType } from "../../cwt/model.ts";
import type { AliasDecl } from "../../cwt/rules.ts";
import type { DocEntry } from "../../logs/trigger-docs.ts";
import { loweredRuleConflictSkips, type LoweredRule } from "../../lower/lowered-rule.ts";
import {
  bareBlockValue,
  cardinalityArrayType,
  clauseScopeContext,
  comparisonValue,
  mapType,
  mergeBlock,
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
import { Emitter, recordsLocalization, type TsValue } from "../../render/emitter.ts";
import { member as renderMember } from "../../render/writer.ts";
import type { ScriptTriggerReferenceRow } from "./script-reference.ts";
import {
  contributesRefs,
  pushCode,
  pushExpr,
  pushValueListCode,
  scalarExpr,
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
  /** One machine-readable reference row per generated trigger builder. */
  readonly references: readonly ScriptTriggerReferenceRow[];
}

interface EmittedTriggerBuilder {
  readonly code: string;
  readonly signature: string;
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
    const value = bareBlockValue(
      emitter,
      body.bare,
      clauseScopeContext(block.declaration.scope),
      TRIGGER_CLAUSES
    );
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
  // becomes one more argument, which `mergeBlock` names for what it splices.
  const lowered = mergeBlock(
    emitter,
    body.fields,
    clauseScopeContext(block.declaration.scope),
    TRIGGER_CLAUSES
  );
  if ("detail" in lowered) {
    return lowered;
  }
  if (lowered.kind === "map") {
    return skipReason("computed-field-key", "top-level open-keyed block");
  }
  if (lowered.fields.length === 0) {
    return skipReason("empty-block", "block with no typeable fields");
  }
  return scalarOrFields(emitter, rule, { kind: "fields", fields: lowered.fields });
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
 * A rule naming a localisation key also states how a bare string is read there,
 * which is the opposite of how a content member reads one.
 */
export function tsDoc(declarations: readonly AliasDecl[], doc: DocEntry | undefined): string[] {
  const summary = declarations.flatMap((declaration) => declaration.docs)[0] ?? doc?.summary ?? "";
  const lines = [summary];
  if (doc !== undefined && doc.usage !== "") {
    lines.push("", "```", ...doc.usage.split("\n"), "```");
  }
  if (declarations.some((declaration) => namesLocalisationKey(declaration.type))) {
    lines.push("", LOCALISATION_ARGUMENT_DOC);
  }
  return lines;
}

/**
 * What a recorded-script localisation argument's documentation says about the
 * text or reference it takes.
 *
 * Recorded script has no owner of its own, so the two halves worth saying are
 * that inline text is keyed where the script is placed, and that a bare string
 * is that text rather than a key.
 */
const LOCALISATION_ARGUMENT_DOC =
  "Names a localization key. Inline display text — a string, or a language record — is keyed " +
  "and emitted for you against whatever definition, event, or patch this script is placed in; " +
  "reuse the same script under two owners and each gets its own key. An existing key goes here " +
  "as a reference: `mod.localization()` or a definition's `loc` member for a key this mod owns, " +
  "`vanilla.localization()` for one the game ships, `external.localization()` for another mod's.";

function namesLocalisationKey(type: RuleType): boolean {
  if (type.kind === "localisation") {
    return true;
  }
  return type.kind === "block" && type.fields.some((field) => namesLocalisationKey(field.type));
}

function emitBoolean(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[]
): EmittedTriggerBuilder {
  const signature = `${fn}(value: boolean = true): ${emitter.use("Trigger")}<${scope}>`;
  return {
    signature,
    code:
      docComment(docs) +
      `export function ${signature} {\n` +
      `  return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, ` +
      `value)]);\n}\n`,
  };
}

function emitComparison(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  value: TsValue
): EmittedTriggerBuilder {
  const signature =
    `${fn}(op: ${emitter.use("PdxOp")}, value: ${emitter.useValue(value).type}): ` +
    `${emitter.use("Trigger")}<${scope}>`;
  return {
    signature,
    code:
      docComment(docs) +
      `export function ${signature} {\n` +
      `  return ${emitter.use("trigger")}([${emitter.use("cmp")}(${JSON.stringify(key)}, op, ` +
      `${pushExpr(emitter, value, "value")})]);\n}\n`,
  };
}

/**
 * The `return` statement for a whole-value trigger that consumes a
 * localization reference, which is recorded from the authored value so the
 * fold can place a standalone item's text (SDK-306).
 *
 * It collects into a `refs` local rather than the array literal
 * {@link scalarEntryReturn} returns inline, because a rule overloaded between
 * a localisation key and a content reference has both to record.
 */
function localizationEntryReturn(
  emitter: Emitter,
  key: string,
  value: TsValue,
  access: string,
  indent: string
): string {
  const keyText = JSON.stringify(key);
  const collect =
    `${indent}const refs: ${emitter.use("RecordedRefUse")}[] = [];\n` +
    `${indent}${emitter.use("recordLocalization")}(refs, ${access}, ${keyText});\n`;
  const returned = (written: string): string =>
    `${indent}return ${emitter.use("trigger")}([${emitter.use("kv")}(${keyText}, ` +
    `${written})], refs);\n`;
  if (value.refTypes === undefined) {
    return collect + returned(scalarExpr(emitter, value, access, key));
  }
  if (value.scalarSymbol !== undefined) {
    emitter.use(value.scalarSymbol);
  }
  // The id is bound once and both written and recorded, for the same reason
  // {@link scalarEntryReturn} binds one.
  return (
    `${indent}const id = ${value.toScalar(access)};\n` +
    collect +
    `${indent}refs.push({ targets: ${JSON.stringify(value.refTypes)}, id, ` +
    `field: ${keyText} });\n` +
    returned("id")
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
  if (recordsLocalization(value)) {
    return localizationEntryReturn(emitter, key, value, access, indent);
  }
  if (value.refTypes === undefined) {
    return (
      `${indent}return ${emitter.use("trigger")}([${emitter.use("kv")}(${JSON.stringify(key)}, ` +
      `${scalarExpr(emitter, value, access, key)})]);\n`
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
): EmittedTriggerBuilder {
  const signature = `${fn}(value: ${emitter.useValue(value).type}): ${emitter.use("Trigger")}<${scope}>`;
  return {
    signature,
    code:
      docComment(docs) +
      `export function ${signature} {\n` +
      scalarEntryReturn(emitter, key, value, "value", "  ") +
      "}\n",
  };
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
): EmittedTriggerBuilder {
  const type = emitter.use("Trigger");
  const signature =
    inner === null
      ? `${fn}<S extends ${scope}>(condition: ${type}<S>): ${type}<S>`
      : `${fn}(condition: ${type}<${JSON.stringify(inner)}>): ${type}<${scope}>`;
  return {
    signature,
    code:
      docComment(docs) +
      `export function ${signature} {\n` +
      `  return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
      `[...condition.entries])], [...condition.refs]);\n}\n`,
  };
}

/** The `Trigger` type text a nested clause takes in a builder's arguments. */
function clauseType(emitter: Emitter, scope: string | null, outerScope: string): string {
  return `${emitter.use("Trigger")}<${scope === null ? outerScope : JSON.stringify(scope)}>`;
}

/** The type text one lowered argument contributes before repetition applies. */
function baseMemberType(emitter: Emitter, value: ArgValue, outerScope: string): string {
  switch (value.kind) {
    case "scalar":
      return emitter.useValue(value.value).type;
    case "fields":
      return `{ ${value.fields.map((nested) => `${camelCase(nested.name)}${nested.optional ? "?" : ""}: ${memberType(emitter, nested, outerScope)}`).join("; ")} }`;
    case "map":
      return mapType(emitter, value.map);
    case "scalarOrBlock":
      return `${emitter.useValue(value.scalar).type} | ${baseMemberType(emitter, value.block, outerScope)}`;
    case "valueList":
      return valueListType(emitter, value, outerScope);
    case "clause":
      return clauseType(emitter, value.scope, outerScope);
    case "keyedClauses": {
      // Parenthesized so the tuple reads as one item wherever the cardinality
      // wraps it, the way a union arm is.
      const oneCase = `(readonly [string, ${clauseType(emitter, value.scope, outerScope)}])`;
      return cardinalityArrayType(oneCase, value.cardinality);
    }
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
): EmittedTriggerBuilder {
  const field: ArgField = { name: key, value, optional: false, docs: [] };
  const withRefs = contributesRefs(field);
  const signature =
    `${fn}(values: ${valueListType(emitter, value, scope)}): ` +
    `${emitter.use("Trigger")}<${scope}>`;
  return {
    signature,
    code:
      docComment(docs) +
      `export function ${signature} {\n` +
      `  const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
      (withRefs ? `  const refs: ${emitter.use("RecordedRefUse")}[] = [];\n` : "") +
      `  ${pushValueListCode(emitter, value, "values", key, 0, JSON.stringify(key), "entries")}\n` +
      `  return ${emitter.use("trigger")}(entries${withRefs ? ", refs" : ""});\n}\n`,
  };
}

/** The doc line every generated argument object carries. */
function argsDoc(fn: string): string {
  return docComment([`The arguments \`${fn}\` takes, as the rules declare them.`]);
}

/** Whether one lowered value holds a clause that runs in the enclosing scope. */
function runsInEnclosingScope(value: ArgValue): boolean {
  switch (value.kind) {
    case "clause":
    case "keyedClauses":
      return value.scope === null;
    case "fields":
      return value.fields.some((field) => runsInEnclosingScope(field.value));
    case "scalarOrBlock":
      return runsInEnclosingScope(value.block);
    case "valueList":
      return value.fields?.some((field) => runsInEnclosingScope(field.value)) ?? false;
    default:
      return false;
  }
}

/**
 * Whether a builder's arguments hold a clause typed by the scope the builder
 * is called in. Such a builder is generic over that scope rather than fixed to
 * the rule's own scope type, which would reject every narrower caller.
 */
function takesEnclosingScope(fields: readonly ArgField[]): boolean {
  return fields.some((field) => runsInEnclosingScope(field.value));
}

function emitFields(
  emitter: Emitter,
  fn: string,
  key: string,
  scope: string,
  docs: string[],
  fields: readonly ArgField[]
): EmittedTriggerBuilder {
  const name = `${pascalCase(key)}Args`;
  const enclosingScope = takesEnclosingScope(fields);
  const typeParameter = enclosingScope ? `<S extends ${scope} = ${scope}>` : "";
  const returnScope = enclosingScope ? "S" : scope;
  const members = argumentMembers(emitter, fields, returnScope);
  const pushes = pushStatements(emitter, fields, key);
  const withRefs = fields.some(contributesRefs);
  const signature =
    `${fn}${typeParameter}(args: ${name}${enclosingScope ? "<S>" : ""}): ` +
    `${emitter.use("Trigger")}<${returnScope}>`;
  return {
    signature,
    code:
      argsDoc(fn) +
      `export interface ${name}${typeParameter} {\n${members}}\n\n` +
      docComment(docs) +
      `export function ${signature} {\n` +
      `  const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
      (withRefs ? `  const refs: ${emitter.use("RecordedRefUse")}[] = [];\n` : "") +
      pushes +
      `  return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
      `entries)]${withRefs ? ", refs" : ""});\n}\n`,
  };
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
): EmittedTriggerBuilder {
  const name = `${pascalCase(key)}Args`;
  const preservesEnclosingScope = takesEnclosingScope(fields);
  const typeParameter = preservesEnclosingScope ? `<S extends ${scope} = ${scope}>` : "";
  const argsType = `${name}${preservesEnclosingScope ? "<S>" : ""}`;
  const returnScope = preservesEnclosingScope ? "S" : scope;
  const members = argumentMembers(emitter, fields, returnScope);
  const pushes = pushStatements(emitter, fields, key);
  const withRefs = fields.some(contributesRefs);
  const condition = emitter.use("Trigger");
  const scalarType = emitter.useValue(scalar).type;
  const scalarSignature = `${fn}(value: ${scalarType}): ${condition}<${scope}>;`;
  const argsSignature = `${fn}${typeParameter}(args: ${argsType}): ${condition}<${returnScope}>;`;
  return {
    signature: `${scalarSignature}\n${argsSignature}`,
    code:
      argsDoc(fn) +
      `export type ${name}${typeParameter} = {\n${members}};\n\n` +
      docComment(docs) +
      `export function ${scalarSignature}\n` +
      `export function ${argsSignature}\n` +
      `export function ${fn}${preservesEnclosingScope ? `<S extends ${scope}>` : ""}(value: ${scalarType} | ${argsType}): ${condition}<${scope}> {\n` +
      `  if (${emitter.use("isStructuredValue")}(value, ` +
      `${JSON.stringify(scalar.objectKinds ?? [])})) {\n` +
      `    const args = value;\n` +
      `    const entries: ${emitter.use("PdxEntry")}[] = [];\n` +
      (withRefs ? `    const refs: ${emitter.use("RecordedRefUse")}[] = [];\n` : "") +
      pushes +
      `    return ${emitter.use("trigger")}([${emitter.use("block")}(${JSON.stringify(key)}, ` +
      `entries)]${withRefs ? ", refs" : ""});\n` +
      `  }\n` +
      scalarEntryReturn(emitter, key, scalar, "value", "  ") +
      "}\n",
  };
}

function emitOne(
  emitter: Emitter,
  key: string,
  shape: Shape,
  scope: string,
  docs: string[]
): EmittedTriggerBuilder {
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
  const references: ScriptTriggerReferenceRow[] = [];
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
    if (rule.conflicts.length > 0) {
      skipped.push(...loweredRuleConflictSkips(rule));
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
    if (rule.scopes === null) {
      throw new Error(`${key}: resolved scope text without canonical scope availability`);
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
    const method = safeIdentifier(camelCase(key));
    const builder = emitOne(emitter, key, shape, scope, docsForRule);
    chunks.push(builder.code);
    names.add(method);
    references.push({
      method,
      key,
      availability:
        rule.scopes === "universal"
          ? { kind: "universal" }
          : { kind: "scopes", scopes: rule.scopes },
      signature: builder.signature,
      docs: docsForRule,
    });
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
    references,
    docOverrides: [...TRIGGER_DOC_SUMMARY_OVERRIDES].map(
      ([key, override]) => `${key} ← ${override.source} — ${override.reason}`
    ),
    enclosingScopeWrappers: [...ENCLOSING_SCOPE_TRIGGER_WRAPPERS].map(
      ([key, override]) => `${key} ← ${override.source} — ${override.reason}`
    ),
  };
}
