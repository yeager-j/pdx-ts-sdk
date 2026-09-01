/**
 * A typed view over the parsed `.cwt` tree.
 *
 * The parser knows about scalars and blocks; this layer knows what a scalar
 * *means* — that `int[-1..100]` is a bounded integer, `<technology>` is a
 * reference into a content type, and `enum[research_area]` names a closed set.
 */

import { AMBIENT_SCOPE_KEYS, type AmbientScopeKey } from "../special-scope-paths.ts";
import type { CwtBlock, CwtDiagnostic, CwtNode, CwtOption, CwtScalar, CwtValue } from "./parser.ts";

/** Inclusive numeric bounds; `null` represents an open bound. */
export interface Range {
  /** The minimum value, or `null` when unbounded. */
  readonly min: number | null;
  /** The maximum value, or `null` when unbounded. */
  readonly max: number | null;
}

/** The semantic type of a parsed CWT value. */
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
      readonly bare: readonly RuleBareValue[];
      /**
       * The `single_alias` name this block expanded from, when it was written
       * as `single_alias_right[x]` rather than spelled out inline.
       */
      readonly via?: string;
    }
  /** A bracketed CWT keyword the classifier does not understand. */
  | { readonly kind: "unknownKeyword"; readonly text: string }
  /** Anything else: a bare word standing for itself, such as `yes` or `country`. */
  | { readonly kind: "literal"; readonly text: string };

type BlockRuleType = Extract<RuleType, { readonly kind: "block" }>;

/** A recoverable problem found while classifying a parsed value or option. */
export interface ClassificationDiagnostic extends Omit<CwtDiagnostic, "file" | "kind"> {
  /** Identifies the classification problem. */
  readonly kind: "malformed-option-value" | "unknown-keyword";
}

/** Receives recoverable diagnostics produced during CWT classification. */
export type ClassificationReporter = (
  diagnostic: ClassificationDiagnostic,
  sourceFile?: string
) => void;

/** A literal, computed, alias-splice, or subtype field key. */
export type FieldKey =
  | { readonly kind: "name"; readonly name: string }
  /** A computed key, such as `enum[prereq_for_categories] = { ... }`. */
  | { readonly kind: "computed"; readonly type: RuleType }
  /** `alias_name[trigger] = alias_match_left[trigger]` — splices in a whole alias category. */
  | { readonly kind: "aliasName"; readonly category: string }
  /** `subtype[repeatable] = { ... }` — fields that exist only for that subtype. */
  | { readonly kind: "subtype"; readonly name: string; readonly negated: boolean };

/** The permitted occurrence count for a CWT field or bare value. */
export interface Cardinality {
  /** The minimum permitted occurrences. */
  readonly min: number;
  /** `null` means unbounded (`inf`). */
  readonly max: number | null;
}

/** Cardinality for a value that must occur exactly once. */
export const REQUIRED: Cardinality = { min: 1, max: 1 };

/**
 * The scope context a nested block runs in, from `## replace_scope` /
 * `## push_scope`.
 *
 * `from` is as much a part of that context as `this` is: half the blocks the
 * game evaluates read FROM, and the rules say which scope it holds
 * (`## replace_scopes = { this = fleet from = archaeological_site }`).
 * `push_scope` leaves FROM alone, so it contributes `this` only.
 * Every {@link AmbientScopeKey} is present and uses `null` when omitted.
 */
export type ScopeContext = Readonly<
  {
    /** The nested block's `THIS` scope, or `null` when not stated. */
    this: string | null;
    /**
     * True for `replace_scope(s)`, which states the whole context — a scope it
     * leaves out is cleared, not inherited. `push_scope` states only `this`, so
     * everything else carries over from the enclosing block.
     */
    replaces: boolean;
  } & Record<AmbientScopeKey, string | null>
>;

/** A classified keyed CWT field. */
export interface RuleField {
  /** The field's literal or computed key. */
  readonly key: FieldKey;
  /** The accepted value type. */
  readonly type: RuleType;
  /** The permitted occurrence count. */
  readonly cardinality: Cardinality;
  /** Documentation comments bound to the field. */
  readonly docs: readonly string[];
  /** The nested scope annotation, or `null` when inherited. */
  readonly scope: ScopeContext | null;
  /** The one-based source line containing the field. */
  readonly line: number;
  /** `==` marks a comparison field, written in script as `count > 4`. */
  readonly comparison: boolean;
}

/** A classified anonymous value within a CWT block. */
export interface RuleBareValue {
  /** The accepted value type. */
  readonly type: RuleType;
  /** The permitted occurrence count. */
  readonly cardinality: Cardinality;
  /** Documentation comments bound to the value. */
  readonly docs: readonly string[];
  /** The nested scope annotation, or `null` when inherited. */
  readonly scope: ScopeContext | null;
  /** The one-based source line containing the value. */
  readonly line: number;
}

