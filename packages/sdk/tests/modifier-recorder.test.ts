import { serialize } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import { modifierEntries, triggeredModifierBlock } from "../src/content/blocks.ts";
import type { JobRef } from "../src/generated/refs.ts";

describe("job-derived modifier recorder", () => {
  it("emits owned scripted and economic modifier keys", () => {
    const scripted = {
      itemKind: "content" as const,
      type: "scripted_modifier" as const,
      id: "mymod_efficiency",
      def: { id: "mymod_efficiency", category: "country" as const },
    };
    const category = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_expeditions",
      def: {
        id: "mymod_expeditions",
        generateAddModifiers: ["cost"] as const,
        generateMultModifiers: ["upkeep"] as const,
        triggeredCostModifier: [{ key: "mymod_unused_triggered", modifierTypes: [] }] as const,
      },
    };
    const entries = modifierEntries((modifier) => {
      modifier.scripted(scripted).set(0.2);
      modifier.economic(category).resource("energy").cost.add(3);
      modifier.economic(category).resource("energy").upkeep.mult(0.1);
      modifier.economic(category).upkeep.mult(0.5);
    });
    expect(serialize(entries)).toContain("mymod_efficiency = 0.2");
    expect(serialize(entries)).toContain("mymod_expeditions_energy_cost_add = 3");
    expect(serialize(entries)).toContain("mymod_expeditions_energy_upkeep_mult = 0.1");
    expect(serialize(entries)).toContain("mymod_expeditions_upkeep_mult = 0.5");
  });

  it("emits triggered economic families with the selected row key", () => {
    const costKey = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_cost_key",
      def: { id: "mymod_cost_key" },
    };
    const category = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_source_category",
      def: {
        id: "mymod_source_category",
        triggeredCostModifier: [
          { key: costKey, modifierTypes: ["add"] },
          { key: costKey, modifierTypes: ["mult"] },
        ] as const,
        triggeredProducesModifier: [
          { key: "mymod_produces_key", modifierTypes: ["add", "mult"] },
        ] as const,
        triggeredUpkeepModifier: [{ key: "mymod_upkeep_key", modifierTypes: ["mult"] }] as const,
        triggeredLogisticsModifier: [
          { key: "mymod_logistics_key", modifierTypes: ["add", "mult"] },
        ] as const,
      },
    };
    const entries = modifierEntries((modifier) => {
      const economic = modifier.economic as any;
      const cost = economic(category).triggered(costKey);
      cost.cost.mult(0.1);
      cost.resource("energy").cost.add(1);
      cost.resource("energy").cost.mult(0.2);
      const produces = economic(category).triggered("mymod_produces_key");
      produces.produces.mult(0.3);
      produces.resource("minerals").produces.add(2);
      produces.resource("minerals").produces.mult(0.4);
      const upkeep = economic(category).triggered("mymod_upkeep_key");
      upkeep.upkeep.mult(0.5);
      upkeep.resource("energy").upkeep.mult(0.6);
      const logistics = economic(category).triggered("mymod_logistics_key");
      logistics.logistics.mult(0.7);
      logistics.resource("energy").logistics.add(3);
      logistics.resource("energy").logistics.mult(0.8);
    });
    const output = serialize(entries);
    expect(output).toContain("mymod_cost_key_cost_mult = 0.1");
    expect(output).toContain("mymod_cost_key_energy_cost_add = 1");
    expect(output).toContain("mymod_cost_key_energy_cost_mult = 0.2");
    expect(output).toContain("mymod_produces_key_produces_mult = 0.3");
    expect(output).toContain("mymod_produces_key_minerals_produces_add = 2");
    expect(output).toContain("mymod_produces_key_minerals_produces_mult = 0.4");
    expect(output).toContain("mymod_upkeep_key_upkeep_mult = 0.5");
    expect(output).toContain("mymod_upkeep_key_energy_upkeep_mult = 0.6");
    expect(output).toContain("mymod_logistics_key_logistics_mult = 0.7");
    expect(output).toContain("mymod_logistics_key_energy_logistics_add = 3");
    expect(output).toContain("mymod_logistics_key_energy_logistics_mult = 0.8");
    expect(output).not.toContain("mymod_source_category_cost_mult");
  });

  it("collects both the source and selected triggered key references", () => {
    const costKey = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_cost_key",
      def: { id: "mymod_cost_key" },
    };
    const category = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_source_category",
      def: {
        id: "mymod_source_category",
        triggeredCostModifier: [{ key: costKey, modifierTypes: ["mult"] }] as const,
      },
    };
    const uses: Array<{ id: string; targets: readonly string[] }> = [];
    modifierEntries(
      (modifier) => {
        (modifier.economic as any)(category).triggered(costKey).cost.mult(1);
      },
      (use) => uses.push({ id: use.id, targets: use.targets })
    );
    expect(uses).toEqual([
      { id: "mymod_source_category", targets: ["economic_category"] },
      { id: "mymod_cost_key", targets: ["economic_category"] },
    ]);
  });

  it("rejects malformed and undeclared triggered selections", () => {
    const malformed = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_malformed_category",
      def: {
        id: "mymod_malformed_category",
        triggeredCostModifier: {} as never,
      },
    };
    expect(() =>
      modifierEntries((modifier) => (modifier.economic as any)(malformed).triggered("mymod_key"))
    ).toThrow(/malformed triggeredCostModifier/);

    const missingModifierTypes = {
      ...malformed,
      id: "mymod_missing_modifier_types",
      def: {
        id: "mymod_missing_modifier_types",
        triggeredCostModifier: [{ key: "mymod_key" }] as never,
      },
    };
    expect(() =>
      modifierEntries((modifier) =>
        (modifier.economic as any)(missingModifierTypes).triggered("mymod_key")
      )
    ).toThrow(/modifierTypes must be an array/);

    const unknownModifierType = {
      ...malformed,
      id: "mymod_unknown_modifier_type",
      def: {
        id: "mymod_unknown_modifier_type",
        triggeredCostModifier: [{ key: "mymod_key", modifierTypes: ["bogus"] }] as never,
      },
    };
    expect(() =>
      modifierEntries((modifier) =>
        (modifier.economic as any)(unknownModifierType).triggered("mymod_key")
      )
    ).toThrow(/unknown modifier type/);

    const category = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_category",
      def: {
        id: "mymod_category",
        triggeredCostModifier: [{ key: "mymod_cost_key", modifierTypes: ["mult"] }] as const,
      },
    };
    expect(() =>
      modifierEntries((modifier) => (modifier.economic as any)(category).triggered("mymod_missing"))
    ).toThrow(/no triggered modifier row/);
  });

  it("keeps declared empty rows inert without affecting direct families", () => {
    const emptyKey = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_empty_key",
      def: { id: "mymod_empty_key" },
    };
    const category = {
      itemKind: "content" as const,
      type: "economic_category" as const,
      id: "mymod_empty_category",
      def: {
        id: "mymod_empty_category",
        generateAddModifiers: ["cost"] as const,
        triggeredCostModifier: [{ key: emptyKey, modifierTypes: [] }] as const,
      },
    };
    const direct = modifierEntries((modifier) => {
      const economic = modifier.economic as any;
      economic(category).resource("energy").cost.add(2);
      expect(() => economic(category).triggered(emptyKey)).not.toThrow();
    });
    expect(serialize(direct)).toContain("mymod_empty_category_energy_cost_add = 2");
    expect(() =>
      modifierEntries((modifier) => {
        const economic = modifier.economic as any;
        economic(category).triggered(emptyKey).cost.mult(1);
      })
    ).toThrow(/does not support cost\.mult/);
  });

  it("rejects owned selectors retained after the closure", () => {
    let select: ((item: typeof undefined) => unknown) | undefined;
    expect(() => {
      modifierEntries((modifier) => {
        select = modifier.scripted as never;
      });
      select?.(undefined);
    }).toThrow(/closure that has already returned/);
  });

  it("emits every rule-derived operation with the complete job id", () => {
    const job: JobRef = { id: "mymod_job_with_under_score" };
    const entries = modifierEntries((modifier) => {
      modifier.job(job).add(1);
      modifier.job(job).per.pop(2);
      modifier.job(job).per.crime(3);
      modifier.job(job).max.workforce.add(4);
      modifier.job(job).max.workforce.mult(5);
      modifier.job(job).automated.workforce.mult(6);
      modifier.job(job).workforce.mult(7);
      modifier.job(job).bonus.workforce.mult(8);
    });

    expect(serialize(entries)).toBe(`job_mymod_job_with_under_score_add = 1

job_mymod_job_with_under_score_per_pop = 2

job_mymod_job_with_under_score_per_crime = 3

job_mymod_job_with_under_score_max_workforce_add = 4

job_mymod_job_with_under_score_max_workforce_mult = 5

job_mymod_job_with_under_score_automated_workforce_mult = 6

pop_mymod_job_with_under_score_workforce_mult = 7

pop_mymod_job_with_under_score_bonus_workforce_mult = 8
`);
  });

  it("emits a selected job operation inside a triggered modifier", () => {
    const job: JobRef = { id: "mymod_triggered_job" };
    const entry = triggeredModifierBlock(
      "triggered_planet_modifier",
      { modifiers: (modifier) => modifier.job(job).add(2) },
      { path: "", ownerId: "modifier_recorder_test" }
    );

    expect(serialize([entry])).toContain("job_mymod_triggered_job_add = 2");
  });
});
