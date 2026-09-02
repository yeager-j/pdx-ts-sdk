import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeOf, type RuleField } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readAliases, scopeIndex, type AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseModifierDocs } from "@pdx-ts/codegen-cwt/logs/modifier-docs";
import { parseScopeLinks } from "@pdx-ts/codegen-cwt/logs/scopes";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRule } from "@pdx-ts/codegen-cwt/lower/lowered-rule";
import {
  canonicalThisScope,
  scopeType,
  splitRootMetadata,
  withFrom,
} from "@pdx-ts/codegen-cwt/lower/scope-context";
import { loadScopeFacts } from "@pdx-ts/codegen-cwt/lower/scope-facts";
import { compareToBaseline, loadBaseline } from "@pdx-ts/codegen-cwt/reconcile/baseline";
import {
  reconcile,
  type DriftBaseline,
  type ScopeResolution,
} from "@pdx-ts/codegen-cwt/reconcile/reconcile";
import {
  resolveRuleScopes,
  scopeAuthorityOf,
  type RuleScopeDecision,
} from "@pdx-ts/codegen-cwt/reconcile/scope-authority";
import { Emitter } from "@pdx-ts/codegen-cwt/render/emitter";
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
const emitter = new Emitter(rules);
const scopes = scopeIndex(rules);
const baseline = loadBaseline();
const report = reconcile(rules, docs, modifierDocs, dumpLinks);

/** The 13 scopes `export-modifier-scope-family` reviewed, `colony` included. */
const EXPORT_MODIFIER_SCOPES = [
  "army",
  "carrier",
  "colony",
  "country",
  "fleet",
  "leader",
  "megastructure",
  "planet",
  "pop_faction",
  "pop_group",
  "ship",
  "species",
  "system",
];

function resolution(overrides: Partial<ScopeResolution> = {}): ScopeResolution {
  return {
    id: "synthetic",
    selectedAuthority: "rules",
    reason: "synthetic",
    evidenceVersion: "synthetic",
    expectedLifetime: "synthetic",
    conflicts: { triggers: [], effects: [] },
    unscopedRules: { triggers: [], effects: [] },
    ...overrides,
  };
}

function baselineWith(resolutions: readonly ScopeResolution[]): DriftBaseline {
  return { ...baseline, scopeResolutions: resolutions };
}

/** The declarations of one synthetic effect whose CWT scopes say `country`. */
function countryScopedDeclarations(key: string): readonly AliasDecl[] {
  const source = ["## scopes = { country }", `alias[effect:${key}] = bool`].join("\n");
  return readAliases(
    parseCwt(source, "synthetic.cwt").nodes,
    "synthetic.cwt",
    "effect",
    new Map()
  ).aliases.get(key)!;
}

/** The same declarations without a `## scopes` annotation. */
function unannotatedDeclarations(key: string): readonly AliasDecl[] {
  const source = `alias[effect:${key}] = bool`;
  return readAliases(
    parseCwt(source, "synthetic.cwt").nodes,
    "synthetic.cwt",
    "effect",
    new Map()
  ).aliases.get(key)!;
}

function pushedScope(name: string) {
  const node = parseCwt(`## push_scope = ${name}\nfield = scalar`, `${name}-scope.cwt`).nodes[0];
  if (node?.kind !== "assignment") {
    throw new Error("synthetic scope must be attached to an assignment");
  }
  const scope = scopeOf(node.options);
  if (scope === null) {
    throw new Error("synthetic push_scope must classify");
  }
  return scope;
}

function replacedScopes(body: string) {
  const node = parseCwt(`## replace_scopes = { ${body} }\nfield = scalar`, "replace.cwt").nodes[0];
  if (node?.kind !== "assignment") {
    throw new Error("synthetic scope must be attached to an assignment");
  }
  const scope = scopeOf(node.options);
  if (scope === null) {
    throw new Error("synthetic replace_scopes must classify");
  }
  return scope;
}

