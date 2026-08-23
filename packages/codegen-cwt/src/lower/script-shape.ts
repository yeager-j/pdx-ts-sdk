/**
 * Shared field-shape classification for block rules.
 *
 * A block rule's fields fall into five argument kinds: plain scalars, nested
 * clause holes (`limit = single_alias_right[trigger_clause]` — an opaque,
 * already-built `Trigger`, so recursion terminates at depth one by
 * construction), comparison fields (`count == int_value_field`, sometimes
 * overloaded with literals like `count = all`), open maps, where the key is a
 * filter the script fills in (`<resource> = value_field`), and keyed clauses,
 * where such a key holds a clause instead (`switch`'s cases).
 *
 * Classification is shared between the trigger and effect emitters; rendering
 * stays with each emitter. A `SkipReason` return carries the stable category
 * and report detail, so nothing is dropped silently.
 */

import {
  isOptional,
  isRepeated,
  REQUIRED,
  type Cardinality,
  type FieldKey,
  type RuleBareValue,
  type RuleField,
  type RuleType,
  type ScopeContext,
} from "../cwt/model.ts";
import { camelCase, pluralize } from "../naming.ts";
import {
  EXTRA_ALIAS_CATEGORIES,
  SCRIPT_ALIAS_CATEGORIES,
  UNIVERSAL_SCOPES,
} from "../overlay/index.ts";
import { referenceTargetsOf, type Emitter, type TsValue } from "../render/emitter.ts";

/** Stable reasons the shared trigger/effect generator can reject a CWT rule. */
export type ScriptGenerationSkipCategory =
  | "invalid-rule-name"
  | "missing-rule-scope"
  | "unknown-scope"
  | "missing-push-scope"
  | "comparison-effect"
  | "parameterised-placeholder"
  | "unsupported-value"
  | "multiple-block-forms"
  | "scalar-block-overload"
  | "bare-value-block"
  | "unsupported-alias-splice"
  | "unsupported-clause"
  | "unknown-push-scope"
  | "conflicting-clause-scope"
  | "empty-block"
  | "reserved-field-collision"
  | "computed-field-key"
  | "mixed-clause-categories"
  | "clause-scalar-overload"
  | "multiple-structured-scalar-arms"
  | "unsupported-scalar-arm"
  | "structured-bare-values"
  | "repeated-nested-field"
  | "empty-structured-arm"
  | "unsupported-comparison-operand"
  | "comparison-overload"
  | "unsupported-field-value";

/** All stable skip reasons reported by script and scope-link generation. */
export type ScriptSkipCategory =
  | ScriptGenerationSkipCategory
  | "abstract-placeholder"
  | "handwritten-trigger"
  | "structural-effect"
  | "event-fire-effect"
  | "removed-api"
  | "scopeless-event-kind"
  | "missing-fire-rule-scope"
  | "event-policy-rejected"
  | "value-link"
  | "data-link"
  | "missing-output-scope"
  | "polymorphic-output-scope"
  | "unknown-output-scope"
  | "unknown-input-scope";

/** A classified reason that script generation cannot preserve a declaration. */
export interface SkipReason {
  /** The stable category used by reports and tests. */
  readonly category: ScriptSkipCategory;
  /** The declaration-specific explanation shown in the report. */
  readonly detail: string;
}

/** A skipped rule paired with its original CWT name. */
export interface SkippedRule extends SkipReason {
  /** The CWT rule name. */
  readonly name: string;
}

/** Creates a classified script-generation skip reason. */
export function skipReason(category: ScriptSkipCategory, detail: string): SkipReason {
  return { category, detail };
}

/** Creates a classified skip record for one named rule. */
export function skippedRule(
  name: string,
  category: ScriptSkipCategory,
  detail: string
): SkippedRule {
  return { name, category, detail };
}

/**
 * Renders a supported-scopes list as the TS type parameter: a sorted literal
 * union, `"ScopeName"` for universal rules, `null` when a name is unknown.
 */
export function scopeType(
  scopes: readonly string[],
  index: ReadonlyMap<string, string>
): string | null {
  const canonical = canonicalScopeSet(scopes, index);
  if (canonical === "universal") {
    return "ScopeName";
  }
  if (canonical === null) {
    return null;
  }
  return canonical.map((scope) => JSON.stringify(scope)).join(" | ");
}

/** The canonical scope set behind `scopeType`, or "universal", or null. */
export function canonicalScopeSet(
  scopes: readonly string[],
  index: ReadonlyMap<string, string>
): readonly string[] | "universal" | null {
  if (scopes.some((scope) => UNIVERSAL_SCOPES.has(scope))) {
    return "universal";
  }
  const canonical = scopes.map((scope) => index.get(scope));
  if (canonical.some((scope) => scope === undefined)) {
    return null;
  }
  return [...new Set(canonical as string[])].sort();
}

/**
 * The scopes one rule declares, from the rules' own `## scopes` with the game's
 * dump as fallback. Empty when neither source names any — the caller reports
 * that rather than guessing, since a scope invented here would be a lie about
 * where the rule is legal.
 */
export function declaredScopes(
  declarations: readonly { readonly supportedScopes: readonly string[] | null }[],
  doc:
    | {
        /** Scope names reported by the Stellaris script documentation dump. */
        readonly scopes: readonly string[];
      }
    | undefined
): readonly string[] {
  const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
  return declared.length > 0 ? declared : (doc?.scopes ?? []);
}

/** A nested script clause category supported by the shared block model. */
export type ClauseCategory = "trigger" | "effect" | "modifier_rule";

/** How a nested clause changes the callback's game-scope identity. */
export type ScopeTransition = "same" | "push" | "replace" | "unknown";

/**
 * A block whose keys the script itself supplies, lowered to one typed map.
 *
 * `<resource> = value_field` and `value_set[country_flag] = bool` declare a
 * key filter rather than a key, so the block is open and its entries are
 * authored as an object rather than as named members.
 */
