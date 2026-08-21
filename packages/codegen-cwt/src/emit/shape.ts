/**
 * Shared field-shape classification for block rules.
 *
 * A block rule's fields fall into three argument kinds: plain scalars, nested
 * clause holes (`limit = single_alias_right[trigger_clause]` — an opaque,
 * already-built `Trigger`, so recursion terminates at depth one by
 * construction), and comparison fields (`count == int_value_field`, sometimes
 * overloaded with literals like `count = all`).
 *
 * Classification is shared between the trigger and effect emitters; rendering
 * stays with each emitter. A `SkipReason` return carries the stable category
 * and report detail, so nothing is dropped silently.
 */

import { isOptional, isRepeated, type RuleField, type RuleType } from "../cwt/model.ts";
import { UNIVERSAL_SCOPES } from "../overlay.ts";
import type { Emitter, TsValue } from "./types.ts";

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
  | "empty-block"
  | "reserved-field-collision"
  | "computed-field-key"
  | "mixed-clause-categories"
  | "clause-scalar-overload"
  | "multiple-structured-scalar-arms"
  | "repeated-structured-scalar-arms"
  | "unsupported-scalar-arm"
  | "structured-bare-values"
  | "repeated-nested-field"
  | "empty-structured-arm"
  | "unsupported-comparison-operand"
  | "comparison-overload"
  | "unsupported-field-value";

export type ScriptSkipCategory =
  | ScriptGenerationSkipCategory
  | "abstract-placeholder"
  | "handwritten-trigger"
  | "structural-effect"
  | "event-fire-effect"
  | "scopeless-event-kind"
  | "missing-fire-rule-scope"
  | "event-policy-rejected"
  | "value-link"
  | "data-link"
  | "missing-output-scope"
  | "polymorphic-output-scope"
  | "unknown-output-scope"
  | "unknown-input-scope";

export interface SkipReason {
  readonly category: ScriptSkipCategory;
  readonly detail: string;
}

export interface SkippedRule extends SkipReason {
  readonly name: string;
}

export function skipReason(category: ScriptSkipCategory, detail: string): SkipReason {
  return { category, detail };
}

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
  doc: { readonly scopes: readonly string[] } | undefined
): readonly string[] {
  const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
  return declared.length > 0 ? declared : (doc?.scopes ?? []);
}

export type ClauseCategory = "trigger" | "effect" | "modifier_rule";

export type ArgValue =
  | { readonly kind: "scalar"; readonly value: TsValue }
  /**
   * A field that accepts either one scalar value or a structured block. The
   * scalar arm's runtime object kinds are carried by `TsValue`, so generated
   * code can distinguish SDK scalar values from the structured block.
   */
  | {
      readonly kind: "scalarOrFields";
      readonly scalar: TsValue;
      readonly fields: readonly ArgField[];
    }
  /**
   * A typed hole for a nested clause. `scope` is the canonical scope the
   * clause runs in, or `null` for "the enclosing rule's own scope". `splice`
   * clauses spread their entries bare into the block; named clauses wrap them
   * under the field's key.
   */
  | {
      readonly kind: "clause";
      readonly category: ClauseCategory;
      readonly scope: string | null;
      readonly splice: boolean;
    }
  /** `count == int_value_field`, plus any literal overloads (`count = all`). */
  | {
      readonly kind: "comparison";
      readonly value: TsValue;
      readonly literals: readonly string[];
    };

export interface ArgField {
  readonly name: string;
  readonly value: ArgValue;
  readonly optional: boolean;
  readonly repeated?: boolean;
  readonly docs: readonly string[];
}

type AliasExpandedField = RuleField & { readonly aliasCategory: string };

function isAliasExpandedField(field: RuleField): field is AliasExpandedField {
  return "aliasCategory" in field;
}

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
    const members = emitter.rules.aliasCategories.get(field.key.category);
    if (members === undefined) {
      return skipReason(
        "unsupported-alias-splice",
        `splices a category the emitter cannot type (${field.key.category})`
      );
    }
    for (const [name, declarations] of members) {
      for (const declaration of declarations) {
        const expandedField: AliasExpandedField = {
          key: { kind: "name", name },
          type: declaration.type,
          cardinality: field.cardinality,
          docs: [...field.docs, ...declaration.docs],
          scope: field.scope ?? declaration.scope,
          line: field.line,
          comparison: field.comparison || declaration.comparison,
          aliasCategory: field.key.category,
        };
        expanded.push(expandedField);
      }
    }
  }
  return expanded;
}

