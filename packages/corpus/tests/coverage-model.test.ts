/**
 * The coverage model over synthetic inputs: every row of the classification
 * table, every contradiction the builders refuse, the summary arithmetic,
 * and the printed layout.
 *
 * Synthetic on purpose. The real inputs exercise whichever rows vanilla and
 * the rules happen to contain today (the script gap ledger is empty, the fire
 * join never fires), and a row that has only ever been green proves nothing.
 * `coverage.test.ts` reconciles the real report with the ledgers.
 */

import type { ModifierJoin } from "@pdx-ts/codegen-cwt/emit/script/modifiers";
import type { LinkClassification } from "@pdx-ts/codegen-cwt/lower/links";
import { skippedRule, type ScriptSkipCategory } from "@pdx-ts/codegen-cwt/lower/script-shape";
import type { EventFieldPolicyEntry } from "@pdx-ts/codegen-cwt/policy/event-fields";
import type { ScriptGapReport } from "@pdx-ts/codegen-cwt/policy/script-gaps";
import { describe, expect, it } from "vitest";

import {
  coverageOf,
  declaredTopLevelFields,
  formatCoverageReport,
  HAND_WRITTEN_LINKS,
  rerootPath,
  siteClassOfSkip,
  sitesOfEffects,
  sitesOfEventFields,
  sitesOfModifiers,
  sitesOfRegistry,
  sitesOfScopeLinks,
  sitesOfTriggers,
  sitesOfUnexposedType,
  summarizeCoverage,
  type CoverageClass,
  type CoverageInputs,
  type CoverageSite,
  type CoverageSurface,
  type RegistryCoverageInput,
  type UnexposedTypeInput,
} from "../src/coverage/index.ts";

/** Provenance for tests that check the layout, not the header. */
const PROVENANCE = {
  rulesCommit: "0123456789abcdef0123",
  gameVersion: "4.4.6",
  foldersWithoutType: [],
};

const NO_GAPS: ScriptGapReport = { policyOwned: [], abstractPlaceholders: [], trackedGaps: [] };

/** The real hand-written links, and a policy that marks `switch` unsupported. */
const OWNERSHIP = {
  links: HAND_WRITTEN_LINKS,
  unsupportedStructuralEffects: new Set(["switch"]),
};

/** Usage from a table; unknown keys weigh zero. */
const usageOf =
  (table: Readonly<Record<string, number>>) =>
  (key: string): number =>
    table[key] ?? 0;

/** A site projected to the fields the table decides. */
function row(site: CoverageSite): Record<string, unknown> {
  return {
    key: site.key,
    class: site.class,
    reason: site.reason,
    ...(site.issue === undefined ? {} : { issue: site.issue }),
    ...(site.droppedArms === undefined ? {} : { droppedArms: site.droppedArms }),
    used: site.used,
  };
}

describe("siteClassOfSkip", () => {
  /** Every category, so a new one fails to compile here until it is classified. */
  const EXPECTED: Readonly<Record<ScriptSkipCategory, CoverageClass | "throws">> = {
    "invalid-rule-name": "gap",
    "missing-rule-scope": "gap",
    "unknown-scope": "gap",
    "missing-push-scope": "gap",
    "comparison-effect": "gap",
    "parameterised-placeholder": "gap",
    "unsupported-value": "gap",
    "multiple-block-forms": "gap",
    "scalar-block-overload": "gap",
    "bare-value-block": "gap",
    "unsupported-alias-splice": "gap",
    "unsupported-clause": "gap",
    "unknown-push-scope": "gap",
    "conflicting-clause-scope": "gap",
    "empty-block": "gap",
    "reserved-field-collision": "gap",
    "computed-field-key": "gap",
    "mixed-clause-categories": "gap",
    "clause-scalar-overload": "gap",
    "multiple-structured-scalar-arms": "gap",
    "unsupported-scalar-arm": "gap",
    "structured-bare-values": "gap",
    "repeated-nested-field": "gap",
    "empty-structured-arm": "gap",
    "unsupported-comparison-operand": "gap",
    "comparison-overload": "gap",
    "unsupported-field-value": "gap",
    "abstract-placeholder": "policy-owned",
    "handwritten-trigger": "policy-owned",
    "structural-effect": "policy-owned",
    "event-fire-effect": "policy-owned",
    "removed-api": "removed",
    "scopeless-event-kind": "throws",
    "missing-fire-rule-scope": "throws",
    "event-policy-rejected": "throws",
    "value-link": "gap",
    "data-link": "gap",
    "missing-output-scope": "gap",
    "polymorphic-output-scope": "gap",
    "unknown-output-scope": "gap",
    "unknown-input-scope": "gap",
  };

  it.each(Object.entries(EXPECTED))(
    "classifies %s as %s for an unowned key",
    (category, expected) => {
      const skip = skippedRule("some_key", category as ScriptSkipCategory, "detail");
      if (expected === "throws") {
        expect(() => siteClassOfSkip(skip, OWNERSHIP)).toThrow(
          "some_key: " + category + " describes an event kind, not a rule site"
        );
        return;
      }
      expect(siteClassOfSkip(skip, OWNERSHIP).class).toBe(expected);
    }
  );

  it("carries the skip detail as the reason", () => {
    expect(siteClassOfSkip(skippedRule("k", "unsupported-value", "a shape"), OWNERSHIP)).toEqual({
      class: "gap",
      reason: "a shape",
    });
  });

  it("classifies a structural effect by whether an author can write it", () => {
    // `if` has a method, `else` is recorded by the chain `if` returns, and
    // `switch` has neither: the policy owns all three, coverage counts one gap.
    const classes = ["if", "else", "switch"].map(
      (key) =>
        siteClassOfSkip(skippedRule(key, "structural-effect", `hand-written: ${key}`), OWNERSHIP)
          .class
    );
    expect(classes).toEqual(["policy-owned", "policy-owned", "gap"]);
  });

  it("owns a value link or polymorphic link the SDK writes by hand", () => {
    const ownership = {
      links: new Map([["target", "hand-written"]]),
      unsupportedStructuralEffects: new Set<string>(),
    };
    expect(
      siteClassOfSkip(skippedRule("target", "polymorphic-output-scope", "any"), ownership)
    ).toEqual({ class: "policy-owned", reason: "hand-written" });
    expect(
      siteClassOfSkip(skippedRule("other", "polymorphic-output-scope", "any"), ownership)
    ).toEqual({ class: "gap", reason: "any" });
  });

  it("does not let ownership reach a non-link category", () => {
    const ownership = {
      links: new Map([["k", "hand-written"]]),
      unsupportedStructuralEffects: new Set<string>(),
    };
    expect(siteClassOfSkip(skippedRule("k", "data-link", "from_data"), ownership).class).toBe(
      "gap"
    );
  });

  it("names the scripted binding module for an abstract placeholder", () => {
    const result = siteClassOfSkip(
      skippedRule("<scripted_trigger>", "abstract-placeholder", "abstract"),
      OWNERSHIP
    );
    expect(result.class).toBe("policy-owned");
    expect(result.reason).toContain("packages/sdk/src/script/scripted.ts");
  });
});