function field(name: string, scope: RuleField["scope"]): RuleField {
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

describe("the baseline read as scope authority", () => {
  it("maps rule names out of both conflict and unscoped-rule entries", () => {
    const authority = scopeAuthorityOf(
      baselineWith([
        resolution({
          id: "conflicting",
          conflicts: {
            triggers: ["is_alive: rules say [country], docs say [planet]"],
            effects: [],
          },
        }),
        resolution({
          id: "unannotated",
          selectedAuthority: "docs",
          unscopedRules: { triggers: [], effects: ["set_pop_flag"] },
        }),
      ]),
      scopes
    );

    expect(authority.triggers.get("is_alive")).toEqual({
      resolution: "conflicting",
      authority: "rules",
    });
    expect(authority.effects.get("set_pop_flag")).toEqual({
      resolution: "unannotated",
      authority: "docs",
    });
  });

  it("refuses a rule two resolutions both decide", () => {
    const claimed = baselineWith([
      resolution({
        id: "first",
        conflicts: { triggers: ["is_alive: rules say [], docs say []"], effects: [] },
      }),
      resolution({ id: "second", unscopedRules: { triggers: ["is_alive"], effects: [] } }),
    ]);

    expect(() => scopeAuthorityOf(claimed, scopes)).toThrowError(
      'Scope resolutions "first" and "second" both decide rule "is_alive"'
    );
  });

  it("refuses a mixed resolution whose reviewed set names an unknown scope", () => {
    const misspelled = baselineWith([
      resolution({
        id: "mixed-typo",
        selectedAuthority: "mixed",
        unscopedRules: { triggers: [], effects: ["export_modifier_to_variable"] },
        resolvedScopes: { effects: { export_modifier_to_variable: ["country", "contry"] } },
      }),
    ]);

    expect(() => scopeAuthorityOf(misspelled, scopes)).toThrowError(
      'Scope resolution "mixed-typo" gives rule "export_modifier_to_variable" ' +
        'the unknown scope "contry"'
    );
  });

  it("keeps a trigger and an effect of the same name on their own reviewed sets", () => {
    const authority = scopeAuthorityOf(
      baselineWith([
        resolution({
          id: "same-name",
          selectedAuthority: "mixed",
          unscopedRules: { triggers: ["has_flag"], effects: ["has_flag"] },
          resolvedScopes: {
            triggers: { has_flag: ["country"] },
            effects: { has_flag: ["planet"] },
          },
        }),
      ]),
      scopes
    );

    expect(authority.triggers.get("has_flag")?.scopes).toEqual(["country"]);
    expect(authority.effects.get("has_flag")?.scopes).toEqual(["planet"]);
  });

  it("reports a mixed resolution that reviewed no scope set", () => {
    const withoutSet = baselineWith([
      resolution({
        id: "mixed-empty",
        selectedAuthority: "mixed",
        unscopedRules: { triggers: [], effects: ["export_modifier_to_variable"] },
      }),
    ]);

    expect(compareToBaseline(report, withoutSet)).toContain(
      "  ! scope resolution mixed-empty has no resolvedScopes.effects entry for " +
        "export_modifier_to_variable"
    );
  });

  it("reports a reviewed scope set on a resolution that reads a whole source", () => {
    const misplaced = baselineWith([
      resolution({
        id: "rules-with-set",
        unscopedRules: { triggers: [], effects: ["export_modifier_to_variable"] },
        resolvedScopes: { effects: { export_modifier_to_variable: ["country"] } },
      }),
    ]);

    expect(compareToBaseline(report, misplaced)).toContain(
      "  ! scope resolution rules-with-set has resolvedScopes but is not mixed"
    );
  });
});

describe("a rule whose two sources disagree", () => {
  const key = "synthetic_effect";
  const declarations = countryScopedDeclarations(key);
  const doc = { scopes: ["planet"] };
  const lower = (decision: RuleScopeDecision | undefined, decls = declarations) =>
    lowerRule(key, decls, doc, emitter, scopes, decision);

  it("takes the CWT scopes when the baseline selected the rules", () => {
    expect(lower({ resolution: "r", authority: "rules" }).scopes).toEqual(["country"]);
  });

  it("takes the documented scopes when the baseline selected the docs", () => {
    expect(lower({ resolution: "r", authority: "docs" }).scopes).toEqual(["planet"]);
  });

  it("takes the reviewed set when the baseline selected neither source alone", () => {
    const decision: RuleScopeDecision = {
      resolution: "r",
      authority: "mixed",
      scopes: ["country", "planet"],
    };

    expect(lower(decision).scopes).toEqual(["country", "planet"]);
  });

  it("has no scopes when the baseline selected no source", () => {
    expect(lower({ resolution: "r", authority: "none" }).scopes).toBeNull();
  });

  it("falls back to the CWT scopes when no resolution decides it", () => {
    expect(lower(undefined).scopes).toEqual(["country"]);
  });

  it("does not guess from the documentation when the rule is unannotated too", () => {
    expect(lower(undefined, unannotatedDeclarations(key)).scopes).toBeNull();
  });
});

describe("the reviewed mixed resolution for export_modifier_to_variable", () => {
  it("puts colony into the effect's generated scopes", () => {
    const authority = scopeAuthorityOf(baseline, scopes);
    const key = "export_modifier_to_variable";
    const lowered = lowerRule(
      key,
      rules.effects.get(key)!,
      docs.effects.get(key),
      emitter,
      scopes,
      authority.effects.get(key)
    );

    expect(lowered.scopes).toEqual(EXPORT_MODIFIER_SCOPES);
  });

  it("gives the scope facts the same set the emitters use", () => {
    const facts = loadScopeFacts(CONFIG, DOCS);

    expect(facts.effects.get("export_modifier_to_variable")?.scopes).toEqual(
      EXPORT_MODIFIER_SCOPES
    );
  });
});

describe("scope facts read by a generator that never runs the drift gate", () => {
  /** The vendored config with one effect's `## scopes` changed, in a temp copy. */
  function configWithDriftedEffect(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "pdx-scope-facts-"));
    const config = path.join(directory, "config");
    cpSync(CONFIG, config, { recursive: true });
    const effects = path.join(config, "effects.cwt");
    const source = readFileSync(effects, "utf8");
    const annotated = "## scopes = { country }\nalias[effect:country_event] = {";
    // A guard on the fixture: a vendor edit that moved this line would
    // otherwise leave the test asserting against an unchanged copy.
    expect(source).toContain(annotated);
    writeFileSync(
      effects,
      source.replace(annotated, "## scopes = { planet }\nalias[effect:country_event] = {"),
      "utf8"
    );
    return config;
  }

  it("refuses to apply a baseline the supplied rules no longer match", () => {
    const config = configWithDriftedEffect();

    try {
      expect(() => loadScopeFacts(config, DOCS)).toThrowError(
        /effect scope conflict: country_event/
      );
    } finally {
      rmSync(path.dirname(config), { recursive: true, force: true });
    }
  });
});

