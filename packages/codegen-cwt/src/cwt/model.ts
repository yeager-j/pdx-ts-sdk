/**
 * A typed view over the parsed `.cwt` tree.
 *
 * The parser knows about scalars and blocks; this layer knows what a scalar
 * *means* — that `int[-1..100]` is a bounded integer, `<technology>` is a
 * reference into a content type, and `enum[research_area]` names a closed set.
 */

import type { CwtBlock, CwtDiagnostic, CwtNode, CwtOption, CwtScalar, CwtValue } from "./parser.ts";

export interface Range {
  readonly min: number | null;
  readonly max: number | null;
}

export type RuleType =
  | { readonly kind: "bool" }
  | { readonly kind: "int"; readonly range: Range | null }
  | { readonly kind: "float"; readonly range: Range | null }
  | { readonly kind: "scalar" }
  | { readonly kind: "localisation" }
  /** A numeric expression the game evaluates: a literal, a variable, or a scripted value. */
  | { readonly kind: "valueField"; readonly integer: boolean }
  | { readonly kind: "enum"; readonly name: string }
  /** `<technology>` — a key defined by some content type, resolvable only against a game install. */
  | { readonly kind: "typeRef"; readonly name: string }
  /** `value[country_flag]` — an open set of names the script itself invents. */
  | { readonly kind: "valueSet"; readonly name: string }
  | { readonly kind: "scope"; readonly name: string }
  | { readonly kind: "scopeGroup"; readonly name: string }
  | { readonly kind: "filepath"; readonly path: string | null }
  | { readonly kind: "icon"; readonly path: string }
  | { readonly kind: "colour"; readonly format: string }
  /** `alias_match_left[trigger]` — recurses into every rule in that alias category. */
  | { readonly kind: "aliasMatchLeft"; readonly category: string }
  /** `single_alias_right[trigger_clause]` — expands to a block defined in `aliases.cwt`. */
  | { readonly kind: "singleAliasRight"; readonly name: string }
  | {
      readonly kind: "block";
      readonly fields: readonly RuleField[];
      readonly bare: readonly RuleType[];
    }
  /** A bracketed CWT keyword the classifier does not understand. */
  | { readonly kind: "unknownKeyword"; readonly text: string }
  /** Anything else: a bare word standing for itself, such as `yes` or `country`. */
  | { readonly kind: "literal"; readonly text: string };

export interface ClassificationDiagnostic extends Omit<CwtDiagnostic, "file" | "kind"> {
  readonly kind: "unknown-keyword";
}

export type ClassificationReporter = (diagnostic: ClassificationDiagnostic) => void;

export type FieldKey =
  | { readonly kind: "name"; readonly name: string }
  /** A computed key, such as `enum[prereq_for_categories] = { ... }`. */
  | { readonly kind: "computed"; readonly type: RuleType }
  /** `alias_name[trigger] = alias_match_left[trigger]` — splices in a whole alias category. */
  | { readonly kind: "aliasName"; readonly category: string }
  /** `subtype[repeatable] = { ... }` — fields that exist only for that subtype. */
  | { readonly kind: "subtype"; readonly name: string; readonly negated: boolean };

export interface Cardinality {
  readonly min: number;
  /** `null` means unbounded (`inf`). */
  readonly max: number | null;
}

export const REQUIRED: Cardinality = { min: 1, max: 1 };

/**
 * The scope context a nested block runs in, from `## replace_scope` /
 * `## push_scope`.
 *
 * `from` is as much a part of that context as `this` is: half the blocks the
 * game evaluates read FROM, and the rules say which scope it holds
 * (`## replace_scopes = { this = fleet from = archaeological_site }`).
 * `push_scope` leaves FROM alone, so it contributes `this` only.
 */
export interface ScopeContext {
  readonly this: string | null;
  readonly root: string | null;
  readonly from: string | null;
  /**
   * True for `replace_scope(s)`, which states the whole context — a scope it
   * leaves out is cleared, not inherited. `push_scope` states only `this`, so
   * everything else carries over from the enclosing block.
   */
  readonly replaces: boolean;
}

export interface RuleField {
  readonly key: FieldKey;
  readonly type: RuleType;
  readonly cardinality: Cardinality;
  readonly docs: readonly string[];
  readonly scope: ScopeContext | null;
  readonly line: number;
  /** `==` marks a comparison field, written in script as `count > 4`. */
  readonly comparison: boolean;
}

