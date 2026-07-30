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
 * stays with each emitter. A `string` return is the skip reason — the caller
 * reports it, nothing is dropped silently.
 */

import { isOptional, type RuleField, type RuleType } from "../cwt/model.ts";
import { UNIVERSAL_SCOPES } from "../overlay.ts";
import type { Emitter, TsValue } from "./types.ts";

export interface SkippedRule {
  readonly name: string;
  readonly reason: string;
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

export type ClauseCategory = "trigger" | "effect" | "modifier_rule";

export type ArgValue =
  | { readonly kind: "scalar"; readonly value: TsValue }
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
  | { readonly kind: "comparison"; readonly literals: readonly string[] };

export interface ArgField {
  readonly name: string;
  readonly value: ArgValue;
  readonly optional: boolean;
  readonly docs: readonly string[];
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
 * A `string` return is the skip reason.
 */
function clauseScope(
  emitter: Emitter,
  name: string,
  fields: readonly RuleField[],
  inherited: string | null
): string | null | { readonly reason: string } {
  const pushed =
    fields.map((field) => field.scope?.this).find((scope) => scope != null) ?? inherited;
  if (pushed == null) {
    return null;
  }
  const canonical = emitter.canonicalScope(pushed);
  return canonical === null
    ? { reason: `field "${name}" pushes an unknown scope (${pushed})` }
    : canonical;
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
  allowedClauses: ReadonlySet<ClauseCategory>
): ArgField[] | string {
  const grouped = new Map<string, RuleField[]>();
  for (const field of expandEnumKeys(emitter, fields)) {
    if (field.key.kind !== "name") {
      return "block with computed or subtype field keys";
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
    const docs = group.flatMap((field) => field.docs);
    const clauses = group.filter((field) => clauseOf(field.type) !== null);

    if (clauses.length === group.length) {
      const category = clauseOf(group[0]!.type)!;
      if (group.some((field) => clauseOf(field.type) !== category)) {
        return `field "${name}" mixes clause categories`;
      }
      if (!allowedClauses.has(category)) {
        return `field "${name}" splices ${category}, which this emitter cannot type`;
      }
      const scope = clauseScope(emitter, name, group, inheritedScope);
      if (typeof scope === "object" && scope !== null) {
        return scope.reason;
      }
      merged.push({
        name,
        value: { kind: "clause", category, scope, splice: false },
        optional,
        docs,
      });
      continue;
    }
    if (clauses.length > 0) {
      return `field "${name}" overloaded between a clause and a scalar`;
    }

    if (group.some((field) => field.comparison)) {
      const value = emitter.unionFor(
        group.filter((field) => field.comparison).map((field) => field.type)
      );
      if (value === null || value.type !== "number") {
        return `comparison field "${name}" is not numeric`;
      }
      const rest = group.filter((field) => !field.comparison).map((field) => field.type);
      const literals = rest.flatMap((type) => (type.kind === "literal" ? [type.text] : []));
      if (literals.length !== rest.length) {
        return `comparison field "${name}" overloaded with a non-literal declaration`;
      }
      merged.push({ name, value: { kind: "comparison", literals }, optional, docs });
      continue;
    }

    const value = emitter.unionFor(group.map((field) => field.type));
    if (value === null) {
      return `field "${name}" has a type the emitter cannot express`;
    }
    merged.push({ name, value: { kind: "scalar", value }, optional, docs });
  }
  return merged;
}
