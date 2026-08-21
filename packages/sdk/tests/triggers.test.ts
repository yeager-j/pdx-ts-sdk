import { kv, serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import type { PlanetClassRef } from "../src/generated/refs.ts";
import { eventTarget } from "../src/script/effects/recorder.ts";
import { isStructuredValue, toScalar } from "../src/script/scalar.ts";
import {
  aiArmorRatio,
  and,
  anyCountry,
  canAccessSystem,
  countOwnedPopGroup,
  currentSituationApproach,
  currentStage,
  customTooltip,
  hasActiveEvent,
  hasCompletedEventChainCounter,
  hasCountryFlag,
  hasGlobalFlag,
  hasTechnology,
  hiddenTrigger,
  isAi,
  isPlanetClass,
  nand,
  nor,
  not,
  numLeaderTraits,
  or,
  owner,
  popGroupSize,
  resourceStockpilePercent,
  target,
  totalWorkforceWithJobTag,
  traitHasAllTags,
  trigger,
  yearsPassed,
} from "../src/script/triggers.ts";

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

  it("emits NOR and NAND blocks directly, including their single-operand form", () => {
    const neither = nor(hasCountryFlag("ascended"), yearsPassed(">=", 50));
    const notBoth = nand(hasCountryFlag("ascended"), yearsPassed(">=", 50));
    const single = nor(hasCountryFlag("ascended"));

    expect(serialize([...neither.entries])).toBe(
      "NOR = {\n\thas_country_flag = ascended\n\tyears_passed >= 50\n}\n"
    );
    expect(serialize([...notBoth.entries])).toBe(
      "NAND = {\n\thas_country_flag = ascended\n\tyears_passed >= 50\n}\n"
    );
    expect(serialize([...single.entries])).toBe("NOR = {\n\thas_country_flag = ascended\n}\n");
  });

  it("emits a scope link as one navigation block, and() spliced flat inside it", () => {
    // `owner = { ... }` is already an implicit AND, the same as vanilla's own
    // spelling — the nested `AND` wrapper `and()` used to add here said
    // nothing the block did not already say.
    const condition = owner(and(isAi(), hasCountryFlag("ascended")));
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "owner = {
      	is_ai = yes
      	has_country_flag = ascended
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

  it("and() operands splice flat, with no AND wrapper, matching vanilla's implicit AND", () => {
    const condition = and(hasCountryFlag("ascended"), yearsPassed(">=", 50));
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "has_country_flag = ascended

      years_passed >= 50
      "
    `);
  });

  it("a.and(b) is and(a, b): same tree, fluent spelling", () => {
    // SDK-53: `Trigger` had no methods, so `someTrigger.and(other)` used to
    // fail with "Property 'and' does not exist on type 'Trigger<...>'" — a
    // compile error, not a runtime one (see scope-safety.test-d.ts).
    const fluent = hasCountryFlag("ascended").and(yearsPassed(">=", 50));
    const free = and(hasCountryFlag("ascended"), yearsPassed(">=", 50));
    expect(serialize([...fluent.entries])).toBe(serialize([...free.entries]));
    expect(serialize([...fluent.entries])).toMatchInlineSnapshot(`
      "has_country_flag = ascended

      years_passed >= 50
      "
    `);
  });

  it("re-groups a flattened and() under NOT, so NOT(AND) stays a NAND and does not become a NOR", () => {
    // NOT's immediate children get NOR semantics ("neither"), not NAND ("not
    // both") — an unwrapped `and()` spliced flat under NOT would silently
    // swap one for the other, so `not()` re-wraps a multi-entry operand.
    const condition = not(and(hasCountryFlag("ascended"), yearsPassed(">=", 50)));
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "NOT = {
      	AND = {
      		has_country_flag = ascended
      		years_passed >= 50
      	}
      }
      "
    `);
  });

  it("composes SDK-52's branded SituationTrigger through and()/not()/.and() like any other trigger", () => {
    // SituationTrigger (currentSituationApproach/currentStage) is a plain
    // Trigger<"situation"> with an optional phantom brand, not a distinct
    // combinator surface — the flattening (and()) and re-grouping (not())
    // in this file apply to it unchanged.
    const flat = and(currentSituationApproach("approach_a"), currentStage("stage_1"));
    expect(serialize([...flat.entries])).toMatchInlineSnapshot(`
      "current_situation_approach = approach_a

      current_stage = stage_1
      "
    `);

    const fluentBranded = currentSituationApproach("approach_a").and(currentStage("stage_1"));
    expect(serialize([...fluentBranded.entries])).toBe(serialize([...flat.entries]));

    // A single branded condition negates directly, no AND wrapper.
    expect(serialize([...not(currentSituationApproach("approach_a")).entries])).toBe(
      "NOT = {\n\tcurrent_situation_approach = approach_a\n}\n"
    );
    // A multi-entry branded conjunction keeps its AND wrapper under NOT (NAND, not NOR).
    expect(serialize([...not(flat).entries])).toBe(
      "NOT = {\n" +
        "\tAND = {\n" +
        "\t\tcurrent_situation_approach = approach_a\n" +
        "\t\tcurrent_stage = stage_1\n" +
        "\t}\n" +
        "}\n"
    );
  });

  it("splices hidden_trigger operands flat, changing no scope", () => {
    // Tooltip visibility, not logic: the conditions still have to hold, and
    // the block changes no scope — so it takes conditions rather than a
    // closure, and its own scope is theirs. and()'s own flattening applies
    // here too, so the outer AND wrapper is gone as well.
    const condition = and(
      isAi(),
      hiddenTrigger(hasCountryFlag("ascended"), owner(hasCountryFlag("patron")))
    );
    expect(serialize([...condition.entries])).toMatchInlineSnapshot(`
      "is_ai = yes

      hidden_trigger = {
      	has_country_flag = ascended
      	owner = {
      		has_country_flag = patron
      	}
      }
      "
    `);
  });

  it("writes a custom tooltip as either its localisation scalar or its gated block", () => {
    expect(serialize([...customTooltip("requires_ascension_theory").entries])).toBe(
      "custom_tooltip = requires_ascension_theory\n"
    );
    expect(
      serialize([
        ...customTooltip({
          failText: "default",
          successText: "ascension_theory_ready",
          conditions: hasTechnology("tech_ascension_theory"),
        }).entries,
      ])
    ).toBe(
      "custom_tooltip = {\n" +
        "\tfail_text = default\n" +
        "\tsuccess_text = ascension_theory_ready\n" +
        "\thas_technology = tech_ascension_theory\n" +
        "}\n"
    );
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

  it("preserves a multi-entry operand as an AND group inside NOR and NAND", () => {
    const multiEntry = trigger<"country">([
      kv("has_country_flag", "ascended"),
      kv("has_global_flag", "crisis_active"),
    ]);

    for (const [name, condition] of [
      ["NOR", nor(multiEntry, yearsPassed(">=", 50))],
      ["NAND", nand(multiEntry, yearsPassed(">=", 50))],
    ] as const) {
      expect(serialize([...condition.entries])).toBe(
        `${name} = {\n` +
          "\tAND = {\n" +
          "\t\thas_country_flag = ascended\n" +
          "\t\thas_global_flag = crisis_active\n" +
          "\t}\n" +
          "\tyears_passed >= 50\n" +
          "}\n"
      );
    }
  });

  it("accepts tech references by object", () => {
    const condition = hasTechnology({ id: "tech_lasers_1" });
    expect(serialize([...condition.entries])).toBe("has_technology = tech_lasers_1\n");
  });

  it("writes an event-chain counter check with its chain reference", () => {
    const condition = hasCompletedEventChainCounter({
      eventChain: { id: "effects_test_chain" },
      counter: "insights",
    });
    expect(serialize([...condition.entries])).toBe(
      "has_completed_event_chain_counter = {\n\tevent_chain = effects_test_chain\n\tcounter = insights\n}\n"
    );
  });

  it("writes a scope-valued argument as its path, whichever lowering it takes", () => {
    // SDK-93. `can_access_system` is `scope[system]`, so its whole domain is
    // scopes and the generated code reads `.path` directly. `is_planet_class`
    // is overloaded between `<planet_class>` and `scope_group[target_planet]`,
    // so the same call site has to unwrap either — `refId` is what does it.
    const system = eventTarget<"system">("triggers_test_system");
    expect(serialize([...canAccessSystem(system).entries])).toBe(
      "can_access_system = event_target:triggers_test_system\n"
    );
    const world = eventTarget<"planet">("triggers_test_world");
    expect(serialize([...isPlanetClass(world).entries])).toBe(
      "is_planet_class = event_target:triggers_test_world\n"
    );
    expect(serialize([...isPlanetClass("pc_gaia").entries])).toBe("is_planet_class = pc_gaia\n");
  });

  it("unwraps a reference by its kind, not by whether it carries a path", () => {
    // `TypedRef` is branded but structurally open, so a content reference may
    // legitimately carry a `path` of its own — a file path, a lookup key.
    // Deciding on presence would have written that path where the game
    // requires an id. `ScopeValue`'s `kind` discriminant is what decides.
    const gaia: PlanetClassRef & { path: string } = { id: "pc_gaia", path: "not_a_scope" };
    expect(serialize([...isPlanetClass(gaia).entries])).toBe("is_planet_class = pc_gaia\n");
    expect(toScalar(gaia)).toBe("pc_gaia");
    expect(toScalar(eventTarget<"planet">("triggers_test_world"))).toBe(
      "event_target:triggers_test_world"
    );
  });

  it("uses generated scalar object kinds to distinguish references from structured values", () => {
    expect(isStructuredValue(eventTarget<"planet">("triggers_test_world"), ["scope-ref"])).toBe(
      false
    );
    expect(isStructuredValue({ id: "pc_gaia" }, ["typed-ref"])).toBe(false);
    expect(isStructuredValue({ ethic: "ethic_materialist" }, ["scope-ref"])).toBe(true);
  });

  it("serializes a generated structured-only field", () => {
    expect(
      serialize([
        ...numLeaderTraits({
          value: [">=", 2],
          containsModifier: { string: "federation", type: "any", isSubclass: "any" },
        }).entries,
      ])
    ).toBe(`num_leader_traits = {
\tvalue >= 2
\tcontains_modifier = {
\t\tstring = federation
\t\ttype = any
\t\tis_subclass = any
\t}
}
`);
  });

  it("serializes top-level and nested bare-value trigger blocks in author order", () => {
    const conditions = [
      hasActiveEvent(["events_test.1", { id: "events_test.2" }]),
      traitHasAllTags(["biological", "lithoid"]),
      totalWorkforceWithJobTag({ tags: ["farmer", "researcher"], value: [">=", 100] }),
    ];

    expect(serialize(conditions.flatMap((condition) => [...condition.entries]))).toBe(
      "has_active_event = { events_test.1 events_test.2 }\n" +
        "\n" +
        "trait_has_all_tags = { biological lithoid }\n" +
        "\n" +
        "total_workforce_with_job_tag = {\n" +
        "\ttags = { farmer researcher }\n" +
        "\tvalue >= 100\n" +
        "}\n"
    );
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

  it("serializes every ScriptValue comparison operand without changing plain numeric comparisons", () => {
    const comparisons = [
      popGroupSize(">", 8),
      popGroupSize(">", "@minimum_pop_group_size"),
      popGroupSize(">", "local_spent_biomass"),
      popGroupSize(">", "this.local_spent_biomass"),
      popGroupSize(">", "value:minimum_pop_group_size"),
      popGroupSize(">", "trigger:has_minimum_pop_group_size"),
      aiArmorRatio(">", 0.5),
    ];

    expect(serialize(comparisons.flatMap((comparison) => [...comparison.entries]))).toBe(
      "pop_group_size > 8\n" +
        "\n" +
        "pop_group_size > @minimum_pop_group_size\n" +
        "\n" +
        "pop_group_size > local_spent_biomass\n" +
        "\n" +
        "pop_group_size > this.local_spent_biomass\n" +
        "\n" +
        "pop_group_size > value:minimum_pop_group_size\n" +
        "\n" +
        "pop_group_size > trigger:has_minimum_pop_group_size\n" +
        "\n" +
        "ai_armor_ratio > 0.5\n"
    );
  });

  it("lowers a direct ScriptValue comparison field before serialization", () => {
    const condition = countOwnedPopGroup({ count: "@wanted" });

    expect(serialize([...condition.entries])).toBe(
      "count_owned_pop_group = {\n\tcount = @wanted\n}\n"
    );
  });
});
