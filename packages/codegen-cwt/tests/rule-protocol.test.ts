import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { createEffectPolicy } from "@pdx-ts/codegen-cwt/effect-policy";
import { emitEvents } from "@pdx-ts/codegen-cwt/emit/events";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRuleTable } from "@pdx-ts/codegen-cwt/lowered-rule";
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
const scopes = scopeIndex(rules);

describe("LoweredRule", () => {
  const triggers = lowerRuleTable(rules.triggers, docs.triggers, emitter, scopes);
  const effects = lowerRuleTable(rules.effects, docs.effects, emitter, scopes);

  it("carries legal scopes and nested-clause facts through one model", () => {
    const rule = triggers.get("count_owned_planet")!;
    expect(rule.scopes).toEqual(["country", "sector"]);
    expect(rule.scopeType).toBe('"country" | "sector"');
    expect(rule.blocks).toHaveLength(1);
    expect(rule.body.splice).toBeNull();
    expect([...rule.body.clauses]).toEqual([["limit", "planet"]]);
    expect([...rule.body.args]).toEqual(["count"]);
  });

  it("retains mixed named arguments and effect splices", () => {
    const rule = effects.get("while")!;
    expect(rule.scopes).toBe("universal");
    expect(rule.body.splice).toEqual({ scope: null });
    expect([...rule.body.clauses]).toEqual([["limit", null]]);
    expect([...rule.body.args]).toEqual(["count"]);
  });
});

describe("the effect ownership policy", () => {
  const policy = createEffectPolicy(rules);

  it("derives fire ownership from event kinds joined to effect rules", () => {
    expect(policy.fireKeys.size).toBe(20);
    expect(policy.fireKeys.has("country_event")).toBe(true);
    expect(policy.fireKeys.has("pop_event")).toBe(false);
    expect(policy.byKey.get("pop_event")).toMatchObject({ owner: "generated" });
  });

  it("reports a scoped event kind whose fire-effect rule disappears", () => {
    const effects = new Map(rules.effects);
    effects.delete("country_event");
    const changedRules = { ...rules, effects };
    const changedPolicy = createEffectPolicy(changedRules);
    const events = emitEvents(new Emitter(changedRules), changedPolicy);

    expect(events.skipped).toContainEqual({
      name: "country_event",
      reason: "no fire-effect rule with `## scopes`",
    });
    expect(events.fireMethods).toBe(22);
  });

  it("accounts explicitly for CWT-owned and SDK-synthetic methods", () => {
    expect(policy.structuralMethods).toEqual(
      new Set([
        "if",
        "whileLoop",
        "random",
        "randomList",
        "lockedRandomList",
        "saveEventTargetAs",
        "saveGlobalEventTargetAs",
        "addResource",
        "hiddenEffect",
        "addEventChainCounter",
        "resetEventChainCounter",
        "target",
        "run",
      ])
    );
  });
});