export interface MapValue {
  /** The index-signature label naming what one key is, such as `resource`. */
  readonly keyName: string;
  /** The TypeScript type the index signature keys on. */
  readonly indexType: "string" | "number";
  /** The registries a key may name, when every key form is a content reference. */
  readonly keyRefTypes?: readonly string[];
  /** The value one entry holds. */
  readonly value: TsValue;
  /** Whether entries are written as comparisons rather than assignments. */
  readonly comparison?: true;
  /** The entry count the declarations admit together. */
  readonly cardinality: Cardinality;
  /** Whether entries are written beside the enclosing block's own keys. */
  readonly splice: boolean;
}

/** The block shapes one generated argument admits. */
export type BlockValue =
  | {
      /** Selects a structured object argument. */
      readonly kind: "fields";
      /** The named members of the structured object. */
      readonly fields: readonly ArgField[];
    }
  | {
      /** Selects an open-keyed map argument. */
      readonly kind: "map";
      /** The keys, values, and placement the map admits. */
      readonly map: MapValue;
    }
  /** One braced value containing anonymous scalar or structured items. */
  | {
      /** Selects one braced list of anonymous values. */
      readonly kind: "valueList";
      /** The scalar item arm, when the list admits scalar items. */
      readonly scalar: TsValue | null;
      /** The structured item arm, when the list admits object items. */
      readonly fields: readonly ArgField[] | null;
      /** The combined item count admitted by the anonymous declarations. */
      readonly cardinality: Cardinality;
    };

/** The lowering of one CWT block of keyed fields: named members, or one open map. */
export type KeyedBlockValue = Extract<BlockValue, { readonly kind: "fields" | "map" }>;

/** The authored value shape of one generated trigger or effect argument. */
export type ArgValue =
  | BlockValue
  | {
      /** Selects a plain scalar argument. */
      readonly kind: "scalar";
      /** The scalar TypeScript and runtime representation. */
      readonly value: TsValue;
    }
  /**
   * A field that accepts either one scalar value or a block. The scalar arm's
   * runtime object kinds are carried by `TsValue`, so generated code can
   * distinguish SDK scalar values from the block.
   */
  | {
      /** Selects an overload between a scalar and a block. */
      readonly kind: "scalarOrBlock";
      /** The scalar arm of the overload. */
      readonly scalar: TsValue;
      /** The block arm of the overload. */
      readonly block: BlockValue;
    }
  /**
   * A typed hole for a nested clause. `scope` is the canonical scope the
   * clause runs in, or `null` for "the enclosing rule's own scope". `splice`
   * clauses spread their entries bare into the block; named clauses wrap them
   * under the field's key.
   */
  | {
      /** Selects a nested trigger, effect, or modifier-rule clause. */
      readonly kind: "clause";
      /** The kind of script rules accepted inside the clause. */
      readonly category: ClauseCategory;
      /** The canonical pushed scope, or `null` for the enclosing scope. */
      readonly scope: string | null;
      /** How entering this clause changes the live game scope identity. */
      readonly transition: ScopeTransition;
      /** Whether clause entries are emitted without a named wrapper. */
      readonly splice: boolean;
    }
  /**
   * A block whose keys the script supplies and whose values are nested
   * clauses: `switch = { trigger = has_ethic ethic_pacifist = { ... } }`.
   * The game takes the first case whose key matches, so the cases are
   * authored as an ordered list of key/clause pairs rather than an object.
   */
  | {
      /** Selects an ordered list of script-keyed nested clauses. */
      readonly kind: "keyedClauses";
      /** The kind of script rules accepted inside one case. */
      readonly category: ClauseCategory;
      /** The canonical pushed scope, or `null` for the enclosing scope. */
      readonly scope: string | null;
      /** The case count the declarations admit together. */
      readonly cardinality: Cardinality;
      /** The block's own keys, which a case key may not repeat. */
      readonly reservedKeys: readonly string[];
    }
  /**
   * An ordered list of tagged members of one spliced alias category, each item
   * naming exactly one member. `scope` is the canonical scope the members'
   * clauses run in, or `null` for the enclosing scope.
   */
  | {
      /** Selects an ordered list of alias-category members. */
      readonly kind: "aliasList";
      /** The spliced CWT alias category. */
      readonly category: string;
      /** The canonical pushed scope, or `null` for the enclosing scope. */
      readonly scope: string | null;
      /** Whether the items are emitted without a named wrapper. */
      readonly splice: boolean;
    }
  /** One block of a spliced alias category, typed by its content-side interface. */
  | {
      /** Selects an alias category authored through its emitted block interface. */
      readonly kind: "aliasStruct";
      /** The spliced CWT alias category. */
      readonly category: string;
    }
  /** `count == int_value_field`, plus any literal overloads (`count = all`). */
  | {
      /** Selects a comparison operand with optional literal overloads. */
      readonly kind: "comparison";
      /** The supported numeric or boolean comparison operand. */
      readonly value: TsValue;
      /** Literal tokens accepted in place of the comparison operand. */
      readonly literals: readonly string[];
    };

/** One generated argument field after overloaded CWT declarations are merged. */
export interface ArgField {
  /**
   * The PDXScript key the field writes, which is also its authoring member
   * name. A spliced {@link MapValue} writes its entries beside that key
   * instead of under it, so its name is the authoring member only.
   */
  readonly name: string;
  /** The authored value shape shared by the field's declarations. */
  readonly value: ArgValue;
  /** Whether authors may omit the field. */
  readonly optional: boolean;
  /**
   * How often authors may repeat the field as sibling keys, absent when the
   * rules permit it at most once.
   */
  readonly repeated?: Cardinality;
  /** Documentation retained from every merged declaration. */
  readonly docs: readonly string[];
}

/**
 * Replaces unkeyed alias splices with the category's concrete named fields.
 * Returns a skip reason when the category has no declaration table, or when it
 * carries its own script authoring surface and must not be flattened into one.
 */
