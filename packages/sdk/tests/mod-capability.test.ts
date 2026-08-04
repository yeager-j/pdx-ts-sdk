import { describe, expect, it } from "vitest";

import { createMod, currentSituationApproach, currentStage, render } from "../src/index.ts";

function mod() {
  return createMod({
    name: "Nested capability",
    prefix: "nested_capability",
    supportedVersion: "4.4.*",
  });
}

describe("mod capability nested identities", () => {
  it("preserves capability-owned nested definition ids", () => {
    const capability = mod();
    const tradition = capability.tradition("harmony", {
      name: "Harmony",
      traditionSwap: { nested_capability_renewal: { name: "Renewal" } },
    });

    expect(Object.keys(tradition.def.traditionSwap ?? {})).toEqual(["nested_capability_renewal"]);
    expect(
      render(capability.compile([capability.feature("traditions", [tradition])])).get(
        "common/traditions/nested_capability_traditions.txt"
      )
    ).toContain("name = nested_capability_renewal");
  });

  it("rejects an unprefixed nested definition id before defining content", () => {
    expect(() =>
      mod().tradition("harmony", {
        name: "Harmony",
        traditionSwap: { renewal: { name: "Renewal" } },
      })
    ).toThrow('Nested definition id "renewal" does not belong to mod prefix "nested_capability"');
  });

  it("rejects an invalid nested definition id before defining content", () => {
    expect(() =>
      mod().tradition("harmony", {
        name: "Harmony",
        traditionSwap: { "not a valid id": { name: "Renewal" } },
      })
    ).toThrow('Nested definition id "not a valid id" must be lowercase snake_case');
  });

  it("preserves situation stage and approach ids referenced in the same definition", () => {
    const capability = mod();
    const situation = capability.situationType("mood", {
      name: "Mood",
      monthlyProgress: { base: 1 },
      stages: {
        nested_capability_stage: {
          name: "Stage",
          icon: "GFX_situation_stage",
          iconBackground: "GFX_situation_stage_bg",
          potential: currentSituationApproach("nested_capability_calm"),
        },
      },
      approach: {
        nested_capability_calm: {
          name: "Calm",
          icon: "GFX_situation_approach",
          iconBackground: "GFX_situation_approach_bg",
          allow: currentStage("nested_capability_stage"),
        },
      },
    });

    const rendered = render(
      capability.compile([capability.feature("situations", [situation])])
    ).get("common/situations/nested_capability_situations.txt");
    expect(rendered).toContain("current_situation_approach = nested_capability_calm");
    expect(rendered).toContain("current_stage = nested_capability_stage");
  });
});
