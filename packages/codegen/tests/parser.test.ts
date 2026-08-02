import { classify, supportedScopesOf } from "@pdx-ts/codegen/cwt/model";
import { parseCwt, type CwtAssignment } from "@pdx-ts/codegen/cwt/parser";
import { describe, expect, it } from "vitest";

function only(source: string): CwtAssignment {
  const { nodes } = parseCwt(source, "test.cwt");
  const node = nodes[0];
  if (node?.kind !== "assignment") {
    throw new Error("expected a single assignment");
  }
  return node;
}

describe("cwt parser", () => {
  it("binds doc and option comments to the entry below them", () => {
    const node = only(
      ["## cardinality = 0..1", "###Checks something", "weight = float"].join("\n")
    );
    expect(node.docs).toEqual(["Checks something"]);
    expect(node.options).toHaveLength(1);
    expect(node.options[0]!.name).toBe("cardinality");
  });

  it("ignores plain and decorative comments", () => {
    const node = only(["#### banner", "# a note", "weight = float"].join("\n"));
    expect(node.docs).toEqual([]);
    expect(node.options).toEqual([]);
  });

  it("reads bracketed keys verbatim", () => {
    expect(only("alias[trigger:has_edict] = <edict>").key.text).toBe("alias[trigger:has_edict]");
    expect(only("subtype[!start_tech] = { levels = int }").key.text).toBe("subtype[!start_tech]");
  });

  it("distinguishes == from =", () => {
    expect(only("alias[trigger:num_moons] == int_value_field").op).toBe("==");
    expect(only("alias[trigger:is_ai] = bool").op).toBe("=");
  });

  it("keeps values standing alone inside a block", () => {
    const node = only("prerequisites = {\n\t<technology>\n\t<technology>\n}");
    expect(node.value.kind).toBe("block");
    const nodes = node.value.kind === "block" ? node.value.nodes : [];
    expect(nodes.map((child) => child.kind)).toEqual(["value", "value"]);
  });

  it("parses a block-valued option", () => {
    const node = only("## replace_scope = { this = country root = country }\npotential = { }");
    expect(node.options[0]!.value?.kind).toBe("block");
  });

  it("marks a negated option", () => {
    const node = only("## type_key_filter <> random_list\nfoo = bool");
    expect(node.options[0]!.negated).toBe(true);
  });

  it("keeps unquoted prose option values whole", () => {
    const node = only("## display_name = Country Event\ncountry_event = { }");
    const value = node.options[0]!.value;
    expect(value?.kind === "scalar" ? value.text : null).toBe("Country Event");
  });

  it("reports a malformed option instead of dropping or throwing on it", () => {
    const result = parseCwt("## cardinality 0..1\nweight = float", "test.cwt");
    expect(result.diagnostics).toEqual([
      { kind: "malformed-option", file: "test.cwt", line: 1, text: "## cardinality 0..1" },
    ]);
  });

  it("throws with file and line on unbalanced braces", () => {
    expect(() => parseCwt("foo = {\n\tbar = bool\n", "test.cwt")).toThrow(/test\.cwt:1/);
    expect(() => parseCwt("foo = bool\n}\n", "test.cwt")).toThrow(/test\.cwt:2: Unbalanced/);
  });

  it("throws on an unterminated quoted string", () => {
    expect(() => parseCwt('name = "unclosed\n', "test.cwt")).toThrow(/Unterminated quoted string/);
  });
});

describe("rule types", () => {
  it("reads bounded ranges", () => {
    expect(classify(only("levels = int[-1..100]").value)).toEqual({
      kind: "int",
      range: { min: -1, max: 100 },
    });
  });

  it("treats an open bound as unbounded", () => {
    expect(classify(only("value = value_field[0.0..inf]").value)).toEqual({
      kind: "valueField",
      integer: false,
    });
  });

  it("classifies the reference and set forms", () => {
    expect(classify(only("tier = <technology_tier>").value)).toEqual({
      kind: "typeRef",
      name: "technology_tier",
    });
    expect(classify(only("area = enum[research_area]").value)).toEqual({
      kind: "enum",
      name: "research_area",
    });
    expect(classify(only("flag = value[country_flag]").value)).toEqual({
      kind: "valueSet",
      name: "country_flag",
    });
  });

  it("falls back to a literal for a bare word standing for itself", () => {
    expect(classify(only("who = country").value)).toEqual({ kind: "literal", text: "country" });
  });

  it("expands single_alias_right against the definitions it is given", () => {
    const clause = only(
      "single_alias[trigger_clause] = { alias_name[trigger] = alias_match_left[trigger] }"
    );
    const rule = only("alias[trigger:any_country] = single_alias_right[trigger_clause]");
    expect(classify(rule.value)).toEqual({ kind: "singleAliasRight", name: "trigger_clause" });
    expect(classify(rule.value, () => clause.value)).toEqual({
      kind: "block",
      bare: [],
      fields: [expect.objectContaining({ key: { kind: "aliasName", category: "trigger" } })],
    });
  });

  it("reads the scope list a rule declares", () => {
    expect(
      supportedScopesOf(only("## scopes = { country federation }\nfoo = bool").options)
    ).toEqual(["country", "federation"]);
    expect(supportedScopesOf(only("## scopes = any\nfoo = bool").options)).toEqual(["any"]);
    expect(supportedScopesOf(only("foo = bool").options)).toBeNull();
  });

  it("separates a negated subtype from a plain one", () => {
    const rule = only("technology = { subtype[!repeatable] = { cost = int } }");
    const block = classify(rule.value);
    const fields = block.kind === "block" ? block.fields : [];
    expect(fields[0]!.key).toEqual({ kind: "subtype", name: "repeatable", negated: true });
  });
});
