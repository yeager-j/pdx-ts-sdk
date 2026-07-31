import { kv, serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import {
  and,
  anyCountry,
  hasCountryFlag,
  hasGlobalFlag,
  hasTechnology,
  isAi,
  not,
  or,
  trigger,
  yearsPassed,
} from "../src/triggers.ts";

describe("trigger builders", () => {
  it("emits nested combinator blocks", () => {
    const condition = not(or(hasGlobalFlag("crisis_active"), anyCountry(isAi())));
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "NOT = {
      	OR = {
      		has_global_flag = crisis_active
      		any_country = {
      			is_ai = yes
      		}
      	}
      }
      "
    `);
  });

  it("flattens and() operands into one AND block", () => {
    const condition = and(hasCountryFlag("ascended"), yearsPassed(">=", 50));
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "AND = {
      	has_country_flag = ascended
      	years_passed >= 50
      }
      "
    `);
  });

  it("preserves a multi-entry operand as an AND group inside OR", () => {
    const multiEntry = trigger<"country">([
      kv("has_country_flag", "ascended"),
      kv("has_global_flag", "crisis_active"),
    ]);
    const condition = or(multiEntry, yearsPassed(">=", 50));

    expect(serialize([...condition.entries])).toBe(
      "OR = {\n" +
        "\tAND = {\n" +
        "\t\thas_country_flag = ascended\n" +
        "\t\thas_global_flag = crisis_active\n" +
        "\t}\n" +
        "\tyears_passed >= 50\n" +
        "}\n"
    );
  });

  it("accepts tech references by object", () => {
    const condition = hasTechnology({ id: "tech_lasers_1" });
    expect(serialize([...condition.entries])).toBe("has_technology = tech_lasers_1\n");
  });

  it("throws an explanatory error when a trigger is called like a function", () => {
    const condition = hasGlobalFlag("some_flag");
    expect(() => condition()).toThrow(/BUILD time/);
  });
});