describe("sitesOfTriggers", () => {
  const gaps: ScriptGapReport = {
    ...NO_GAPS,
    trackedGaps: [
      {
        kind: "trigger",
        name: "tracked",
        category: "unsupported-value",
        detail: "current detail",
        rationale: "Deferred.",
        issue: "SDK-999",
      },
    ],
  };

  it("classifies every declared key once", () => {
    const sites = sitesOfTriggers(
      {
        declared: ["removed", "emitted", "tracked", "untracked", "doubled", "owned"],
        emitted: ["emitted"],
        skipped: [
          skippedRule("removed", "removed-api", "declared removed"),
          skippedRule("tracked", "unsupported-value", "current detail"),
          skippedRule("untracked", "bare-value-block", "bare"),
          skippedRule("doubled", "conflicting-clause-scope", "limit conflicts"),
          skippedRule("doubled", "conflicting-clause-scope", "owner conflicts"),
          skippedRule("owned", "handwritten-trigger", "hand-written combinator"),
        ],
      },
      gaps,
      usageOf({ emitted: 5, removed: 2, tracked: 1 }),
      OWNERSHIP
    );
    expect(sites.map(row)).toEqual([
      { key: "doubled", class: "gap", reason: "limit conflicts; owner conflicts", used: 0 },
      { key: "emitted", class: "authorable", reason: "generated from the rules", used: 5 },
      { key: "owned", class: "policy-owned", reason: "hand-written combinator", used: 0 },
      { key: "removed", class: "removed", reason: "declared removed", used: 2 },
      { key: "tracked", class: "gap", reason: "Deferred.", issue: "SDK-999", used: 1 },
      { key: "untracked", class: "gap", reason: "bare", used: 0 },
    ]);
  });

  it("does not apply an effect ledger row to a trigger", () => {
    const sites = sitesOfTriggers(
      { declared: ["k"], emitted: [], skipped: [skippedRule("k", "unsupported-value", "d")] },
      {
        ...NO_GAPS,
        trackedGaps: [
          {
            kind: "effect",
            name: "k",
            category: "unsupported-value",
            detail: "d",
            rationale: "r",
            issue: "SDK-1",
          },
        ],
      },
      () => 0,
      OWNERSHIP
    );
    expect(sites.map(row)).toEqual([{ key: "k", class: "gap", reason: "d", used: 0 }]);
  });

  it("throws when a declared key is neither emitted nor skipped", () => {
    expect(() =>
      sitesOfTriggers(
        { declared: ["lost", "b"], emitted: ["b"], skipped: [] },
        NO_GAPS,
        () => 0,
        OWNERSHIP
      )
    ).toThrow("lost: declared but neither emitted nor skipped");
  });

  it("throws when a key is both emitted and skipped", () => {
    expect(() =>
      sitesOfTriggers(
        { declared: ["k"], emitted: ["k"], skipped: [skippedRule("k", "empty-block", "d")] },
        NO_GAPS,
        () => 0,
        OWNERSHIP
      )
    ).toThrow("k: both emitted and skipped");
  });

  it("throws when an emitted or skipped key is not declared", () => {
    expect(() =>
      sitesOfTriggers(
        { declared: [], emitted: ["e"], skipped: [skippedRule("s", "empty-block", "d")] },
        NO_GAPS,
        () => 0,
        OWNERSHIP
      )
    ).toThrow("e: emitted but not declared\n  s: skipped but not declared");
  });

  it("throws when one key is skipped under two categories", () => {
    expect(() =>
      sitesOfTriggers(
        {
          declared: ["k"],
          emitted: [],
          skipped: [skippedRule("k", "empty-block", "a"), skippedRule("k", "unknown-scope", "b")],
        },
        NO_GAPS,
        () => 0,
        OWNERSHIP
      )
    ).toThrow("triggers k: skipped as both empty-block and unknown-scope");
  });
});

