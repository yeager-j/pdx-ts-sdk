/**
 * Cuts one CWT type's body down to the fields a single subtype-backed registry
 * actually has.
 *
 * A CWT type can back several SDK registries: `type[component_template]`
 * declares `subtype[utility_component_template]`,
 * `subtype[weapon_component_template]` and
 * `subtype[strike_craft_component_template]`, and the manifest's `as` rename
 * turns each into its own registry. The body, though, is one body — every
 * subtype arm of it, whichever registry is being emitted.
 *
 * {@link flatten} erases which arm a field came from (it keeps the name only in
 * an "Only when …" doc line), and {@link mergeByName} then groups by name in
 * declaration order, so the first arm to declare a name wins the whole group.
 * Running that over the shared body gave every component-template registry
 * every other one's fields: utility acquired the weapon damage family, weapon
 * acquired utility's `ftl`/`jumpdrive`, and `size` came out
 * `WeaponSlotSize | UtilitySlotSize` on all three because weapon declares it
 * first. This pass runs before either of those and removes the arms that are
 * not this registry's, so the erasure has nothing left to confuse.
 *
 * The classification is deliberately conservative. Two subtypes are treated as
 * mutually exclusive only when the rules say so *positively* — each declares
 * its own `## type_key_filter` and the two filters differ, which for these
 * three is the registry keyword the definition is written under. Everything
 * else overlaps: `subtype[planet_killer]` carries
 * `## type_key_filter = weapon_component_template`, so it co-occurs with
 * `subtype[weapon_component_template]` on the same definition and its fields
 * must stay conditional on weapon rather than be dropped from it. A subtype
 * with no filter, or one this type never declared, is unknown rather than
 * exclusive, and unknown resolves to "keep it, conditionally".
 *
 * Inlined fields are relaxed to `min: 0`, matching {@link flatten}. Some of
 * them are declared required inside their arm (`size` is `1..1` on weapon and
 * utility alike), and now that the arm is known to apply, that minimum could be
 * restored. It deliberately is not: every such member is optional in the
 * shipped API today, and tightening one is a breaking change to authoring code
 * that has nothing to do with fixing the contamination. Restoring declared
 * minimums is a follow-up, on its own evidence.
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
 * The fields of `self`'s registry, with every other registry's arm removed.
 *
 * An arm whose predicate is known true for this registry — `subtype[self]`, or
 * `subtype[!other]` for an `other` that cannot co-occur with it — is inlined at
 * the point it was declared, so emission order still follows the rules' own
 * order. An arm whose predicate is known false is dropped. An arm that may or
 * may not apply is left standing as a subtype field, for {@link flatten} to
 * flatten with its conditional doc line.
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
