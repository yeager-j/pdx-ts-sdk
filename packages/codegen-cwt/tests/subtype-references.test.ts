/**
 * `subtypeReferenceRefinements`: the qualified references the rules write,
 * and which of them one authored flag selects — the derivation the capability
 * returns a qualified reference by, and the mission arm reads its witness from.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleField, RuleType } from "@pdx-ts/codegen-cwt/cwt/model";
import type { ContentSubtype, ContentType, RuleSet } from "@pdx-ts/codegen-cwt/cwt/rules";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import {
  qualifiedSubtypeReferences,
  subtypeReferenceRefinements,
} from "@pdx-ts/codegen-cwt/lower/content-reference";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));

function subtype(name: string, selector: ContentSubtype["selector"]): ContentSubtype {
  return { name, group: null, keyFilter: null, pushScope: null, displayName: null, selector };
}

function field(name: string, type: RuleType, min = 1): RuleField {
  return {
    key: { kind: "name", name },
    type,
    cardinality: { min, max: 1 },
    docs: [],
    scope: null,
    line: 1,
    comparison: false,
  };
}

/** A rule set of only the parts the derivation reads. */
function rulesOf(
  types: readonly { name: string; subtypes: ContentSubtype[]; fields: RuleField[] }[]
): RuleSet {
  const contentTypes = new Map<string, ContentType>();
  const bodies = new Map<string, { fields: RuleField[]; scope: null; file: string }>();
  for (const type of types) {
    contentTypes.set(type.name, {
      name: type.name,
      path: `game/common/${type.name}`,
      nameField: null,
      keyFilter: null,
      subtypes: type.subtypes,
      localisation: [],
    });
    bodies.set(type.name, { fields: type.fields, scope: null, file: `${type.name}.cwt` });
  }
  return { contentTypes, bodies } as unknown as RuleSet;
}

const flag = (name: string): ContentSubtype["selector"] => ({
  kind: "flag",
  field: name,
  set: true,
});

describe("qualifiedSubtypeReferences", () => {
  it("collects references written in fields and in other types' subtype selectors", () => {
    const references = qualifiedSubtypeReferences(rules);
    // `ship_size.required_component_set = <component_set.required_component>`.
    expect(references.has("component_set.required_component")).toBe(true);
    // `subtype[contract] = { category = <mission_category.contract> }` on `mission`.
    expect(references.has("mission_category.contract")).toBe(true);
  });
});

describe("subtypeReferenceRefinements", () => {
  it("refines each referenced subtype one flag selects, keeping the flag's requiredness", () => {
    const refinements = subtypeReferenceRefinements(rules);
    expect(refinements.get("mission_category")).toEqual({
      type: "mission_category",
      subtype: "contract",
      reference: "mission_category.contract",
      field: "is_contract",
      member: "isContract",
      required: true,
    });
    expect(refinements.get("component_set")).toMatchObject({
      reference: "component_set.required_component",
      member: "requiredComponentSet",
      required: false,
    });
    // `<ship_size.starbase>` is written six times, but `class = shipclass_starbase`
    // is a literal selector, so nothing refines it.
    expect(refinements.has("ship_size")).toBe(false);
  });

  it("refines nothing for a subtype no flag selects, or that nothing references", () => {
    const refinements = subtypeReferenceRefinements(
      rulesOf([
        {
          name: "thing",
          subtypes: [
            subtype("written", { kind: "present", field: "extra" }),
            subtype("lonely", flag("lonely")),
          ],
          fields: [
            field("extra", { kind: "int", range: null }, 0),
            field("lonely", { kind: "bool" }, 0),
          ],
        },
        {
          name: "user",
          subtypes: [],
          fields: [field("ref", { kind: "typeRef", name: "thing.written" })],
        },
      ])
    );
    expect(refinements.size).toBe(0);
  });

  it("rejects a selecting flag the body does not declare as bool", () => {
    expect(() =>
      subtypeReferenceRefinements(
        rulesOf([
          {
            name: "thing",
            subtypes: [subtype("special", flag("special"))],
            fields: [field("special", { kind: "literal", text: "yes" })],
          },
          {
            name: "user",
            subtypes: [],
            fields: [field("ref", { kind: "typeRef", name: "thing.special" })],
          },
        ])
      )
    ).toThrow("declares special as literal rather than bool");
  });

  it("rejects a type with two flag-selected subtypes the rules reference", () => {
    expect(() =>
      subtypeReferenceRefinements(
        rulesOf([
          {
            name: "thing",
            subtypes: [subtype("a", flag("is_a")), subtype("b", flag("is_b"))],
            fields: [field("is_a", { kind: "bool" }), field("is_b", { kind: "bool" })],
          },
          {
            name: "user",
            subtypes: [],
            fields: [
              field("a", { kind: "typeRef", name: "thing.a" }),
              field("b", { kind: "typeRef", name: "thing.b" }),
            ],
          },
        ])
      )
    ).toThrow("two flag-selected subtypes the rules reference qualified");
  });
});