const BRACKETED = /^([a-z_]+)\[([^\]]*)\]$/;
const RANGE = /^(-?[\d.]+|-?inf)\.\.(-?[\d.]+|-?inf)$/;
const CARDINALITY = /^~?(\d+)\.\.(\d+|inf)$/;

function parseRange(text: string): Range | null {
  const match = RANGE.exec(text);
  if (match === null) {
    return null;
  }
  const bound = (raw: string): number | null => (raw.endsWith("inf") ? null : Number(raw));
  return { min: bound(match[1]!), max: bound(match[2]!) };
}

function classifyBracketed(
  head: string,
  argument: string,
  raw: string,
  line: number,
  report?: ClassificationReporter
): RuleType {
  switch (head) {
    case "enum":
    case "complex_enum":
      return { kind: "enum", name: argument };
    case "value":
    case "value_set":
      return { kind: "valueSet", name: argument };
    case "scope":
      return { kind: "scope", name: argument };
    case "scope_group":
      return { kind: "scopeGroup", name: argument };
    case "icon":
      return { kind: "icon", path: argument };
    case "filepath":
      return { kind: "filepath", path: argument };
    case "colour":
      return { kind: "colour", format: argument };
    case "alias_match_left":
      return { kind: "aliasMatchLeft", category: argument };
    case "single_alias_right":
      return { kind: "singleAliasRight", name: argument };
    case "alias_keys_field":
      return { kind: "scalar" };
    case "int":
      return { kind: "int", range: parseRange(argument) };
    case "float":
      return { kind: "float", range: parseRange(argument) };
    case "value_field":
      return { kind: "valueField", integer: false };
    case "int_value_field":
      return { kind: "valueField", integer: true };
    default: {
      report?.({ kind: "unknown-keyword", line, text: raw });
      return { kind: "unknownKeyword", text: raw };
    }
  }
}

function classifyScalar(text: string, line: number, report?: ClassificationReporter): RuleType {
  switch (text) {
    case "bool":
      return { kind: "bool" };
    case "int":
      return { kind: "int", range: null };
    case "float":
    case "percentage_field":
      return { kind: "float", range: null };
    case "scalar":
      return { kind: "scalar" };
    case "localisation":
    case "localisation_synced":
    case "localisation_inline":
      return { kind: "localisation" };
    case "value_field":
    case "variable_field":
      return { kind: "valueField", integer: false };
    case "int_value_field":
    case "int_variable_field":
    // `value_int_field` is an upstream typo (situations.cwt total_progress)
    // for int_value_field; reading it as a literal would type the field as
    // the string "value_int_field".
    case "value_int_field":
      return { kind: "valueField", integer: true };
    case "filepath":
      return { kind: "filepath", path: null };
    // The unbracketed spelling of `scope[any]`: a scope named by any path the
    // game can follow, with nothing said about which scope it lands in. Read
    // as a literal it typed 7 fields as the useless string `"scope_field"`.
    case "scope_field":
      return { kind: "scope", name: "any" };
    default:
      break;
  }
  if (text.startsWith("<") && text.endsWith(">")) {
    return { kind: "typeRef", name: text.slice(1, -1) };
  }
  const bracketed = BRACKETED.exec(text);
  if (bracketed !== null) {
    return classifyBracketed(bracketed[1]!, bracketed[2]!, text, line, report);
  }
  return { kind: "literal", text };
}

/** Expands `single_alias_right[x]` to the block `aliases.cwt` defines for it. */
export type SingleAliasResolver = (name: string) => CwtValue | undefined;

export function classify(
  value: CwtValue,
  resolve?: SingleAliasResolver,
  report?: ClassificationReporter
): RuleType {
  if (value.kind === "block") {
    return classifyBlock(value, resolve, report);
  }
  const type: RuleType = value.quoted
    ? { kind: "literal", text: value.text }
    : classifyScalar(value.text, value.line, report);
  if (type.kind !== "singleAliasRight" || resolve === undefined) {
    return type;
  }
  const target = resolve(type.name);
  return target === undefined ? type : classify(target, resolve, report);
}

