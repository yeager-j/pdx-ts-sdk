import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitTriggers } from "@pdx-ts/codegen-cwt/emit/script/triggers";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRuleTable } from "@pdx-ts/codegen-cwt/lower/lowered-rule";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");
const rules = loadRules(CONFIG);
const docs = parseTriggerDocs(
  readFileSync(`${DOCS}/triggers.log`, "utf8"),
  readFileSync(`${DOCS}/effects.log`, "utf8")
);
const emitter = new Emitter(rules);
const emission = emitTriggers(
  emitter,
  docs.triggers,
  lowerRuleTable(rules.triggers, docs.triggers, emitter, scopeIndex(rules))
);

describe("trigger emission", () => {
  it("accounts for every scalar-plus-block alias", () => {
    const mixed = [...rules.triggers]
      .filter(([, declarations]) => {
        return (
          declarations.some((declaration) => declaration.type.kind === "block") &&
          declarations.some((declaration) => declaration.type.kind !== "block")
        );
      })
      .map(([key]) => key)
      .sort();

    expect(mixed).toEqual([
      "<scripted_trigger>",
      "custom_tooltip",
      "fail_text",
      "has_resource",
      "intel_level",
      "is_war_participant",
      "success_text",
    ]);
    expect(emission.skipped.filter((rule) => mixed.includes(rule.name))).toEqual([
      {
        name: "<scripted_trigger>",
        category: "abstract-placeholder",
        detail: "abstract scripted-trigger placeholder",
      },
    ]);
  });

  it("emits localisation aliases as scalar and trigger-block overloads", () => {
    expect([...emission.names]).toEqual(
      expect.arrayContaining(["customTooltip", "failText", "successText"])
    );
    expect(emission.code).toContain(
      "export type CustomTooltipArgs<S extends ScopeName = ScopeName> = {"
    );
    expect(emission.code).toContain('failText?: "default" | string;');
    expect(emission.code).toContain("conditions: Trigger<S>;");
    for (const fn of ["customTooltip", "failText", "successText"]) {
      expect(emission.code).toContain(`export function ${fn}(value: string): Trigger<ScopeName>;`);
    }
    expect(emission.code).toContain('return trigger([kv("custom_tooltip", value)]);');
    expect(emission.code).toContain('return trigger([block("custom_tooltip", entries)], refs);');
  });

  it("dispatches a non-localisation scalar arm on the object kinds it admits", () => {
    expect([...emission.names]).toEqual(
      expect.arrayContaining(["hasResource", "intelLevel", "isWarParticipant"])
    );

    const resourceScope =
      'Trigger<"astral_rift" | "carrier" | "country" | "deposit" | "planet" | "ship">';
    expect(emission.code).toContain(
      "export type HasResourceArgs = {\n" +
        "  type: ResourceRef | string;\n" +
        "  amount: ScriptValue | readonly [PdxOp, ScriptValue];\n" +
        "};"
    );
    expect(emission.code).toContain(
      `export function hasResource(value: ResourceRef | string | boolean): ${resourceScope};`
    );
    expect(emission.code).toContain(
      `export function hasResource(args: HasResourceArgs): ${resourceScope};`
    );
    // A branded resource reference is the scalar arm; any other object is the block.
    expect(emission.code).toContain('if (isStructuredValue(value, ["typed-ref"])) {');
    expect(emission.code).toContain('return trigger([kv("has_resource", refId(value))]);');

    expect(emission.code).toContain(
      'export type IntelLevelArgs = {\n  level: IntelLevel;\n  system: ScopeValue<"system">;\n};'
    );
    expect(emission.code).toContain(
      'export function intelLevel(value: IntelLevel): Trigger<"country">;'
    );
    expect(emission.code).toContain(
      'export function intelLevel(args: IntelLevelArgs): Trigger<"country">;'
    );
    expect(emission.code).toContain('return trigger([kv("intel_level", value)]);');

    const warParticipantScalar =
      'ScopeValue<"agreement"|"archaeological_site"|"army"|"carrier"|"country"|"debris"' +
      '|"deposit"|"first_contact"|"fleet"|"leader"|"megastructure"|"planet"|"pop_faction"' +
      '|"pop_group"|"sector"|"ship"|"situation"|"spy_network"|"starbase"|"system"|"war">';
    expect(emission.code).toContain(
      `export function isWarParticipant(value: ${warParticipantScalar}): ` +
        'Trigger<"country" | "war">;'
    );
    expect(emission.code).toContain(
      'export function isWarParticipant(args: IsWarParticipantArgs): Trigger<"country" | "war">;'
    );
    expect(emission.code).toContain('  war?: ScopeValue<"war">;');
    expect(emission.code).toContain('if (isStructuredValue(value, ["scope-ref"])) {');
    expect(emission.code).toContain('return trigger([kv("is_war_participant", value.path)]);');
  });

  it("uses the audited game-doc summary when CWT prose is wrong", () => {
    const fn = emission.code.indexOf("export function traitHasAnyTag");
    const summary = emission.code.indexOf("Checks if a trait has at least one tag from the list");
    expect(summary).toBeGreaterThan(0);
    expect(fn - summary).toBeLessThan(500);
    expect(emission.docOverrides).toEqual([
      expect.stringContaining("trait_has_any_tag ← vendor/cwtools-stellaris-config"),
    ]);
  });
});
