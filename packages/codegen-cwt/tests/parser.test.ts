import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContentTypesFrom } from "@pdx-ts/codegen-cwt/cwt/load";
import { cardinalityOf, classify, scopeOf, supportedScopesOf } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt, type CwtAssignment } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readContentTypes } from "@pdx-ts/codegen-cwt/cwt/rules";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { describe, expect, it } from "vitest";

const CONFIG = fileURLToPath(
  new URL("../../../vendor/cwtools-stellaris-config/config", import.meta.url)
);

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

  it("classifies an alias key as an open string", () => {
    expect(classify(only("modifier = alias_keys_field[modifier]").value)).toEqual({
      kind: "scalar",
    });
  });

  it.each(["quantum_range[0..3]", "scope2[fleet]", "Scope[fleet]", "sceop2[fleet]"])(
    "reports the unsupported bracketed keyword %s instead of treating it as a literal",
    (text) => {
      const diagnostics: unknown[] = [];
      expect(
        classify(only(`gateway = ${text}`).value, undefined, (diagnostic) => {
          diagnostics.push(diagnostic);
        })
      ).toEqual({ kind: "unknownKeyword", text });
      expect(diagnostics).toEqual([
        {
          kind: "unknown-keyword",
          line: 1,
          text,
        },
      ]);
    }
  );

  it("keeps a quoted bracketed value literal", () => {
    expect(classify(only('gateway = "quantum_range[0..3]"').value)).toEqual({
      kind: "literal",
      text: "quantum_range[0..3]",
    });
  });

  it("classifies colon-paired dynamic values as authored scalar tokens", () => {
    expect(classify(only("text = value[gui_element_name]:localisation").value)).toEqual({
      kind: "scalar",
    });
    expect(classify(only("texture = value[gui_element_name]:<sprite>").value)).toEqual({
      kind: "scalar",
    });
  });

  it("keeps anonymous block-member order, cardinality, and documentation", () => {
    const type = classify(
      only(
        [
          "values = {",
          "  ## cardinality = 0..inf",
          "  ### First values stay first.",
          "  <technology>",
          "  ## cardinality = 0..1",
          "  scalar",
          "}",
        ].join("\n")
      ).value
    );

    expect(type).toEqual({
      kind: "block",
      fields: [],
      bare: [
        {
          type: { kind: "typeRef", name: "technology" },
          cardinality: { min: 0, max: null },
          docs: ["First values stay first."],
          scope: null,
          line: 4,
        },
        {
          type: { kind: "scalar" },
          cardinality: { min: 0, max: 1 },
          docs: [],
          scope: null,
          line: 6,
        },
      ],
    });
  });

  it("classifies the scope forms, including the unbracketed one", () => {
    expect(classify(only("who = scope_group[target_country]").value)).toEqual({
      kind: "scopeGroup",
      name: "target_country",
    });
    expect(classify(only("target = scope[planet]").value)).toEqual({
      kind: "scope",
      name: "planet",
    });
    // `scope_field` is the unbracketed spelling of `scope[any]`. Read as a
    // literal it typed seven generated fields as the string `"scope_field"`.
    expect(classify(only("location = scope_field").value)).toEqual({ kind: "scope", name: "any" });
  });

  it("expands single_alias_right against the definitions it is given", () => {
    const clause = only(
      "single_alias[trigger_clause] = { alias_name[trigger] = alias_match_left[trigger] }"
    );
    const rule = only("alias[trigger:any_country] = single_alias_right[trigger_clause]");
    expect(classify(rule.value)).toEqual({ kind: "singleAliasRight", name: "trigger_clause" });
    expect(classify(rule.value, () => ({ value: clause.value }))).toEqual({
      kind: "block",
      bare: [],
      fields: [expect.objectContaining({ key: { kind: "aliasName", category: "trigger" } })],
      via: "trigger_clause",
    });
  });

  it("keeps the outermost alias name when one clause expands into another", () => {
    const clauses = new Map([
      ["trigger_clause", only("single_alias[trigger_clause] = { alias_name[trigger] = bool }")],
      [
        "triggered_modifier_clause",
        only(
          "single_alias[triggered_modifier_clause] = { potential = single_alias_right[trigger_clause] }"
        ),
      ],
    ]);
    const rule = only("triggered_desc = single_alias_right[triggered_modifier_clause]");
    const outer = classify(rule.value, (name) => {
      const clause = clauses.get(name);
      return clause === undefined ? undefined : { value: clause.value };
    });

    expect(outer.kind === "block" ? outer.via : null).toBe("triggered_modifier_clause");
    const nested = outer.kind === "block" ? outer.fields[0]!.type : null;
    expect(nested?.kind === "block" ? nested.via : null).toBe("trigger_clause");
  });

  it("leaves a non-block alias expansion unnamed", () => {
    const clause = only("single_alias[some_scalar] = scalar");
    const rule = only("thing = single_alias_right[some_scalar]");
    expect(classify(rule.value, () => ({ value: clause.value }))).toEqual({ kind: "scalar" });
  });

  it("names nothing when the block was spelled out inline", () => {
    const inline = classify(only("modifier = { description = localisation }").value);
    expect(inline.kind === "block" ? inline.via : "missing").toBeUndefined();
  });

  it("reports diagnostics from a resolved alias against its declaration", () => {
    const clause = only("single_alias[trigger_clause] = { gateway = scope2[fleet] }");
    const rule = only("alias[trigger:any_country] = single_alias_right[trigger_clause]");
    const diagnostics: unknown[] = [];

    classify(
      rule.value,
      () => ({
        value: clause.value,
        sourceFile: "aliases.cwt",
      }),
      (diagnostic, sourceFile) =>
        diagnostics.push({ ...diagnostic, file: sourceFile ?? "consumer.cwt" })
    );

    expect(diagnostics).toEqual([
      { kind: "unknown-keyword", file: "aliases.cwt", line: 1, text: "scope2[fleet]" },
    ]);
  });

  it("reads the scope list a rule declares", () => {
    expect(
      supportedScopesOf(only("## scopes = { country federation }\nfoo = bool").options)
    ).toEqual(["country", "federation"]);
    expect(supportedScopesOf(only("## scopes = any\nfoo = bool").options)).toEqual(["any"]);
    expect(supportedScopesOf(only("foo = bool").options)).toBeNull();
  });

  it("reads the scope_groups table scopes.cwt declares", () => {
    const { scopeGroups, scopes } = loadRules(CONFIG);
    expect([...scopeGroups.keys()].sort()).toEqual([
      "carrier",
      "celestial_coordinate",
      "spatial_object",
      "target_country",
      "target_graphical_culture",
      "target_leader",
      "target_planet",
      "target_species",
    ]);
    // The vendored table writes `carrier` twice inside three of its groups.
    expect(scopeGroups.get("target_species")).toEqual([
      "country",
      "pop_group",
      "leader",
      "planet",
      "ship",
      "carrier",
      "fleet",
      "army",
      "species",
      "first_contact",
    ]);
    // A group and a scope may share a name, so the two tables stay apart.
    expect(scopeGroups.get("carrier")).toEqual(["planet", "ship", "carrier", "colony"]);
    expect(scopes.has("Carrier")).toBe(true);
  });

  it("separates a negated subtype from a plain one", () => {
    const rule = only("technology = { subtype[!repeatable] = { cost = int } }");
    const block = classify(rule.value);
    const fields = block.kind === "block" ? block.fields : [];
    expect(fields[0]!.key).toEqual({ kind: "subtype", name: "repeatable", negated: true });
  });
});