describe("sitesOfEffects", () => {
  const facts = {
    declared: ["country_event", "ship_event", "if"],
    emitted: [],
    skipped: [
      skippedRule("country_event", "event-fire-effect", "typed by the event-fire emitter"),
      skippedRule("ship_event", "event-fire-effect", "typed by the event-fire emitter"),
      skippedRule("if", "structural-effect", "control flow"),
    ],
  };

  it("keeps a fire effect policy-owned while the event emitter typed it", () => {
    const sites = sitesOfEffects(facts, [], NO_GAPS, () => 0, OWNERSHIP);
    expect(sites.map((site) => [site.key, site.class])).toEqual([
      ["country_event", "policy-owned"],
      ["if", "policy-owned"],
      ["ship_event", "policy-owned"],
    ]);
  });

  it("turns a fire effect into a gap when the event emitter skipped its fire method", () => {
    const sites = sitesOfEffects(
      facts,
      [
        skippedRule(
          "ship_event",
          "missing-fire-rule-scope",
          "no fire-effect rule with `## scopes`"
        ),
        skippedRule("event", "scopeless-event-kind", "scopeless"),
      ],
      NO_GAPS,
      () => 0,
      OWNERSHIP
    );
    expect(sites.map(row)).toEqual([
      {
        key: "country_event",
        class: "policy-owned",
        reason: "typed by the event-fire emitter",
        used: 0,
      },
      { key: "if", class: "policy-owned", reason: "control flow", used: 0 },
      {
        key: "ship_event",
        class: "gap",
        reason: "no typed fire method: no fire-effect rule with `## scopes`",
        used: 0,
      },
    ]);
  });
});

describe("sitesOfScopeLinks", () => {
  it("owns the hand-written links and leaves the rest as gaps", () => {
    const classification: LinkClassification = {
      links: [{ key: "owner", method: "owner", inputScopes: [], outputScope: "country", docs: [] }],
      skipped: [
        skippedRule("target", "polymorphic-output-scope", "any"),
        skippedRule("script_value", "value-link", "value link"),
        skippedRule("trigger", "value-link", "value link"),
        skippedRule("variable", "value-link", "value link"),
        skippedRule("modifier", "value-link", "value link"),
        skippedRule("pop_faction_parameter", "data-link", "from_data"),
      ],
      navigation: new Map(),
    };
    const sites = sitesOfScopeLinks(
      [
        "owner",
        "target",
        "script_value",
        "trigger",
        "variable",
        "modifier",
        "pop_faction_parameter",
      ],
      classification,
      usageOf({ owner: 9, target: 3 }),
      OWNERSHIP
    );
    expect(sites.map((site) => [site.key, site.class, site.used])).toEqual([
      ["modifier", "gap", 0],
      ["owner", "authorable", 9],
      ["pop_faction_parameter", "gap", 0],
      ["script_value", "policy-owned", 0],
      ["target", "policy-owned", 3],
      ["trigger", "policy-owned", 0],
      ["variable", "gap", 0],
    ]);
    expect(sites.find((site) => site.key === "target")?.reason).toContain(
      "packages/sdk/src/script/triggers.ts"
    );
  });
});

describe("sitesOfModifiers", () => {
  const join = (unscoped: readonly string[]): ModifierJoin => ({
    universal: ["b_universal"],
    groups: new Map([["country", ["a_country"]]]),
    unscoped,
    unknownCategories: [],
    unknownScopeTokens: [],
    dynamicFamilies: [],
    categoryScopes: new Map(),
  });

  it("classifies scoped names authorable and unscoped names as untracked gaps", () => {
    expect(sitesOfModifiers(join(["c_unscoped"]), usageOf({ a_country: 4 })).map(row)).toEqual([
      {
        key: "a_country",
        class: "authorable",
        reason: "scope evidence in modifier categories",
        used: 4,
      },
      {
        key: "b_universal",
        class: "authorable",
        reason: "scope evidence in modifier categories",
        used: 0,
      },
      {
        key: "c_unscoped",
        class: "gap",
        reason: "no scope evidence in modifier categories (drift-gated)",
        used: 0,
      },
    ]);
  });

  it("throws on a name in two partitions", () => {
    expect(() => sitesOfModifiers(join(["a_country"]), () => 0)).toThrow(
      "modifiers a_country: joined into two scope partitions"
    );
  });
});