/** The category of a block holding nothing but alias splices, else null. */
export function clauseOf(type: RuleType): ClauseCategory | null {
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
function clauseScope(
  emitter: Emitter,
  name: string,
  fields: readonly RuleField[],
  inherited: string | null
): string | null | SkipReason {
  const pushed =
    fields.map((field) => field.scope?.this).find((scope) => scope != null) ?? inherited;
  if (pushed == null) {
    return null;
  }
  const canonical = emitter.canonicalScope(pushed);
  return canonical === null
    ? skipReason("unknown-push-scope", `field "${name}" pushes an unknown scope (${pushed})`)
    : canonical;
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

/** Nested repeated members need arrays, which an ArgField does not model. */
function hasRepeatedNestedField(fields: readonly RuleField[]): boolean {
  return fields.some(
    (field) =>
      isRepeated(field.cardinality) ||
      (field.type.kind === "block" && hasRepeatedNestedField(field.type.fields))
  );
}

/**
 * Merges the repeated keys an overloaded rule produces into one typed field
 * each. `inheritedScope` is the raw scope the declaration pushes, if any —
 * clause fields without their own `## push_scope` run there.
 */
export function mergeFields(
  emitter: Emitter,
  fields: readonly RuleField[],
  inheritedScope: string | null,
  allowedClauses: ReadonlySet<ClauseCategory>,
  preserveRepeated = false
): ArgField[] | SkipReason {
  const grouped = new Map<string, RuleField[]>();
  for (const field of expandEnumKeys(emitter, fields)) {
    if (field.key.kind !== "name") {
      return skipReason("computed-field-key", "block with computed or subtype field keys");
    }
    const existing = grouped.get(field.key.name);
    if (existing === undefined) {
      grouped.set(field.key.name, [field]);
    } else {
      existing.push(field);
    }
  }

  const merged: ArgField[] = [];
  for (const [name, group] of grouped) {
    const optional = group.some((field) => isOptional(field.cardinality));
    const repeated = preserveRepeated && group.some((field) => isRepeated(field.cardinality));
    const docs = group.flatMap((field) => field.docs);
    const clauses = group.filter((field) => clauseOf(field.type) !== null);

    if (clauses.length === group.length) {
      const category = clauseOf(group[0]!.type)!;
      if (group.some((field) => clauseOf(field.type) !== category)) {
        return skipReason("mixed-clause-categories", `field "${name}" mixes clause categories`);
      }
      if (!allowedClauses.has(category)) {
        return skipReason(
          "unsupported-clause",
          `field "${name}" splices ${category}, which this emitter cannot type`
        );
      }
      const scope = clauseScope(emitter, name, group, inheritedScope);
      if (typeof scope === "object" && scope !== null) {
        return scope;
      }
      merged.push({
        name,
        value: { kind: "clause", category, scope, splice: false },
        optional,
        ...(repeated ? { repeated: true } : {}),
        docs,
      });
      continue;
    }
    if (clauses.length > 0) {
      return skipReason(
        "clause-scalar-overload",
        `field "${name}" overloaded between a clause and a scalar`
      );
    }

    const structured = group.filter(
      (
        field
      ): field is RuleField & { readonly type: Extract<RuleType, { readonly kind: "block" }> } =>
        field.type.kind === "block"
    );
    if (structured.length > 0) {
      const scalarDeclarations = group.filter((field) => field.type.kind !== "block");
      if (structured.length !== 1 || scalarDeclarations.length === 0) {
        return skipReason(
          "multiple-structured-scalar-arms",
          `field "${name}" has more than one structured/scalar arm`
        );
      }
      if (group.some((field) => isRepeated(field.cardinality))) {
        return skipReason(
          "repeated-structured-scalar-arms",
          `field "${name}" has repeated structured/scalar arms`
        );
      }
      const scalar = emitter.unionFor(scalarDeclarations.map((field) => field.type));
      if (scalar === null) {
        return skipReason(
          "unsupported-scalar-arm",
          `field "${name}" has a scalar arm the emitter cannot express`
        );
      }
      const block = structured[0]!.type;
      if (block.bare.length > 0) {
        return skipReason(
          "structured-bare-values",
          `field "${name}" structured arm has bare values`
        );
      }
      const preserveNested = group.some(isAliasExpandedField);
      if (hasRepeatedNestedField(block.fields) && !preserveNested) {
        return skipReason(
          "repeated-nested-field",
          `field "${name}" structured arm has repeated nested fields`
        );
      }
      const fields = mergeFields(
        emitter,
        block.fields,
        structured[0]!.scope?.this ?? inheritedScope,
        allowedClauses,
        preserveNested
      );
      if (!Array.isArray(fields)) {
        return {
          ...fields,
          detail: `field "${name}" structured arm ${fields.detail}`,
        };
      }
      if (fields.length === 0) {
        return skipReason(
          "empty-structured-arm",
          `field "${name}" structured arm has no typeable fields`
        );
      }
      merged.push({
        name,
        value: { kind: "scalarOrFields", scalar, fields },
        optional,
        ...(repeated ? { repeated: true } : {}),
        docs,
      });
      continue;
    }

    if (group.some((field) => field.comparison)) {
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
      merged.push({
        name,
        value: { kind: "comparison", value, literals },
        optional,
        ...(repeated ? { repeated: true } : {}),
        docs,
      });
      continue;
    }

    const value = emitter.unionFor(group.map((field) => field.type));
    if (value === null) {
      return skipReason(
        "unsupported-field-value",
        `field "${name}" has a type the emitter cannot express`
      );
    }
    merged.push({
      name,
      value: { kind: "scalar", value },
      optional,
      ...(repeated ? { repeated: true } : {}),
      docs,
    });
  }
  return merged;
}