const BRACKETED = /^([^\[\]]+)\[([^\[\]]*)\]$/;
const VALUE_PAIR = /^value(?:_set)?\[[^\]]+\]:(?:localisation|<[^>]+>)$/;
const RANGE = /^(-?[\d.]+|-?inf)\.\.(-?[\d.]+|-?inf)$/;
// CWT permits a soft bound on either side of a cardinality range. The leading
// form was already accepted; the trailing form is used by the vendored rules.
const CARDINALITY = /^~?(\d+)\.\.~?(\d+|inf)$/;

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
    // `filename[dir]` is CWT's "a path the game resolves relative to `dir`",
    // against `filepath[dir]`'s "a path under `dir`". Both are one string in
    // the file and both lower to `string`; the distinction is a lookup rule
    // for a validator, not a shape. `model_mesh.meshsettings`' four texture
    // members are the only ones in the vendored rules, and left unknown they
    // were four fields the mesh registry could not author at all.
    case "filename":
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
      return { kind: "valueField", integer: true };
    case "filepath":
    case "filename":
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
  if (VALUE_PAIR.test(text)) {
    return { kind: "scalar" };
  }
  const bracketed = BRACKETED.exec(text);
  if (bracketed !== null) {
    return classifyBracketed(bracketed[1]!, bracketed[2]!, text, line, report);
  }
  return { kind: "literal", text };
}

/** A `single_alias_right[x]` target and the diagnostic destination of its declaration. */
export interface SingleAliasTarget {
  /** The parsed value declared for the alias. */
  readonly value: CwtValue;
  /** The source file used for diagnostics from the expanded declaration. */
  readonly sourceFile?: string;
}

/** Expands `single_alias_right[x]` to the block `aliases.cwt` defines for it. */
export type SingleAliasResolver = (name: string) => SingleAliasTarget | undefined;

/** Classifies a parsed CWT value and expands known single aliases. */
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
  if (target === undefined) {
    return type;
  }
  const targetReport =
    report === undefined || target.sourceFile === undefined
      ? report
      : (diagnostic: ClassificationDiagnostic, sourceFile?: string) =>
          report(diagnostic, sourceFile ?? target.sourceFile);
  const expanded = classify(target.value, resolve, targetReport);
  // A chain of aliases keeps the outermost name: the spread runs after the
  // recursion, so an inner `via` is overwritten by the name the consumer
  // actually wrote. Non-block expansions carry nothing to hang a name on.
  return expanded.kind === "block" ? { ...expanded, via: type.name } : expanded;
}

/** Classifies every keyed field and anonymous value in a parsed CWT block. */
export function classifyBlock(
  block: CwtBlock,
  resolve?: SingleAliasResolver,
  report?: ClassificationReporter
): BlockRuleType {
  const fields: RuleField[] = [];
  const bare: RuleBareValue[] = [];
  for (const node of block.nodes) {
    if (node.kind === "assignment") {
      fields.push(toField(node.key, node, resolve, report));
      continue;
    }
    bare.push({
      type: classify(node.value, resolve, report),
      cardinality: cardinalityOf(node.options, report),
      docs: node.docs,
      scope: scopeOf(node.options, report),
      line: node.line,
    });
  }
  return { kind: "block", fields, bare };
}

function classifyKey(key: CwtScalar, report?: ClassificationReporter): FieldKey {
  const { text } = key;
  if (key.quoted) {
    return { kind: "name", name: text };
  }
  // `$localisation_parameter = scalar` is CWT's placeholder for a key the
  // script itself invents, so the block is an open map. Read as a name it
  // would become a field literally called `$localisation_parameter`.
  if (text.startsWith("$")) {
    return { kind: "computed", type: { kind: "scalar" } };
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
    cardinality: cardinalityOf(node.options, report),
    docs: node.docs,
    scope: scopeOf(node.options, report),
    line: node.line,
    comparison: node.op === "==",
  };
}

/** Finds the first option with the requested name. */
export function findOption(options: readonly CwtOption[], name: string): CwtOption | undefined {
  return options.find((option) => option.name === name);
}

/** Reads field cardinality options, including the legacy `optional` flag. */
export function cardinalityOf(
  options: readonly CwtOption[],
  report?: ClassificationReporter
): Cardinality {
  const option = findOption(options, "cardinality");
  const text = option?.value?.kind === "scalar" ? option.value.text : null;
  const match = text === null ? null : CARDINALITY.exec(text);
  if (match === null) {
    if (option !== undefined) {
      reportMalformedOptionValue(option, report);
    }
    return findOption(options, "optional") === undefined ? REQUIRED : { min: 0, max: 1 };
  }
  return { min: Number(match[1]), max: match[2] === "inf" ? null : Number(match[2]) };
}