export function expandAliasFields(
  emitter: Emitter,
  fields: readonly RuleField[]
): RuleField[] | SkipReason {
  const expanded: RuleField[] = [];
  for (const field of fields) {
    if (field.key.kind !== "aliasName") {
      expanded.push(field);
      continue;
    }
    if (SCRIPT_ALIAS_CATEGORIES.has(field.key.category)) {
      return skipReason(
        "unsupported-alias-splice",
        `splices ${field.key.category} beside named fields, and that category is authored ` +
          "as a whole rather than as members of the enclosing block"
      );
    }
    const members = emitter.rules.aliasCategories.get(field.key.category);
    if (members === undefined) {
      return skipReason(
        "unsupported-alias-splice",
        `splices a category the emitter cannot type (${field.key.category})`
      );
    }
    for (const [name, declarations] of members) {
      for (const declaration of declarations) {
        expanded.push({
          key: { kind: "name", name },
          type: declaration.type,
          cardinality: field.cardinality,
          docs: [...field.docs, ...declaration.docs],
          scope: field.scope ?? declaration.scope,
          line: field.line,
          comparison: field.comparison || declaration.comparison,
        });
      }
    }
  }
  return expanded;
}

/** The one alias category a block holds nothing but splices of, else null. */
export function pureSpliceCategory(type: RuleType): string | null {
  if (type.kind !== "block" || type.bare.length > 0 || type.fields.length === 0) {
    return null;
  }
  const categories = new Set(
    type.fields.map((field) => (field.key.kind === "aliasName" ? field.key.category : null))
  );
  if (categories.size !== 1) {
    return null;
  }
  const [category] = categories;
  return category ?? null;
}

/** The clause category of a block holding nothing but alias splices, else null. */
export function clauseOf(type: RuleType): ClauseCategory | null {
  const category = pureSpliceCategory(type);
  return category === "trigger" || category === "effect" || category === "modifier_rule"
    ? category
    : null;
}

/** How many enum values an enum-typed key filter expands into, at most. */
const ENUM_KEY_EXPANSION_LIMIT = 12;

/**
 * Expands enum-typed key filters into one optional field per enum value:
 * `enum[days_months_year] = int` becomes `days`/`months`/`years` fields.
 */
function expandEnumKeys(emitter: Emitter, fields: readonly RuleField[]): RuleField[] {
  return fields.flatMap((field) => {
    if (field.key.kind !== "computed" || field.key.type.kind !== "enum") {
      return [field];
    }
    const values = emitter.rules.enums.get(field.key.type.name);
    if (values === undefined || values.length > ENUM_KEY_EXPANSION_LIMIT) {
      return [field];
    }
    return values.map((value) => ({
      ...field,
      key: { kind: "name", name: value } as const,
      cardinality: { min: 0, max: field.cardinality.max },
    }));
  });
}

/**
 * Resolves the scope a clause field runs in: the field's own `## push_scope`,
 * else the declaration's, else the enclosing rule's scope (`null`).
 * A `SkipReason` return is the classified skip reason.
 */
export interface ClauseScope {
  readonly scope: string | null;
  readonly transition: ScopeTransition;
}

/**
 * Classifies a CWT scope context by runtime identity behavior.
 *
 * A missing context preserves the current identity. A context without `THIS`
 * is unknown; otherwise `replaces` distinguishes replacement from a push.
 */
export function scopeTransition(scope: ScopeContext | null): ScopeTransition {
  if (scope === null) {
    return "same";
  }
  if (scope.this === null) {
    return "unknown";
  }
  return scope.replaces ? "replace" : "push";
}

/** Preserves a declaration's complete scope transition for nested fields. */
export function clauseScopeContext(scope: ScopeContext | null): ClauseScope {
  return {
    scope: scope?.this ?? null,
    transition: scopeTransition(scope),
  };
}

function inheritedClauseScope(scope: ClauseScope | string | null): ClauseScope {
  return typeof scope === "object" && scope !== null && "transition" in scope
    ? scope
    : { scope, transition: scope === null ? "same" : "push" };
}

function clauseScope(
  emitter: Emitter,
  name: string,
  fields: readonly RuleField[],
  inherited: ClauseScope
): ClauseScope | SkipReason {
  const candidates = fields.map((field) =>
    field.scope === null
      ? inherited
      : { scope: field.scope.this, transition: scopeTransition(field.scope) }
  );
  const [first] = candidates;
  if (first === undefined) {
    return inherited;
  }
  if (
    candidates.some(
      (candidate) => candidate.scope !== first.scope || candidate.transition !== first.transition
    )
  ) {
    return skipReason(
      "conflicting-clause-scope",
      `field "${name}" has incompatible scope transitions across its declarations`
    );
  }
  if (first.transition === "unknown") {
    return skipReason("unknown-push-scope", `field "${name}" does not state a THIS scope`);
  }
  if (first.scope === null) {
    return first;
  }
  const canonical = emitter.canonicalScope(first.scope);
  return canonical === null
    ? skipReason("unknown-push-scope", `field "${name}" pushes an unknown scope (${first.scope})`)
    : { ...first, scope: canonical };
}

function bareClauseScope(
  emitter: Emitter,
  value: RuleBareValue,
  inherited: ClauseScope
): ClauseScope | SkipReason {
  const candidate =
    value.scope === null
      ? inherited
      : { scope: value.scope.this, transition: scopeTransition(value.scope) };
  if (candidate.transition === "unknown") {
    return skipReason("unknown-push-scope", "bare clause does not state a THIS scope");
  }
  if (candidate.scope === null) {
    return candidate;
  }
  const canonical = emitter.canonicalScope(candidate.scope);
  return canonical === null
    ? skipReason("unknown-push-scope", `bare clause pushes an unknown scope (${candidate.scope})`)
    : { ...candidate, scope: canonical };
}

/** The authored operand type for a CWT comparison, or its skip reason. */
export function comparisonValue(
  emitter: Emitter,
  types: readonly RuleType[]
): TsValue | SkipReason {
  const value = emitter.unionFor(types);
  if (
    value === null ||
    value.type
      .split(" | ")
      .some((part) => part !== "number" && part !== "ScriptValue" && part !== "boolean")
  ) {
    return skipReason(
      "unsupported-comparison-operand",
      "comparison operand is not a scalar numeric or boolean value"
    );
  }
  return value;
}

