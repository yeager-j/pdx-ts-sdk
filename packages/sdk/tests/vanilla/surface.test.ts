/**
 * The promoted typed surface, tested against the probe's hand-written
 * goldens (they were written before any parser existed and are immutable —
 * a mismatch is a finding, not an edit-until-green) plus the promotion's
 * three new claims: OR-prerequisites are typed data, `@ref` re-emission
 * survives the package serializer's quoting rule, and swap names refuse.
 */

import { parse, serialize, withoutLines } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { SwapPatchError } from "../../src/errors.ts";
import { patchTechnology } from "../../src/stellaris/vanilla/patch.ts";
import { anyOf, sha256Hex, viewFromFiles } from "../../src/stellaris/vanilla/view.ts";
import { OR_TECH_FILE, TECH_FILE, VARS_FILE } from "../fixtures/vanilla-fixture.ts";

const FILES = {
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/scripted_variables/pp_vars.txt": VARS_FILE,
};

const vanilla = viewFromFiles(FILES);
const geneForging = vanilla
  .technology("tech_gene_forging")
  .require("cost", "prerequisites", "weight");

// The unpatched fixture tech re-emitted in repo formatting — copied verbatim
// from design/parser-probe/probe.test.ts, where it was hand-written before
// the parser existed.
const GOLDEN_ROUNDTRIP = `tech_gene_forging = {
	cost = @t3cost
	area = society
	tier = 3
	category = { biology }
	prerequisites = { "tech_helix_mapping" }
	weight = @t3weight
	gateway = biological
	modifier = {
		description = tech_gene_forging_modifier_desc
		description_parameters = {
			POINTS = @tech_gene_forging_POINTS
		}
		BIOLOGICAL_species_trait_points_add = @tech_gene_forging_POINTS
	}
	feature_flags = { modify_traits pop_self_modification }
	technology_swap = {
		name = tech_gene_forging_overtuned
		inherit_icon = yes
		inherit_effects = no
		trigger = {
			has_origin = origin_overtuned
		}
	}
	potential = {
		OR = {
			is_machine_empire = no
			has_civic = civic_machine_assimilator
			has_civic = civic_machine_servitor
		}
		is_natural_design_empire = no
	}
	weight_modifier = {
		factor = 2
		modifier = {
			factor = 1.25
			is_hive_empire = yes
		}
		modifier = {
			factor = 1.25
			is_xenophile = yes
		}
		modifier = {
			factor = 1.25
			has_origin = origin_necrophage
			has_trait = trait_necrophage
		}
		modifier = {
			factor = 2
			has_relic = r_pox_sample
		}
		modifier = {
			factor = 0
			is_individual_machine = yes
			NOT = {
				any_owned_species = {
					is_organic_species = yes
				}
			}
		}
		modifier = {
			factor = @pp_boost
			has_ascension_perk = ap_engineered_evolution
		}
	}
	ai_weight = {
		modifier = {
			factor = 2
			has_origin = origin_necrophage
			has_trait = trait_necrophage
		}
		modifier = {
			factor = @pp_boost
			has_ascension_perk = ap_engineered_evolution
		}
	}
}
`;

// Exactly two changes, in place: the patch took `.value` on cost (baking
// 8000 is visible in the source), and prerequisites gained the new tech.
const GOLDEN_PATCHED = GOLDEN_ROUNDTRIP.replace("\tcost = @t3cost\n", "\tcost = 8000\n").replace(
  '\tprerequisites = { "tech_helix_mapping" }\n',
  '\tprerequisites = { "tech_helix_mapping" "pp_tech_chimeric_grafts" }\n'
);

