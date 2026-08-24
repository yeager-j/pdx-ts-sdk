/**
 * The rule table is audited data; these tests pin its shape and its two
 * user-facing surfaces — the build pin on every row and the refusal message
 * a blocked win-assertion produces. The ship-components message is an inline
 * golden: it is part of the API ("refusals cite their open cell"), so editing
 * it should feel like editing an error contract, not a string.
 */

import { describe, expect, it } from "vitest";

import { UnverifiedRegistryError } from "../../src/errors.ts";
import { CONTENT_REGISTRIES } from "../../src/generated/content-registry.ts";
import {
  REGISTRY_RULES,
  registryRule,
  SUPPORTED_STELLARIS_BUILD,
  unverifiedCellError,
} from "../../src/installation/vanilla/override-rules.ts";

describe("the rule table", () => {
  it("covers exactly the registries the handoff names", () => {
    expect(REGISTRY_RULES.map((row) => row.registry)).toEqual([
      "technology",
      "building",
      "scripted-triggers",
      "scripted-effects",
      "events",
      "scripted-constants",
      "megastructure",
      "ship-components",
      "localization",
    ]);
  });

  it("pins every row to the supported build", () => {
    expect(SUPPORTED_STELLARIS_BUILD).toBe("4.4.6");
    for (const row of REGISTRY_RULES) {
      expect(row.verifiedAgainst).toBe(SUPPORTED_STELLARIS_BUILD);
    }
  });

  it("every verified or assumed cell cites at least one oracle run", () => {
    for (const row of REGISTRY_RULES) {
      for (const cell of [row.repeat, row.replacement]) {
        if (cell.state !== "refused") {
          expect(cell.runs.length).toBeGreaterThan(0);
          for (const run of cell.runs) {
            expect(run).toMatch(/^r\d+$/);
          }
        }
      }
    }
  });

  it("technology is fully verified last-wins whole-object", () => {
    const row = registryRule("technology");
    expect(row.repeat).toEqual({
      state: "verified",
      rule: "last-wins",
      runs: ["r0", "r1", "r4", "r10"],
    });
    expect(row.replacement.state).toBe("verified");
  });

  it("megastructure carries a named judgment, never a silent upgrade", () => {
    const row = registryRule("megastructure");
    expect(row.replacement.state).toBe("assumed");
    if (row.replacement.state === "assumed") {
      expect(row.replacement.judgment).toContain("Jackson, 2026-07-31");
    }
  });

  it("localization refuses filename-order assertions in both cells", () => {
    const row = registryRule("localization");
    expect(row.repeat.state).toBe("refused");
    expect(row.replacement.state).toBe("refused");
  });

  it("an unknown registry names the known ones", () => {
    expect(() => registryRule("starbases")).toThrow(UnverifiedRegistryError);
    expect(() => registryRule("starbases")).toThrow(/technology, building/);
  });

  it("derives a manifest-backed row's dir from the generated descriptor", () => {
    for (const registry of ["technology", "building", "megastructure"] as const) {
      const descriptor = CONTENT_REGISTRIES.find((candidate) => candidate.type === registry);
      expect(descriptor).toBeDefined();
      expect(registryRule(registry).dir).toBe(descriptor!.outputDir);
    }
    // The derivation is the claim; these pin what it currently resolves to.
    expect(registryRule("technology").dir).toBe("common/technology");
    expect(registryRule("building").dir).toBe("common/buildings");
    expect(registryRule("megastructure").dir).toBe("common/megastructures");
  });

  it("stores no dir on a manifest-backed row", () => {
    for (const registry of ["technology", "building", "megastructure"]) {
      const row = REGISTRY_RULES.find((candidate) => candidate.registry === registry);
      expect(row).toBeDefined();
      expect(Object.hasOwn(row!, "dir")).toBe(false);
    }
  });
});

describe("refusal messages", () => {
  it("the ship-components refusal cites the open cell, the gap, and the pin", () => {
    const error = unverifiedCellError(registryRule("ship-components"), "repeat");
    expect(error).toBeInstanceOf(UnverifiedRegistryError);
    expect(error.message).toMatchInlineSnapshot(
      `"registry \`ship-components\` has no verified duplicate-winner rule: the duplicate diagnostic ("key used multiple times") names no winner. Settled by: a runtime observable for a repeated component key (resolver-evaluation.md, ship-components row). (rule table pinned to Stellaris 4.4.6)"`
    );
  });

  it("refuses to build a refusal from a cell that is not refused", () => {
    expect(() => unverifiedCellError(registryRule("technology"), "repeat")).toThrow(
      /verified cell/
    );
  });
});
