import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { buildMod, collection, defineTechnology, render } from "../src/index.ts";
import { and, hasCountryFlag, hasTechnology, not } from "../src/triggers.ts";

const CONFIG = {
  name: "Technology test",
  prefix: "mymod",
  supportedVersion: "4.4.*",
};

describe("Technology", () => {
  it("emits vanilla-convention PDXScript", () => {
    const base = defineTechnology({
      id: "mymod_tech_base",
      name: "Base Tech",
      cost: 1000,
      area: "physics",
      tier: 2,
      category: "particles",
    });
    const advancedTech = defineTechnology({
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
    const technologies = collection(undefined, [base, advancedTech]);
    const file = buildMod(CONFIG, [technologies]).contentFiles[0]!;
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
    const technologies = collection(undefined, [
      defineTechnology({
        id: "mymod_tech_minimal",
        name: "Minimal",
        cost: 100,
        area: "society",
        tier: 1,
        category: "statecraft",
      }),
    ]);
    expect(
      render(buildMod(CONFIG, [technologies])).get("common/technology/mymod_technology.txt")
    ).toBe(
      "mymod_tech_minimal = {\n\tarea = society\n\ttier = 1\n\tcategory = { statecraft }\n\tcost = 100\n}\n"
    );
  });
});