describe("promoted surface", () => {
  it("round-trips the fixture tech to the hand-written golden", () => {
    expect(serialize([geneForging.toEntries()])).toBe(GOLDEN_ROUNDTRIP);
  });

  it("emits the patched tech with exactly the two intended changes", () => {
    const patched = patchTechnology(geneForging, (t) => ({
      cost: t.cost.value * 2,
      prerequisites: [...t.prerequisites, "pp_tech_chimeric_grafts"],
    }));
    expect(serialize([patched.toEntries()])).toBe(GOLDEN_PATCHED);
  });

  it("re-emission is a semantic fixpoint", () => {
    const emitted = serialize([geneForging.toEntries()]);
    const reparsed = parse(emitted, "emitted.txt");
    expect(reparsed.diagnostics).toEqual([]);
    expect(serialize(reparsed.items)).toBe(emitted);
  });

  it("a ParsedNumber passed through whole re-emits as a bare @reference", () => {
    // The promotion fix: the probe emitted scalar("@t3cost"), which the
    // package serializer would quote into a string the game cannot resolve.
    const patched = patchTechnology(geneForging, (t) => ({ cost: t.cost }));
    expect(serialize([patched.toEntries()])).toContain("\tcost = @t3cost\n");
  });

  it("resolves variables with provenance: cross-file and file-local", () => {
    expect(geneForging.cost.value).toBe(4000);
    expect(geneForging.cost.ref).toBe("@t3cost");
    expect(geneForging.weight.value).toBe(65);
    expect(geneForging.weight.ref).toBe("@t3weight");
    expect(geneForging.tier?.value).toBe(3);
    expect(geneForging.tier?.ref).toBeUndefined();
  });

  it("surfaces typed fields and carries the unmodelled rest", () => {
    expect(geneForging.id).toBe("tech_gene_forging");
    expect(geneForging.area).toBe("society");
    expect(geneForging.category.map((c) => c.id)).toEqual(["biology"]);
    expect(geneForging.potential).toBeDefined();
    expect(geneForging.rest.map((entry) => entry.key)).toEqual([
      "gateway",
      "modifier",
      "feature_flags",
      "technology_swap",
      "weight_modifier",
      "ai_weight",
    ]);
  });

  it("carries provenance: source file, content hash, citation", () => {
    expect(geneForging.sourceFile).toBe("common/technology/pp_soc_tech.txt");
    expect(geneForging.sourceSha256).toBe(sha256Hex(TECH_FILE));
    expect(geneForging.citation).toMatch(/^common\/technology\/pp_soc_tech\.txt:\d+$/);
    expect(geneForging.origin).toBe(vanilla);
  });

  it("exposes the file manifest in enumeration order, @-definitions excluded", () => {
    expect(vanilla.files.map((file) => file.path)).toEqual([
      "common/scripted_variables/pp_vars.txt",
      "common/technology/pp_soc_tech.txt",
    ]);
    expect(vanilla.files.map((file) => file.keys)).toEqual([[], ["tech_gene_forging"]]);
  });

  it("manifestKey identifies content: same input same key, changed input new key", () => {
    expect(viewFromFiles(FILES).manifestKey).toBe(vanilla.manifestKey);
    const changed = { ...FILES, "common/technology/pp_soc_tech.txt": TECH_FILE + "\n# touched\n" };
    expect(viewFromFiles(changed).manifestKey).not.toBe(vanilla.manifestKey);
  });

  it("throws on an unknown technology with a nearest-match hint", () => {
    expect(() => vanilla.technology("gene_forging")).toThrow(/1 technologies/);
    expect(() => vanilla.technology("gene_forging")).toThrow(/tech_gene_forging/);
  });

  it("refuses a technology_swap name, pointing at the parent", () => {
    expect(() => vanilla.technology("tech_gene_forging_overtuned")).toThrow(SwapPatchError);
    expect(() => vanilla.technology("tech_gene_forging_overtuned")).toThrow(
      /technology_swap inside tech_gene_forging/
    );
    expect(() => vanilla.technology("tech_gene_forging_overtuned")).toThrow(/open question 3/);
  });

  it("require() names the missing field loudly", () => {
    expect(() => vanilla.technology("tech_gene_forging").require("isRare")).toThrow(/isRare/);
  });

  it("a block cost is unmodelled: carried in rest, invisible to the type", () => {
    // Real shape from 00_cosmic_storm_tech.txt: cost = { factor = ...
    // inline_script = { ... } }. The surface cannot stand behind it as a
    // number, so it rides in rest and require("cost") stays honest.
    const view = viewFromFiles({
      "common/technology/pp_storm.txt":
        "tech_pp_storm = {\n\tcost = {\n\t\tfactor = 2\n\t}\n\tarea = physics\n\ttier = 2\n}\n",
    });
    const storm = view.technology("tech_pp_storm");
    expect(storm.cost).toBeUndefined();
    expect(storm.rest.map((entry) => entry.key)).toEqual(["cost"]);
    expect(() => storm.require("cost")).toThrow(/has no cost/);
    // The block survives emission byte-exact...
    expect(serialize([storm.toEntries()])).toContain("\tcost = {\n\t\tfactor = 2\n\t}\n");
    // ...and a patch may still replace it with a scalar, in place.
    const patched = patchTechnology(storm, () => ({ cost: 500 }));
    expect(serialize([patched.toEntries()])).toContain("\tcost = 500\n");
    expect(serialize([patched.toEntries()])).not.toContain("factor = 2");
  });

  it("throws on an undefined @variable, naming it and the file", () => {
    const files = {
      "common/technology/broken.txt": "tech_pp_broken = {\n\tcost = @nope\n\tarea = society\n}\n",
    };
    expect(() => viewFromFiles(files)).toThrow(/@nope/);
    expect(() => viewFromFiles(files)).toThrow(/broken\.txt/);
  });

  it("throws on an invalid area instead of widening to string", () => {
    const files = {
      "common/technology/bad_area.txt":
        "tech_pp_bad = {\n\tcost = 10\n\tarea = underwater_basket_weaving\n}\n",
    };
    expect(() => viewFromFiles(files)).toThrow(/underwater_basket_weaving/);
    expect(() => viewFromFiles(files)).toThrow(/society/);
  });

  it("refuses parser repairs instead of trusting them", () => {
    const files = { "common/technology/torn.txt": "tech_pp_torn = {\n\tarea = society\n" };
    expect(() => viewFromFiles(files)).toThrow(/parser repaired/);
  });

  it("refuses paths outside the parsed slice", () => {
    expect(() => viewFromFiles({ "common/buildings/pp.txt": "" })).toThrow(/Unsupported path/);
  });
});

