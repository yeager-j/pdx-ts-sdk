import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { loadRules } from "../../tools/codegen/cwt/rules.ts";
import { parseTriggerDocs } from "../../tools/codegen/logs/trigger-docs.ts";
import { compareToBaseline, reconcile, type DriftReport } from "../../tools/codegen/reconcile.ts";

const CONFIG = "vendor/cwtools-stellaris-config/config";
const DOCS = "vendor/cwtools-stellaris-config/script-docs/v4.4.1";

const rules = loadRules(CONFIG);
const docs = parseTriggerDocs(
  readFileSync(`${DOCS}/triggers.log`, "utf8"),
  readFileSync(`${DOCS}/effects.log`, "utf8")
);
const baseline = JSON.parse(
  readFileSync("tools/codegen/drift-baseline.json", "utf8")
) as DriftReport;

describe("the two rule sources", () => {
  it("agree on all but a handful of names", () => {
    expect(rules.triggers.size).toBe(1082);
    expect(docs.triggers.size).toBe(1085);
    expect(rules.effects.size).toBe(1058);
    expect(docs.effects.size).toBe(1056);
  });

  it("carry a scope for every documented trigger and effect", () => {
    const entries = [...docs.triggers.values(), ...docs.effects.values()];
    expect(entries.every((entry) => entry.scopes.length > 0)).toBe(true);
    expect(docs.malformed).toEqual([]);
  });

  it("annotate a scope on all but five trigger rules", () => {
    const declarations = [...rules.triggers.values()].flat();
    const annotated = declarations.filter((declaration) => declaration.supportedScopes !== null);
    expect(declarations).toHaveLength(1133);
    expect(annotated).toHaveLength(1128);
  });

  it("agrees with the game that there are three research areas", () => {
    expect(rules.enums.get("research_area")).toEqual(["physics", "society", "engineering"]);
  });

  it("still match the recorded drift baseline", () => {
    expect(compareToBaseline(reconcile(rules, docs), baseline)).toEqual([]);
  });
});

describe("the drift gate", () => {
  const report = reconcile(rules, docs);

  it("names a trigger that appeared in only one source", () => {
    const injected: DriftReport = {
      ...baseline,
      triggers: {
        ...baseline.triggers,
        docsOnly: [...baseline.triggers.docsOnly, "has_new_thing"],
      },
    };
    expect(compareToBaseline(report, injected)).toEqual([
      "  - trigger only in docs: has_new_thing",
    ]);
  });

  it("names a trigger that stopped drifting", () => {
    const injected: DriftReport = {
      ...baseline,
      effects: { ...baseline.effects, rulesOnly: [] },
    };
    expect(compareToBaseline(report, injected)).toEqual(
      baseline.effects.rulesOnly.map((name) => `  + effect only in rules: ${name}`)
    );
  });

  it("catches a scope named by either source that scopes.cwt does not define", () => {
    expect(compareToBaseline(report, { ...baseline, unknownScopes: ["made_up"] })).toEqual([
      ...baseline.unknownScopes.map((scope) => `  + unknown scope: ${scope}`),
      "  - unknown scope: made_up",
    ]);
  });

  it("catches a rule whose scopes disagree with the game's dump", () => {
    expect(
      compareToBaseline(report, {
        ...baseline,
        scopeConflicts: [...baseline.scopeConflicts, "made_up: rules say [a], docs say [b]"],
      })
    ).toEqual(["  - scope conflict: made_up: rules say [a], docs say [b]"]);
  });
});

describe("where the fork and the game's dump disagree", () => {
  const report = reconcile(rules, docs);

  it("is almost entirely the 4.x scope renames the dump has not caught up with", () => {
    const parsed = report.scopeConflicts.map((line) => {
      const match = /^\S+: rules say \[(.*)\], docs say \[(.*)\]$/.exec(line)!;
      const fromRules = new Set(match[1]!.split(" "));
      const fromDocs = new Set(match[2]!.split(" "));
      return {
        rulesAdd: [...fromRules].filter((scope) => !fromDocs.has(scope)),
        docsAdd: [...fromDocs].filter((scope) => !fromRules.has(scope)),
      };
    });
    const count = (scope: string, key: "rulesAdd" | "docsAdd"): number =>
      parsed.filter((entry) => entry[key].includes(scope)).length;

    // `carrier` is a scope the fork tracks and the dump omits; `pop` is the
    // pre-4.0 name for what the fork calls `pop_group`.
    expect(count("carrier", "rulesAdd")).toBe(164);
    expect(count("pop", "docsAdd")).toBe(70);
    const explained = parsed.filter(
      (entry) => entry.rulesAdd.includes("carrier") || entry.docsAdd.includes("pop")
    );
    expect(explained.length / parsed.length).toBeGreaterThan(0.95);
  });
});
