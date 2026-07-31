/**
 * Acceptance tests for the parser probe. The two goldens below were written
 * BY HAND before the parser existed — transcribed from fixture.ts through the
 * serializer's documented rules (tabs, comments dropped, blank lines dropped,
 * `2.0` → `2`, lists inline) — and are immutable: if one turns out to be
 * wrong, that is a recorded finding, not an edit-until-green.
 *
 * Gate (docs/handoff-pdxscript-parser.md): every field of the fixture tech,
 * including the six `TechnologyFields` does not model, survives parse → typed
 * surface → re-emit in original order; the patched golden differs in exactly
 * the two intended changes; `@variable` references re-emit as references
 * except where the author visibly took `.value`; every mismatch between
 * vanilla and the type model fails loudly.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { emitEntries, lowerEntries } from "./emit.ts";
import { TECH_FILE, VARS_FILE } from "./fixture.ts";
import { PdxSyntaxError } from "./lexer.ts";
import { parseSource } from "./parser.ts";
import { geneForging, patched, vanilla } from "./probe.ts";
import { parseVanilla } from "./surface.ts";

// The unpatched fixture tech re-emitted in repo formatting. Every entry of
// the original, in original order — the six unmodelled fields included — with
// every scripted-variable reference still a reference.
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

// Identical to GOLDEN_ROUNDTRIP except exactly two changes, in place: the
// patch took `.value` on cost (baking 8000 is visible in the source), and
// prerequisites gained the new tech. `weight = @t3weight` stays a reference —
// untouched fields never bake.
const GOLDEN_PATCHED = GOLDEN_ROUNDTRIP.replace("\tcost = @t3cost\n", "\tcost = 8000\n").replace(
  '\tprerequisites = { "tech_helix_mapping" }\n',
  '\tprerequisites = { "tech_helix_mapping" "pp_tech_chimeric_grafts" }\n'
);

const STELLARIS_DIR = join(
  process.env["HOME"] ?? "",
  "Library/Application Support/Steam/steamapps/common/Stellaris"
);

describe("parser probe", () => {
  it("round-trips the fixture tech to the hand-written golden", () => {
    expect(serialize([geneForging.toEntries()])).toBe(GOLDEN_ROUNDTRIP);
  });

  it("emits the patched tech with exactly the two intended changes", () => {
    expect(serialize([patched.toEntries()])).toBe(GOLDEN_PATCHED);
  });

  it("re-emission is a fixpoint: parse the emission, emit again, byte-equal", () => {
    const emitted = serialize([geneForging.toEntries()]);
    const reparsed = parseSource(emitted, "emitted.txt");
    expect(emitEntries(reparsed.entries)).toBe(emitted);
  });

  it("resolves variables with provenance: cross-file and file-local", () => {
    expect(geneForging.cost.value).toBe(4000);
    expect(geneForging.cost.ref).toBe("@t3cost");
    expect(geneForging.weight?.value).toBe(65);
    expect(geneForging.weight?.ref).toBe("@t3weight");
    expect(geneForging.tier?.value).toBe(3);
    expect(geneForging.tier?.ref).toBeUndefined();
  });

  it("surfaces typed fields and carries the unmodelled rest", () => {
    expect(geneForging.id).toBe("tech_gene_forging");
    expect(geneForging.area).toBe("society");
    expect(geneForging.category.map((c) => c.id)).toEqual(["biology"]);
    expect(geneForging.prerequisites.map((p) => p.id)).toEqual(["tech_helix_mapping"]);
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

  it("throws on an unknown technology, naming what the files define", () => {
    expect(() => vanilla.technology("tech_missing")).toThrow(/tech_missing/);
    expect(() => vanilla.technology("tech_missing")).toThrow(/tech_gene_forging/);
  });

  it("throws on an undefined @variable, naming it and the file", () => {
    const files = {
      "common/technology/broken.txt": "tech_pp_broken = {\n\tcost = @nope\n\tarea = society\n}\n",
    };
    expect(() => parseVanilla(files)).toThrow(/@nope/);
    expect(() => parseVanilla(files)).toThrow(/broken\.txt/);
  });

  it("throws on an invalid area instead of widening to string", () => {
    const files = {
      "common/technology/bad_area.txt":
        "tech_pp_bad = {\n\tcost = 10\n\tarea = underwater_basket_weaving\n}\n",
    };
    expect(() => parseVanilla(files)).toThrow(/underwater_basket_weaving/);
    expect(() => parseVanilla(files)).toThrow(/society/);
  });

  it("require() names the missing field loudly", () => {
    expect(() => vanilla.technology("tech_gene_forging").require("isRare")).toThrow(/isRare/);
    expect(() => vanilla.technology("tech_gene_forging").require("isRare")).toThrow(
      /tech_gene_forging/
    );
  });

  it("parses both fixture files without consuming their order", () => {
    const parsed = parseSource(TECH_FILE, "pp_soc_tech.txt");
    expect(parsed.entries.map((entry) => entry.key)).toEqual([
      "@tech_gene_forging_POINTS",
      "tech_gene_forging",
    ]);
    expect(parseSource(VARS_FILE, "pp_vars.txt").variables.get("@t3cost")).toBe(4000);
  });
});

describe("parser corners", () => {
  it("preserves comparison operators through the round trip", () => {
    const source = "limit = {\n\thas_level >= 2\n\tcount < 5\n\tval != 0\n}\n";
    expect(emitEntries(parseSource(source, "ops.txt").entries)).toBe(source);
  });

  it("preserves quoted strings with spaces", () => {
    const source = 'custom_tooltip = "the hum went unheard"\n';
    expect(emitEntries(parseSource(source, "quoted.txt").entries)).toBe(source);
  });

  it("round-trips negative and decimal numbers", () => {
    const source = "modifier = {\n\tfactor = -0.5\n}\n";
    expect(emitEntries(parseSource(source, "nums.txt").entries)).toBe(source);
  });

  it("round-trips an empty block", () => {
    const source = "potential = {}\n";
    expect(emitEntries(parseSource(source, "empty.txt").entries)).toBe(source);
  });

  it("lexes @[ ... ] inline math as one token; emitting it throws loudly", () => {
    const parsed = parseSource("position = @[ 1 - leopard_x ]\n", "math.txt");
    const value = parsed.entries[0]?.value;
    expect(value).toEqual({ kind: "math", source: "@[ 1 - leopard_x ]" });
    expect(() => emitEntries(parsed.entries)).toThrow(/inline math/);
  });
});

// Non-gating contact with reality: parse every vanilla technology file and
// assert the semantic fixpoint — parse → emit → re-parse yields the same
// lowered tree. Runs only where the install exists; the committed gate is the
// hand-written fixture above.
//
// No silent caps: files the parser refuses are collected and pinned, not
// skipped. The five below all contain OR-prerequisites — `prerequisites = {
// tech_stingers OR = { ... } }` — a block mixing bare values and assignments,
// which the probe's parser recognizes and refuses (a recorded finding: the
// strict list/block split, and the typed surface's `TechnologyRef[]`, cannot
// represent it). Growing this list means vanilla changed under the probe.
const MIXED_BLOCK_FILES = [
  "00_biogenesis_tech.txt",
  "00_eng_weapon_tech.txt",
  "00_megastructures.txt",
  "00_nomads_dlc_tech.txt",
  "00_phys_weapon_tech.txt",
];

describe.skipIf(!existsSync(STELLARIS_DIR))("real install (non-gating)", () => {
  it("parse → emit → re-parse is a fixpoint over common/technology", () => {
    const dir = join(STELLARIS_DIR, "common/technology");
    const files = readdirSync(dir).filter((name) => name.endsWith(".txt"));
    expect(files.length).toBeGreaterThan(0);
    const refused: string[] = [];
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      let first;
      try {
        first = parseSource(source, name);
      } catch (error) {
        if (error instanceof PdxSyntaxError && /mixing bare values/.test(error.message)) {
          refused.push(name);
          continue;
        }
        throw error;
      }
      const emitted = emitEntries(first.entries);
      const second = parseSource(emitted, name);
      expect(lowerEntries(second.entries), name).toEqual(lowerEntries(first.entries));
    }
    expect(refused).toEqual(MIXED_BLOCK_FILES);
  });
});
