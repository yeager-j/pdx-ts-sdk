import { describe, expect, it } from "vitest";

import { loadRules } from "../../../../tools/codegen/cwt/rules.ts";
import { emitOnActions } from "../../../../tools/codegen/emit/on-actions.ts";

const rules = loadRules("vendor/cwtools-stellaris-config/config");
const emission = emitOnActions(rules);

describe("on-action codegen", () => {
  it("parses the hook metadata without recovery", () => {
    expect(rules.diagnostics.filter((diagnostic) => diagnostic.file === "on_actions.cwt")).toEqual(
      []
    );
  });

  it("derives the target hook's scope and FROM contracts from CWT metadata", () => {
    expect(emission.code).toContain(
      'onGameStartCountry: {\n    kind: "on-action-ref",\n    name: "on_game_start_country",\n    scope: "country",\n    from: undefined,'
    );
    expect(emission.code).toContain(
      'onCustomDiplomacy: {\n    kind: "on-action-ref",\n    name: "on_custom_diplomacy",\n    scope: "country",\n    from: "country",'
    );
  });

  it("pins the representable and intentionally rejected hook counts", () => {
    expect(emission.emitted).toBe(372);
    expect(emission.noScope).toBe(9);
    expect(emission.skipped).toHaveLength(18);
  });

  it("reports every unrepresentable metadata class instead of guessing", () => {
    expect(new Set(emission.skipped.map((entry) => entry.split(" — ")[1]))).toEqual(
      new Set([
        "name is not a plain on-action identifier",
        "unknown FROM scope any",
        "unknown this scope root",
        "unknown this scope any",
        "no_scope metadata disagrees with event_type cosmic_storm",
      ])
    );
  });
});
