/**
 * The typed vanilla surface, tested against hand-written goldens (written
 * before any parser existed and immutable — a mismatch is a finding, not an
 * edit-until-green) plus three further claims: OR-prerequisites are typed data, `@ref` re-emission
 * survives the package serializer's quoting rule, and swap names refuse.
 */

import { parse, serialize, withoutLines } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { external } from "../../src/authoring/external.ts";
import type { ContentField } from "../../src/content/schema.ts";
import { SwapPatchError } from "../../src/errors.ts";
import type { AscensionPerkCategoryPatch } from "../../src/generated/ascension-perk-category.ts";
import type { BuildingPatch } from "../../src/generated/building.ts";
import {
  patchAscensionPerkCategory as patchAscensionPerkCategoryItem,
  patchBuilding as patchBuildingItem,
  patchMegastructure as patchMegastructureItem,
  patchTechnology as patchTechnologyItem,
} from "../../src/generated/content-definers.ts";
import type { MegastructurePatch } from "../../src/generated/megastructure.ts";
import type { TechnologyPatch } from "../../src/generated/technology.ts";
import { sha256Hex } from "../../src/installation/vanilla/parse.ts";
import {
  anyOf,
  type ParsedAscensionPerkCategory,
  type ParsedBuilding,
  type ParsedMegastructure,
  type ParsedTechnology,
} from "../../src/installation/vanilla/parsed-definitions.ts";
import { patchContent } from "../../src/installation/vanilla/patch.ts";
import { viewFromFiles } from "../../src/installation/vanilla/view.ts";
import type { RecordedRefUse } from "../../src/references.ts";
import { always } from "../../src/stellaris.ts";
import {
  ASCENSION_PERK_CATEGORY_FILE,
  BUILDING_FILE,
  MEGASTRUCTURE_FILE,
  OR_TECH_FILE,
  TECH_FILE,
  VARS_FILE,
} from "../fixtures/vanilla-fixture.ts";

/**
 * The prefix a capability would bind into its `patchX` closure. Every
 * localisation key a patch mints starts with it.
 */
const PREFIX = "pp";

/**
 * Every reference a patch recorded, in a stable order. Both arms of the
 * recorded vocabulary are kept, so an unexpected localization use shows up in
 * the comparison rather than being filtered away.
 */
function sortedRefs(refs: readonly RecordedRefUse[]): RecordedRefUse[] {
  const orderKey = (use: RecordedRefUse): string =>
    use.kind === "localization" ? use.item.key : use.id;
  return [...refs].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
}

/**
 * The generated definer returns a placeable item; these tests measure the
 * transform underneath it.
 */
const patchTechnology = <Source extends ParsedTechnology>(
  technology: Source,
  patch: (technology: Source) => TechnologyPatch
) => patchTechnologyItem(technology, patch, PREFIX).patched;

const patchAscensionPerkCategory = <Source extends ParsedAscensionPerkCategory>(
  category: Source,
  patch: (category: Source) => AscensionPerkCategoryPatch
) => patchAscensionPerkCategoryItem(category, patch, PREFIX).patched;

const patchBuilding = <Source extends ParsedBuilding>(
  building: Source,
  patch: (building: Source) => BuildingPatch
) => patchBuildingItem(building, patch, PREFIX).patched;

const patchMegastructure = <Source extends ParsedMegastructure>(
  megastructure: Source,
  patch: (megastructure: Source) => MegastructurePatch
) => patchMegastructureItem(megastructure, patch, PREFIX).patched;

const FILES = {
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/scripted_variables/pp_vars.txt": VARS_FILE,
};