describe("sitesOfEventFields", () => {
  const entry = (
    scriptKey: string,
    disposition: EventFieldPolicyEntry["disposition"],
    extra: Partial<EventFieldPolicyEntry> = {}
  ): EventFieldPolicyEntry => ({
    scriptKey,
    shape: "scalar 0..1",
    disposition,
    reason: `${scriptKey} reason`,
    ...extra,
  });

  it("prefixes keys by table, skips synthetic rows, and looks usage up by bare key", () => {
    const sites = sitesOfEventFields(
      {
        event: [entry("trigger", "supported"), entry("base", "unsupported")],
        option: [
          entry("trigger", "supported"),
          entry("name", "partial", { unsupportedForms: ["repeated names", "blocks"] }),
          entry("alias_name[effect]", "supported", { synthetic: true }),
        ],
      },
      usageOf({ trigger: 7, name: 2 })
    );
    expect(sites.map(row)).toEqual([
      { key: "event.base", class: "gap", reason: "base reason", used: 0 },
      { key: "event.trigger", class: "policy-owned", reason: "trigger reason", used: 7 },
      {
        key: "option.name",
        class: "partial",
        reason: "name reason",
        droppedArms: ["repeated names", "blocks"],
        used: 2,
      },
      { key: "option.trigger", class: "policy-owned", reason: "trigger reason", used: 7 },
    ]);
  });
});

describe("rerootPath", () => {
  const roots = [
    { prefix: "situation_type.", replacement: "" },
    { prefix: "planet_initializer.", replacement: "planet." },
  ];

  it("strips the registry prefix and maps a category onto its member key", () => {
    expect(rerootPath("situation_type.stages.icon", roots)).toBe("stages.icon");
    expect(rerootPath("planet_initializer.change_orbit", roots)).toBe("planet.change_orbit");
  });

  it("leaves a bare name and a splice row unchanged", () => {
    expect(rerootPath("resources", roots)).toBe("resources");
    expect(rerootPath("alias_name[modifier]", roots)).toBe("alias_name[modifier]");
  });
});

describe("sitesOfRegistry", () => {
  const input: RegistryCoverageInput = {
    registry: "building",
    emitted: ["cost", "upgrades_to", "planet.class"],
    omissions: [
      { path: "change_orbit", kind: "declined", reason: "positional sugar" },
      { path: "resources", kind: "unsupported", reason: "no declaration the emitter can lower" },
      { path: "old_field", kind: "unsupported", reason: "repeated-struct overlay is incomplete" },
      { path: "localisation.title", kind: "collapsed", reason: "duplicates name" },
    ],
    splices: new Map([["modifier", new Set(["pop_growth", "unused_modifier"])]]),
    corpus: new Map([
      ["cost", 40],
      ["change_orbit", 3],
      ["resources", 30],
      ["inline_script", 285],
      ["mystery", 2],
      ["pop_growth", 12],
    ]),
    acknowledged: [
      {
        registry: "building",
        field: "inline_script",
        count: 285,
        reason: "macro",
        issue: "SDK-17",
      },
      {
        registry: "building",
        field: "resources",
        count: 30,
        reason: "block shape",
        issue: "SDK-62",
      },
    ],
    formMismatches: [
      {
        registry: "building",
        field: "upgrades_to",
        kind: "form",
        family: "rules-omit-form",
        rationale: "one design writes a block",
      },
    ],
  };

  it("builds one site per emitted field, omission, splice, and corpus-only path", () => {
    expect(sitesOfRegistry(input).map(row)).toEqual([
      {
        key: "alias_name[modifier]",
        class: "authorable",
        reason: "alias category spliced unkeyed at the top level",
        used: 12,
      },
      { key: "change_orbit", class: "declined", reason: "positional sugar", used: 3 },
      { key: "cost", class: "authorable", reason: "generated from the rules", used: 40 },
      { key: "inline_script", class: "gap", reason: "macro", issue: "SDK-17", used: 285 },
      {
        key: "mystery",
        class: "gap",
        reason: "observed in vanilla with no lowered declaration",
        used: 2,
      },
      {
        key: "old_field",
        class: "gap",
        reason: "repeated-struct overlay is incomplete",
        used: 0,
      },
      { key: "planet.class", class: "authorable", reason: "generated from the rules", used: 0 },
      { key: "resources", class: "gap", reason: "block shape", issue: "SDK-62", used: 30 },
      {
        key: "upgrades_to",
        class: "partial",
        reason: "rules-omit-form: one design writes a block",
        used: 0,
      },
    ]);
  });

  it("throws on a path both emitted and omitted", () => {
    expect(() =>
      sitesOfRegistry({
        ...input,
        omissions: [
          { path: "cost", kind: "declined", reason: "r" },
          { path: "planet.class", kind: "unsupported", reason: "r" },
        ],
        acknowledged: [],
        formMismatches: [],
      })
    ).toThrow(
      "registry sites contradict the emission:\n" +
        "  building cost: emitted and declined\n" +
        "  building planet.class: emitted and unsupported"
    );
  });

  it("throws on an acknowledged gap that names no gap site", () => {
    expect(() =>
      sitesOfRegistry({
        ...input,
        acknowledged: [
          { registry: "building", field: "cost", count: 1, reason: "r", issue: "SDK-1" },
        ],
      })
    ).toThrow("building.cost: acknowledged gap names no gap site");
  });

  it("throws on a form mismatch that names no emitted site", () => {
    expect(() =>
      sitesOfRegistry({
        ...input,
        formMismatches: [
          {
            registry: "building",
            field: "gone",
            kind: "form",
            family: "rules-omit-form",
            rationale: "r",
          },
        ],
      })
    ).toThrow("building.gone: form mismatch names no emitted site");
  });
});

