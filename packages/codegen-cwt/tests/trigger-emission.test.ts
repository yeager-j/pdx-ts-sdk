import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import { readAliases, scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { pushCode } from "@pdx-ts/codegen-cwt/emit/script/trigger-push-code";
import { emitTriggers, type TriggerEmission } from "@pdx-ts/codegen-cwt/emit/script/triggers";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import { lowerRuleTable } from "@pdx-ts/codegen-cwt/lower/lowered-rule";
import type { ArgField } from "@pdx-ts/codegen-cwt/lower/script-shape";
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

/**
 * `emitTriggers` audits every overlay row against the table it is given, so an
 * inline table must declare the rule each row names. `TRIGGER_DOC_SUMMARY_OVERRIDES`
 * covers `trait_has_any_tag` and is not what these tests vary, so the helper
 * supplies it; the `ENCLOSING_SCOPE_TRIGGER_WRAPPERS` rows are spelled per test.
 */
const DOC_OVERRIDE_ROW = [
  "### CWT prose the overlay replaces",
  "## scopes = any",
  "alias[trigger:trait_has_any_tag] = bool",
].join("\n");

/**
 * Emits a trigger table written inline rather than the vendored one, so a rule
 * shape can be posed to the emitter without a rules change.
 */
function emitInlineTriggers(source: string): TriggerEmission {
  const inlineEmitter = new Emitter(rules);
  const { aliases } = readAliases(
    parseCwt([DOC_OVERRIDE_ROW, source].join("\n\n"), "triggers.cwt").nodes,
    "triggers.cwt",
    "trigger",
    new Map()
  );
  return emitTriggers(
    inlineEmitter,
    docs.triggers,
    lowerRuleTable(aliases, docs.triggers, inlineEmitter, scopeIndex(rules))
  );
}

/** A pure trigger splice, the shape an `ENCLOSING_SCOPE_TRIGGER_WRAPPERS` row claims. */
function pureSplice(key: string, options: readonly string[] = []): string {
  return [
    "## scopes = any",
    ...options,
    `alias[trigger:${key}] = {`,
    "\talias_name[trigger] = alias_match_left[trigger]",
    "}",
  ].join("\n");
}

const BOTH_WRAPPER_ROWS = [pureSplice("hidden_progress"), pureSplice("simple_progress")].join(
  "\n\n"
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

  it("documents every generated argument object, whichever form it takes", () => {
    expect(emission.code).toContain(
      "/** The arguments `calcTrueIf` takes, as the rules declare them. */\n" +
        "export interface CalcTrueIfArgs {"
    );
    expect(emission.code).toContain(
      "/** The arguments `hasResource` takes, as the rules declare them. */\n" +
        "export type HasResourceArgs = {"
    );
  });

  /**
   * The nested scope of an iterator wrapper comes from the CWT siblings alone.
   * The game's documentation dump states a trigger's own supported scopes and
   * never the scope it pushes, so it cannot corroborate these signatures.
   */
  it("gives each iterator wrapper the nested scope its rule pushes", () => {
    expect(emission.code).toContain(
      'export function anyCosmicStorm(condition: Trigger<"storm">): Trigger<ScopeName> {'
    );
    expect(emission.code).toContain(
      'export function anySystemWithinStorm(condition: Trigger<"system">): Trigger<"storm"> {'
    );
  });

  it("makes a wrapper that pushes no scope generic over the enclosing scope", () => {
    for (const fn of ["hiddenProgress", "simpleProgress"]) {
      expect(emission.code).toContain(
        `export function ${fn}<S extends ScopeName>(condition: Trigger<S>): Trigger<S> {`
      );
    }
  });

  it("skips a wrapper that pushes no scope and has no overlay row", () => {
    const emitted = emitInlineTriggers(
      [BOTH_WRAPPER_ROWS, pureSplice("pretend_progress")].join("\n\n")
    );

    expect(emitted.skipped).toContainEqual({
      name: "pretend_progress",
      category: "missing-push-scope",
      detail: "scope change with no push_scope annotation",
    });
    expect(emitted.names).toContain("hiddenProgress");
  });

  it("rejects an overlay row whose rule now declares a push scope", () => {
    expect(() =>
      emitInlineTriggers(
        [
          pureSplice("hidden_progress", ["## push_scope = country"]),
          pureSplice("simple_progress"),
        ].join("\n\n")
      )
    ).toThrow(
      'ENCLOSING_SCOPE_TRIGGER_WRAPPERS names "hidden_progress", which now declares push_scope country'
    );
  });

  it("rejects an overlay row whose rule is no longer a pure trigger splice", () => {
    expect(() =>
      emitInlineTriggers(
        [
          "## scopes = any",
          "alias[trigger:hidden_progress] = bool",
          "",
          pureSplice("simple_progress"),
        ].join("\n")
      )
    ).toThrow(
      'ENCLOSING_SCOPE_TRIGGER_WRAPPERS names "hidden_progress", which is not a pure trigger splice (bool)'
    );
  });

  it("rejects an overlay row whose rule no longer exists", () => {
    expect(() => emitInlineTriggers(pureSplice("simple_progress"))).toThrow(
      'ENCLOSING_SCOPE_TRIGGER_WRAPPERS names "hidden_progress", which no trigger rule declares'
    );
  });

  it("authors a repeated comparison as one value, one pair, or a list of pairs", () => {
    expect(emission.code).toContain(
      "value: ScriptValue | readonly [PdxOp, ScriptValue] | " +
        "readonly (readonly [PdxOp, ScriptValue])[];"
    );
    expect(emission.code).toContain("if (isComparisonList(args.value)) {");
    expect(emission.code).toContain("for (const entry1 of args.value) {");
    expect(emission.code).toContain(
      'entries.push(cmp("value", entry1[0], scriptValueScalar(entry1[1])));'
    );
    expect(emission.code).toContain(
      'entries.push(typeof args.value === "object" ? cmp("value", args.value[0], ' +
        'scriptValueScalar(args.value[1])) : kv("value", scriptValueScalar(args.value)));'
    );
  });

  it("records one content reference per item of a repeated reference-bearing field", () => {
    const repeatedTrait: ArgField = {
      name: "trait",
      value: {
        kind: "scalar",
        value: { type: "TraitRef | string", toScalar: (expr) => expr, refTypes: ["trait"] },
      },
      optional: false,
      repeated: true,
      docs: [],
    };
    const pushEmitter = new Emitter(rules);
    pushEmitter.beginFile();

    const code = pushCode(pushEmitter, repeatedTrait, "args.trait", "has_trait", 0);

    expect(code).toContain("for (const entry0 of args.trait) {");
    expect(code).toContain("const id0 = entry0;");
    expect(code).toContain('entries.push(kv("trait", id0));');
    expect(code).toContain('refs.push({ targets: ["trait"], id: id0, field: "has_trait.trait" });');
    expect(code.indexOf("for (const entry0")).toBeLessThan(code.indexOf("refs.push"));
    expect(code.trimEnd().endsWith("}")).toBe(true);
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