const vanilla = viewFromFiles(FILES);
const geneForging = vanilla
  .definition("technology", "tech_gene_forging")
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
    expect(() => vanilla.definition("technology", "gene_forging")).toThrow(
      /1 definitions of `technology`/
    );
    expect(() => vanilla.definition("technology", "gene_forging")).toThrow(/tech_gene_forging/);
  });

  it("refuses a technology_swap name, pointing at the parent", () => {
    expect(() => vanilla.definition("technology", "tech_gene_forging_overtuned")).toThrow(
      SwapPatchError
    );
    expect(() => vanilla.definition("technology", "tech_gene_forging_overtuned")).toThrow(
      /technology_swap inside tech_gene_forging/
    );
    // Pins the actionable half of the message, not a doc reference: the reason
    // it is refused and what to do instead.
    expect(() => vanilla.definition("technology", "tech_gene_forging_overtuned")).toThrow(
      /no oracle evidence/
    );
    expect(() => vanilla.definition("technology", "tech_gene_forging_overtuned")).toThrow(
      /Patch tech_gene_forging instead/
    );
  });

  it("require() names the missing field loudly", () => {
    expect(() => vanilla.definition("technology", "tech_gene_forging").require("isRare")).toThrow(
      /isRare/
    );
  });

  it("a block cost is unmodelled: carried in rest, invisible to the type", () => {
    // Real shape from 00_cosmic_storm_tech.txt: cost = { factor = ...
    // inline_script = { ... } }. The surface cannot stand behind it as a
    // number, so it rides in rest and require("cost") stays honest.
    const view = viewFromFiles({
      "common/technology/pp_storm.txt":
        "tech_pp_storm = {\n\tcost = {\n\t\tfactor = 2\n\t}\n\tarea = physics\n\ttier = 2\n}\n",
    });
    const storm = view.definition("technology", "tech_pp_storm");
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
    // A real registry the SDK defines content for, and deliberately does not
    // parse: the slice is PARSED_REGISTRIES, not "anything under common".
    expect(() => viewFromFiles({ "common/traditions/pp.txt": "" })).toThrow(/Unsupported path/);
    expect(() => viewFromFiles({ "common/traditions/pp.txt": "" })).toThrow(/common\/buildings/);
  });
});