/**
 * The item count a braced block admits, summed: each anonymous declaration is
 * another slot in the same block, so `<color_define>` 0..4 beside `"null"`
 * 0..4 admits up to eight items. An open block's key filters sum the same way.
 */
function totalCardinality(values: readonly { readonly cardinality: Cardinality }[]): Cardinality {
  return {
    min: values.reduce((sum, value) => sum + value.cardinality.min, 0),
    max: values.some((value) => value.cardinality.max === null)
      ? null
      : values.reduce((sum, value) => sum + value.cardinality.max!, 0),
  };
}

/**
 * The occurrence count one named key admits, as an envelope over its
 * declarations rather than a sum: each declaration is another *form* the one
 * key accepts, not another key. `ethic = <ethic>` 1..3 beside `ethic = random`
 * 1..3 is three ethics that may each take either form, not six.
 *
 * This is the reading {@link ArgField.optional} already takes, where any
 * declaration permitting absence makes the whole field optional.
 */
function widestCardinality(fields: readonly RuleField[]): Cardinality {
  return {
    min: Math.min(...fields.map((field) => field.cardinality.min)),
    max: fields.some((field) => field.cardinality.max === null)
      ? null
      : Math.max(...fields.map((field) => field.cardinality.max!)),
  };
}

/**
 * Renders the index-signature type an open-keyed block admits.
 *
 * A reference-keyed map keys on `string` rather than the branded reference:
 * the brand is an object, and an object cannot key one.
 */
export function mapType(emitter: Emitter, map: MapValue): string {
  const value = emitter.useValue(map.value).type;
  const entry =
    map.comparison === true ? `${value} | readonly [${emitter.use("PdxOp")}, ${value}]` : value;
  return `{ readonly [${map.keyName}: ${map.indexType}]: ${entry} }`;
}

/**
 * Renders the readonly tuple or array type admitted by an item cardinality.
 * Finite ranges become tuple unions; unbounded ranges preserve their minimum prefix.
 */
/**
 * The widest maximum still worth spelling as a tuple union.
 *
 * Each permitted length is its own arm, so `0..100` — how `effects.cwt` writes
 * "as many as you like" for starbase modules and message variables — would be
 * 101 arms of up to 100 members each, which states the bound far less clearly
 * than an array does. Eight is the widest union the rules already produce
 * (`create_country.flag.colors`, two 0..4 declarations of one block).
 */
const TUPLE_UNION_LIMIT = 8;

export function cardinalityArrayType(item: string, cardinality: Cardinality): string {
  const tuple = (length: number): string =>
    `readonly [${Array.from({ length }, () => item).join(", ")}]`;
  if (cardinality.max !== null && cardinality.max <= TUPLE_UNION_LIMIT) {
    return Array.from({ length: cardinality.max - cardinality.min + 1 }, (_, index) =>
      tuple(cardinality.min + index)
    ).join(" | ");
  }
  // `A | B[]` is an array of B beside an A, so only the array forms bracket a
  // union item. A tuple element already ends at its comma.
  const element = item.includes(" | ") ? `(${item})` : item;
  return cardinality.min === 0
    ? `readonly ${element}[]`
    : `readonly [${Array.from({ length: cardinality.min }, () => item).join(", ")}, ...${element}[]]`;
}

/**
 * The type text a repeated member emits, given the type text one occurrence
 * admits.
 *
 * A repeated comparison keeps its single forms and gains a non-empty list of
 * operator/operand pairs instead of a plain array: `readonly (ScriptValue |
 * readonly [PdxOp, ScriptValue])[]` would accept `[">", 2]` as two bare
 * operands and silently write two keys where the author meant one comparison,
 * and an empty list would name an operator the author never wrote.
 */
export function repeatedMemberType(
  emitter: Emitter,
  value: ArgValue,
  single: string,
  cardinality: Cardinality
): string {
  if (value.kind === "comparison") {
    const operand = emitter.useValue(value.value).type;
    const pair = `readonly [${emitter.use("PdxOp")}, ${operand}]`;
    return `${single} | readonly [${pair}, ...(${pair})[]]`;
  }
  return cardinalityArrayType(single, cardinality);
}

/** Lowers the anonymous contents of one braced field. */
export function bareBlockValue(
  emitter: Emitter,
  bare: readonly RuleBareValue[],
  inheritedScope: ClauseScope | string | null,
  allowedSplices: ReadonlySet<string>
): Extract<ArgValue, { readonly kind: "clause" | "valueList" }> | SkipReason {
  const inherited = inheritedClauseScope(inheritedScope);
  const clauses = bare.flatMap((value) => {
    const category = clauseOf(value.type);
    return category === null ? [] : [{ value, category }];
  });
  if (clauses.length > 0) {
    if (clauses.length !== bare.length || clauses.length !== 1) {
      return skipReason(
        "mixed-clause-categories",
        "bare block mixes a clause with other anonymous values"
      );
    }
    const { value, category } = clauses[0]!;
    if (!allowedSplices.has(category)) {
      return skipReason(
        "unsupported-clause",
        `bare block contains ${category}, which this emitter cannot type`
      );
    }
    if (isRepeated(value.cardinality)) {
      return skipReason("repeated-nested-field", "bare block contains a repeated clause");
    }
    const scope = bareClauseScope(emitter, value, inherited);
    return "detail" in scope ? scope : { kind: "clause", category, ...scope, splice: false };
  }

  const structured = bare.filter(
    (
      value
    ): value is RuleBareValue & {
      readonly type: Extract<RuleType, { readonly kind: "block" }>;
    } => value.type.kind === "block"
  );
  if (structured.length > 1) {
    return skipReason(
      "multiple-structured-scalar-arms",
      "bare block has more than one structured arm"
    );
  }

  let fields: readonly ArgField[] | null = null;
  if (structured.length === 1) {
    const block = structured[0]!.type;
    if (block.bare.length > 0) {
      return skipReason("structured-bare-values", "bare structured arm nests bare values");
    }
    const lowered = mergeBlock(
      emitter,
      block.fields,
      structured[0]!.scope === null ? inherited : clauseScopeContext(structured[0]!.scope),
      allowedSplices
    );
    if ("detail" in lowered) {
      return lowered;
    }
    if (lowered.kind === "map") {
      return skipReason("computed-field-key", "bare structured arm is an open-keyed block");
    }
    if (lowered.fields.length === 0) {
      return skipReason("empty-structured-arm", "bare structured arm has no typeable fields");
    }
    fields = lowered.fields;
  }

  const scalarDeclarations = bare.filter((value) => value.type.kind !== "block");
  const scalar =
    scalarDeclarations.length === 0
      ? null
      : emitter.unionFor(scalarDeclarations.map((value) => value.type));
  if (scalarDeclarations.length > 0 && scalar === null) {
    return skipReason("unsupported-field-value", "bare block has a scalar arm it cannot express");
  }
  if (scalar === null && fields === null) {
    return skipReason("empty-block", "bare block has no typeable values");
  }
  return {
    kind: "valueList",
    scalar,
    fields,
    cardinality: totalCardinality(bare),
  };
}

