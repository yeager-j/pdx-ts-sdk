import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeOf, type RuleField, type ScopeContext } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readAliases, type AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseModifierDocs } from "@pdx-ts/codegen-cwt/logs/modifier-docs";
import { parseScopeLinks } from "@pdx-ts/codegen-cwt/logs/scopes";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import {
  compareToBaseline,
  loadBaseline,
  updatedBaseline,
} from "@pdx-ts/codegen-cwt/reconcile/baseline";
import {
  reconcile,
  type DriftBaseline,
  type ScopeConflict,
} from "@pdx-ts/codegen-cwt/reconcile/reconcile";
import { SPECIAL_SCOPE_PATHS } from "@pdx-ts/codegen-cwt/special-scope-paths";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");

const rules = loadRules(CONFIG);
const docs = parseTriggerDocs(
  readFileSync(`${DOCS}/triggers.log`, "utf8"),
  readFileSync(`${DOCS}/effects.log`, "utf8")
);
const modifierDocs = parseModifierDocs(readFileSync(`${DOCS}/modifiers.log`, "utf8"));
const dumpLinks = parseScopeLinks(readFileSync(`${DOCS}/scopes.log`, "utf8"));
// Through the loader, so a list the committed JSON omits reads as its default
// rather than as undefined.
const baseline = loadBaseline();

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
    expect(compareToBaseline(reconcile(rules, docs, modifierDocs, dumpLinks), baseline)).toEqual(
      []
    );
  });
});

describe("the scope-link join", () => {
  const report = reconcile(rules, docs, modifierDocs, dumpLinks);

  it("reads every links.cwt entry, static and data-driven", () => {
    expect(rules.links.size).toBe(93);
    const statics = [...rules.links.values()].filter(
      (link) => link.type === "scope" && !link.fromData
    );
    expect(statics).toHaveLength(88);
  });

  it("records only pop_group as genuine drift", () => {
    expect(report.links).toEqual({ rulesOnly: ["pop_group"], docsOnly: [] });
  });

  it("excludes the dump's special scope references rather than reporting them", () => {
    const dumpNames = new Set(dumpLinks.links.map((link) => link.name));
    for (const scopePath of SPECIAL_SCOPE_PATHS) {
      expect(dumpNames.has(scopePath)).toBe(true);
      expect(report.links.docsOnly).not.toContain(scopePath);
    }
  });

  it("excludes value and from_data links by their own markers", () => {
    for (const name of ["variable", "script_value", "modifier", "trigger"]) {
      expect(rules.links.get(name)?.type).toBe("value");
      expect(report.links.rulesOnly).not.toContain(name);
    }
    expect(rules.links.get("pop_faction_parameter")?.fromData).toBe(true);
    expect(report.links.rulesOnly).not.toContain("pop_faction_parameter");
  });
});

