/**
 * `planSubtypeUnions` on hand-built fields, so each disposition — an arm
 * modelled as a named interface, a required declaration collapsed with its
 * reason, a member left in the base — is asserted on its own rather than
 * inferred from the technology diff.
 */

import type { RuleField, SubtypeCondition } from "@pdx-ts/codegen-cwt/cwt/model";
import type { ContentSubtype, ContentType, SubtypeSelector } from "@pdx-ts/codegen-cwt/cwt/rules";
import { flatten } from "@pdx-ts/codegen-cwt/emit/content/field-projection";
import {
  armStatuses,
  collapsedConditionRows,
  planSubtypeUnions,
  type ClaimableMember,
} from "@pdx-ts/codegen-cwt/emit/content/subtype-unions";
import { describe, expect, it } from "vitest";

function subtype(name: string, selector: SubtypeSelector | null): ContentSubtype {
  return { name, group: null, keyFilter: null, pushScope: null, displayName: null, selector };
}

function contentType(name: string, subtypes: readonly ContentSubtype[]): ContentType {
  return {
    name,
    path: `game/common/${name}`,
    nameField: null,
    keyFilter: null,
    subtypes,
    localisation: [],
  };
}

function named(name: string, min = 1, conditions?: readonly SubtypeCondition[]): RuleField {
  return {
    key: { kind: "name", name },
    type: { kind: "bool" },
    cardinality: { min, max: 1 },
    docs: [],
    scope: null,
    line: 1,
    comparison: false,
    ...(conditions === undefined ? {} : { conditions }),
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

function member(name: string, group: readonly RuleField[], type = "boolean"): ClaimableMember {
  return { name, member: name, group, type, memberType: type, docs: [], override: undefined };
}

const under = (subtypeName: string, negated = false): SubtypeCondition => ({
  subtype: subtypeName,
  negated,
  owner: "technology",
});

const START = subtype("start", { kind: "flag", field: "start_tech", set: true });
const REPEATABLE = subtype("repeatable", { kind: "present", field: "levels" });
const CONTRACT = subtype("contract", {
  kind: "reference",
  field: "category",
  reference: "mission_category.contract",
});

/** The witness an authored `<mission_category.contract>` carries, as the emitter resolves it. */
const contractWitness = (reference: string) =>
  reference === "mission_category.contract"
    ? {
        qualifiedType: "MissionCategoryContractRef",
        baseType: "MissionCategoryRef",
        member: "isContract",
      }
    : null;

/** The mission body as the rules declare it, already inlined. */
function missionMembers(): ClaimableMember[] {
  return [
    member("category", [named("category", 0)], "MissionCategoryRef | string"),
    member(
      "event_chain",
      [named("event_chain", 0), named("event_chain", 1, [under("contract")])],
      "EventChainRef | string"
    ),
    member("time_to_accept", [named("time_to_accept", 0, [under("contract")])], "number"),
    member("picture", [named("picture")], "string"),
  ];
}

/** The technology body as the rules declare it, already inlined. */
function technologyMembers(): ClaimableMember[] {
  return [
    member("start_tech", [named("start_tech", 0)]),
    member(
      "cost",
      [named("cost", 0, [under("start")]), named("cost", 1, [under("start", true)])],
      "number"
    ),
    member("levels", [named("levels", 0, [under("start", true)])], "number"),
    member("cost_per_level", [named("cost_per_level", 1, [under("repeatable")])], "number"),
    member("area", [named("area")], "string"),
  ];
}

describe("flatten", () => {
  it("keeps an inlined field's cardinality and records the arm it sits under", () => {
    const flattened = flatten([arm("start", true, [named("cost")])], "technology");
    expect(flattened[0]!.cardinality).toEqual({ min: 1, max: 1 });
    expect(flattened[0]!.conditions).toEqual([under("start", true)]);
    expect(flattened[0]!.docs).toEqual([]);
  });

  it("records nested arms innermost first", () => {
    const flattened = flatten([arm("outer", false, [arm("inner", true, [named("x")])])], "t");
    expect(flattened[0]!.conditions).toEqual([
      { subtype: "inner", negated: true, owner: "t" },
      { subtype: "outer", negated: false, owner: "t" },
    ]);
  });
});

describe("armStatuses", () => {
  it("reads a declaration under the subtype's own arms and nothing else", () => {
    const group = [named("cost", 0, [under("start")]), named("cost", 1, [under("start", true)])];
    expect(armStatuses(group, "start", undefined)).toEqual({
      selected: "optional",
      unselected: "required",
    });
    expect(armStatuses([named("only", 1, [under("start")])], "start", undefined)).toEqual({
      selected: "required",
      unselected: "absent",
    });
  });

  it("reads another subtype's declaration as optional on both sides", () => {
    // A trait block is declared under `subtype[civic]` and under
    // `subtype[origin]`; neither arm may forbid it.
    const group = [named("traits", 1, [under("civic")]), named("traits", 1, [under("origin")])];
    expect(armStatuses(group, "civic", undefined)).toEqual({
      selected: "required",
      unselected: "optional",
    });
  });

  it("honours an overlay row that makes the member optional", () => {
    const group = [named("x", 1, [under("start")])];
    const override = { optional: true, reason: "measured against the install" } as const;
    expect(armStatuses(group, "start", override).selected).toBe("optional");
  });
});

describe("planSubtypeUnions", () => {
  it("emits one named arm per way the subtypes apply, dropping contradictions", () => {
    const plan = planSubtypeUnions(
      contentType("technology", [START, REPEATABLE]),
      technologyMembers(),
      null,
      new Map()
    );
    expect(plan.modelled).toEqual([
      "start (`start_tech = yes`)",
      "repeatable (a written `levels`)",
    ]);
    // start × repeatable is contradictory: a start technology cannot carry
    // `levels`, which selects repeatable.
    expect(plan.arms.map((entry) => entry.typeName)).toEqual([
      "TechnologyStartFields",
      "TechnologyRepeatableFields",
      "TechnologyPlainFields",
    ]);
    const spelled = (armName: string, name: string) =>
      plan.arms
        .find((entry) => entry.typeName === armName)!
        .members.find((entry) => entry.member === name)!;
    expect(spelled("TechnologyStartFields", "start_tech")).toMatchObject({
      type: "true",
      optional: false,
    });
    expect(spelled("TechnologyStartFields", "cost")).toMatchObject({ optional: true });
    expect(spelled("TechnologyStartFields", "levels")).toMatchObject({ type: "never" });
    expect(spelled("TechnologyPlainFields", "start_tech")).toMatchObject({
      type: "false",
      optional: true,
    });
    expect(spelled("TechnologyPlainFields", "cost")).toMatchObject({
      type: "number",
      optional: false,
      docs: ["Required unless `start_tech: true`."],
    });
    expect(spelled("TechnologyRepeatableFields", "levels")).toMatchObject({
      type: "number",
      optional: false,
    });
    expect(spelled("TechnologyRepeatableFields", "cost_per_level")).toMatchObject({
      optional: false,
      docs: ["Required when `levels` is set, and not allowed otherwise."],
    });
    // The unconditional member stays in the base, required.
    expect(plan.base.get("area")).toEqual({ optional: false, docs: [] });
    expect(plan.base.has("cost")).toBe(false);
    // The ledger sees a claimed member as optional when any arm allows that.
    expect(plan.claimedDocs.get("cost")).toEqual({
      optional: true,
      docs: ["Required unless `start_tech: true`."],
    });
    expect(plan.collapsed).toEqual([]);
  });

  it("collapses a required declaration whose subtype has no readable selector", () => {
    const contract = subtype("contract", null);
    const plan = planSubtypeUnions(
      contentType("mission", [contract]),
      [member("event_chain", [named("event_chain", 1, [under("contract")])])],
      null,
      new Map()
    );
    expect(plan.arms).toEqual([]);
    expect(plan.collapsed).toEqual([
      {
        path: "mission.event_chain",
        kind: "collapsed",
        reason:
          "required under subtype[contract], authored optional: the subtype's body is not one " +
          "readable field",
      },
    ]);
    // The flat reading keeps the member optional with its doc line.
    expect(plan.base.get("event_chain")?.optional).toBe(true);
  });

  it("collapses on a registry-wide reason and on an overlay row", () => {
    const type = contentType("technology", [START]);
    const members = [
      member("start_tech", [named("start_tech", 0)]),
      member("cost", [named("cost", 1, [under("start", true)])]),
    ];
    expect(
      planSubtypeUnions(
        type,
        members,
        "the registry's scope selector already parameterises its fields",
        new Map()
      ).collapsed[0]?.reason
    ).toBe(
      "required under subtype[!start], authored optional: the registry's scope selector already parameterises its fields"
    );
    const overlay = new Map([["start", "vanilla writes cost on start technologies"]]);
    const plan = planSubtypeUnions(type, members, null, overlay);
    expect(plan.arms).toEqual([]);
    expect(plan.collapsed[0]?.reason).toBe(
      "required under subtype[!start], authored optional: vanilla writes cost on start technologies"
    );
    expect(plan.flatSubtypesApplied).toEqual(["start"]);
  });

  it("counts a flat-arm row as applied only where it kept an arm flat", () => {
    const rare = subtype("rare", { kind: "flag", field: "is_rare", set: true });
    const contract = subtype("contract", null);
    const rows = new Map([
      ["rare", "no declaration sits under this arm"],
      ["contract", "its selector is unreadable anyway"],
    ]);
    const plan = planSubtypeUnions(
      contentType("technology", [rare, contract]),
      [
        member("is_rare", [named("is_rare", 0)]),
        member("event_chain", [named("event_chain", 1, [under("contract")])]),
      ],
      null,
      rows
    );
    expect(plan.flatSubtypesApplied).toEqual([]);
  });

  it("never reports a subtype's own selector field, and skips subtypes with no arm fields", () => {
    const hidden = subtype("hidden", { kind: "flag", field: "hidden", set: true });
    const rare = subtype("rare", { kind: "flag", field: "is_rare", set: true });
    const plan = planSubtypeUnions(
      contentType("economic_category", [hidden, rare]),
      [
        member("hidden", [named("hidden", 1, [under("hidden")])]),
        member("is_rare", [named("is_rare", 0)]),
      ],
      "the registry's definer infers a witness from the definition, which a union defeats",
      new Map()
    );
    expect(plan.collapsed).toEqual([]);
    expect(plan.arms).toEqual([]);
    expect(plan.modelled).toEqual([]);
  });

  it("selects a reference arm by the qualified reference and refuses its witness on the other", () => {
    const plan = planSubtypeUnions(
      contentType("mission", [CONTRACT]),
      missionMembers(),
      null,
      new Map(),
      contractWitness
    );
    expect(plan.modelled).toEqual(["contract (`category = <mission_category.contract>`)"]);
    expect(plan.references).toEqual(["mission_category.contract"]);
    expect(plan.collapsed).toEqual([]);
    expect(plan.arms.map((entry) => entry.typeName)).toEqual([
      "MissionContractFields",
      "MissionPlainFields",
    ]);
    const spelled = (armName: string, name: string) =>
      plan.arms
        .find((entry) => entry.typeName === armName)!
        .members.find((entry) => entry.member === name)!;
    expect(spelled("MissionContractFields", "category")).toMatchObject({
      type: "MissionCategoryContractRef",
      optional: false,
    });
    expect(spelled("MissionContractFields", "event_chain")).toMatchObject({
      type: "EventChainRef | string",
      optional: false,
    });
    expect(spelled("MissionContractFields", "time_to_accept")).toMatchObject({
      type: "number",
      optional: true,
    });
    // The plain arm still takes a raw id, and an authored category only when
    // its witness does not select the subtype.
    expect(spelled("MissionPlainFields", "category")).toMatchObject({
      type: "(MissionCategoryRef & { readonly def?: { readonly isContract?: false } }) | string",
      optional: true,
    });
    expect(spelled("MissionPlainFields", "event_chain")).toMatchObject({
      optional: true,
      docs: ["Required when `category` names a `<mission_category.contract>`."],
    });
    expect(spelled("MissionPlainFields", "time_to_accept")).toMatchObject({ type: "never" });
  });

  it("keeps a reference arm flat where no authored item witnesses the referenced subtype", () => {
    const plan = planSubtypeUnions(
      contentType("mission", [CONTRACT]),
      missionMembers(),
      null,
      new Map(),
      () => null
    );
    expect(plan.arms).toEqual([]);
    expect(plan.references).toEqual([]);
    expect(plan.collapsed.map((row) => row.reason)).toEqual([
      "required under subtype[contract], authored optional: the subtype selects by a " +
        "`<mission_category.contract>`, and no authored item carries that subtype as a witness",
    ]);
  });

  it("rejects a reference discriminant whose type does not spell the referenced reference", () => {
    const members = missionMembers().map((entry) =>
      entry.name === "category" ? { ...entry, type: "string" } : entry
    );
    expect(() =>
      planSubtypeUnions(
        contentType("mission", [CONTRACT]),
        members,
        null,
        new Map(),
        contractWitness
      )
    ).toThrow("does not spell the referenced registry's `MissionCategoryRef` arm");
  });

  it("leaves a literal selector and an unauthored selector field flat", () => {
    const starbase = subtype("starbase", {
      kind: "literal",
      field: "class",
      token: "shipclass_starbase",
    });
    const ghost = subtype("ghost", { kind: "flag", field: "not_authored", set: true });
    const plan = planSubtypeUnions(
      contentType("ship_size", [starbase, ghost]),
      [
        member("class", [named("class")], "string"),
        member("a", [named("a", 1, [under("starbase")])]),
        member("b", [named("b", 1, [under("ghost")])]),
      ],
      null,
      new Map()
    );
    expect(plan.arms).toEqual([]);
    expect(plan.collapsed.map((row) => row.reason)).toEqual([
      "required under subtype[starbase], authored optional: the subtype selects by a literal " +
        "value, which the type does not state",
      "required under subtype[ghost], authored optional: its selector field `not_authored` is " +
        "not an authored member",
    ]);
  });
});

describe("collapsedConditionRows", () => {
  it("reports only required declarations, with the level's reason", () => {
    const grouped = new Map([
      ["x", [named("x", 1, [under("dynamic")])]],
      ["y", [named("y", 0, [under("dynamic")])]],
      ["z", [named("z")]],
    ]);
    expect(
      collapsedConditionRows(grouped, "situation_type.stages", "nested block members are read flat")
    ).toEqual([
      {
        path: "situation_type.stages.x",
        kind: "collapsed",
        reason:
          "required under subtype[dynamic], authored optional: nested block members are read flat",
      },
    ]);
  });
});