/** The computed key types the map model can carry as index-signature keys. */
type MapKeyType = Extract<
  RuleType,
  { readonly kind: "typeRef" | "valueSet" | "scalar" | "int" | "float" }
>;

/** One computed-key declaration, with the key type the map model read from it. */
interface OpenKeyDeclaration {
  /** The declaration the open key was written on. */
  readonly field: RuleField;
  /** The key filter every key of this declaration matches. */
  readonly keyType: MapKeyType;
}

/** The key type a computed key contributes to an open map, or `null` when it cannot. */
function mapKeyType(key: FieldKey): MapKeyType | null {
  if (key.kind !== "computed") {
    return null;
  }
  switch (key.type.kind) {
    case "typeRef":
    case "valueSet":
    case "scalar":
    case "int":
    case "float":
      return key.type;
    default:
      return null;
  }
}

/** The family a key type belongs to; two declarations share a member name only if they agree. */
function mapKeyFamily(type: MapKeyType): string {
  return type.kind === "typeRef" || type.kind === "valueSet"
    ? `${type.kind}[${type.name}]`
    : type.kind;
}

/** Whether a key filter admits only numbers, so the index signature keys on one. */
function isNumericKey(type: MapKeyType): boolean {
  return type.kind === "int" || type.kind === "float";
}

/** The index-signature label a key type reads as. */
function mapKeyName(type: MapKeyType): string {
  switch (type.kind) {
    case "typeRef":
    case "valueSet":
      return camelCase(type.name);
    case "scalar":
      return "parameter";
    case "int":
    case "float":
      return type.kind;
  }
}

/** The member name a map takes when it shares its block with named fields. */
function mapMemberName(type: MapKeyType): string {
  return type.kind === "typeRef" || type.kind === "valueSet"
    ? pluralize(camelCase(type.name))
    : "entries";
}

/** One block's declarations split into its named keys and its computed keys. */
interface PartitionedBlock {
  /** Declarations grouped per literal key, in first-declaration order. */
  readonly named: ReadonlyMap<string, RuleField[]>;
  /** The computed-key declarations the block's open map is built from. */
  readonly open: readonly OpenKeyDeclaration[];
  /** The computed-key declarations whose values are nested clauses. */
  readonly keyed: readonly RuleField[];
  /** How many named keys are declared before the first computed key. */
  readonly computedPosition: number;
}

/** The clause category a computed key holds one of per case, else `null`. */
function keyedClauseCategory(key: FieldKey, type: RuleType): ClauseCategory | null {
  return key.kind === "computed" && key.type.kind === "scalar" ? clauseOf(type) : null;
}

/**
 * Splits one block's declarations, with enum-typed key filters already
 * expanded, into named groups, open-key declarations, and clause-valued
 * computed keys. Declines a block whose keys no model can name.
 */
function partitionBlock(
  emitter: Emitter,
  fields: readonly RuleField[]
): PartitionedBlock | SkipReason {
  const named = new Map<string, RuleField[]>();
  const open: OpenKeyDeclaration[] = [];
  const keyed: RuleField[] = [];
  let computedPosition = 0;
  for (const field of expandEnumKeys(emitter, fields)) {
    if (field.key.kind === "name") {
      const existing = named.get(field.key.name);
      if (existing === undefined) {
        named.set(field.key.name, [field]);
      } else {
        existing.push(field);
      }
      continue;
    }
    if (open.length === 0 && keyed.length === 0) {
      computedPosition = named.size;
    }
    if (keyedClauseCategory(field.key, field.type) !== null) {
      keyed.push(field);
      continue;
    }
    // A computed key holding any other block would need a map of blocks, which
    // no rule declares and the map model deliberately does not carry.
    const keyType = field.type.kind === "block" ? null : mapKeyType(field.key);
    if (keyType === null) {
      return skipReason("computed-field-key", "block with computed or subtype field keys");
    }
    open.push({ field, keyType });
  }
  return { named, open, keyed, computedPosition };
}

/**
 * Merges the open-key declarations of one block into the map they describe.
 * `splice` states whether its entries are written beside the block's named keys.
 */
function openMapValue(
  emitter: Emitter,
  declarations: readonly OpenKeyDeclaration[],
  splice: boolean
): MapValue | SkipReason {
  const keyTypes = declarations.map((declaration) => declaration.keyType);
  // Not `unionFor`: the key is never spelled as a branded type, only as the
  // index signature's `string` or `number`.
  const keyRefTypes = referenceTargetsOf(keyTypes);
  // A map-only block merges every key family it declares, so one family that
  // admits names the game does not read as a number keeps the whole map on
  // `string`.
  const indexType = keyTypes.every(isNumericKey) ? "number" : "string";
  const fields = declarations.map((declaration) => declaration.field);
  const comparisons = fields.filter((field) => field.comparison);
  if (comparisons.length > 0 && comparisons.length !== fields.length) {
    return skipReason(
      "comparison-overload",
      "open block mixes comparison and assignment declarations"
    );
  }
  const types = fields.map((field) => field.type);
  const value =
    comparisons.length === 0 ? emitter.unionFor(types) : comparisonValue(emitter, types);
  if (value === null) {
    return skipReason(
      "unsupported-field-value",
      "open block values have a type the emitter cannot express"
    );
  }
  if ("category" in value) {
    return value;
  }
  return {
    keyName: mapKeyName(declarations[0]!.keyType),
    indexType,
    ...(keyRefTypes === undefined ? {} : { keyRefTypes }),
    value,
    ...(comparisons.length === 0 ? {} : { comparison: true as const }),
    cardinality: totalCardinality(fields),
    splice,
  };
}

