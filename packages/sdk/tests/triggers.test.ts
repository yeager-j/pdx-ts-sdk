import { kv, serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import {
  and,
  anyCountry,
  hasCountryFlag,
  hasGlobalFlag,
  hasTechnology,
  hiddenTrigger,
  isAi,
  not,
  or,
  owner,
  resourceStockpilePercent,
  target,
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

  it("emits a scope link as one navigation block", () => {
    const condition = owner(and(isAi(), hasCountryFlag("ascended")));
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "owner = {
      	AND = {
      		is_ai = yes
      		has_country_flag = ascended
      	}
      }
      "
    `);
  });

  it("emits the asserted target link as a navigation block", () => {
    const condition = target<"country">(isAi());
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "target = {
      	is_ai = yes
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

  it("splices hidden_trigger operands flat, changing no scope", () => {
    // Tooltip visibility, not logic: the conditions still have to hold, and
    // the block changes no scope — so it takes conditions rather than a
    // closure, and its own scope is theirs.
    const condition = and(
      isAi(),
      hiddenTrigger(hasCountryFlag("ascended"), owner(hasCountryFlag("patron")))
    );
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "AND = {
      	is_ai = yes
      	hidden_trigger = {
      		has_country_flag = ascended
      		owner = {
      			has_country_flag = patron
      		}
      	}
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

  it("writes a generated trigger's ScriptValue argument bare, including a scripted-variable reference (widenedLowering, SDK-47 P1 fix)", () => {
    // resourceStockpilePercent's `value` is triggers.cwt's
    // `value_field[0.0...1.0]`, so it is the one ordinary (non-comparison)
    // value_field argument a top-level trigger function takes — the same
    // ScriptValue widening as every content field, going through the
    // generated code's own `scriptValueScalar` wrap rather than content.ts's
    // writer. A number keeps working unchanged; `@my_value` is the form that
    // used to come out wrongly quoted (`value = "@my_value"`) before the fix.
    const numeric = resourceStockpilePercent({ resource: "energy", value: 0.5 });
    expect(serialize([...numeric.entries])).toBe(
      "resource_stockpile_percent = {\n\tresource = energy\n\tvalue = 0.5\n}\n"
    );
    const variable = resourceStockpilePercent({ resource: "energy", value: "@my_value" });
    expect(serialize([...variable.entries])).toBe(
      "resource_stockpile_percent = {\n\tresource = energy\n\tvalue = @my_value\n}\n"
    );
  });
});
