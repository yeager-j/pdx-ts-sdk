import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { Technology } from "../src/tech.ts";
import { and, hasCountryFlag, hasTechnology, not } from "../src/triggers.ts";

describe("Technology", () => {
  it("emits vanilla-convention PDXScript", () => {
    const base = new Technology({
      id: "mymod_tech_base",
      name: "Base Tech",
      cost: 1000,
      area: "physics",
      tier: 2,
      category: "particles",
    });
    const tech = new Technology({
      id: "mymod_tech_advanced",
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
    expect(serialize([tech.toEntries()])).toMatchInlineSnapshot(`
      "mymod_tech_advanced = {
      	cost = 4000
      	area = physics
      	tier = 3
      	category = { particles }
      	prerequisites = { "mymod_tech_base" "tech_lasers_1" }
      	is_rare = yes
      	weight = 85
      	potential = {
      		AND = {
      			has_country_flag = chosen_ones
      			NOT = {
      				has_technology = mymod_tech_base
      			}
      		}
      	}
      }
      "
    `);
  });

  it("omits optional fields that were not provided", () => {
    const tech = new Technology({
      id: "mymod_tech_minimal",
      name: "Minimal",
      cost: 100,
      area: "society",
      tier: 1,
      category: "statecraft",
    });
    expect(serialize([tech.toEntries()])).toBe(
      "mymod_tech_minimal = {\n\tcost = 100\n\tarea = society\n\ttier = 1\n\tcategory = { statecraft }\n}\n"
    );
  });
});
