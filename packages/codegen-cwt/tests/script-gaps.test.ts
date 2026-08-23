import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readAliases, scopeIndex, type AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { emitEffects } from "@pdx-ts/codegen-cwt/emit/script/effects";
import { emitTriggers } from "@pdx-ts/codegen-cwt/emit/script/triggers";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRuleTable, type LoweredRule } from "@pdx-ts/codegen-cwt/lower/lowered-rule";
import { skippedRule } from "@pdx-ts/codegen-cwt/lower/script-shape";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/policy/effects";
import {
  formatScriptGapReport,
  reconcileScriptGaps,
  SCRIPT_GENERATION_GAPS,
  type ScriptGenerationGap,
  type ScriptRuleKind,
} from "@pdx-ts/codegen-cwt/policy/script-gaps";
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

/** The declarations of one synthetic rule the rules mark `## api_status = removed`. */
function removedDeclarations(category: ScriptRuleKind, key: string): readonly AliasDecl[] {
  const source = ["## api_status = removed", `alias[${category}:${key}] = $any`].join("\n");
  const parsed = parseCwt(source, "removed.cwt");
  return readAliases(parsed.nodes, "removed.cwt", category, new Map()).aliases.get(key)!;
}

/** A one-entry rule table holding that synthetic removed rule, ready for an emitter. */
function removedRuleTable(
  emitter: Emitter,
  category: ScriptRuleKind,
  key: string
): ReadonlyMap<string, LoweredRule> {
  const declarations = new Map([[key, removedDeclarations(category, key)]]);
  const ruleDocs = category === "trigger" ? docs.triggers : docs.effects;
  return lowerRuleTable(declarations, ruleDocs, emitter, scopes);
}

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

    expect(SCRIPT_GENERATION_GAPS).toHaveLength(32);
    expect(report.policyOwned).toHaveLength(44);
    expect(report.abstractPlaceholders).toHaveLength(2);
    expect(report.trackedGaps).toHaveLength(32);
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

    expect(lines.trackedGaps).toHaveLength(32);
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

  it("owns the rules declared removed by CWT as an intentional exclusion", () => {
    const report = reconcileScriptGaps({
      triggers: triggers.skipped,
      effects: effects.skipped,
    });
    const removed = report.policyOwned
      .filter((entry) => entry.category === "removed-api")
      .map((entry) => `${entry.kind}:${entry.name}`);

    expect(removed).toEqual([
      "effect:pop_event",
      "effect:remove_pop_flag",
      "effect:set_pop_flag",
      "effect:set_timed_pop_flag",
      "trigger:has_pop_flag",
      "trigger:pop_has_ethic",
    ]);
  });

  it("keeps emitting the effects the rules mark api_status = kept", () => {
    expect(effects.interfaces).toContain("aiTradeFacility(args:");
    expect(effects.interfaces).toContain("runInAiMode(value?: boolean): void;");
  });

  it("refuses a hand-written trigger the rules later declare removed", () => {
    const emitter = new Emitter(rules);

    expect(() =>
      emitTriggers(emitter, docs.triggers, removedRuleTable(emitter, "trigger", "hidden_trigger"))
    ).toThrow(
      "hidden_trigger: the rules declare the trigger removed (## api_status = removed), " +
        "but hand-written structural-trigger policy still owns it"
    );
  });

  it("refuses a structural effect the rules later declare removed", () => {
    const emitter = new Emitter(rules);

    expect(() =>
      emitEffects(
        emitter,
        docs.effects,
        scopes,
        removedRuleTable(emitter, "effect", "switch"),
        createEffectPolicy(rules),
        []
      )
    ).toThrow(
      "switch: the rules declare the effect removed (## api_status = removed), " +
        "but hand-written structural effect policy still owns it"
    );
  });

  it("rejects a removed-api row in the gap ledger", () => {
    const removedRow = row({ key: "has_pop_flag", category: "removed-api" as never });
    expect(() =>
      reconcileScriptGaps(
        {
          triggers: [skippedRule("has_pop_flag", "removed-api", "declared removed by the rules")],
          effects: [],
        },
        [removedRow]
      )
    ).toThrow("trigger:has_pop_flag: intentional exclusions do not belong in the gap ledger");
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
