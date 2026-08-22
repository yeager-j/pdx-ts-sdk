/**
 * A canonical, order-independent text fingerprint of one CWT `RuleField` or
 * `RuleType` — the same declaration always serializes to the same string,
 * and a declaration that changed shape always serializes to a different one.
 *
 * `event-field-policy.ts` hashes this text with SHA-256 to pin each event and
 * option field's CWT arm against the reviewed support policy: a rule that
 * silently reshapes underneath the policy changes its signature, and the
 * hash comparison catches it. Nothing here knows about that policy, or about
 * events at all — it is a pure reading of the rule model, reusable by any
 * future caller that needs to notice a CWT shape changing underneath it.
 */

import type { RuleField, RuleType } from "./model.ts";

function rangeSignature(range: {
  readonly min: number | null;
  readonly max: number | null;
}): string {
  return `${range.min ?? "-inf"}..${range.max ?? "inf"}`;
}

/** Serializes a field's nested scope context for inclusion in a fingerprint. */
export function scopeSignature(field: RuleField): string {
  const scope = field.scope;
  return scope === null
    ? "inherited"
    : [scope.this, scope.root, scope.from, scope.replaces ? "replace" : "push"]
        .map((part) => part ?? "-")
        .join("/");
}

function keySignature(field: RuleField): string {
  const key = field.key;
  switch (key.kind) {
    case "name":
      return key.name;
    case "computed":
      return `computed[${ruleTypeSignature(key.type)}]`;
    case "aliasName":
      return `alias_name[${key.category}]`;
    case "subtype":
      return `subtype[${key.negated ? "!" : ""}${key.name}]`;
  }
}

/** Serializes a rule type into a deterministic, order-independent fingerprint. */
export function ruleTypeSignature(type: RuleType): string {
  switch (type.kind) {
    case "bool":
    case "scalar":
    case "localisation":
      return type.kind;
    case "int":
    case "float":
      return type.range === null ? type.kind : `${type.kind}[${rangeSignature(type.range)}]`;
    case "valueField":
      return type.integer ? "int_value_field" : "value_field";
    case "enum":
      return `enum[${type.name}]`;
    case "typeRef":
      return `<${type.name}>`;
    case "valueSet":
      return `value_set[${type.name}]`;
    case "scope":
      return `scope[${type.name}]`;
    case "scopeGroup":
      return `scope_group[${type.name}]`;
    case "filepath":
      return `filepath[${type.path ?? ""}]`;
    case "icon":
      return `icon[${type.path}]`;
    case "colour":
      return `colour[${type.format}]`;
    case "aliasMatchLeft":
      return `alias_match_left[${type.category}]`;
    case "singleAliasRight":
      return `single_alias_right[${type.name}]`;
    case "unknownKeyword":
      return `unknown[${type.text}]`;
    case "literal":
      return `literal[${JSON.stringify(type.text)}]`;
    case "block": {
      const fields = type.fields.map(fieldSignature).sort();
      const bare = type.bare.map((value) => ruleTypeSignature(value.type)).sort();
      return `block{fields=[${fields.join(";")}];bare=[${bare.join(";")}]}`;
    }
  }
}

/** Serializes a keyed rule field into a deterministic fingerprint. */
export function fieldSignature(field: RuleField): string {
  const cardinality = `${field.cardinality.min}..${field.cardinality.max ?? "inf"}`;
  return `${keySignature(field)}:${cardinality}:${field.comparison ? "comparison" : "assignment"}:${scopeSignature(field)}:${ruleTypeSignature(field.type)}`;
}

function memberNames(type: RuleType): string[] {
  if (type.kind !== "block") {
    return [];
  }
  const names: string[] = [];
  for (const field of type.fields) {
    if (field.key.kind === "subtype") {
      names.push(...memberNames(field.type));
      continue;
    }
    if (field.key.kind === "name") {
      names.push(field.key.name);
      continue;
    }
    if (field.key.kind === "aliasName") {
      names.push(`alias_name[${field.key.category}]`);
    }
  }
  return names;
}

/** Describes whether a field is scalar or block-shaped and names its block members. */
export function armShape(field: RuleField): string {
  const cardinality = `${field.cardinality.min}..${field.cardinality.max ?? "inf"}`;
  if (field.type.kind !== "block") {
    return `scalar ${cardinality}`;
  }
  return `block ${cardinality} {${[...new Set(memberNames(field.type))].sort().join(", ")}}`;
}