/** A site with only the fields the summary reads. */
function siteOf(
  key: string,
  cls: CoverageClass,
  used: number,
  surface: CoverageSurface["id"] = "triggers"
): CoverageSite {
  return { surface, key, class: cls, reason: `${key} reason`, used };
}

describe("summarizeCoverage", () => {
  const triggers: CoverageSurface = {
    id: "triggers",
    label: "triggers",
    sites: [
      siteOf("a", "authorable", 10),
      siteOf("b", "policy-owned", 5),
      siteOf("c", "gap", 5),
      siteOf("d", "removed", 100),
      siteOf("e", "gap", 0),
    ],
  };
  const building: CoverageSurface = {
    id: "registry:building",
    label: "building",
    sites: [
      siteOf("cost", "authorable", 40, "registry:building"),
      siteOf("x", "declined", 10, "registry:building"),
      { ...siteOf("y", "partial", 10, "registry:building"), droppedArms: ["blocks"] },
    ],
  };
  const agenda: CoverageSurface = {
    id: "registry:agenda",
    label: "agenda",
    sites: [siteOf("z", "removed", 1, "registry:agenda")],
  };

  it("counts every class, excludes removed sites from both denominators, and weighs by usage", () => {
    const report = summarizeCoverage([building, agenda, triggers]);
    const [first] = report.surfaces;
    expect(first?.summary).toEqual({
      label: "triggers",
      sites: 5,
      counts: { authorable: 1, "policy-owned": 1, declined: 0, partial: 0, gap: 2, removed: 1 },
      declared: 2 / 4,
      used: 15 / 20,
    });
    expect(first?.remainder.map((site) => [site.key, site.used])).toEqual([
      ["d", 100],
      ["c", 5],
      ["e", 0],
    ]);
  });

  it("orders script surfaces first, then registries by label", () => {
    const report = summarizeCoverage([building, agenda, triggers]);
    expect(report.surfaces.map((surface) => surface.summary.label)).toEqual([
      "triggers",
      "agenda",
      "building",
    ]);
  });

  it("aggregates the registries once and everything overall", () => {
    const report = summarizeCoverage([building, agenda, triggers]);
    expect(report.registries).toEqual({
      label: "registries (all)",
      sites: 4,
      counts: { authorable: 1, "policy-owned": 0, declined: 1, partial: 1, gap: 0, removed: 1 },
      declared: 1 / 3,
      used: 40 / 60,
    });
    expect(report.overall).toEqual({
      label: "overall",
      sites: 9,
      counts: { authorable: 2, "policy-owned": 1, declined: 1, partial: 1, gap: 2, removed: 2 },
      declared: 3 / 7,
      used: 55 / 80,
    });
  });

  it("gives null ratios where a denominator is zero", () => {
    const report = summarizeCoverage([agenda]);
    expect(report.overall.declared).toBeNull();
    expect(report.overall.used).toBeNull();
    const unused = summarizeCoverage([
      { id: "triggers", label: "triggers", sites: [siteOf("a", "gap", 0)] },
    ]);
    expect(unused.overall.declared).toBe(0);
    expect(unused.overall.used).toBeNull();
  });

  it("throws on a surface given twice", () => {
    expect(() => summarizeCoverage([triggers, triggers])).toThrow(
      "surface triggers is given twice"
    );
  });
});