describe("a body field naming a scope scopes.cwt does not define", () => {
  const ctx = { scope: null, unpinned: "ScopeName" };

  it("fails lowering rather than widening the field's own scope", () => {
    expect(() => scopeType(emitter, field("limit", pushedScope("contry")), ctx)).toThrowError(
      'Scope annotation "this" on field "limit" names unknown scope "contry"'
    );
  });

  it("fails lowering rather than hiding an ambient slot", () => {
    const scope = replacedScopes("this = country root = countr");

    expect(() => scopeType(emitter, field("limit", scope), ctx)).toThrowError(
      'Scope annotation "root" on field "limit" names unknown scope "countr"'
    );
  });

  it("still leaves a universal scope unpinned", () => {
    expect(scopeType(emitter, field("limit", pushedScope("any")), ctx).type).toBe("ScopeName");
  });
});

describe("a scope annotation naming a declared scope group", () => {
  const ctx = { scope: null, unpinned: "ScopeName" };
  const spatialObjectScopes = [
    "ambient_object",
    "archaeological_site",
    "astral_rift",
    "bypass",
    "carrier",
    "colony",
    "debris",
    "fleet",
    "megastructure",
    "planet",
    "ship",
    "situation",
    "starbase",
    "system",
  ];
  const spatialObjectType = spatialObjectScopes.map((scope) => `"${scope}"`).join(" | ");

  it("lowers the THIS position to the group's member union", () => {
    const pushed = field("on_start", pushedScope("scope_group[spatial_object]"));
    const scope = scopeType(emitter, pushed, ctx);

    expect(scope.type).toBe(spatialObjectType);
    expect(scope.scopes).toEqual(spatialObjectScopes);
    expect(canonicalThisScope(emitter, "scope_group[spatial_object]", "test annotation")).toEqual(
      spatialObjectScopes
    );
  });

  it("lowers an ambient slot without disturbing the field's own scope", () => {
    const replaced = field(
      "on_start",
      replacedScopes(
        "this = country root = scope_group[spatial_object] from = scope_group[spatial_object]"
      )
    );
    const scope = scopeType(emitter, replaced, ctx);

    expect(scope.type).toBe('"country"');
    expect(scope.from).toBe(spatialObjectType);
    expect(scope.root).toBe(spatialObjectType);
    expect(scope.context.from).toBe(spatialObjectType);
    expect(withFrom(emitter, 'Trigger<"country">', scope)).toBe(
      `WithFrom<Trigger<"country">, "country", { readonly root: ${spatialObjectType}; ` +
        `readonly from: ${spatialObjectType} }>`
    );
  });

  it("still rejects a group that scopes.cwt does not declare", () => {
    const replaced = field(
      "on_start",
      replacedScopes("this = country from = scope_group[not_a_group]")
    );

    expect(() => scopeType(emitter, replaced, ctx)).toThrowError(
      'names unknown scope "scope_group[not_a_group]"'
    );
  });

  it("marks a group-scoped block split only when ROOT differs", () => {
    const differentRoot = scopeType(
      emitter,
      field("on_start", replacedScopes("this = scope_group[spatial_object] root = country")),
      ctx
    );
    const matchingRoot = scopeType(
      emitter,
      field(
        "on_start",
        replacedScopes("this = scope_group[spatial_object] root = scope_group[spatial_object]")
      ),
      ctx
    );

    expect(splitRootMetadata(differentRoot)).toEqual(["splitRoot: true"]);
    expect(splitRootMetadata(matchingRoot)).toEqual([]);
  });

  it("matches a group name however the annotation spells it", () => {
    expect(emitter.scopeGroup("SPATIAL_OBJECT")).not.toBeNull();
  });
});