export function classifyBlock(
  block: CwtBlock,
  resolve?: SingleAliasResolver,
  report?: ClassificationReporter
): RuleType {
  const fields: RuleField[] = [];
  const bare: RuleType[] = [];
  for (const node of block.nodes) {
    if (node.kind === "assignment") {
      fields.push(toField(node.key, node, resolve, report));
      continue;
    }
    bare.push(classify(node.value, resolve, report));
  }
  return { kind: "block", fields, bare };
}

function classifyKey(key: CwtScalar, report?: ClassificationReporter): FieldKey {
  const { text } = key;
  if (key.quoted) {
    return { kind: "name", name: text };
  }
  const bracketed = BRACKETED.exec(text);
  if (bracketed === null) {
    // A key spelled `int`, `scalar`, or `<resource>` is a key FILTER — it
    // matches any key of that type (`random_list`'s weights are `int = {...}`).
    // Only words the classifier does not recognise are literal field names.
    const type = classifyScalar(text, key.line, report);
    return type.kind === "literal" ? { kind: "name", name: text } : { kind: "computed", type };
  }
  if (bracketed[1] === "alias_name") {
    return { kind: "aliasName", category: bracketed[2]! };
  }
  if (bracketed[1] === "subtype") {
    const argument = bracketed[2]!;
    const negated = argument.startsWith("!");
    return { kind: "subtype", name: negated ? argument.slice(1) : argument, negated };
  }
  return { kind: "computed", type: classifyScalar(text, key.line, report) };
}

function toField(
  key: CwtScalar,
  node: CwtNode & { kind: "assignment" },
  resolve?: SingleAliasResolver,
  report?: ClassificationReporter
): RuleField {
  return {
    key: classifyKey(key, report),
    type: classify(node.value, resolve, report),
    cardinality: cardinalityOf(node.options),
    docs: node.docs,
    scope: scopeOf(node.options),
    line: node.line,
    comparison: node.op === "==",
  };
}

export function findOption(options: readonly CwtOption[], name: string): CwtOption | undefined {
  return options.find((option) => option.name === name);
}

export function cardinalityOf(options: readonly CwtOption[]): Cardinality {
  const option = findOption(options, "cardinality");
  const text = option?.value?.kind === "scalar" ? option.value.text : null;
  const match = text === null ? null : CARDINALITY.exec(text);
  if (match === null) {
    return findOption(options, "optional") === undefined ? REQUIRED : { min: 0, max: 1 };
  }
  return { min: Number(match[1]), max: match[2] === "inf" ? null : Number(match[2]) };
}

/**
 * `replace_scope` swaps the whole scope context, `push_scope` only pushes
 * `this`. Either tells us which scope the block below runs in.
 */
export function scopeOf(options: readonly CwtOption[]): ScopeContext | null {
  const pushed = findOption(options, "push_scope");
  if (pushed?.value?.kind === "scalar") {
    return { this: pushed.value.text, root: null, from: null, replaces: false };
  }
  const replaced = findOption(options, "replace_scope") ?? findOption(options, "replace_scopes");
  const block = replaced?.value;
  if (block === undefined || block === null || block.kind !== "block") {
    return null;
  }
  const read = (name: string): string | null => {
    const node = block.nodes.find(
      (candidate): candidate is CwtNode & { kind: "assignment" } =>
        candidate.kind === "assignment" && candidate.key.text.toLowerCase() === name
    );
    return node !== undefined && node.value.kind === "scalar" ? node.value.text : null;
  };
  return { this: read("this"), root: read("root"), from: read("from"), replaces: true };
}

/**
 * Reads `## scopes = { country federation }`, `## scopes = any`, or the
 * singular `## scope = …` that a couple of rules still use.
 *
 * Returns `null` when the rule carries no scope annotation at all.
 */
export function supportedScopesOf(options: readonly CwtOption[]): string[] | null {
  const option = findOption(options, "scopes") ?? findOption(options, "scope");
  const value = option?.value;
  if (value === undefined || value === null) {
    return null;
  }
  if (value.kind === "scalar") {
    return [value.text];
  }
  return value.nodes.flatMap((node) =>
    node.kind === "value" && node.value.kind === "scalar" ? [node.value.text] : []
  );
}

export function isOptional(cardinality: Cardinality): boolean {
  return cardinality.min === 0;
}

export function isRepeated(cardinality: Cardinality): boolean {
  return cardinality.max === null || cardinality.max > 1;
}