describe("the drift gate", { timeout: 30_000 }, () => {
  const report = reconcile(rules, docs, modifierDocs, dumpLinks);

  it("finds no unknown CWT keyword in the vendored rules", () => {
    expect(report.unknownKeywords).toEqual([]);
  });

  it("catches an unknown CWT keyword the baseline does not expect", () => {
    expect(
      compareToBaseline(report, { ...baseline, unknownKeywords: ["effects.cwt:1 sceop[fleet]"] })
    ).toEqual(["  - unknown CWT keyword: effects.cwt:1 sceop[fleet]"]);
  });

  it("carries a per-file reference-count signature on the one accepted unknown scope", () => {
    expect(report.unknownScopes).toEqual(["pop — effects.log:52, triggers.log:73"]);
  });

  it("finds no malformed doc-dump blocks in the vendored dumps today", () => {
    expect(report.malformedDocBlocks).toEqual([]);
    expect(report.malformedModifierBlocks).toEqual([]);
    expect(report.malformedScopeLinkBlocks).toEqual([]);
    expect(report.duplicateDocEntries).toEqual([]);
    expect(report.duplicateModifierEntries).toEqual([]);
    expect(report.duplicateScopeLinkEntries).toEqual([]);
    expect(report.unknownModifierScopeTokens).toEqual([]);
  });

  it("catches a malformed trigger/effect doc block the baseline does not expect", () => {
    expect(
      compareToBaseline(report, {
        ...baseline,
        malformedDocBlocks: ["triggers.log:1 made up block"],
      })
    ).toEqual(["  - malformed trigger/effect doc block: triggers.log:1 made up block"]);
  });

  it("catches a malformed modifier doc block the baseline does not expect", () => {
    expect(
      compareToBaseline(report, {
        ...baseline,
        malformedModifierBlocks: ["modifiers.log:1 made up line"],
      })
    ).toEqual(["  - malformed modifier doc block: modifiers.log:1 made up line"]);
  });

  it("catches an unknown modifier scope token the baseline does not expect", () => {
    const modifierCategories = new Map(rules.modifierCategories);
    modifierCategories.set("Colony", [...rules.modifierCategories.get("Colony")!, "made_up_scope"]);
    const changed = reconcile({ ...rules, modifierCategories }, docs, modifierDocs, dumpLinks);
    expect(compareToBaseline(changed, baseline)).toContain(
      "  + unknown modifier scope token: made_up_scope — modifier_categories.cwt category:Colony"
    );
  });

  it("names a trigger that appeared in only one source", () => {
    const injected: DriftBaseline = {
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
    const injected: DriftBaseline = {
      ...baseline,
      effects: { ...baseline.effects, rulesOnly: [] },
    };
    expect(compareToBaseline(report, injected)).toEqual(
      baseline.effects.rulesOnly.map((name) => `  + effect only in rules: ${name}`)
    );
  });

  it("names a curated modifier the game's dump stopped listing", () => {
    const injected: DriftBaseline = {
      ...baseline,
      modifiers: { rulesOnly: [...baseline.modifiers.rulesOnly, "has_new_modifier"] },
    };
    expect(compareToBaseline(report, injected)).toEqual([
      "  - modifier only in rules: has_new_modifier",
    ]);
  });

  it("catches a scope named by either source that scopes.cwt does not define", () => {
    expect(compareToBaseline(report, { ...baseline, unknownScopes: ["made_up"] })).toEqual([
      ...baseline.unknownScopes.map((scope) => `  + unknown scope: ${scope}`),
      "  - unknown scope: made_up",
    ]);
  });

  it("requires every accepted scope disagreement to carry a rationale", () => {
    const [first, ...rest] = baseline.scopeResolutions;
    expect(
      compareToBaseline(report, {
        ...baseline,
        scopeResolutions: [{ ...first!, reason: "" }, ...rest],
      })
    ).toEqual([`  ! scope resolution ${first!.id} has no reason`]);
  });

  it("fails when one effect rule's scope changes", () => {
    const effects = new Map(rules.effects);
    effects.set(
      "country_event",
      rules.effects.get("country_event")!.map((declaration) => ({
        ...declaration,
        supportedScopes: ["planet"],
      }))
    );
    const changed = reconcile({ ...rules, effects }, docs, modifierDocs, dumpLinks);
    const differences = compareToBaseline(changed, baseline);

    expect(differences).toContain(
      "  + effect scope conflict: country_event: rules say [planet], docs say [country]"
    );
    expect(() => updatedBaseline(changed, baseline)).toThrowError(
      "Scope drift cannot be rebaselined without an explicit resolution"
    );
  });

  it("catches a CWT keyword the classifier does not understand", () => {
    const injected = {
      ...rules,
      diagnostics: [
        ...rules.diagnostics,
        {
          kind: "unknown-keyword" as const,
          file: "test.cwt",
          line: 1,
          text: "quantum_range[0..3]",
        },
      ],
    };
    const changed = reconcile(injected, docs, modifierDocs, dumpLinks);
    expect(compareToBaseline(changed, baseline)).toEqual([
      "  + unknown CWT keyword: test.cwt:1 quantum_range[0..3]",
    ]);
  });
});

describe("where the fork and the game's dump disagree", () => {
  const report = reconcile(rules, docs, modifierDocs, dumpLinks);

  const differencesOf = (conflict: ScopeConflict) => {
    const fromRules = new Set(conflict.rules === "any" ? [] : conflict.rules);
    const fromDocs = new Set(conflict.docs === "any" ? [] : conflict.docs);
    return {
      rulesAdd: [...fromRules].filter((scope) => !fromDocs.has(scope)),
      docsAdd: [...fromDocs].filter((scope) => !fromRules.has(scope)),
    };
  };

  it("audits effect scopes with the same machinery as triggers", () => {
    expect(report.scopeConflicts.triggers).toHaveLength(232);
    expect(report.scopeConflicts.effects).toHaveLength(161);
    expect(report.unscopedRules.triggers).toEqual([
      "cosmic_storm_influence_value",
      "has_pop_flag",
      "pop_has_ethic",
    ]);
    expect(report.unscopedRules.effects).toEqual([
      "<scripted_effect>",
      "cancel_contract",
      "create_random_fleet",
      "issue_contract",
      "pop_event",
      "remove_pop_flag",
      "set_pop_flag",
      "set_timed_pop_flag",
    ]);
  });

  it("shows that most trigger and effect drift is the stale 4.x scope model", () => {
    const parsed = [...report.scopeConflicts.triggers, ...report.scopeConflicts.effects].map(
      (conflict) => {
        const difference = differencesOf(conflict);
        return {
          ...difference,
          explained: difference.rulesAdd.includes("carrier") || difference.docsAdd.includes("pop"),
        };
      }
    );
    const count = (scope: string, key: "rulesAdd" | "docsAdd"): number =>
      parsed.filter((entry) => entry[key].includes(scope)).length;

    // `carrier` is a scope the fork tracks and the dump omits; `pop` is the
    // pre-4.0 name for what the fork calls `pop_group`.
    expect(count("carrier", "rulesAdd")).toBe(296);
    expect(count("pop", "docsAdd")).toBe(117);
    const explained = parsed.filter((entry) => entry.explained);
    expect(explained.length / parsed.length).toBeGreaterThan(0.95);
  });
});

describe("a scope annotation inside a rule body", { timeout: 30_000 }, () => {
  /** The classified `## push_scope` / `## replace_scopes` one option line declares. */
  function annotation(option: string): ScopeContext {
    const node = parseCwt(`${option}\nfield = scalar`, "annotation.cwt").nodes[0];
    if (node?.kind !== "assignment") {
      throw new Error("synthetic scope must be attached to an assignment");
    }
    const scope = scopeOf(node.options);
    if (scope === null) {
      throw new Error("synthetic annotation must classify");
    }
    return scope;
  }

  function field(name: string, scope: ScopeContext): RuleField {
    return {
      key: { kind: "name", name },
      type: { kind: "bool" },
      cardinality: { min: 1, max: 1 },
      docs: [],
      scope,
      line: 1,
      comparison: false,
    };
  }

  /** One effect whose nested `limit` clause replaces ROOT with a misspelling. */
  function misspelledClauseEffect(): ReadonlyMap<string, readonly AliasDecl[]> {
    const source = [
      "## scopes = { country }",
      "alias[effect:synthetic_clause_effect] = {",
      "\t## replace_scopes = { this = country root = countr }",
      "\tlimit = bool",
      "}",
    ].join("\n");
    const { aliases } = readAliases(
      parseCwt(source, "synthetic-effect.cwt").nodes,
      "synthetic-effect.cwt",
      "effect",
      new Map()
    );
    return new Map([...rules.effects, ...aliases]);
  }

  const injected = reconcile(
    {
      ...rules,
      bodies: new Map([
        ...rules.bodies,
        [
          "synthetic_type",
          {
            fields: [field("potential", annotation("## push_scope = contry"))],
            scope: null,
            file: "synthetic-body.cwt",
          },
        ],
      ]),
      effects: misspelledClauseEffect(),
    },
    docs,
    modifierDocs,
    dumpLinks
  );

  it("reaches the drift report from a content body's own field", () => {
    expect(injected.unknownScopes).toContain("contry — synthetic-body.cwt:1");
  });

  it("reaches it from a nested clause of an alias declaration", () => {
    expect(injected.unknownScopes).toContain("countr — synthetic-effect.cwt:1");
  });

  it("fails the gate rather than silently widening the field", () => {
    const differences = compareToBaseline(injected, baseline);

    expect(differences).toContain("  + unknown scope: contry — synthetic-body.cwt:1");
    expect(differences).toContain("  + unknown scope: countr — synthetic-effect.cwt:1");
  });

  /** One body whose `from` slot holds a scope group rather than one scope. */
  const withGroupSlot = (group: string) =>
    reconcile(
      {
        ...rules,
        bodies: new Map([
          ...rules.bodies,
          [
            "synthetic_type",
            {
              fields: [
                field(
                  "on_start",
                  annotation(`## replace_scopes = { this = country from = scope_group[${group}] }`)
                ),
              ],
              scope: null,
              file: "synthetic-body.cwt",
            },
          ],
        ]),
      },
      docs,
      modifierDocs,
      dumpLinks
    );

  it("separates a declared scope group from a scope scopes.cwt does not define", () => {
    const declared = withGroupSlot("spatial_object");
    // The vendored rules already fill ambient slots with this group, so the
    // synthetic reference joins that entry rather than adding its own.
    const entry = declared.scopeGroupAmbientSlots.find((slot) =>
      slot.startsWith("scope_group[spatial_object] — ")
    );

    expect(entry).toContain("synthetic-body.cwt:1");
    expect(declared.unknownScopes.some((scope) => scope.startsWith("scope_group["))).toBe(false);
    expect(compareToBaseline(declared, baseline)).toContain(
      `  + scope group in ambient slot: ${entry}`
    );
  });

  it("still reports a group name scopes.cwt never declared as an unknown scope", () => {
    const invented = withGroupSlot("not_a_group");

    expect(invented.unknownScopes).toContain("scope_group[not_a_group] — synthetic-body.cwt:1");
    expect(invented.scopeGroupAmbientSlots).toEqual(baseline.scopeGroupAmbientSlots);
  });
});