/** The one clause category and scope a group of clause declarations agrees on. */
function mergedClause(
  emitter: Emitter,
  name: string,
  group: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
):
  | {
      /** The kind of script rules the clause accepts. */
      readonly category: ClauseCategory;
      /** The canonical pushed scope, or `null` for the enclosing scope. */
      readonly scope: string | null;
      /** How entering the clause changes the live game scope identity. */
      readonly transition: ScopeTransition;
    }
  | SkipReason {
  const category = clauseOf(group[0]!.type)!;
  if (group.some((field) => clauseOf(field.type) !== category)) {
    return skipReason("mixed-clause-categories", `field "${name}" mixes clause categories`);
  }
  if (!allowedSplices.has(category)) {
    return skipReason(
      "unsupported-clause",
      `field "${name}" holds ${category} rules, which this emitter cannot type`
    );
  }
  const scope = clauseScope(emitter, name, group, inheritedScope);
  return "detail" in scope ? scope : { category, ...scope };
}

/** Merges a group whose every declaration is a clause hole into one typed hole. */
function mergedClauseValue(
  emitter: Emitter,
  name: string,
  group: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgValue | SkipReason {
  const clause = mergedClause(emitter, name, group, inheritedScope, allowedSplices);
  return "detail" in clause ? clause : { kind: "clause", ...clause, splice: false };
}

/**
 * Lowers one field's braced arm: a block of named fields or an open map,
 * lowered by recursion, or a block of bare values handed to
 * {@link bareBlockValue}.
 */
function structuredArmValue(
  emitter: Emitter,
  name: string,
  declaration: RuleField & { readonly type: Extract<RuleType, { readonly kind: "block" }> },
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): BlockValue | Extract<ArgValue, { readonly kind: "clause" }> | SkipReason {
  const block = declaration.type;
  const scope = declaration.scope === null ? inheritedScope : clauseScopeContext(declaration.scope);
  const inArm = (detail: string): string => `field "${name}" structured arm ${detail}`;
  if (block.bare.length > 0) {
    const value = bareBlockValue(emitter, block.bare, scope, allowedSplices);
    return "detail" in value ? { ...value, detail: inArm(value.detail) } : value;
  }
  const lowered = mergeBlock(emitter, block.fields, scope, allowedSplices);
  if ("detail" in lowered) {
    return { ...lowered, detail: inArm(lowered.detail) };
  }
  return lowered.kind === "fields" && lowered.fields.length === 0
    ? skipReason("empty-structured-arm", inArm("has no typeable fields"))
    : lowered;
}

/**
 * Merges a group holding a braced arm, possibly overloaded with scalar
 * declarations. The arms stay separable at runtime because the block's own
 * kind says which authored shapes belong to it.
 */
function mergedStructuredValue(
  emitter: Emitter,
  name: string,
  group: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgValue | SkipReason {
  const structured = group.filter(
    (
      field
    ): field is RuleField & { readonly type: Extract<RuleType, { readonly kind: "block" }> } =>
      field.type.kind === "block"
  );
  const scalarDeclarations = group.filter((field) => field.type.kind !== "block");
  if (structured.length !== 1) {
    return skipReason(
      "multiple-structured-scalar-arms",
      `field "${name}" has more than one structured/scalar arm`
    );
  }
  const arm = structuredArmValue(emitter, name, structured[0]!, inheritedScope, allowedSplices);
  if ("detail" in arm || scalarDeclarations.length === 0) {
    return arm;
  }
  if (arm.kind === "clause") {
    return skipReason(
      "clause-scalar-overload",
      `field "${name}" overloaded between a clause and a scalar`
    );
  }
  const scalar = emitter.unionFor(scalarDeclarations.map((field) => field.type));
  if (scalar === null) {
    return skipReason(
      "unsupported-scalar-arm",
      `field "${name}" has a scalar arm the emitter cannot express`
    );
  }
  return { kind: "scalarOrBlock", scalar, block: arm };
}

/** Merges a comparison group: the operand type plus any literal overloads. */
function mergedComparisonValue(
  emitter: Emitter,
  name: string,
  group: readonly RuleField[]
): ArgValue | SkipReason {
  const value = comparisonValue(
    emitter,
    group.filter((field) => field.comparison).map((field) => field.type)
  );
  if ("category" in value) {
    return {
      ...value,
      detail: `comparison field "${name}" ${value.detail}`,
    };
  }
  const rest = group.filter((field) => !field.comparison).map((field) => field.type);
  const literals = rest.flatMap((type) => (type.kind === "literal" ? [type.text] : []));
  if (literals.length !== rest.length) {
    return skipReason(
      "comparison-overload",
      `comparison field "${name}" overloaded with a non-literal declaration`
    );
  }
  return { kind: "comparison", value, literals };
}

/**
 * Merges a group whose every declaration is a block holding nothing but
 * splices of one alias category with its own authoring surface. Returns `null`
 * when the group is not that, so the caller can go on classifying it.
 */
function mergedAliasValue(
  emitter: Emitter,
  name: string,
  group: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgValue | SkipReason | null {
  const categories = new Set(group.map((field) => pureSpliceCategory(field.type)));
  if (categories.size !== 1) {
    return null;
  }
  const [category] = categories;
  if (category == null || !SCRIPT_ALIAS_CATEGORIES.has(category)) {
    return null;
  }
  if (!allowedSplices.has(category)) {
    return skipReason(
      "unsupported-alias-splice",
      `field "${name}" splices ${category}, which this emitter cannot type`
    );
  }
  if (EXTRA_ALIAS_CATEGORIES.get(category)?.scriptList === undefined) {
    return { kind: "aliasStruct", category };
  }
  const scope = clauseScope(emitter, name, group, inheritedScope);
  if ("detail" in scope) {
    return scope;
  }
  return { kind: "aliasList", category, scope: scope.scope, splice: false };
}

/**
 * Classifies one name's declarations into their argument kind — clause hole,
 * spliced alias category, structured arm, comparison, plain scalar — and
 * merges them into the one typed value the field carries.
 */
function mergedArgValue(
  emitter: Emitter,
  name: string,
  group: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgValue | SkipReason {
  const clauses = group.filter((field) => clauseOf(field.type) !== null);
  if (clauses.length === group.length) {
    return mergedClauseValue(emitter, name, group, inheritedScope, allowedSplices);
  }
  if (clauses.length > 0) {
    return skipReason(
      "clause-scalar-overload",
      `field "${name}" overloaded between a clause and a scalar`
    );
  }
  const alias = mergedAliasValue(emitter, name, group, inheritedScope, allowedSplices);
  if (alias !== null) {
    return alias;
  }
  if (group.some((field) => field.type.kind === "block")) {
    return mergedStructuredValue(emitter, name, group, inheritedScope, allowedSplices);
  }
  if (group.some((field) => field.comparison)) {
    return mergedComparisonValue(emitter, name, group);
  }
  const value = emitter.unionFor(group.map((field) => field.type));
  if (value === null) {
    return skipReason(
      "unsupported-field-value",
      `field "${name}" has a type the emitter cannot express`
    );
  }
  return { kind: "scalar", value };
}

/** The authoring member each spliced clause category contributes to its block. */
const CLAUSE_SPLICE_MEMBERS: readonly {
  /** The spliced clause category. */
  readonly category: ClauseCategory;
  /** The member the block's author writes the clause under. */
  readonly member: string;
  /** What the member holds, since the rules name no field to document. */
  readonly summary: string;
}[] = [
  {
    category: "trigger",
    member: "conditions",
    summary: "The nested conditions, written bare inside the block beside its named keys.",
  },
  {
    category: "effect",
    member: "effects",
    summary: "The nested effects, written bare inside the block beside its named keys.",
  },
];

/**
 * The implicit member an unkeyed splice contributes beside a block's named
 * fields: `calc_true_if = { amount == int alias_name[trigger] }` takes its
 * conditions as one more argument, whose entries the writer then spreads bare
 * into the block.
 */
function splicedMember(
  emitter: Emitter,
  splices: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgField | SkipReason {
  const categories = new Set(
    splices.map((field) => (field.key.kind === "aliasName" ? field.key.category : ""))
  );
  if (categories.size !== 1) {
    return skipReason(
      "unsupported-alias-splice",
      `block splices more than one category (${[...categories].sort().join(", ")})`
    );
  }
  const category = [...categories][0]!;
  const clause = CLAUSE_SPLICE_MEMBERS.find((row) => row.category === category);
  const list = EXTRA_ALIAS_CATEGORIES.get(category)?.scriptList;
  const member = clause?.member ?? list?.memberName;
  if (member === undefined || !allowedSplices.has(category)) {
    return skipReason(
      "unsupported-alias-splice",
      `splices a category the field model cannot type (${category})`
    );
  }
  const scope = clauseScope(emitter, member, splices, inheritedScope);
  if ("detail" in scope) {
    return scope;
  }
  return {
    name: member,
    value:
      clause === undefined
        ? { kind: "aliasList", category, scope: scope.scope, splice: true }
        : {
            kind: "clause",
            category: clause.category,
            ...scope,
            splice: true,
          },
    optional: splices.every((field) => isOptional(field.cardinality)),
    docs: [
      ...(clause === undefined ? [] : [clause.summary]),
      ...splices.flatMap((field) => field.docs),
    ],
  };
}

/**
 * Merges the declarations of each named key into one typed field, preserving
 * the declared cardinality: a key any declaration permits more than once
 * becomes a repeated field.
 */
function mergeNamedGroups(
  emitter: Emitter,
  grouped: ReadonlyMap<string, RuleField[]>,
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgField[] | SkipReason {
  const merged: ArgField[] = [];
  for (const [name, group] of grouped) {
    const value = mergedArgValue(emitter, name, group, inheritedScope, allowedSplices);
    if ("detail" in value) {
      return value;
    }
    const occurrences = widestCardinality(group);
    merged.push({
      name,
      value,
      optional: isOptional(occurrences),
      ...(isRepeated(occurrences) ? { repeated: occurrences } : {}),
      // One key's declarations are its forms, and CWT documents each form
      // separately, so the same sentence usually arrives once per form.
      docs: [...new Set(group.flatMap((field) => field.docs))],
    });
  }
  return merged;
}

/**
 * Lowers one spliced alias category's members into the fields an author writes,
 * one per member name. Each member's own value is lowered by the ordinary
 * field path, so a member that splices its category again terminates at that
 * category's name rather than expanding it.
 */
export function aliasListMembers(
  emitter: Emitter,
  category: string,
  allowedSplices: ReadonlySet<string>
): ArgField[] | SkipReason {
  const members = emitter.rules.aliasCategories.get(category);
  if (members === undefined) {
    return skipReason(
      "unsupported-alias-splice",
      `the rules declare no alias[${category}:...] members`
    );
  }
  const fields = [...members].flatMap(([name, declarations]) =>
    declarations.map((declaration): RuleField => ({
      key: { kind: "name", name },
      type: declaration.type,
      cardinality: REQUIRED,
      docs: declaration.docs,
      scope: declaration.scope,
      line: declaration.line,
      comparison: declaration.comparison,
    }))
  );
  const block = mergeBlock(emitter, fields, null, allowedSplices);
  if ("detail" in block) {
    return block;
  }
  if (block.kind === "map") {
    return skipReason(
      "computed-field-key",
      `alias[${category}:...] members are an open-keyed block`
    );
  }
  return [...block.fields];
}

/** The member name a block's clause-valued computed keys take. */
const KEYED_CLAUSE_MEMBER = "cases";

/**
 * The documentation a synthesized case list carries. The rules document the
 * rule, never the key filter the cases come from, so the member states its own
 * contract: what one case is, how many the rules admit, and which keys it
 * refuses.
 */
function keyedClauseDocs(cardinality: Cardinality, reservedKeys: readonly string[]): string[] {
  const minimum =
    cardinality.min === 1 ? "At least one case." : `At least ${cardinality.min} cases.`;
  const reserved = reservedKeys.map((key) => `\`${key}\``).join(", ");
  return [
    "One case per key the selector may equal, in the order the game tests them; " +
      "the first match wins.",
    ...(isOptional(cardinality) ? [] : [minimum]),
    ...(reservedKeys.length === 0
      ? []
      : [`Keys the block writes itself (${reserved}) are rejected.`]),
  ];
}

/** Merges the clause-valued computed keys of one block into the member they describe. */
function keyedClausesField(
  emitter: Emitter,
  declarations: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>,
  reservedKeys: readonly string[]
): ArgField | SkipReason {
  const clause = mergedClause(
    emitter,
    KEYED_CLAUSE_MEMBER,
    declarations,
    inheritedScope,
    allowedSplices
  );
  if ("detail" in clause) {
    return clause;
  }
  const cardinality = totalCardinality(declarations);
  return {
    name: KEYED_CLAUSE_MEMBER,
    value: { kind: "keyedClauses", ...clause, cardinality, reservedKeys },
    optional: isOptional(cardinality),
    docs: [
      ...keyedClauseDocs(cardinality, reservedKeys),
      ...declarations.flatMap((declaration) => declaration.docs),
    ],
  };
}

/**
 * Places the member a block's computed keys lower to among its named members,
 * where the first computed declaration stands.
 */
function withComputedMember(
  members: readonly ArgField[],
  member: ArgField,
  position: number
): KeyedBlockValue | SkipReason {
  if (members.some((field) => field.name === member.name)) {
    return skipReason("reserved-field-collision", `a rule field is already named "${member.name}"`);
  }
  return {
    kind: "fields",
    fields: [...members.slice(0, position), member, ...members.slice(position)],
  };
}

/**
 * Lowers one CWT block of keyed fields into the argument it emits: named
 * members, or one map when every key is a key filter.
 *
 * An unkeyed alias splice becomes one more member, named for what it splices.
 * A block declaring computed keys beside named ones gets them as one extra
 * member — a map, or a case list when the computed keys hold clauses — placed
 * where its first declaration stands so the emitted key order matches the
 * shipped files. `inheritedScope` retains the declaration's scope transition,
 * so clause fields without their own annotation run in that exact context.
 */
export function mergeBlock(
  emitter: Emitter,
  fields: readonly RuleField[],
  inheritedScope: ClauseScope | string | null,
  allowedSplices: ReadonlySet<string>
): KeyedBlockValue | SkipReason {
  const inherited = inheritedClauseScope(inheritedScope);
  const splices = fields.filter((field) => field.key.kind === "aliasName");
  const partition = partitionBlock(
    emitter,
    fields.filter((field) => field.key.kind !== "aliasName")
  );
  if ("detail" in partition) {
    return partition;
  }
  // A splice writes entries the block's own keys sit beside, and so does an
  // open map. Which of the two a shipped key belongs to is not recoverable
  // from the key alone, so the pair is declined rather than guessed at.
  if (splices.length > 0 && partition.open.length > 0) {
    return skipReason("computed-field-key", "open-keyed block beside an alias splice");
  }
  // A case writes its key as a block, and so do a splice's own entries and an
  // open map's, so the same key would belong to two members at once.
  if (partition.keyed.length > 0 && (splices.length > 0 || partition.open.length > 0)) {
    return skipReason("computed-field-key", "keyed clauses beside an alias splice or an open map");
  }
  const merged = mergeNamedGroups(emitter, partition.named, inherited, allowedSplices);
  if (!Array.isArray(merged)) {
    return merged;
  }
  const members = appendSplicedMember(emitter, merged, splices, inherited, allowedSplices);
  if (!Array.isArray(members)) {
    return members;
  }
  if (partition.keyed.length > 0) {
    const cases = keyedClausesField(
      emitter,
      partition.keyed,
      inherited,
      allowedSplices,
      members.map((field) => field.name)
    );
    return "detail" in cases
      ? cases
      : withComputedMember(members, cases, partition.computedPosition);
  }
  if (partition.open.length === 0) {
    return { kind: "fields", fields: members };
  }
  if (members.length === 0) {
    const map = openMapValue(emitter, partition.open, false);
    return "category" in map ? map : { kind: "map", map };
  }
  const families = new Set(partition.open.map((declaration) => mapKeyFamily(declaration.keyType)));
  if (families.size > 1) {
    return skipReason("computed-field-key", "mixed block with more than one computed key family");
  }
  const map = openMapValue(emitter, partition.open, true);
  if ("category" in map) {
    return map;
  }
  const member: ArgField = {
    name: mapMemberName(partition.open[0]!.keyType),
    value: { kind: "map", map },
    optional: isOptional(map.cardinality),
    docs: partition.open.flatMap((declaration) => declaration.field.docs),
  };
  return withComputedMember(members, member, partition.computedPosition);
}

/**
 * Adds the member an unkeyed splice contributes, or returns the named members
 * unchanged when the block splices nothing.
 */
function appendSplicedMember(
  emitter: Emitter,
  merged: readonly ArgField[],
  splices: readonly RuleField[],
  inheritedScope: ClauseScope,
  allowedSplices: ReadonlySet<string>
): ArgField[] | SkipReason {
  if (splices.length === 0) {
    return [...merged];
  }
  const spliced = splicedMember(emitter, splices, inheritedScope, allowedSplices);
  if ("detail" in spliced) {
    return spliced;
  }
  if (merged.some((field) => field.name === spliced.name)) {
    return skipReason(
      "reserved-field-collision",
      `a rule field is already named "${spliced.name}"`
    );
  }
  return [...merged, spliced];
}