describe("OR-prerequisites", () => {
  const view = viewFromFiles({
    "common/technology/pp_eng_tech.txt": OR_TECH_FILE,
  });
  const missiles = view.definition("technology", "tech_pp_missiles_2").require("prerequisites");

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

  it("records every option of an alternation group as a reference", () => {
    // The group lowers to a passthrough entry, so the scalar lowering never
    // sees its options — the transform reports them, against the same
    // `refTypes` the descriptor declares for the field around them.
    const patched = patchTechnology(geneForging, (t) => ({
      prerequisites: [...t.prerequisites, anyOf("tech_a", "pp_tech_b")],
    }));
    // Every id the member writes, grouped or not, on the same terms.
    expect(sortedRefs(patched.refs)).toEqual([
      { targets: ["technology"], id: "pp_tech_b", field: "prerequisites" },
      { targets: ["technology"], id: "tech_a", field: "prerequisites" },
      { targets: ["technology"], id: "tech_helix_mapping", field: "prerequisites" },
    ]);
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
      patchTechnology(view.definition("technology", "tech_pp_dup"), () => ({
        category: ["c3"],
      })).toEntries(),
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

  it("mints a prefixed key for a desc-bearing modifier row, and lowers it", () => {
    const patched = patchTechnology(geneForging, () => ({
      weightModifier: { modifiers: [{ factor: 2, desc: "Because reasons" }] },
    }));
    // The key is the define path's own derivation with the owner substituted:
    // `<prefix>_<vanillaId>` leads it, so it cannot be a key vanilla defines.
    const [entry] = patched.loc;
    expect(entry?.key).toMatch(/^pp_tech_gene_forging_weight_modifier_[0-9a-f]{8}$/);
    expect(entry?.translations).toEqual({ english: "Because reasons" });
    expect(patched.replaceLoc).toEqual([]);
    expect(serialize([patched.toEntries()])).toContain(`\t\tdesc = ${entry!.key}\n`);
  });

  it("pins the minted key to an author-supplied key, through the same owner", () => {
    const patched = patchTechnology(geneForging, () => ({
      weightModifier: {
        modifiers: [{ factor: 2, desc: { english: "Because reasons", key: "flesh_is_weak" } }],
      },
    }));
    expect(patched.loc).toEqual([
      {
        key: "pp_tech_gene_forging_weight_modifier_flesh_is_weak",
        translations: { english: "Because reasons" },
      },
    ]);
    expect(patched.warnings).toEqual([]);
  });

  it("warns, rather than throws, when the minted key is a hash of the text", () => {
    const patched = patchTechnology(geneForging, () => ({
      weightModifier: { modifiers: [{ factor: 2, desc: "Because reasons" }] },
    }));
    expect(patched.warnings).toEqual([
      {
        code: "unstable-desc-key",
        message: expect.stringContaining('Modifier desc on "pp_tech_gene_forging"'),
      },
    ]);
  });

  it("renames through the registry's own localisation slots, under vanilla's keys", () => {
    const patched = patchTechnology(geneForging, () => ({
      name: "Chimeric Forging",
      desc: "Rewritten flavour.",
    }));
    // Vanilla's own slot keys — the declared pattern applied to the vanilla id
    // — so the replacement lands where the game already looks. Nothing about
    // the emitted body changes: a rename is localisation, not script.
    expect(patched.replaceLoc).toEqual([
      { key: "tech_gene_forging", translations: { english: "Chimeric Forging" } },
      { key: "tech_gene_forging_desc", translations: { english: "Rewritten flavour." } },
    ]);
    expect(patched.loc).toEqual([]);
    expect(serialize([patched.toEntries()])).toBe(GOLDEN_ROUNDTRIP);
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
    // A localisation slot IS a patchable member — it writes no body key, so
    // the patchable-field map does not have it, and it must not be mistaken
    // for a typo on the way past.
    expect(() => patchTechnology(geneForging, () => ({ cost: 1, name: "Renamed" }))).not.toThrow();
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
  const swapped = view.definition("technology", "tech_pp_swaps");

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

  it("refuses a parsed entry belonging to another member", () => {
    // A passthrough carries its own key, so an `area` entry spliced into
    // `technologySwap` would delete the swaps and write a second `area` where
    // they stood. Loud, rather than a body the author never described.
    const area = swapped.body.find((entry) => entry.key === "area")!;
    expect(() => patchTechnology(swapped, () => ({ technologySwap: [area] }))).toThrow(
      '"technologySwap" was given a parsed "area" entry, and this member writes "technology_swap"'
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

/**
 * The second registry through the same seam. Nothing below is a building-shaped
 * variant of the machinery above — it is the same transform, the same view, and
 * the same descriptors, reached through a registry whose parsed side models no
 * fields at all. That is the property: a registry costs an overlay row and a
 * `PARSED_REGISTRIES` row, not a code path.
 */
describe("the building slice", () => {
  const view = viewFromFiles({ "common/buildings/pp_buildings.txt": BUILDING_FILE });
  const refinery = view.definition("building", "building_pp_refinery");

  it("parses every definition with its provenance and its registry tag", () => {
    expect(view.definitions("building").map((building) => building.id)).toEqual([
      "building_pp_refinery",
      "building_pp_refinery_2",
    ]);
    expect(refinery.registry).toBe("building");
    expect(refinery.sourceFile).toBe("common/buildings/pp_buildings.txt");
    expect(refinery.sourceSha256).toBe(sha256Hex(BUILDING_FILE));
    expect(refinery.citation).toMatch(/^common\/buildings\/pp_buildings\.txt:\d+$/);
    expect(refinery.origin).toBe(view);
  });

  it("models no field, so the whole body rides in rest", () => {
    // Nothing is property-accessible and nothing is dropped: `rest` is the
    // body, which is what makes a registry with no reader still patchable.
    expect(refinery.rest).toBe(refinery.body);
    expect(refinery.rest.map((entry) => entry.key)).toEqual([
      "base_buildtime",
      "category",
      "icon",
      "potential",
      "allow",
      "prerequisites",
      "upgrades",
      "resources",
      "planet_limit",
      "triggered_planet_modifier",
      "triggered_planet_modifier",
      "ai_weight",
    ]);
  });

  it("re-emission is a semantic fixpoint", () => {
    const emitted = serialize([refinery.toEntries()]);
    const reparsed = parse(emitted, "emitted.txt");
    expect(reparsed.diagnostics).toEqual([]);
    expect(serialize(reparsed.items)).toBe(emitted);
    expect(withoutLines(reparsed.items)).toEqual(
      withoutLines(parse(BUILDING_FILE, "buildings.txt").items.slice(1, 2))
    );
  });

  it("resolves the file-local @variable rather than trusting it", () => {
    expect(() =>
      viewFromFiles({
        "common/buildings/broken.txt": "building_pp_x = {\n\tbase_buildtime = @nope\n}\n",
      })
    ).toThrow(/@nope/);
  });

  it("refuses a swap name for a registry that declares none, as an unknown id", () => {
    // `SWAP_IDENTITIES` has no building row, so nothing is registered as a
    // swap and the refusal above never fires here — an unknown id is just
    // unknown, with the same nearest-match hint.
    expect(() => view.definition("building", "building_pp_refiner")).toThrow(
      /Unknown building "building_pp_refiner"/
    );
    expect(() => view.definition("building", "building_pp_refiner")).toThrow(
      /2 definitions of `building`/
    );
  });

  it("patches in place: a replaced trigger, an appended block, a flipped dual", () => {
    const kept = refinery.body.filter((entry) => entry.key === "triggered_planet_modifier");
    const patched = patchBuilding(refinery, () => ({
      potential: always(),
      planetLimit: { base: 2, modifiers: [{ add: 1, when: always() }] },
      triggeredPlanetModifier: [
        ...kept,
        { when: always(), modifier: (m) => m.raw("planet_jobs_produces_mult", 0.3) },
      ],
    }));
    const emitted = serialize([patched.toEntries()]);
    // Each patched key kept its slot, and the untouched ones rode through —
    // including `resources`, whose nested `inline_script` no authoring surface
    // can express (SDK-62 residue, SDK-17 machinery). Passthrough covering
    // what a definer cannot write is the point of walking the parsed body.
    expect(emitted).toBe(
      "building_pp_refinery = {\n" +
        "\tbase_buildtime = @pp_refinery_buildtime\n" +
        "\tcategory = manufacturing\n" +
        "\ticon = building_pp_refinery\n" +
        "\tpotential = {\n\t\talways = yes\n\t}\n" +
        "\tallow = {\n\t\thas_major_upgraded_capital = yes\n\t}\n" +
        '\tprerequisites = { "tech_gene_forging" }\n' +
        "\tupgrades = { building_pp_refinery_2 }\n" +
        "\tresources = {\n" +
        "\t\tcategory = planet_buildings\n" +
        "\t\tinline_script = {\n" +
        "\t\t\tscript = jobs/building_jobs\n" +
        "\t\t\tBUILDING = pp_refinery\n" +
        "\t\t}\n" +
        "\t\tcost = {\n\t\t\tminerals = 300\n\t\t}\n" +
        "\t\tupkeep = {\n\t\t\tenergy = 5\n\t\t}\n" +
        "\t}\n" +
        "\tplanet_limit = {\n\t\tbase = 2\n\t\tmodifier = {\n\t\t\tadd = 1\n\t\t\talways = yes\n\t\t}\n\t}\n" +
        "\ttriggered_planet_modifier = {\n" +
        "\t\tpotential = {\n\t\t\texists = owner\n\t\t}\n" +
        "\t\tmodifier = {\n\t\t\tplanet_jobs_produces_mult = 0.1\n\t\t}\n" +
        "\t}\n" +
        "\ttriggered_planet_modifier = {\n" +
        "\t\tpotential = {\n\t\t\thas_modifier = pp_storm_touched\n\t\t}\n" +
        "\t\tmodifier = {\n\t\t\tplanet_jobs_upkeep_mult = -0.05\n\t\t}\n" +
        "\t}\n" +
        "\ttriggered_planet_modifier = {\n" +
        "\t\tpotential = {\n\t\t\talways = yes\n\t\t}\n" +
        "\t\tmodifier = {\n\t\t\tplanet_jobs_produces_mult = 0.3\n\t\t}\n" +
        "\t}\n" +
        "\tai_weight = {\n\t\tweight = 5\n\t}\n" +
        "}\n"
    );
  });

  it("flips the other building's dual the other way, block to scalar", () => {
    const upgraded = view.definition("building", "building_pp_refinery_2");
    const emitted = serialize([patchBuilding(upgraded, () => ({ planetLimit: 3 })).toEntries()]);
    expect(emitted).toContain("\tplanet_limit = 3\n");
    expect(emitted).not.toContain("ap_engineered_evolution");
  });

  it("refuses a parsed entry belonging to another member, as it does elsewhere", () => {
    const allow = refinery.body.find((entry) => entry.key === "allow")!;
    expect(() => patchBuilding(refinery, () => ({ triggeredPlanetModifier: [allow] }))).toThrow(
      '"triggeredPlanetModifier" was given a parsed "allow" entry, and this member writes ' +
        '"triggered_planet_modifier"'
    );
  });

  it("records the references a patched ref-valued member writes", () => {
    const patched = patchBuilding(refinery, () => ({
      upgrades: [{ id: "pp_building_annex" }],
      prerequisites: ["pp_tech_refining"],
    }));
    expect(sortedRefs(patched.refs)).toEqual([
      { targets: ["building"], id: "pp_building_annex", field: "upgrades" },
      { targets: ["technology"], id: "pp_tech_refining", field: "prerequisites" },
    ]);
  });
});

describe("the ascension perk category slice", () => {
  const view = viewFromFiles({
    "common/ascension_perk_categories/pp_ascension_perk_categories.txt":
      ASCENSION_PERK_CATEGORY_FILE,
  });
  const ambitions = view.definition("ascension_perk_category", "ap_category_ambitions");

  it("parses the current members as branded references", () => {
    expect(ambitions.registry).toBe("ascension_perk_category");
    expect(ambitions.sourceSha256).toBe(sha256Hex(ASCENSION_PERK_CATEGORY_FILE));
    expect(ambitions.ascensionPerks.map((perk) => perk.id)).toEqual([
      "ap_defender_of_the_galaxy_nomads",
      "ap_become_the_crisis",
      "ap_cosmogenesis",
      "ap_behemoths",
      "ap_galactic_hyperthermia",
    ]);
    expect(ambitions.rest).toEqual([]);
  });

  it("round-trips the category and appends a perk in its original field slot", () => {
    const roundTrip = serialize([ambitions.toEntries()]);
    expect(serialize(parse(roundTrip, "category.txt").items)).toBe(roundTrip);

    const patched = patchAscensionPerkCategory(ambitions, (category) => ({
      ascensionPerks: [...category.ascensionPerks, "pp_ascension_perk_archive_ambition"],
    }));
    const emitted = serialize([patched.toEntries()]);
    expect(emitted).toContain(
      "\tascension_perks = { ap_defender_of_the_galaxy_nomads ap_become_the_crisis " +
        "ap_cosmogenesis ap_behemoths ap_galactic_hyperthermia " +
        "pp_ascension_perk_archive_ambition }\n"
    );
  });

  it("rejects a category without its required member list", () => {
    expect(() =>
      viewFromFiles({
        "common/ascension_perk_categories/broken.txt": "ap_category_empty = { }\n",
      })
    ).toThrow(/ascension_perk_category ap_category_empty has no ascension_perks/);
  });
});

/**
 * The megastructure registry also has an assumed rule-table cell. Nothing
 * about the parse or transform changes for that — the confidence rides on the
 * *win*, which this file does not compute — so what is measured here is the
 * same property the building slice measures, through shapes neither earlier
 * registry writes: an `economic_template` block, an inline nested struct, and
 * a field the emitter declines outright.
 */
describe("the megastructure slice", () => {
  const view = viewFromFiles({
    "common/megastructures/pp_megastructures.txt": MEGASTRUCTURE_FILE,
    "common/scripted_variables/pp_vars.txt": VARS_FILE,
  });
  const array0 = view.definition("megastructure", "megastructure_pp_array_0");

  it("parses every definition with its provenance and its registry tag", () => {
    expect(view.definitions("megastructure").map((mega) => mega.id)).toEqual([
      "megastructure_pp_array_0",
      "megastructure_pp_array_1",
    ]);
    expect(array0.registry).toBe("megastructure");
    expect(array0.sourceFile).toBe("common/megastructures/pp_megastructures.txt");
    expect(array0.sourceSha256).toBe(sha256Hex(MEGASTRUCTURE_FILE));
    expect(array0.origin).toBe(view);
  });

  it("models no field, so the whole body rides in rest", () => {
    expect(array0.rest).toBe(array0.body);
    expect(array0.rest.map((entry) => entry.key)).toEqual([
      "entity",
      "construction_entity",
      "portrait",
      "place_entity_on_planet_plane",
      "entity_offset",
      "build_time",
      "resources",
      "custom_tooltip_requirements",
      "prerequisites",
      "potential",
      "possible",
      "placement_rules",
      "ai_weight",
    ]);
  });

  it("re-emission is a semantic fixpoint", () => {
    const emitted = serialize([array0.toEntries()]);
    const reparsed = parse(emitted, "emitted.txt");
    expect(reparsed.diagnostics).toEqual([]);
    expect(serialize(reparsed.items)).toBe(emitted);
    expect(withoutLines(reparsed.items)).toEqual(
      withoutLines(parse(MEGASTRUCTURE_FILE, "megastructures.txt").items.slice(2, 3))
    );
  });

  it("resolves both file-local @variables rather than trusting them", () => {
    expect(() =>
      viewFromFiles({
        "common/megastructures/broken.txt":
          "megastructure_pp_x = {\n\tentity_offset = { x = 0 y = @nope }\n}\n",
      })
    ).toThrow(/@nope/);
  });

  it("patches in place: a replaced economic block, an appended member", () => {
    const patched = patchMegastructure(array0, () => ({
      buildTime: 2400,
      resources: [
        {
          category: "megastructures",
          cost: { amounts: { unity: 7500 } },
          upkeep: { amounts: { energy: 8 } },
        },
      ],
      triggeredCountryModifier: [
        { when: always(), modifier: (m) => m.raw("country_naval_cap_add", 25) },
      ],
    }));
    const emitted = serialize([patched.toEntries()]);
    // Replaced in the slot vanilla wrote it in...
    expect(emitted).toContain("\tbuild_time = 2400\n");
    expect(emitted).toContain(
      "\tresources = {\n" +
        "\t\tcategory = megastructures\n" +
        "\t\tcost = {\n\t\t\tunity = 7500\n\t\t}\n" +
        "\t\tupkeep = {\n\t\t\tenergy = 8\n\t\t}\n" +
        "\t}\n"
    );
    // ...and a member vanilla did not write is appended rather than refused.
    expect(emitted).toContain(
      "\ttriggered_country_modifier = {\n" +
        "\t\tpotential = {\n\t\t\talways = yes\n\t\t}\n" +
        "\t\tmodifier = {\n\t\t\tcountry_naval_cap_add = 25\n\t\t}\n" +
        "\t}\n"
    );
  });

  it("carries an untouched mixed trigger struct through a patch, byte-exact", () => {
    const emitted = serialize([patchMegastructure(array0, () => ({ buildTime: 60 })).toEntries()]);
    expect(emitted).toContain(
      "\tplacement_rules = {\n" +
        "\t\tplanet_possible = {\n" +
        "\t\t\tNOT = {\n\t\t\t\tis_planet_class = pc_gas_giant\n\t\t\t}\n" +
        "\t\t}\n" +
        "\t}\n"
    );
  });

  it("patches a mixed trigger struct with its trigger flattened beside siblings", () => {
    const emitted = serialize([
      patchMegastructure(array0, () => ({
        placementRules: { when: always(), planetPossible: always() },
      })).toEntries(),
    ]);
    expect(emitted).toContain(
      "\tplacement_rules = {\n\t\tplanet_possible = {\n\t\t\talways = yes\n\t\t}\n\t\talways = yes\n\t}\n"
    );
    expect(emitted).not.toContain("when =");
  });

  it("carries an untouched nested struct through with its @reference intact", () => {
    // Vanilla writes `entity_offset = { x = 0 y = @... }` on one line; the
    // package serializer promises a semantic round trip, not a byte-identical
    // one, so it comes back as a block. What must survive is the `@variable`
    // reference — baked to `-20` here, the emitted file would need no
    // declaration and the patch's local re-declaration would be wrong.
    const emitted = serialize([patchMegastructure(array0, () => ({ buildTime: 60 })).toEntries()]);
    expect(emitted).toContain("\tentity_offset = {\n\t\tx = 0\n\t\ty = @pp_array_offset_y\n\t}\n");
  });

  it("keeps a carried occurrence beside a fresh one, at the first one's position", () => {
    // `triggered_country_modifier` repeats — the rules declare
    // `## cardinality = 0..1` and vanilla's own `shroud_seal` writes it twice,
    // so the member is a list on both surfaces. Replacement is still
    // all-occurrences-at-the-first-one's-position (the technology `category`
    // rule), and with a list nothing is lost by it: an author spreads the
    // occurrences they mean to keep and authors the rest beside them.
    const array1 = view.definition("megastructure", "megastructure_pp_array_1");
    const kept = array1.body.filter((entry) => entry.key === "triggered_country_modifier")[1]!;
    const emitted = serialize([
      patchMegastructure(array1, () => ({
        triggeredCountryModifier: [
          kept,
          { when: always(), modifier: (m) => m.raw("country_naval_cap_add", 40) },
        ],
      })).toEntries(),
    ]);
    // Both blocks, in the order the array gave them, in the slot the first
    // vanilla occurrence held — before `ai_weight`, which did not move.
    expect(emitted).toBe(
      "megastructure_pp_array_1 = {\n" +
        '\tentity = "pp_array_entity"\n' +
        '\tconstruction_entity = "pp_array_construction_entity"\n' +
        '\tportrait = "GFX_megastructure_pp_array_background"\n' +
        "\tplace_entity_on_planet_plane = no\n" +
        "\tbuild_time = @pp_array_buildtime\n" +
        "\tupgrade_from = { megastructure_pp_array_0 }\n" +
        "\tresources = {\n" +
        "\t\tcategory = megastructures\n" +
        "\t\tcost = {\n\t\t\tunity = 10000\n\t\t}\n" +
        "\t\tupkeep = {\n\t\t\tenergy = 10\n\t\t}\n" +
        "\t}\n" +
        "\ttriggered_country_modifier = {\n" +
        "\t\tpotential = {\n\t\t\talways = yes\n\t\t}\n" +
        "\t\tall_technology_research_speed = 0.05\n" +
        "\t}\n" +
        "\ttriggered_country_modifier = {\n" +
        "\t\tpotential = {\n\t\t\talways = yes\n\t\t}\n" +
        "\t\tmodifier = {\n\t\t\tcountry_naval_cap_add = 40\n\t\t}\n" +
        "\t}\n" +
        "\tai_weight = {\n" +
        "\t\tweight = 5\n" +
        "\t\tmodifier = {\n" +
        "\t\t\tfactor = 2\n" +
        "\t\t\tfrom = {\n\t\t\t\thas_ascension_perk = ap_galactic_wonders\n\t\t\t}\n" +
        "\t\t}\n" +
        "\t}\n" +
        "}\n"
    );
    // The occurrence the author did not carry is the only thing dropped.
    expect(emitted).not.toContain("has_technology = tech_pp_resonance");
  });

  it("records the references a patched ref-valued member writes", () => {
    const patched = patchMegastructure(array0, () => ({
      prerequisites: ["pp_tech_resonance"],
      upgradeFrom: [{ id: "pp_megastructure_seed" }],
    }));
    expect(sortedRefs(patched.refs)).toEqual([
      { targets: ["megastructure"], id: "pp_megastructure_seed", field: "upgrade_from" },
      { targets: ["technology"], id: "pp_tech_resonance", field: "prerequisites" },
    ]);
  });

  it("renames through all four of the registry's localisation slots", () => {
    const patched = patchMegastructure(array0, () => ({
      name: "Resonance Array",
      desc: "A lattice tuned to the system's star.",
      details: "Amplifies research across the empire.",
      delayedInfo: "Construction continues.",
    }));
    expect(patched.replaceLoc).toEqual([
      { key: "megastructure_pp_array_0", translations: { english: "Resonance Array" } },
      {
        key: "megastructure_pp_array_0_DESC",
        translations: { english: "A lattice tuned to the system's star." },
      },
      {
        key: "megastructure_pp_array_0_MEGASTRUCTURE_DETAILS",
        translations: { english: "Amplifies research across the empire." },
      },
      {
        key: "megastructure_pp_array_0_CONSTRUCTION_INFO_DELAYED",
        translations: { english: "Construction continues." },
      },
    ]);
    expect(patched.loc).toEqual([]);
    // A rename is localisation, not script: the body is the unpatched one.
    expect(serialize([patched.toEntries()])).toBe(serialize([array0.toEntries()]));
  });
});

/**
 * Which shapes a patch may carry is a question about the *define* path: the
 * only localisation a definition mints for itself comes from
 * `ContentAuthoring`'s pre-pass, which reaches `weightBlock` desc rows,
 * `repeatedStruct` ids, and every key-typed field — and, since it descends
 * `struct` levels, anything nested inside one. A patch runs the same pre-pass
 * against `<prefix>_<vanillaId>`. Everything else a definition can hold is a
 * recorder's output, and rides a patch unchanged.
 */
describe("what a patch may and may not carry", () => {
  const view = viewFromFiles({ "common/buildings/pp_buildings.txt": BUILDING_FILE });
  const refinery = view.definition("building", "building_pp_refinery");

  it("carries the two building shapes that mint nothing", () => {
    const emitted = serialize([
      patchBuilding(refinery, () => ({
        // modifierBlock: a recorder, nothing else.
        planetModifier: (m) => m.raw("planet_housing_add", 2),
        // effect: the effect recorder collects references, never localisation.
        onBuilt: (colony) => {
          colony.addModifier({ modifier: "pp_refinery_online", days: -1 });
        },
      })).toEntries(),
    ]);
    expect(emitted).toContain("\tplanet_modifier = {\n\t\tplanet_housing_add = 2\n\t}\n");
    expect(emitted).toContain("\ton_built = {\n\t\tadd_modifier = {");
  });

  it("mints a patched definition's key-typed text under the prefixed vanilla id", () => {
    const patched = patchBuilding(refinery, () => ({
      // triggeredModifierBlock: `description` is a key CWT types `localisation`.
      triggeredPlanetModifier: [
        {
          when: always(),
          description: "Refined output rises.",
          modifier: (m) => m.raw("planet_jobs_produces_mult", 0.4),
        },
      ],
      // struct: `triggered_desc.text` is a key-typed field one level down.
      triggeredDesc: [{ trigger: always(), text: "The refinery is running hot." }],
      // A reference names a key that already exists, so it mints nothing.
      customTooltip: external.localization("pp_refinery_existing_tooltip"),
    }));
    expect(patched.loc).toEqual([
      {
        key: "pp_building_pp_refinery_triggered_planet_modifier_0_description",
        translations: { english: "Refined output rises." },
      },
      {
        key: "pp_building_pp_refinery_triggered_desc_0_text",
        translations: { english: "The refinery is running hot." },
      },
    ]);
    const emitted = serialize([patched.toEntries()]);
    expect(emitted).toContain(
      "\t\tdescription = pp_building_pp_refinery_triggered_planet_modifier_0_description\n"
    );
    expect(emitted).toContain("\t\ttext = pp_building_pp_refinery_triggered_desc_0_text\n");
    expect(emitted).toContain("\tcustom_tooltip = pp_refinery_existing_tooltip\n");
  });

  it("leaves a passthrough occurrence alone while an authored sibling mints", () => {
    // Vanilla's own second `triggered_planet_modifier` rides through as the
    // node it already is: its text, if it had any, is vanilla's and already
    // keyed, so nothing here may re-key it.
    const vanillaClause = refinery.body.filter(
      (entry) => entry.key === "triggered_planet_modifier"
    )[1]!;
    const patched = patchBuilding(refinery, () => ({
      triggeredPlanetModifier: [
        vanillaClause,
        {
          when: always(),
          description: "An authored clause.",
          modifier: (m) => m.raw("planet_housing_add", 1),
        },
      ],
    }));
    expect(patched.loc).toEqual([
      {
        key: "pp_building_pp_refinery_triggered_planet_modifier_1_description",
        translations: { english: "An authored clause." },
      },
    ]);
    const emitted = serialize([patched.toEntries()]);
    expect(emitted).toContain("\t\thas_modifier = pp_storm_touched\n");
    expect(emitted).toContain(
      "\t\tdescription = pp_building_pp_refinery_triggered_planet_modifier_1_description\n"
    );
  });

  it("mints for a desc'd modifier row nested inside a struct member", () => {
    // `technology_swap` is a struct whose `weight` is a dual with a WeightBlock
    // arm — one level down from the top, and a level the define path's own
    // pre-pass descends. The struct key and the entry's index are in the
    // minted key, so two swaps do not share one.
    const patched = patchTechnology(geneForging, () => ({
      technologySwap: [
        {
          name: "tech_gene_forging_frugal",
          weight: {
            modifiers: [{ factor: 2, desc: { english: "Cheaper", key: "frugal" } }],
          },
        },
        {
          name: "tech_gene_forging_lavish",
          weight: {
            modifiers: [{ factor: 3, desc: { english: "Pricier", key: "lavish" } }],
          },
        },
      ],
    }));
    expect(patched.loc).toEqual([
      {
        key: "pp_tech_gene_forging_technology_swap_0_weight_frugal",
        translations: { english: "Cheaper" },
      },
      {
        key: "pp_tech_gene_forging_technology_swap_1_weight_lavish",
        translations: { english: "Pricier" },
      },
    ]);
    const emitted = serialize([patched.toEntries()]);
    expect(emitted).toContain(
      "\t\t\tdesc = pp_tech_gene_forging_technology_swap_0_weight_frugal\n"
    );
    expect(emitted).toContain(
      "\t\t\tdesc = pp_tech_gene_forging_technology_swap_1_weight_lavish\n"
    );
  });

  it("refuses a nested definition whose ids would need localisation of their own", () => {
    // No live patch registry has such a field, so this is the refusal reached
    // by construction rather than through a registry: a `repeatedStruct` entry
    // key is an id of this mod's own, and a patch has no rule for minting one
    // inside a definition it does not own.
    const nested: ContentField = {
      key: "swap",
      member: "swap",
      shape: "repeatedStruct",
      form: "block",
      keying: "container",
      fields: [],
      localisation: [{ member: "name", pattern: "$", required: true }],
    };
    expect(() =>
      patchContent(
        refinery,
        () => ({ swap: { pp_thing: { name: "Thing" } } }),
        "building",
        [nested],
        [],
        PREFIX
      )
    ).toThrow(/is a nested definition whose ids carry localisation/);
  });
});