/**
 * The group a `scope_group[spatial_object]` scope annotation names, or `null`
 * when the value is an ordinary scope name.
 *
 * A slot filled this way holds one of the group's scopes at runtime rather than
 * a single known scope. The caller decides whether the named group exists.
 */
export function scopeGroupName(declared: string): string | null {
  const match = BRACKETED.exec(declared.trim());
  return match?.[1] === "scope_group" ? match[2]! : null;
}

/**
 * `replace_scope` swaps the whole scope context, `push_scope` only pushes
 * `this`. Either tells us which scope the block below runs in.
 */
export function scopeOf(
  options: readonly CwtOption[],
  report?: ClassificationReporter
): ScopeContext | null {
  const pushed = findOption(options, "push_scope");
  if (pushed !== undefined) {
    if (pushed.value?.kind === "scalar") {
      return {
        this: pushed.value.text,
        ...ambientScopeContext(() => null),
        replaces: false,
      };
    }
    reportMalformedOptionValue(pushed, report);
  }
  const replaced = findOption(options, "replace_scope") ?? findOption(options, "replace_scopes");
  if (replaced === undefined) {
    return null;
  }
  if (replaced.value?.kind !== "block") {
    reportMalformedOptionValue(replaced, report);
    return null;
  }
  const block = replaced.value;
  reportUnreadableScopeMembers(replaced, block, report);
  const read = (name: string): string | null => {
    const node = block.nodes.find(
      (candidate): candidate is CwtNode & { kind: "assignment" } =>
        candidate.kind === "assignment" && candidate.key.text.toLowerCase() === name
    );
    return node !== undefined && node.value.kind === "scalar" ? node.value.text : null;
  };
  return {
    this: read("this"),
    ...ambientScopeContext(read),
    replaces: true,
  };
}

/** The keys a `replace_scope(s)` block may assign: the block's own scope plus every ambient slot. */
const SCOPE_CONTEXT_KEYS: ReadonlySet<string> = new Set<string>(["this", ...AMBIENT_SCOPE_KEYS]);

/**
 * Reports every member of a `replace_scope(s)` block that {@link scopeOf}
 * cannot read.
 *
 * Checking the block's outer shape is not enough. `read` looks each slot up by
 * name and accepts only a scalar, so a misspelled key, a bare member, or a
 * block-valued assignment resolves to `null` — and because `replace_scopes`
 * states the whole context, `null` *clears* the slot rather than inheriting it.
 * A typo therefore drops a scope the rules meant to declare, silently changing
 * the generated API. `common/missions.cwt:305` is the case in the vendored
 * rules: it writes `fromform = country` where its own documentation comment
 * two lines above says `fromfrom`.
 *
 * Diagnostics carry the option's line rather than the member's, because an
 * option value is tokenized from the annotation's text alone and every line
 * inside it is 1.
 */
function reportUnreadableScopeMembers(
  option: CwtOption,
  block: CwtBlock,
  report?: ClassificationReporter
): void {
  if (report === undefined) {
    return;
  }
  const malformed = (text: string): void => {
    report({
      kind: "malformed-option-value",
      line: option.line,
      text: `## ${option.name} ${text}`,
    });
  };
  for (const node of block.nodes) {
    if (node.kind !== "assignment") {
      malformed("has a member that is not an assignment");
      continue;
    }
    if (!SCOPE_CONTEXT_KEYS.has(node.key.text.toLowerCase())) {
      malformed(`names "${node.key.text}", which is not a scope context key`);
      continue;
    }
    if (node.value.kind !== "scalar") {
      malformed(`gives "${node.key.text}" a value that is not a scope name`);
    }
  }
}

function reportMalformedOptionValue(option: CwtOption, report?: ClassificationReporter): void {
  if (report === undefined) {
    return;
  }
  const operator = option.value === null ? "" : ` ${option.negated ? "<>" : "="} `;
  const value =
    option.value === null ? "" : option.value.kind === "scalar" ? option.value.text : "{...}";
  report({
    kind: "malformed-option-value",
    line: option.line,
    text: `## ${option.name}${operator}${value}`,
  });
}

function ambientScopeContext(
  scopeAt: (key: AmbientScopeKey) => string | null
): Record<AmbientScopeKey, string | null> {
  return Object.fromEntries(AMBIENT_SCOPE_KEYS.map((key) => [key, scopeAt(key)])) as Record<
    AmbientScopeKey,
    string | null
  >;
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

/** Reports whether a cardinality permits zero occurrences. */
export function isOptional(cardinality: Cardinality): boolean {
  return cardinality.min === 0;
}

/** Reports whether a cardinality permits more than one occurrence. */
export function isRepeated(cardinality: Cardinality): boolean {
  return cardinality.max === null || cardinality.max > 1;
}
