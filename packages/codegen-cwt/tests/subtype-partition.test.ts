/**
 * `partitionSubtypeFields` on hand-built fields, so each disposition is
 * asserted on its own rather than inferred from a component-template diff.
 *
 * The shapes mirror `components.cwt`: three subtypes whose `## type_key_filter`
 * is the registry keyword their definitions are written under, plus a fourth
 * (`planet_killer`) that shares weapon's filter and therefore co-occurs with it.
 */

import type { RuleField } from "@pdx-ts/codegen-cwt/cwt/model";
import type { ContentSubtype } from "@pdx-ts/codegen-cwt/cwt/rules";
import { partitionSubtypeFields } from "@pdx-ts/codegen-cwt/emit/subtype-partition";
import { describe, expect, it } from "vitest";

function subtype(name: string, keyFilter: string | null): ContentSubtype {
  return {
    name,
    group: null,
    keyFilter,
    pushScope: null,
    displayName: null,
    absentUnless: null,
  };
}

const UTILITY = subtype("utility_component_template", "utility_component_template");
const WEAPON = subtype("weapon_component_template", "weapon_component_template");
const STRIKE_CRAFT = subtype("strike_craft_component_template", "strike_craft_component_template");
/** Same filter as weapon: a planet killer *is* a weapon component template. */
const PLANET_KILLER = subtype("planet_killer", "weapon_component_template");
/** Declares no filter at all, so nothing is known to exclude it. */
const UNFILTERED = subtype("required_component", null);

const DECLARED = [UTILITY, WEAPON, STRIKE_CRAFT, PLANET_KILLER, UNFILTERED];

function named(name: string, min = 1, docs: readonly string[] = []): RuleField {
  return {
    key: { kind: "name", name },
    type: { kind: "bool" },
    cardinality: { min, max: 1 },
    docs,
    scope: null,
    line: 1,
    comparison: false,
  };
}

function arm(name: string, negated: boolean, fields: readonly RuleField[]): RuleField {
  return {
    key: { kind: "subtype", name, negated },
    type: { kind: "block", fields, bare: [] },
    cardinality: { min: 1, max: 1 },
    docs: [],
    scope: null,
    line: 1,
    comparison: false,
  };
}

function names(fields: readonly RuleField[]): string[] {
  return fields.map((field) =>
    field.key.kind === "name"
      ? field.key.name
      : field.key.kind === "subtype"
        ? `subtype[${field.key.negated ? "!" : ""}${field.key.name}]`
        : field.key.kind
  );
}

describe("partitionSubtypeFields", () => {
  it("inlines the registry's own arm with no conditional doc line and min 0", () => {
    const fields = [
      named("key"),
      arm(UTILITY.name, false, [named("ftl"), named("size", 1, ["The slot it fits."])]),
    ];
    const partitioned = partitionSubtypeFields(fields, UTILITY, DECLARED);
    expect(names(partitioned)).toEqual(["key", "ftl", "size"]);
    const size = partitioned[2]!;
    expect(size.cardinality).toEqual({ min: 0, max: 1 });
    // The predicate holds by construction here, so nothing narrates it.
    expect(size.docs).toEqual(["The slot it fits."]);
    // Non-subtype fields are passed through untouched, minimum included.
    expect(partitioned[0]).toBe(fields[0]);
    expect(partitioned[0]!.cardinality).toEqual({ min: 1, max: 1 });
  });

  it("drops an arm belonging to a subtype that cannot co-occur", () => {
    const fields = [
      named("key"),
      arm(WEAPON.name, false, [named("target_weights"), named("size")]),
      arm(STRIKE_CRAFT.name, false, [named("launch_time")]),
    ];
    expect(names(partitionSubtypeFields(fields, UTILITY, DECLARED))).toEqual(["key"]);
  });

  it("drops the registry's own negated arm", () => {
    const fields = [named("key"), arm(UTILITY.name, true, [named("power")])];
    expect(names(partitionSubtypeFields(fields, UTILITY, DECLARED))).toEqual(["key"]);
  });

  it("inlines a negated arm naming a subtype that cannot co-occur", () => {
    const fields = [arm(WEAPON.name, true, [named("ftl", 1, ["Faster than light."])])];
    const partitioned = partitionSubtypeFields(fields, UTILITY, DECLARED);
    expect(names(partitioned)).toEqual(["ftl"]);
    expect(partitioned[0]!.cardinality).toEqual({ min: 0, max: 1 });
    // "not weapon" is always true for utility, so this is not conditional
    // either — no doc line, same as the positive self arm.
    expect(partitioned[0]!.docs).toEqual(["Faster than light."]);
  });

  it("keeps an overlapping arm standing, so flatten narrates it", () => {
    // planet_killer carries weapon's own type_key_filter, so a weapon component
    // template may or may not be one. Dropping the arm would lose
    // `can_destroy_stars` from weapon entirely; inlining it would claim every
    // weapon has it.
    const fields = [arm(PLANET_KILLER.name, false, [named("can_destroy_stars")])];
    const partitioned = partitionSubtypeFields(fields, WEAPON, DECLARED);
    expect(names(partitioned)).toEqual(["subtype[planet_killer]"]);
    expect(partitioned[0]).toBe(fields[0]);
  });

  it("keeps an arm whose subtype declares no key filter, and one it never declared", () => {
    const unknown = arm("no_such_subtype", false, [named("mystery")]);
    const unfiltered = arm(UNFILTERED.name, false, [named("required")]);
    const negatedUnfiltered = arm(UNFILTERED.name, true, [named("optional")]);
    const partitioned = partitionSubtypeFields(
      [unknown, unfiltered, negatedUnfiltered],
      WEAPON,
      DECLARED
    );
    expect(names(partitioned)).toEqual([
      "subtype[no_such_subtype]",
      "subtype[required_component]",
      "subtype[!required_component]",
    ]);
  });

  it("recurses into a nested arm before inlining it", () => {
    const fields = [
      arm(WEAPON.name, false, [
        named("size"),
        arm(UTILITY.name, false, [named("ftl")]),
        arm(PLANET_KILLER.name, false, [named("can_destroy_stars")]),
        arm(WEAPON.name, false, [named("range", 1, ["Reach."])]),
      ]),
    ];
    const partitioned = partitionSubtypeFields(fields, WEAPON, DECLARED);
    // The utility arm nested inside weapon's is dropped, the planet_killer one
    // survives as a condition, and weapon's own inner arm inlines.
    expect(names(partitioned)).toEqual(["size", "subtype[planet_killer]", "range"]);
    expect(partitioned[2]!.cardinality).toEqual({ min: 0, max: 1 });
    expect(partitioned[2]!.docs).toEqual(["Reach."]);
  });

  it("leaves a body with no subtype arms exactly as it found it", () => {
    const fields = [named("key"), named("icon"), named("power", 0)];
    expect(partitionSubtypeFields(fields, UTILITY, DECLARED)).toEqual(fields);
  });
});
