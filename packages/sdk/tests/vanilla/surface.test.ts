/**
 * The typed vanilla surface, tested against hand-written goldens (written
 * before any parser existed and immutable — a mismatch is a finding, not an
 * edit-until-green) plus three further claims: OR-prerequisites are typed data, `@ref` re-emission
 * survives the package serializer's quoting rule, and swap names refuse.
 */

import { parse, serialize, withoutLines } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { SwapPatchError } from "../../src/errors.ts";
import { patchTechnology as patchTechnologyItem } from "../../src/generated/content-definers.ts";
import type { TechnologyPatch } from "../../src/generated/technology.ts";
import {
  anyOf,
  sha256Hex,
  viewFromFiles,
  type ParsedTechnology,
} from "../../src/stellaris/vanilla/view.ts";
import { OR_TECH_FILE, TECH_FILE, VARS_FILE } from "../fixtures/vanilla-fixture.ts";

/**
 * The generated definer returns a placeable item; these tests measure the
 * transform underneath it.
 */
const patchTechnology = <Source extends ParsedTechnology>(
  technology: Source,
  patch: (technology: Source) => TechnologyPatch
) => patchTechnologyItem(technology, patch).patched;

const FILES = {
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/scripted_variables/pp_vars.txt": VARS_FILE,
};

const vanilla = viewFromFiles(FILES);
const geneForging = vanilla
  .technology("tech_gene_forging")
  .require("cost", "prerequisites", "weight");

// The unpatched fixture tech re-emitted in repo formatting, hand-written
// before the parser existed.
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

describe("typed vanilla surface", () => {
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
    // Pins the actionable half of the message, not a doc reference: the reason
    // it is refused and what to do instead.
    expect(() => vanilla.technology("tech_gene_forging_overtuned")).toThrow(/no oracle evidence/);
    expect(() => vanilla.technology("tech_gene_forging_overtuned")).toThrow(
      /Patch tech_gene_forging instead/
    );
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

  it("a freshly built OR group is a legal patch input, by the patch widening", () => {
    const patched = patchTechnology(missiles, () => ({
      prerequisites: [anyOf("tech_pp_lasers_1", "pp_tech_torpedoes")],
    }));
    expect(serialize([patched.toEntries()])).toContain(
      '\tprerequisites = {\n\t\tOR = { "tech_pp_lasers_1" "pp_tech_torpedoes" }\n\t}\n'
    );
  });
});

/**
 * What the hand-written transform could not do, and what it silently got
 * wrong. Both follow from lowering through the registry's own field
 * descriptors: the forms they admit are the forms a patch admits, and the
 * references they declare are the references a patch records.
 */