describe("OR-prerequisites", () => {
  const view = viewFromFiles({
    "common/technology/pp_eng_tech.txt": OR_TECH_FILE,
  });
  const missiles = view.technology("tech_pp_missiles_2").require("prerequisites");

  it("types the OR group as AnyOf alongside plain refs", () => {
    expect(missiles.prerequisites).toEqual([
      { id: "tech_pp_missiles_1" },
      { kind: "any-of", options: [{ id: "tech_pp_lasers_1" }, { id: "tech_pp_mass_drivers_1" }] },
    ]);
  });

  it("round-trips the mixed container the probe's parser had to refuse", () => {
    const emitted = serialize([missiles.toEntries()]);
    const reparsed = parse(emitted, "or.txt");
    expect(reparsed.diagnostics).toEqual([]);
    expect(withoutLines(reparsed.items)).toEqual(
      withoutLines(parse(OR_TECH_FILE, "or.txt").items.slice(0, 1))
    );
  });

  it("a patch appends a plain ref without disturbing the OR group", () => {
    const patched = patchTechnology(missiles, (t) => ({
      prerequisites: [...t.prerequisites, "pp_tech_torpedoes"],
    }));
    expect(serialize([patched.toEntries()])).toContain(
      'OR = { "tech_pp_lasers_1" "tech_pp_mass_drivers_1" }'
    );
    expect(serialize([patched.toEntries()])).toContain('"pp_tech_torpedoes"');
  });

  it("anyOf() builds a group from refs or strings and rejects empty", () => {
    expect(anyOf("tech_a", { id: "tech_b" })).toEqual({
      kind: "any-of",
      options: [{ id: "tech_a" }, { id: "tech_b" }],
    });
    expect(() => anyOf()).toThrow(/at least one/);
  });
});
