import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/effect-policy";
import { emitEffects } from "@pdx-ts/codegen-cwt/emit/effects";
import { skippedRule } from "@pdx-ts/codegen-cwt/emit/shape";
import { emitTriggers } from "@pdx-ts/codegen-cwt/emit/triggers";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRuleTable } from "@pdx-ts/codegen-cwt/lowered-rule";
import {
  formatScriptGapReport,
  reconcileScriptGaps,
  SCRIPT_GENERATION_GAPS,
  type ScriptGenerationGap,
} from "@pdx-ts/codegen-cwt/script-gaps";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");
const rules = loadRules(CONFIG);
const docs = parseTriggerDocs(
  readFileSync(`${DOCS}/triggers.log`, "utf8"),
  readFileSync(`${DOCS}/effects.log`, "utf8")
);
const scopes = scopeIndex(rules);
const triggerEmitter = new Emitter(rules);
const effectEmitter = new Emitter(rules);
const triggers = emitTriggers(
  triggerEmitter,
  docs.triggers,
  lowerRuleTable(rules.triggers, docs.triggers, triggerEmitter, scopes)
);
const effects = emitEffects(
  effectEmitter,
  docs.effects,
  scopes,
  lowerRuleTable(rules.effects, docs.effects, effectEmitter, scopes),
  createEffectPolicy(rules),
  []
);

function row(overrides: Partial<ScriptGenerationGap> = {}): ScriptGenerationGap {
  return {
    kind: "trigger",
    key: "sample_rule",
    category: "unsupported-value",
    rationale: "Test gap.",
    issue: "SDK-999",
    ...overrides,
  };
}

describe("the script-generation gap ledger", () => {
  it("accounts for the complete current trigger and effect skip inventory", () => {
    const report = reconcileScriptGaps({
      triggers: triggers.skipped,
      effects: effects.skipped,
    });

    expect(SCRIPT_GENERATION_GAPS).toHaveLength(41);
    expect(report.policyOwned).toHaveLength(38);
    expect(report.abstractPlaceholders).toHaveLength(2);
    expect(report.trackedGaps).toHaveLength(41);
    expect(report.abstractPlaceholders.map((entry) => entry.name)).toEqual([
      "<scripted_effect>",
      "<scripted_trigger>",
    ]);
  });

  it("reports every tracked rule with its category and Linear issue", () => {
    const report = reconcileScriptGaps({
      triggers: triggers.skipped,
      effects: effects.skipped,
    });
    const lines = formatScriptGapReport(report);

    expect(lines.trackedGaps).toHaveLength(41);
    expect(lines.trackedGaps).toContain(
      "effect create_fleet [unsupported-field-value] — SDK-253: " +
        "The create_fleet parent field uses the malformed CWT keyword sceop[fleet]. " +
        '(field "parent" has a type the emitter cannot express)'
    );
    expect(lines.trackedGaps.every((line) => !line.includes("SDK-244"))).toBe(true);
    expect(lines.trackedGaps.every((line) => !line.includes("SDK-251"))).toBe(true);
    expect(lines.trackedGaps.every((line) => !line.includes("SDK-247"))).toBe(true);
    expect(lines.trackedGaps.every((line) => /SDK-[0-9]+/.test(line))).toBe(true);
    expect(lines.trackedGaps.every((line) => !line.includes("e.g."))).toBe(true);
  });

  it("rejects a newly skipped generator-owned rule", () => {
    expect(() =>
      reconcileScriptGaps(
        {
          triggers: [skippedRule("future_rule", "unsupported-value", "future shape")],
          effects: [],
        },
        []
      )
    ).toThrow("trigger:future_rule: unacknowledged unsupported-value gap");
  });

  it("rejects a resolved or disappeared ledger row", () => {
    expect(() => reconcileScriptGaps({ triggers: [], effects: [] }, [row()])).toThrow(
      "trigger:sample_rule: stale ledger row; the rule now emits or no longer exists"
    );
  });

  it("rejects a stale category without depending on detail prose", () => {
    expect(() =>
      reconcileScriptGaps(
        {
          triggers: [skippedRule("sample_rule", "bare-value-block", "changed prose")],
          effects: [],
        },
        [row()]
      )
    ).toThrow(
      "trigger:sample_rule: ledger category unsupported-value is stale; current category is bare-value-block"
    );
  });

  it("rejects duplicate rows", () => {
    expect(() => reconcileScriptGaps({ triggers: [], effects: [] }, [row(), row()])).toThrow(
      "trigger:sample_rule: duplicate ledger row"
    );
  });

  it.each(["", "LIN-10", "SDK-0"])("rejects invalid issue identifier %j", (issue) => {
    expect(() => reconcileScriptGaps({ triggers: [], effects: [] }, [row({ issue })])).toThrow(
      "trigger:sample_rule: issue must be an SDK-N Linear identifier"
    );
  });

  it("rejects a missing rationale", () => {
    expect(() =>
      reconcileScriptGaps({ triggers: [], effects: [] }, [row({ rationale: "" })])
    ).toThrow("trigger:sample_rule: rationale must explain the tracked gap");
  });

  it("rejects an intentional policy row in the gap ledger", () => {
    const policyRow = row({ category: "handwritten-trigger" as never });
    expect(() =>
      reconcileScriptGaps(
        {
          triggers: [skippedRule("sample_rule", "handwritten-trigger", "owned by trigger policy")],
          effects: [],
        },
        [policyRow]
      )
    ).toThrow("trigger:sample_rule: intentional exclusions do not belong in the gap ledger");
  });

  it("rejects a tracked generation gap that becomes policy-owned", () => {
    expect(() =>
      reconcileScriptGaps(
        {
          triggers: [skippedRule("sample_rule", "handwritten-trigger", "now owned by policy")],
          effects: [],
        },
        [row()]
      )
    ).toThrow("trigger:sample_rule: stale ledger row; current category is handwritten-trigger");
  });
});
