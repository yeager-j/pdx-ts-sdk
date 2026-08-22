/**
 * Partitions a shared CWT type body for one subtype-backed SDK registry.
 * Only distinct positive key filters prove two subtype arms disjoint; unknown relationships
 * remain conditional, and inlined fields stay optional.
 */

import type { RuleField } from "../cwt/model.ts";
import type { ContentSubtype } from "../cwt/rules.ts";

type Relation = "self" | "disjoint" | "overlapping";

function relationTo(
  name: string,
  self: ContentSubtype,
  declared: readonly ContentSubtype[]
): Relation {
  if (name === self.name) {
    return "self";
  }
  const other = declared.find((candidate) => candidate.name === name);
  // Only a positive filter on both sides says the two are written under
  // different keys. A negated one (`## type_key_filter <> room_selector`) says
  // which key its subtype is *not* written under, which excludes nothing about
  // the other, so it stays overlapping.
  if (
    other?.keyFilter != null &&
    !other.keyFilter.negated &&
    self.keyFilter !== null &&
    !self.keyFilter.negated &&
    other.keyFilter.key !== self.keyFilter.key
  ) {
    return "disjoint";
  }
  return "overlapping";
}

/**
 * Selects the CWT fields that can apply to one subtype-backed registry.
 * It preserves declaration order, inlines known matching arms as optional fields,
 * drops known disjoint arms, and leaves overlapping arms conditional.
 */
export function partitionSubtypeFields(
  fields: readonly RuleField[],
  self: ContentSubtype,
  declared: readonly ContentSubtype[]
): RuleField[] {
  return fields.flatMap((field): RuleField[] => {
    const key = field.key;
    if (key.kind !== "subtype") {
      return [field];
    }
    const relation = relationTo(key.name, self, declared);
    if (relation === "overlapping") {
      return [field];
    }
    const applies = key.negated ? relation === "disjoint" : relation === "self";
    if (!applies) {
      return [];
    }
    if (field.type.kind !== "block") {
      return [];
    }
    return partitionSubtypeFields(field.type.fields, self, declared).map((inner) => ({
      ...inner,
      cardinality: { min: 0, max: inner.cardinality.max },
    }));
  });
}
