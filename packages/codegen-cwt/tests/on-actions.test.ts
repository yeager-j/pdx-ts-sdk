import path from "node:path";
import { fileURLToPath } from "node:url";
import { emitOnActions } from "@pdx-ts/codegen-cwt/emit/script/on-actions";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rules = loadRules(path.join(ROOT, "vendor/cwtools-stellaris-config/config"));
const emission = emitOnActions(rules);

describe("on-action codegen", () => {
  it("parses the hook metadata without recovery", () => {
    expect(rules.diagnostics.filter((diagnostic) => diagnostic.file === "on_actions.cwt")).toEqual(
      []
    );
  });

  it("derives complete named scope contracts from CWT metadata", () => {
    expect(emission.code).toContain(
      'onGameStartCountry: {\n    kind: "on-action-ref",\n    name: "on_game_start_country",\n    scope: "country",\n    scopes: {},'
    );
    expect(emission.code).toContain(
      'onCustomDiplomacy: {\n    kind: "on-action-ref",\n    name: "on_custom_diplomacy",\n    scope: "country",\n    scopes: {"from":"country"},'
    );
    expect(emission.code).toContain(
      'onStatusQuo: {\n    kind: "on-action-ref",\n    name: "on_status_quo",\n    scope: "country",\n    scopes: {"from":"country","fromfrom":"country","fromfromfrom":"country","fromfromfromfrom":"war"},'
    );
    expect(emission.code).toContain(
      'onModificationComplete: {\n    kind: "on-action-ref",\n    name: "on_modification_complete",\n    scope: "country",\n    scopes: {"from":"species","fromfrom":"species","prev":"planet"},'
    );
  });

  it("pins the representable and intentionally rejected hook counts", () => {
    expect(emission.emitted).toBe(363);
    expect(emission.noScope).toBe(9);
    expect(emission.skipped).toHaveLength(27);
  });

  it("reports every unrepresentable metadata class instead of guessing", () => {
    expect(new Set(emission.skipped.map((entry) => entry.split(" — ")[1]))).toEqual(
      new Set([
        "name is not a plain on-action identifier",
        "unknown FROM scope any",
        "unknown this scope root",
        "unknown this scope any",
        "no_scope metadata disagrees with event_type cosmic_storm",
        "root scope planet disagrees with this scope carrier",
        "root scope country disagrees with this scope carrier",
        "root scope country disagrees with this scope agreement",
        "root scope country disagrees with this scope situation",
        "root scope colony disagrees with this scope carrier",
      ])
    );
  });
});