describe("formatCoverageReport", () => {
  const report = summarizeCoverage([
    {
      id: "registry:building",
      label: "building",
      sites: [
        siteOf("cost", "authorable", 40, "registry:building"),
        { ...siteOf("inline_script", "gap", 285, "registry:building"), issue: "SDK-17" },
        siteOf("change_orbit", "declined", 3, "registry:building"),
        {
          ...siteOf("picture", "partial", 1, "registry:building"),
          droppedArms: ["blocks", "lists"],
        },
        siteOf("mystery", "gap", 1, "registry:building"),
      ],
    },
    {
      id: "triggers",
      label: "triggers",
      sites: [
        siteOf("always", "authorable", 1000),
        siteOf("and", "policy-owned", 100),
        siteOf("has_pop_flag", "removed", 0),
      ],
    },
  ]);

  it("prints the table, the caveat, and every remainder with its heading", () => {
    expect(formatCoverageReport(report, PROVENANCE)).toEqual([
      "syntax coverage: cwtools-stellaris-config @ 0123456789ab; vanilla 4.4.6 (corpus fixture)",
      "",
      "surface                          declared     used  sites authorable policy declined partial   gap removed",
      "triggers                           100.0%   100.0%      3          1      1        0       0     0       1",
      "building                            20.0%    12.1%      5          1      0        1       1     2       0",
      "registries (all)                    20.0%    12.1%      5          1      0        1       1     2       0",
      "overall                             42.9%    79.7%      8          2      1        1       1     2       1",
      "(used weights are key occurrences for script surfaces and definitions for registries; overall mixes them)",
      "folders without a CWT type: 0 (0 definitions) — not counted",
      "",
      "Remainder — triggers (1):",
      "  removed has_pop_flag — has_pop_flag reason (used 0)",
      "Remainder — building (4):",
      "  gap inline_script — SDK-17: inline_script reason (used 285)",
      "  declined change_orbit — change_orbit reason (used 3)",
      "  gap mystery — untracked: mystery reason (used 1)",
      "  partial picture — picture reason; omits blocks, lists (used 1)",
    ]);
  });

  it("prints n/a for a null ratio and an empty remainder's heading", () => {
    const empty = summarizeCoverage([
      { id: "triggers", label: "triggers", sites: [siteOf("gone", "removed", 4)] },
    ]);
    const lines = formatCoverageReport(empty, PROVENANCE);
    expect(lines[3]).toBe(
      "triggers                              n/a      n/a      1          0      0        0       0     0       1"
    );
    expect(lines.slice(-2)).toEqual([
      "Remainder — triggers (1):",
      "  removed gone — gone reason (used 4)",
    ]);
    const none = summarizeCoverage([
      { id: "effects", label: "effects", sites: [siteOf("ok", "authorable", 1, "effects")] },
    ]);
    expect(formatCoverageReport(none, PROVENANCE).at(-1)).toBe("Remainder — effects (0):");
  });
});

describe("sitesOfUnexposedType", () => {
  const input: UnexposedTypeInput = {
    type: "deposit",
    path: "common/deposits",
    fields: ["icon", "category", "alias_name[modifier]"],
    referenceable: true,
    definitions: 300,
    usage: new Map([
      ["icon", 290],
      ["category", 12],
      ["unknown_key", 7],
    ]),
  };

  it("gives one gap site per declared field, weighted from the fixture", () => {
    expect(sitesOfUnexposedType(input).map(row)).toEqual([
      {
        key: "alias_name[modifier]",
        class: "gap",
        reason:
          "registry not exposed (no manifest row); referenceable through vanilla.* but not authorable",
        used: 300,
      },
      {
        key: "category",
        class: "gap",
        reason:
          "registry not exposed (no manifest row); referenceable through vanilla.* but not authorable",
        used: 12,
      },
      {
        key: "icon",
        class: "gap",
        reason:
          "registry not exposed (no manifest row); referenceable through vanilla.* but not authorable",
        used: 290,
      },
    ]);
  });

  it("weighs a splice site by every definition of the type", () => {
    const [site] = sitesOfUnexposedType({
      ...input,
      fields: ["alias_name[trigger]"],
      definitions: 1618,
      usage: new Map(),
    });
    expect(site?.key).toBe("alias_name[trigger]");
    expect(site?.used).toBe(1618);
  });

  it("gives one site for a type with no declared fields, weighted by its definitions", () => {
    const sites = sitesOfUnexposedType({ ...input, fields: [], referenceable: false });
    expect(sites.map(row)).toEqual([
      {
        key: "deposit",
        class: "gap",
        reason:
          "registry not exposed (no manifest row); the body declares no fields, so the type is the site",
        used: 300,
      },
    ]);
  });

  it("owns a type whose folder the SDK writes through a channel", () => {
    const sites = sitesOfUnexposedType({ ...input, type: "on_action", path: "common/on_actions" });
    expect(sites.map((site) => site.class)).toEqual([
      "policy-owned",
      "policy-owned",
      "policy-owned",
    ]);
    expect(sites[0]?.reason).toContain("mod.on");
  });

  it("declines a scripted-definition folder the SDK replaces with TypeScript", () => {
    const sites = sitesOfUnexposedType({
      ...input,
      type: "scripted_trigger",
      path: "common/scripted_triggers",
    });
    expect(sites.map((site) => site.class)).toEqual(["declined", "declined", "declined"]);
    expect(sites[0]?.reason).toContain("a TypeScript function (or constant) replaces");
  });

  it("refuses a type another surface counts", () => {
    expect(() => sitesOfUnexposedType({ ...input, type: "event" })).toThrow(
      "event is counted by event fields surface; it is not an unexposed type"
    );
  });
});

describe("declaredTopLevelFields", () => {
  it("collects named keys, subtype members, and alias splices, and skips computed keys", () => {
    const named = (name: string) => ({
      key: { kind: "name" as const, name },
      type: { kind: "scalar" as const, text: "int" },
      cardinality: { min: 0, max: 1 },
      docs: [],
      scope: null,
    });
    const body = {
      fields: [
        named("b"),
        named("a"),
        {
          ...named("subtype"),
          key: { kind: "subtype" as const, name: "x", negated: false },
          type: { kind: "block" as const, fields: [named("c"), named("a")] },
        },
        { ...named("splice"), key: { kind: "aliasName" as const, category: "modifier" } },
        {
          ...named("computed"),
          key: { kind: "computed" as const, type: { kind: "scalar" as const, text: "enum[x]" } },
        },
      ],
      scope: null,
      file: "x.cwt",
    };
    expect(declaredTopLevelFields(body as never)).toEqual(["a", "alias_name[modifier]", "b", "c"]);
    expect(declaredTopLevelFields(undefined)).toEqual([]);
  });
});