describe("content type declarations", () => {
  const { contentTypes: traditions } = loadContentTypesFrom(CONFIG, ["common/traditions.cwt"]);
  const { contentTypes: traits } = loadContentTypesFrom(CONFIG, ["common/traits.cwt"]);

  it("returns parser diagnostics alongside content types", () => {
    const result = loadContentTypesFrom(CONFIG, ["common/country_types.cwt"]);
    expect(result.diagnostics).toEqual([
      {
        kind: "malformed-option",
        file: "common/country_types.cwt",
        line: 323,
        text: "## A module controls what code a country will use for a specific system, for instance we can decide to run a completely different economy module that uses cats as main currency ( if such a module exists, that is )",
      },
      {
        kind: "malformed-option",
        file: "common/country_types.cwt",
        line: 324,
        text: "## Only one module per module type is allowed",
      },
    ]);
  });

  it("keeps the subtype a localisation slot was declared inside", () => {
    expect(traditions.get("swapped_tradition")?.localisation).toEqual([
      {
        key: "name",
        pattern: "$",
        required: false,
        optional: false,
        subtype: "not_inheriting_name",
      },
      {
        key: "flavor",
        pattern: "$_delayed",
        required: false,
        optional: true,
        subtype: "not_inheriting_name",
      },
      {
        key: "effects",
        pattern: "$_desc",
        required: false,
        optional: true,
        subtype: "not_inheriting_effects",
      },
    ]);
  });

  it("leaves a slot declared outside any subtype without provenance", () => {
    expect(traditions.get("tradition")?.localisation).toEqual([
      { key: "name", pattern: "$", required: false, optional: false, subtype: null },
      { key: "flavor", pattern: "$_delayed", required: false, optional: true, subtype: null },
      { key: "effects", pattern: "$_desc", required: false, optional: true, subtype: null },
    ]);
  });

  it("reads the unset-flag selector off a zero-cardinality subtype body", () => {
    const swapped = traditions.get("swapped_tradition")?.subtypes ?? [];
    expect(swapped.map((subtype) => [subtype.name, subtype.selector])).toEqual([
      ["not_inheriting_name", { kind: "flag", field: "inherit_name", set: false }],
      ["not_inheriting_icon", { kind: "flag", field: "inherit_icon", set: false }],
      ["not_inheriting_effects", { kind: "flag", field: "inherit_effects", set: false }],
    ]);
  });

  it("reads set-flag, presence, literal, and reference selectors off the vendored rules", () => {
    const selectorsOf = (types: ReturnType<typeof loadContentTypesFrom>, name: string) =>
      new Map(
        (types.contentTypes.get(name)?.subtypes ?? []).map((subtype) => [
          subtype.name,
          subtype.selector,
        ])
      );
    const technology = selectorsOf(
      loadContentTypesFrom(CONFIG, ["common/technologies_consolidated.cwt"]),
      "technology"
    );
    expect(technology.get("start")).toEqual({ kind: "flag", field: "start_tech", set: true });
    expect(technology.get("repeatable")).toEqual({ kind: "present", field: "levels" });

    const shipSizes = loadContentTypesFrom(CONFIG, ["common/ship_sizes.cwt"]);
    const shipSize = selectorsOf(shipSizes, "ship_size");
    expect(shipSize.get("starbase")).toEqual({
      kind: "literal",
      field: "class",
      token: "shipclass_starbase",
    });
    // `## cardinality = 0..1  is_space_station = no`: the flag is not set.
    expect(shipSize.get("ship")).toEqual({ kind: "flag", field: "is_space_station", set: false });
    // `## cardinality = 0..1  is_designable = yes` is vacuous: it excludes nothing.
    expect(shipSize.get("designable")).toBeNull();
    // `is_bio_ship = bool` matches the field written with either value.
    expect(shipSize.get("bio_ship")).toEqual({ kind: "present", field: "is_bio_ship" });
    // `hero_ship = { }` selects on the block being written.
    expect(shipSize.get("hero_ship")).toEqual({ kind: "present", field: "hero_ship" });

    const missions = loadContentTypesFrom(CONFIG, ["common/missions.cwt"]);
    // `category = <mission_category.contract>` selects by what the value names,
    // not by the field being present.
    expect(selectorsOf(missions, "mission").get("contract")).toEqual({
      kind: "reference",
      field: "category",
      reference: "mission_category.contract",
    });
    expect(selectorsOf(missions, "mission_category").get("contract")).toEqual({
      kind: "flag",
      field: "is_contract",
      set: true,
    });
  });

  it("leaves a zero-cardinality block predicate unread rather than reading presence", () => {
    // `## cardinality = 0..0` on a block selects by the block's absence, which
    // the model does not state; reading it as presence would swap the arms.
    const source = [
      "types = {",
      "  type[t] = {",
      "    subtype[bare] = {",
      "      ## cardinality = 0..0",
      "      hero_ship = { }",
      "    }",
      "    subtype[written] = {",
      "      hero_ship = { }",
      "    }",
      "  }",
      "}",
    ].join("\n");
    const types = readContentTypes(parseCwt(source, "test.cwt").nodes);
    const selectors = new Map(types[0]!.value.subtypes.map((s) => [s.name, s.selector]));
    expect(selectors.get("bare")).toBeNull();
    expect(selectors.get("written")).toEqual({ kind: "present", field: "hero_ship" });
  });

  it("states no selector for a subtype body outside those shapes", () => {
    const subtypes = traits.get("trait")?.subtypes ?? [];
    const selectors = new Map(subtypes.map((subtype) => [subtype.name, subtype.selector]));
    // `## cardinality = 0..0` but the field asserts `$any`, not `yes`.
    expect(selectors.get("species_trait")).toBeNull();
    // More than one field, so no single key selects it.
    expect(selectors.get("starting_ruler_trait")).toBeNull();
    // Two fields in agreements.cwt's `has_parent`, an empty body in sprites.cwt.
    const agreements = loadContentTypesFrom(CONFIG, ["common/agreements.cwt"]);
    const presets = agreements.contentTypes.get("agreement_preset")?.subtypes ?? [];
    expect(presets.find((subtype) => subtype.name === "has_parent")?.selector).toBeNull();
    const sprites = loadContentTypesFrom(CONFIG, ["interface/sprites.cwt"]);
    const sprite = sprites.contentTypes.get("sprite")?.subtypes ?? [];
    expect(sprite.find((subtype) => subtype.name === "normal")?.selector).toBeNull();
  });
});