describe("descriptor-derived patching", () => {
  it("admits the dual field's block arm, which the hand-listed type dropped", () => {
    const patched = patchTechnology(geneForging, () => ({ cost: { base: 5000, factor: 2 } }));
    expect(serialize([patched.toEntries()])).toContain(
      "\tcost = {\n\t\tbase = 5000\n\t\tfactor = 2\n\t}\n"
    );
  });

  it("records the reference a patched ref-valued field writes", () => {
    // `tier` is `<technology_tier>` in the rules, and the hand-written
    // transform wrote it without recording the use — the descriptor declares
    // it, so the lowering collects it like any other.
    const patched = patchTechnology(geneForging, () => ({ tier: { id: "pp_tier_4" } }));
    expect(patched.refs).toContainEqual({
      targets: ["technology_tier"],
      id: "pp_tier_4",
      field: "tier",
    });
  });

  it("keeps a bare number in a ref-valued field out of the reference guard", () => {
    // Vanilla's tiers are the integers 0-5, so `tier: 3` names no id.
    const patched = patchTechnology(geneForging, () => ({ tier: 3 }));
    expect(patched.refs).toEqual([]);
    expect(serialize([patched.toEntries()])).toContain("\ttier = 3\n");
  });

  it("replaces every occurrence of a repeated key, at the first one's position", () => {
    const view = viewFromFiles({
      "common/technology/pp_dup.txt":
        "tech_pp_dup = {\n\tarea = physics\n\tcategory = { c1 }\n\tgateway = g\n" +
        "\tcategory = { c2 }\n}\n",
    });
    const emitted = serialize([
      patchTechnology(view.technology("tech_pp_dup"), () => ({ category: ["c3"] })).toEntries(),
    ]);
    expect(emitted).toBe(
      "tech_pp_dup = {\n\tarea = physics\n\tcategory = { c3 }\n\tgateway = g\n}\n"
    );
  });

  it("carries parsed occurrences through beside freshly authored ones", () => {
    const swap = geneForging.body.find((entry) => entry.key === "technology_swap")!;
    const emitted = serialize([
      patchTechnology(geneForging, () => ({
        technologySwap: [swap, { name: "tech_gene_forging_frugal", inheritIcon: true }],
      })).toEntries(),
    ]);
    // The parsed one is spliced as it stands, interior and all...
    expect(emitted).toContain("\t\thas_origin = origin_overtuned\n");
    // ...and the fresh one lowers through the same descriptor beside it.
    expect(emitted).toContain(
      "\ttechnology_swap = {\n\t\tname = tech_gene_forging_frugal\n\t\tinherit_icon = yes\n\t}\n"
    );
  });

  it("refuses a desc-bearing modifier row until patches can mint its key", () => {
    expect(() =>
      patchTechnology(geneForging, () => ({
        weightModifier: { modifiers: [{ factor: 2, desc: "Because reasons" }] },
      }))
    ).toThrow(/desc'd modifier rows in patches arrive with the patch-localization change/);
  });
});

/**
 * A patch member the transform would not emit has to fail loudly. The lowering
 * iterates descriptors rather than the patch object, so an unknown key is
 * dropped in silence otherwise — and the compiler catches neither case:
 * TypeScript performs no excess-property check on an object literal returned
 * from an inferred-return arrow, which is the shape every patch callback has.
 */
describe("patch members the transform cannot emit", () => {
  it("refuses `id`, which vanilla's identity already settles", () => {
    expect(() =>
      // @ts-expect-error — pinned as an error where the compiler does see it.
      patchTechnology(geneForging, (): TechnologyPatch => ({ cost: 1, id: "pp_tech_elsewhere" }))
    ).toThrow(/may not set "id"/);
    // The real idiom, which the compiler does NOT reject: an inferred-return
    // arrow gets no excess-property check, so this is caught here or nowhere.
    expect(() => patchTechnology(geneForging, () => ({ cost: 1, id: "pp_x" }))).toThrow(
      /keeps vanilla's identity/
    );
  });

  it("refuses a member the registry does not have, with a nearest-match hint", () => {
    expect(() => patchTechnology(geneForging, () => ({ cost: 1, costt: 2 }))).toThrow(
      /"costt", which is not a patchable technology member/
    );
    expect(() => patchTechnology(geneForging, () => ({ cost: 1, costt: 2 }))).toThrow(
      /did you mean: cost, costPerLevel\?/
    );
    // A localisation slot is a real member of the definition and deliberately
    // not of the patch, so it fails here rather than emitting nothing.
    expect(() => patchTechnology(geneForging, () => ({ cost: 1, name: "Renamed" }))).toThrow(
      /"name", which is not a patchable technology member/
    );
  });
});

/**
 * `technology_swap` is an ordinary repeated struct in patch position. Replacing
 * the swap blocks of a technology this mod is already overriding whole is not
 * the refused case — that is patching *into* a swap as an override target,
 * which `VanillaView.technology` still refuses (see `SwapPatchError` above).
 */
describe("patched technology swaps", () => {
  const view = viewFromFiles({
    "common/technology/pp_swaps.txt":
      "tech_pp_swaps = {\n\tarea = society\n" +
      "\ttechnology_swap = {\n\t\tname = tech_pp_swaps_a\n\t\tinherit_icon = yes\n\t}\n" +
      "\tgateway = biological\n" +
      "\ttechnology_swap = {\n\t\tname = tech_pp_swaps_b\n\t\tinherit_effects = no\n\t}\n}\n",
  });
  const swapped = view.technology("tech_pp_swaps");

  it("replaces every swap block at the first one's position", () => {
    const emitted = serialize([
      patchTechnology(swapped, () => ({
        technologySwap: [{ name: "tech_pp_swaps_c", inheritName: true }],
      })).toEntries(),
    ]);
    expect(emitted).toBe(
      "tech_pp_swaps = {\n\tarea = society\n" +
        "\ttechnology_swap = {\n\t\tname = tech_pp_swaps_c\n\t\tinherit_name = yes\n\t}\n" +
        "\tgateway = biological\n}\n"
    );
  });

  it("keeps the parsed swaps byte-faithful when one fresh swap joins them", () => {
    const parsed = swapped.body.filter((entry) => entry.key === "technology_swap");
    const emitted = serialize([
      patchTechnology(swapped, () => ({
        technologySwap: [...parsed, { name: "tech_pp_swaps_c" }],
      })).toEntries(),
    ]);
    expect(emitted).toBe(
      "tech_pp_swaps = {\n\tarea = society\n" +
        "\ttechnology_swap = {\n\t\tname = tech_pp_swaps_a\n\t\tinherit_icon = yes\n\t}\n" +
        "\ttechnology_swap = {\n\t\tname = tech_pp_swaps_b\n\t\tinherit_effects = no\n\t}\n" +
        "\ttechnology_swap = {\n\t\tname = tech_pp_swaps_c\n\t}\n" +
        "\tgateway = biological\n}\n"
    );
  });
});