describe("grouped surfaces", () => {
  const report = summarizeCoverage([
    { id: "triggers", label: "triggers", sites: [siteOf("always", "authorable", 10)] },
    {
      id: "registry:building",
      label: "building",
      sites: [siteOf("cost", "authorable", 40, "registry:building")],
    },
    {
      id: "registry:deposit",
      label: "deposit",
      group: "registries not exposed",
      sites: [siteOf("icon", "gap", 290, "registry:deposit")],
    },
    {
      id: "registry:army",
      label: "army",
      group: "registries not exposed",
      sites: [siteOf("damage", "gap", 5, "registry:army")],
    },
  ]);

  it("folds grouped surfaces into one row and keeps every remainder", () => {
    expect(report.surfaces.map((surface) => surface.summary.label)).toEqual([
      "triggers",
      "building",
    ]);
    expect(report.groups.map((group) => group.summary)).toEqual([
      {
        label: "registries not exposed",
        sites: 2,
        counts: { authorable: 0, "policy-owned": 0, declined: 0, partial: 0, gap: 2, removed: 0 },
        declared: 0,
        used: 0,
      },
    ]);
    expect(report.groups[0]?.surfaces.map((surface) => surface.summary.label)).toEqual([
      "army",
      "deposit",
    ]);
    expect(report.registries.sites).toBe(3);
    expect(report.overall.sites).toBe(4);
  });

  it("prints the group row before the totals, the caveat, and every member's remainder", () => {
    const lines = formatCoverageReport(report, {
      ...PROVENANCE,
      foldersWithoutType: [
        { path: "common/inline_scripts", definitions: 2371 },
        { path: "common/name_lists", definitions: 40 },
        { path: "common/a", definitions: 3 },
        { path: "common/b", definitions: 3 },
        { path: "common/c", definitions: 2 },
        { path: "common/d", definitions: 1 },
      ],
    });
    expect(lines.slice(3, 11)).toEqual([
      "triggers                           100.0%   100.0%      1          1      0        0       0     0       0",
      "building                           100.0%   100.0%      1          1      0        0       0     0       0",
      "registries not exposed               0.0%     0.0%      2          0      0        0       0     2       0",
      "registries (all)                    33.3%    11.9%      3          1      0        0       0     2       0",
      "overall                             50.0%    14.5%      4          2      0        0       0     2       0",
      "(used weights are key occurrences for script surfaces and definitions for registries; overall mixes them)",
      "folders without a CWT type: 6 (2420 definitions) — not counted: common/inline_scripts (2371), common/name_lists (40), common/a (3), common/b (3), common/c (2)",
      "",
    ]);
    expect(lines.slice(11)).toEqual([
      "Remainder — triggers (0):",
      "Remainder — building (0):",
      "Remainder — army (1):",
      "  gap damage — untracked: damage reason (used 5)",
      "Remainder — deposit (1):",
      "  gap icon — untracked: icon reason (used 290)",
    ]);
  });
});

