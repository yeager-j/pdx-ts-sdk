import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { external } from "../src/authoring/external.ts";
import { createMod, render } from "../src/index.ts";
import { and, hasCountryFlag, hasTechnology, not } from "../src/script/triggers.ts";

const CONFIG = {
  name: "Technology test",
  prefix: "mymod",
  supportedVersion: "4.4.*",
};
const mod = createMod(CONFIG);

describe("Technology", () => {
  it("emits vanilla-convention PDXScript", () => {
    const base = mod.technology("base", {
      name: "Base Tech",
      cost: 1000,
      area: "physics",
      tier: 2,
      category: "particles",
    });
    const advancedTech = mod.technology("advanced", {
      name: "Advanced Tech",
      cost: 4000,
      area: "physics",
      tier: 3,
      category: "particles",
      prerequisites: [base, "tech_lasers_1"],
      weight: 85,
      isRare: true,
      potential: and(hasCountryFlag("chosen_ones"), not(hasTechnology(base))),
    });
    const file = mod.compile([mod.feature(undefined, [base, advancedTech])]).contentFiles[0]!;
    const advanced = file.entries[file.ids.indexOf("mymod_tech_advanced")]!;
    expect(serialize([advanced])).toMatchInlineSnapshot(`
      "mymod_tech_advanced = {
      	area = physics
      	tier = 3
      	category = { particles }
      	cost = 4000
      	weight = 85
      	prerequisites = { "mymod_tech_base" "tech_lasers_1" }
      	potential = {
      		has_country_flag = chosen_ones
      		NOT = {
      			has_technology = mymod_tech_base
      		}
      	}
      	is_rare = yes
      }
      "
    `);
  });

  it("omits optional fields that were not provided", () => {
    const technologies = mod.feature(undefined, [
      mod.technology("minimal", {
        name: "Minimal",
        cost: 100,
        area: "society",
        tier: 1,
        category: "statecraft",
      }),
    ]);
    expect(render(mod.compile([technologies])).get("common/technology/mymod_technology.txt")).toBe(
      "mymod_tech_minimal = {\n\tarea = society\n\ttier = 1\n\tcategory = { statecraft }\n\tcost = 100\n}\n"
    );
  });

  it("emits the modifier clause at both levels the rules declare it (SDK-63)", () => {
    // 243 shipped technologies write `modifier`, and 55 write the same clause
    // again inside `technology_swap` — the largest unlowered field on the
    // registry, silently dropped by the writer until each got its
    // CONTENT_FIELD_OVERRIDES row. The nested block is not a copy of the
    // outer one: a swap declares the modifiers that replace the parent's when
    // the swap's own trigger holds, so both have to survive one definition.
    const gained = mod.technology("gene_banks", {
      name: "Gene Banks",
      cost: 2000,
      area: "society",
      tier: 2,
      category: "biology",
      modifier: (m) => m.raw("all_technology_research_speed", 0.05),
      technologySwap: [
        {
          name: "gene_seed_purification",
          trigger: hasCountryFlag("purifier"),
          modifier: (m) => {
            m.raw("all_technology_research_speed", 0.1);
            m.country.unity.produces.mult(0.02);
          },
        },
      ],
    });
    const file = mod.compile([mod.feature(undefined, [gained])]).contentFiles[0]!;
    const entry = file.entries[file.ids.indexOf("mymod_tech_gene_banks")]!;
    expect(serialize([entry])).toMatchInlineSnapshot(`
      "mymod_tech_gene_banks = {
      	area = society
      	tier = 2
      	category = { biology }
      	cost = 2000
      	technology_swap = {
      		name = gene_seed_purification
      		trigger = {
      			has_country_flag = purifier
      		}
      		modifier = {
      			all_technology_research_speed = 0.1
      			country_unity_produces_mult = 0.02
      		}
      	}
      	modifier = {
      		all_technology_research_speed = 0.05
      	}
      }
      "
    `);
  });

  it("writes prereqfor_desc's enum keys at both levels (SDK-64)", () => {
    // `enum[prereq_for_category] = { title desc }` is one declaration under a
    // closed set of names, so it authors as one member per name rather than as
    // a record whose keys would have to be the game's spelling —
    // `diploAction`, beside the `hidePrereqForDesc` sibling the same block
    // declares. Each key is a list because vanilla writes `custom` three times
    // inside one `prereqfor_desc`, and the whole block repeats because
    // tech_gene_expressions writes two of them.
    const unlock = mod.technology("ion_cannon", {
      name: "Ion Cannon",
      cost: 3000,
      area: "physics",
      tier: 3,
      category: "particles",
      prereqforDesc: [
        {
          hidePrereqForDesc: ["component"],
          custom: [
            {
              title: external.localization("TECH_UNLOCK_ION_CANNON_TITLE"),
              desc: external.localization("TECH_UNLOCK_ION_CANNON_DESC"),
            },
            { title: external.localization("TECH_UNLOCK_ION_AURAS_TITLE") },
          ],
          diploAction: [{ title: external.localization("TECH_UNLOCK_ION_DIPLO_TITLE") }],
        },
        { custom: [{ title: external.localization("TECH_UNLOCK_ION_REFIT_TITLE") }] },
      ],
      technologySwap: [
        {
          name: "bio_ion_cannon",
          trigger: hasCountryFlag("bio_ships"),
          prereqforDesc: [
            { ship: [{ title: external.localization("TECH_UNLOCK_BIO_ION_TITLE") }] },
          ],
        },
      ],
    });
    const file = mod.compile([mod.feature(undefined, [unlock])]).contentFiles[0]!;
    const entry = file.entries[file.ids.indexOf("mymod_tech_ion_cannon")]!;
    expect(serialize([entry])).toMatchInlineSnapshot(`
      "mymod_tech_ion_cannon = {
      	area = physics
      	tier = 3
      	category = { particles }
      	cost = 3000
      	technology_swap = {
      		name = bio_ion_cannon
      		trigger = {
      			has_country_flag = bio_ships
      		}
      		prereqfor_desc = {
      			ship = {
      				title = TECH_UNLOCK_BIO_ION_TITLE
      			}
      		}
      	}
      	prereqfor_desc = {
      		hide_prereq_for_desc = component
      		custom = {
      			title = TECH_UNLOCK_ION_CANNON_TITLE
      			desc = TECH_UNLOCK_ION_CANNON_DESC
      		}
      		custom = {
      			title = TECH_UNLOCK_ION_AURAS_TITLE
      		}
      		diplo_action = {
      			title = TECH_UNLOCK_ION_DIPLO_TITLE
      		}
      	}
      	prereqfor_desc = {
      		custom = {
      			title = TECH_UNLOCK_ION_REFIT_TITLE
      		}
      	}
      }
      "
    `);
  });
});
