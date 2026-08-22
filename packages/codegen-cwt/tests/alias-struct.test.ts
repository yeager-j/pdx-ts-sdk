/**
 * `government_trigger`, lowered from the real rules.
 *
 * `common/governments.cwt` is deliberately absent from `RULE_FILES` — it
 * carries two malformed `## default: no` option comments that the drift gate
 * rejects — so the category is parsed here directly, through the same
 * generalized reader `loadRules` uses for the categories it does load.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readAliases, type AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitAliasStruct } from "@pdx-ts/codegen-cwt/emit/alias-struct";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { EXTRA_ALIAS_CATEGORIES } from "@pdx-ts/codegen-cwt/overlay";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const GOVERNMENTS = "common/governments.cwt";

const rules = loadRules(CONFIG);

function categoryOf(file: string, category: string): Map<string, AliasDecl[]> {
  const parsed = parseCwt(readFileSync(`${CONFIG}/${file}`, "utf8"), file);
  const members = new Map<string, AliasDecl[]>();
  readAliases(parsed.nodes, file, category, new Map(), members);
  return members;
}

const governmentTrigger = categoryOf(GOVERNMENTS, "government_trigger");
const emission = emitAliasStruct(new Emitter(rules), "government_trigger", governmentTrigger);

describe("alias category reading", () => {
  it("reads the categories the overlay names, and only those", () => {
    expect([...rules.aliasCategories.keys()].sort()).toEqual(
      [...EXTRA_ALIAS_CATEGORIES.keys()].sort()
    );
    // A GUI/graphics category must not have been swept in alongside them.
    expect(rules.aliasCategories.has("scripted_effect_params")).toBe(false);
  });

  it("reads pre_triggers.cwt into its two content-facing families", () => {
    expect([...rules.aliasCategories.get("pop_pre_trigger")!.keys()]).toEqual([
      "has_owner",
      "is_enslaved",
      "is_being_purged",
      "is_being_assimilated",
      "has_planet",
      "is_sapient",
      "is_robotic",
    ]);
    expect(rules.aliasCategories.get("colony_pre_trigger")!.size).toBe(7);
    // Every member is a plain bool; that is what lets the splice lower as a struct.
    for (const declarations of rules.aliasCategories.get("pop_pre_trigger")!.values()) {
      expect(declarations.map((declaration) => declaration.type.kind)).toEqual(["bool"]);
    }
  });

  it("leaves triggers and effects on their own tables", () => {
    // Generalizing the reader must not have migrated the two categories every
    // other emitter reads.
    expect(rules.triggers.size).toBeGreaterThan(1000);
    expect(rules.effects.size).toBeGreaterThan(1000);
    expect(rules.aliasCategories.has("trigger")).toBe(false);
    expect(rules.aliasCategories.has("effect")).toBe(false);
  });

  it("finds government_trigger's fifteen members in governments.cwt", () => {
    expect(governmentTrigger.size).toBe(15);
    // governments.cwt is loaded through loadRules since its three malformed
    // `## default: no` options were deliberately recorded in the drift
    // baseline, so the category reaches the rule set proper too.
    expect(rules.aliasCategories.get("government_trigger")!.size).toBe(15);
  });
});

describe("government_trigger emission", () => {
  it("emits a named requirements block rather than a Trigger", () => {
    expect(emission.typeName).toBe("GovernmentTriggerBlock");
    expect(emission.fieldsConstant).toBe("GOVERNMENT_TRIGGER_FIELDS");
    expect(emission.code).toContain("export interface GovernmentTriggerBlock {");
    expect(emission.code).not.toContain("Trigger<");
  });

  it("lowers the ten domain members onto one clause type, each with its own ref", () => {
    expect(emission.code).toContain("export interface GovernmentTriggerClause<R> {");
    expect(emission.code).toContain("export interface GovernmentTriggerClauseGroup<R> {");
    expect(emission.code).toContain("value?: R;");
    expect(emission.code).toContain("or?: readonly GovernmentTriggerClauseGroup<R>[];");
    expect(emission.code).toContain("not?: readonly GovernmentTriggerClauseGroup<R>[];");
    expect(emission.code).toContain("nor?: readonly GovernmentTriggerClauseGroup<R>[];");
    expect(emission.code).toContain("values: readonly R[];");

    for (const [member, ref] of [
      ["authority", "AuthorityRef | string"],
      ["countryType", "CountryTypeRef | string"],
      ["ethics", "EthicRef | string"],
      ["civics", "CivicOrOriginCivicRef | string"],
      ["origin", "CivicOrOriginOriginRef | string"],
      ["traits", "TraitSpeciesTraitRef | string"],
      ["speciesClass", "SpeciesClassRef | string"],
      ["speciesArchetype", "SpeciesArchetypeRef | string"],
      ["preferredPlanetClass", "PlanetClassRef | string"],
      ["graphicalCulture", "GraphicalCultureRef | string"],
    ] as const) {
      expect(emission.code, member).toContain(`${member}?: GovernmentTriggerClause<${ref}>;`);
    }
  });

  it("lowers the two scalar members ordinarily", () => {
    expect(emission.code).toContain("hostHasDlc?: Dlc;");
    expect(emission.code).toContain("isNomadic?: boolean;");
    expect(emission.code).toContain(
      '{ key: "host_has_dlc", member: "hostHasDlc", shape: "value", ' +
        'form: "scalar", conversion: "identity" }'
    );
  });

  it("lowers the combinators as self-references through the category table", () => {
    // The whole reason for the aliasStruct shape: OR/AND/limit each splice the
    // category back into itself, so their field table cannot be written inline.
    // SDK-42: "OR" lowers to member "orGroups", not "or" — its CWT key
    // collides with the domain clause's own genuinely-disjunctive "or" group
    // two levels down, and a repeated `OR` combinator here is ANDed by the
    // game rather than ORed the way a bare "or" array would misread. "AND"
    // and "limit" name nothing a clause also uses, so they keep their plain
    // member names.
    for (const [member, key] of [
      ["orGroups", "OR"],
      ["and", "AND"],
      ["limit", "limit"],
    ] as const) {
      expect(emission.code, member).toContain(`${member}?: readonly GovernmentTriggerBlock[];`);
      expect(emission.code, member).toContain(
        `{ key: ${JSON.stringify(key)}, member: ${JSON.stringify(member)}, ` +
          'shape: "aliasStruct", form: "list", category: "government_trigger", repeated: true }'
      );
    }
    expect(emission.code).toContain(
      'registerAliasStructFields("government_trigger", GOVERNMENT_TRIGGER_FIELDS);'
    );
  });

  it("carries the block-level text and always fields the consumers write", () => {
    // `text` and `always` are declared on each combinator, and the consuming
    // `potential`/`possible` blocks declare the same two beside their splice.
    expect(emission.code).toContain("  text?: string;\n  always?: boolean;\n");
    expect(emission.code).toContain(
      '{ key: "text", member: "text", shape: "value", form: "scalar", conversion: "identity" }'
    );
    expect(emission.code).toContain(
      '{ key: "always", member: "always", shape: "value", form: "scalar", conversion: "identity" }'
    );
  });

  it("emits every member of the category and declines none", () => {
    expect(emission.emittedMembers).toEqual([
      "authority",
      "country_type",
      "ethics",
      "civics",
      "origin",
      "traits",
      "species_class",
      "species_archetype",
      "preferred_planet_class",
      "OR",
      "AND",
      "limit",
      "host_has_dlc",
      "graphical_culture",
      "is_nomadic",
    ]);
    expect(emission.declinedMembers).toEqual([]);
  });

  it("declines an unknown-shaped member by name, with a reason", () => {
    // Gaps stay visible: a member the emitter has no shape for must never be
    // dropped into a silently smaller interface.
    const members = new Map(governmentTrigger);
    const unknown = parseCwt(
      "alias[government_trigger:has_country_flag] = { count = int flag = scalar }\n" +
        "alias[government_trigger:weird] = alias_match_left[modifier_rule]\n",
      "synthetic.cwt"
    );
    readAliases(unknown.nodes, "synthetic.cwt", "government_trigger", new Map(), members);
    const declined = emitAliasStruct(new Emitter(rules), "government_trigger", members);
    expect(declined.declinedMembers).toEqual([
      "government_trigger:has_country_flag — a block matching neither the " +
        "value/OR/NOT/NOR clause template nor a self-splice",
      "government_trigger:weird — a scalar type the emitter cannot express",
    ]);
    expect(declined.code).not.toContain("hasCountryFlag");
    expect(declined.code).not.toContain("weird");
  });
});