describe("determinism", () => {
  it("gives identical lines whatever order the inputs arrive in", () => {
    const sites = [
      siteOf("b", "gap", 2),
      siteOf("a", "authorable", 9),
      siteOf("c", "gap", 2),
      siteOf("d", "removed", 1),
    ];
    const registry = [
      siteOf("y", "declined", 1, "registry:r"),
      siteOf("x", "authorable", 3, "registry:r"),
    ];
    const render = (order: readonly CoverageSurface[]): string[] =>
      formatCoverageReport(summarizeCoverage(order), PROVENANCE);
    const forward = render([
      { id: "triggers", label: "triggers", sites },
      { id: "registry:r", label: "r", sites: registry },
    ]);
    const shuffled = render([
      { id: "registry:r", label: "r", sites: [...registry].reverse() },
      { id: "triggers", label: "triggers", sites: [...sites].reverse() },
    ]);
    expect(shuffled).toEqual(forward);
  });

  it("orders a registry's sites by key whatever order the inputs arrive in", () => {
    const input: RegistryCoverageInput = {
      registry: "r",
      emitted: ["b", "a"],
      omissions: [{ path: "d", kind: "unsupported", reason: "r" }],
      splices: new Map(),
      corpus: new Map([
        ["e", 1],
        ["c", 2],
      ]),
      acknowledged: [],
      formMismatches: [],
    };
    const reversed: RegistryCoverageInput = {
      ...input,
      emitted: ["a", "b"],
      corpus: new Map([
        ["c", 2],
        ["e", 1],
      ]),
    };
    expect(sitesOfRegistry(reversed)).toEqual(sitesOfRegistry(input));
    expect(sitesOfRegistry(input).map((site) => site.key)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("coverageOf", () => {
  /** One site of every surface, with one remainder on most of them. */
  const inputs: CoverageInputs = {
    triggers: {
      declared: ["always", "gone"],
      emitted: ["always"],
      skipped: [skippedRule("gone", "removed-api", "declared removed")],
    },
    effects: {
      declared: ["if", "switch"],
      emitted: [],
      skipped: [
        skippedRule("if", "structural-effect", "control flow"),
        skippedRule("switch", "structural-effect", "control flow"),
      ],
    },
    fireSkips: [],
    scriptGaps: NO_GAPS,
    modifiers: {
      universal: ["b_universal"],
      groups: new Map([["country", ["a_country"]]]),
      unscoped: ["c_unscoped"],
      unknownCategories: [],
      unknownScopeTokens: [],
      dynamicFamilies: [],
      categoryScopes: new Map(),
    },
    declaredLinks: ["owner", "target"],
    links: {
      links: [{ key: "owner", method: "owner", inputScopes: [], outputScope: "country", docs: [] }],
      skipped: [skippedRule("target", "polymorphic-output-scope", "any")],
      navigation: new Map(),
    },
    eventFields: {
      event: [{ scriptKey: "id", shape: "scalar 1", disposition: "supported", reason: "the id" }],
      option: [],
    },
    ownership: OWNERSHIP,
    registries: [
      {
        registry: "building",
        emitted: ["cost"],
        omissions: [{ path: "resources", kind: "unsupported", reason: "block shape" }],
        splices: new Map(),
        corpus: new Map([
          ["cost", 40],
          ["resources", 30],
        ]),
        acknowledged: [
          {
            registry: "building",
            field: "resources",
            count: 30,
            reason: "block shape",
            issue: "SDK-62",
          },
        ],
        formMismatches: [],
      },
    ],
    unexposedTypes: [
      {
        type: "deposit",
        path: "common/deposits",
        fields: ["icon"],
        referenceable: false,
        definitions: 300,
        usage: new Map([["icon", 290]]),
      },
      {
        type: "on_action",
        path: "common/on_actions",
        fields: ["events"],
        referenceable: false,
        definitions: 50,
        usage: new Map([["events", 50]]),
      },
    ],
    scriptUsage: usageOf({ always: 1000, gone: 2, if: 10, switch: 1, a_country: 4 }),
    eventUsage: usageOf({ id: 7 }),
    linkUsage: usageOf({ owner: 9, target: 3 }),
    provenance: PROVENANCE,
  };

  it("builds every surface, the group row, and the remainders", () => {
    const { report, lines } = coverageOf(inputs);
    expect(report.surfaces.map((surface) => surface.summary.label)).toEqual([
      "triggers",
      "effects",
      "modifiers",
      "scope links",
      "event fields",
      "building",
    ]);
    expect(lines.slice(3, 12)).toEqual([
      "triggers                           100.0%   100.0%      2          1      0        0       0     0       1",
      "effects                             50.0%    90.9%      2          0      1        0       0     1       0",
      "modifiers                           66.7%   100.0%      3          2      0        0       0     1       0",
      "scope links                        100.0%   100.0%      2          1      1        0       0     0       0",
      "event fields                       100.0%   100.0%      1          0      1        0       0     0       0",
      "building                            50.0%    57.1%      2          1      0        0       0     1       0",
      "registries not exposed              50.0%    14.7%      2          0      1        0       0     1       0",
      "registries (all)                    50.0%    22.0%      4          1      1        0       0     2       0",
      "overall                             69.2%    77.8%     14          5      4        0       0     4       1",
    ]);
    expect(lines.slice(15)).toEqual([
      "Remainder — triggers (1):",
      "  removed gone — declared removed (used 2)",
      "Remainder — effects (1):",
      "  gap switch — untracked: control flow (used 1)",
      "Remainder — modifiers (1):",
      "  gap c_unscoped — untracked: no scope evidence in modifier categories (drift-gated) (used 0)",
      "Remainder — scope links (0):",
      "Remainder — event fields (0):",
      "Remainder — building (1):",
      "  gap resources — SDK-62: block shape (used 30)",
      "Remainder — deposit (1):",
      "  gap icon — untracked: registry not exposed (no manifest row) (used 290)",
      "Remainder — on_action (0):",
    ]);
  });

  it("gives identical lines whatever order the input lists arrive in", () => {
    const reverse = <T>(list: readonly T[]): T[] => [...list].reverse();
    const shuffled: CoverageInputs = {
      ...inputs,
      triggers: { ...inputs.triggers, declared: reverse([...inputs.triggers.declared]) },
      effects: { ...inputs.effects, skipped: reverse(inputs.effects.skipped) },
      declaredLinks: reverse([...inputs.declaredLinks]),
      registries: inputs.registries.map((registry) => ({
        ...registry,
        corpus: new Map(reverse([...registry.corpus])),
      })),
      unexposedTypes: reverse(inputs.unexposedTypes),
    };
    expect(coverageOf(shuffled).lines).toEqual(coverageOf(inputs).lines);
  });
});