describe("structural option values", () => {
  it.each([
    ["0..inff", "field = scalar"],
    ["2", "scalar"],
  ])("reports malformed cardinality %s and keeps the fallback", (value, shape) => {
    const node = only(`container = {\n## cardinality = ${value}\n${shape}\n}`);
    const diagnostics: unknown[] = [];
    const classified = classify(node.value, undefined, (diagnostic) =>
      diagnostics.push(diagnostic)
    );

    const declaration =
      classified.kind === "block" ? (classified.fields[0] ?? classified.bare[0]) : undefined;
    expect(declaration?.cardinality).toEqual({ min: 1, max: 1 });
    expect(diagnostics).toEqual([
      { kind: "malformed-option-value", line: 2, text: `## cardinality = ${value}` },
    ]);
  });

  it.each(["0..~1", "~1..1"])("accepts soft cardinality bound %s", (value) => {
    const node = only(`container = {\n## cardinality = ${value}\nscalar\n}`);
    const diagnostics: unknown[] = [];
    const classified = classify(node.value, undefined, (diagnostic) =>
      diagnostics.push(diagnostic)
    );

    expect(classified.kind === "block" ? classified.bare[0]?.cardinality : null).toEqual({
      min: Number(value.split("..")[0]!.replace("~", "")),
      max: 1,
    });
    expect(diagnostics).toEqual([]);
  });

  it.each([
    ["replace_scopes", "country", "field = scalar"],
    ["push_scope", "{ fleet }", "scalar"],
  ])("reports a malformed %s value", (name, value, shape) => {
    const node = only(`container = {\n## ${name} = ${value}\n${shape}\n}`);
    const diagnostics: unknown[] = [];
    const classified = classify(node.value, undefined, (diagnostic) =>
      diagnostics.push(diagnostic)
    );

    const declaration =
      classified.kind === "block" ? (classified.fields[0] ?? classified.bare[0]) : undefined;
    expect(declaration?.scope).toBeNull();
    expect(diagnostics).toEqual([
      {
        kind: "malformed-option-value",
        line: 2,
        text: `## ${name} = ${value === "country" ? value : "{...}"}`,
      },
    ]);
  });

  it.each([
    ["fromform = country", 'names "fromform", which is not a scope context key'],
    ["from = { country }", 'gives "from" a value that is not a scope name'],
    ["country", "has a member that is not an assignment"],
  ])("reports the unreadable member %s inside replace_scopes", (member, detail) => {
    // `replace_scopes` states the whole context, so a slot it fails to read is
    // cleared rather than inherited — a misspelling drops a scope the rules
    // meant to declare. `common/missions.cwt:305` is the live instance.
    const node = only(`## replace_scopes = { this = country ${member} }\nfield = scalar`);
    const diagnostics: unknown[] = [];

    const scope = scopeOf(node.options, (diagnostic) => diagnostics.push(diagnostic));

    expect(scope?.this).toBe("country");
    expect(diagnostics).toEqual([
      { kind: "malformed-option-value", line: 1, text: `## replace_scopes ${detail}` },
    ]);
  });

  it("reads a complete replace_scopes block without reporting anything", () => {
    const node = only("## replace_scopes = { this = country fromfrom = fleet }\nfield = scalar");
    const diagnostics: unknown[] = [];

    const scope = scopeOf(node.options, (diagnostic) => diagnostics.push(diagnostic));

    expect(scope?.this).toBe("country");
    expect(scope?.fromfrom).toBe("fleet");
    expect(diagnostics).toEqual([]);
  });

  it("reads structural options without a reporter", () => {
    const node = only("## cardinality = 0..~1\nfield = scalar");
    expect(cardinalityOf(node.options)).toEqual({ min: 0, max: 1 });
    expect(scopeOf(node.options)).toBeNull();
  });
});
