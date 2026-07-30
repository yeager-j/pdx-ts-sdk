import { describe, expect, it } from "vitest";

import { serializeEntries } from "../src/serialize.ts";
import {
  and,
  anyCountry,
  hasCountryFlag,
  hasGlobalFlag,
  hasTechnology,
  isAi,
  not,
  or,
  yearsPassed,
} from "../src/triggers.ts";

describe("trigger builders", () => {
  it("emits nested combinator blocks", () => {
    const condition = not(or(hasGlobalFlag("crisis_active"), anyCountry(isAi())));
    expect(serializeEntries([...condition.entries])).toMatchInlineSnapshot(`
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
    expect(serializeEntries([...condition.entries])).toMatchInlineSnapshot(`
      "AND = {
      	has_country_flag = ascended
      	years_passed >= 50
      }
      "
    `);
  });

  it("accepts tech references by object", () => {
    const condition = hasTechnology({ id: "tech_lasers_1" });
    expect(serializeEntries([...condition.entries])).toBe("has_technology = tech_lasers_1\n");
  });

  it("throws an explanatory error when a trigger is called like a function", () => {
    const condition = hasGlobalFlag("some_flag");
    expect(() => condition()).toThrow(/BUILD time/);
  });
});
