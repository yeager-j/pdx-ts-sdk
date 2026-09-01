/**
 * SDK-261: `loadRules` reads every `RULE_FILES` entry through `buildRuleSet`
 * in three passes, so that phase 2 (single aliases, content types) is
 * complete before phase 3 (everything that resolves against them) reads any
 * file. Before that change, a single pass resolved a `single_alias` or a
 * split `type[x]`/body declaration only if the file that declared it had
 * already been read, so `RULE_FILES`' hand-written order silently doubled as
 * a dependency order. This file proves the two-phase load no longer depends
 * on file order, against the real rules and against a synthetic, order-rigged
 * pair of files.
 *
 * SDK-357: the same claim also needs the tables holding one declaration per
 * key. They used to let the last file read win, so a colliding declaration
 * silently made file order load-bearing again. They now throw. A repeat inside
 * a single file is caught the same way, since the readers hand over every
 * declaration they read rather than a map that would have collapsed it first.
 * Two repeats are accepted, both because they say the same thing: an enum
 * redeclared with the same member set, and any other declaration repeated with
 * equal content.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { cwtFiles, parseRuleSources } from "@pdx-ts/codegen-cwt/cwt/load";
import type { SingleAliasTarget } from "@pdx-ts/codegen-cwt/cwt/model";
import { parseCwt } from "@pdx-ts/codegen-cwt/cwt/parser";
import {
  buildRuleSet,
  readAliases,
  type AliasDecl,
  type ParsedRuleFile,
  type RuleSet,
} from "@pdx-ts/codegen-cwt/cwt/rules";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { EXTRA_ALIAS_CATEGORIES } from "@pdx-ts/codegen-cwt/overlay";
import { CONTENT_MANIFEST } from "@pdx-ts/codegen-cwt/policy/manifest";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");

function file(name: string, source: string): ParsedRuleFile {
  return { file: name, parsed: parseCwt(source, name) };
}

// `declares.cwt` defines a single_alias and the `type[...]` half of a split
// type/body declaration. `consumes.cwt` references the single_alias via
// `single_alias_right` and supplies the type's body. Under the old single
// pass, whichever of the two files loaded second could see what the other
// declared; whichever loaded first could not — exactly the constraint
// `RULE_FILES`' old comments ("loaded ahead of their registries") admitted.
const declares = file(
  "declares.cwt",
  [
    "single_alias[my_clause] = {",
    "\tflag = bool",
    "}",
    "types = {",
    "\ttype[my_type] = {",
    '\t\tpath = "common/my_types"',
    "\t}",
    "}",
  ].join("\n")
);
const consumes = file(
  "consumes.cwt",
  [
    "alias[trigger:my_trigger] = single_alias_right[my_clause]",
    "my_type = {",
    "\tflag = bool",
    "}",
  ].join("\n")
);

describe("buildRuleSet order independence", () => {
  it("resolves a single_alias and a split type/body the same way regardless of file order", () => {
    const forward = buildRuleSet([declares, consumes]);
    const reversed = buildRuleSet([consumes, declares]);

    expect(reversed.triggers).toEqual(forward.triggers);
    expect(reversed.bodies).toEqual(forward.bodies);

    // Both orders actually resolve, rather than both trivially failing the
    // same way — the assertion above alone would also pass if neither order
    // resolved anything.
    expect(forward.triggers.get("my_trigger")?.[0]?.type.kind).toBe("block");
    expect(forward.bodies.get("my_type")).toEqual({
      fields: expect.any(Array),
      scope: null,
      file: "consumes.cwt",
    });
  });

  it("would have failed under the old single pass: readAliases cannot resolve a single_alias it has not read yet", () => {
    // Reproduces exactly what the old single-pass loop did when `consumes.cwt`
    // was read before `declares.cwt`: the alias reader is handed an empty
    // single-alias table because nothing has read `declares.cwt` yet.
    const withoutDeclares = readAliases(
      consumes.parsed.nodes,
      consumes.file,
      "trigger",
      new Map<string, SingleAliasTarget>()
    ).aliases;
    expect(withoutDeclares.get("my_trigger")?.[0]?.type.kind).toBe("singleAliasRight");

    // `buildRuleSet` never lets that happen: phase 2 reads every file's
    // single aliases before phase 3 resolves against them, so the same
    // reference comes out expanded regardless of which file loads first (see
    // the test above).
    const resolved = buildRuleSet([consumes, declares]).triggers.get("my_trigger")?.[0];
    expect(resolved?.type.kind).toBe("block");
  });

  it("retains parser diagnostics from secondary complex-enum files", () => {
    const secondary = file("secondary.cwt", "## cardinality 0..1\nfield = bool");

    expect(buildRuleSet([], [secondary]).diagnostics).toEqual([
      { kind: "malformed-option", file: "secondary.cwt", line: 1, text: "## cardinality 0..1" },
    ]);
  });

  // Every table holding one declaration per key. `triggers`, `effects`,
  // `aliasCategories`, `onActions` and `modifierTemplates` are left out on
  // purpose: they accumulate in file order by design, so reversing the files
  // reverses them.
  const SINGLE_DECLARATION_TABLES = [
    "enums",
    "complexEnums",
    "scopes",
    "scopeGroups",
    "links",
    "contentTypes",
    "bodies",
    "modifierCategories",
    "modifierDecls",
  ] as const satisfies readonly (keyof RuleSet)[];

  it("assembles the real rule files into the same tables in either file order", () => {
    const sources = parseRuleSources(
      CONFIG,
      CONTENT_MANIFEST.map((entry) => entry.source)
    );
    const categories = [...EXTRA_ALIAS_CATEGORIES.keys()];
    const forward = buildRuleSet(sources.ruleFiles, sources.complexEnumFiles, categories);
    const reversed = buildRuleSet(
      [...sources.ruleFiles].reverse(),
      [...sources.complexEnumFiles].reverse(),
      categories
    );

    for (const table of SINGLE_DECLARATION_TABLES) {
      expect(reversed[table], table).toEqual(forward[table]);
    }
    expect(forward.contentTypes.size).toBeGreaterThan(0);
  });
});

/**
 * Two files declaring one key, for a table that holds a single declaration.
 * `first.cwt` and `second.cwt` are read in both orders, so the error must name
 * whichever file was read first as the owner.
 */
interface ConflictCase {
  /** The rule set table the collision lands in. */
  readonly table: string;
  /** The key both files declare. */
  readonly key: string;
  /** `first.cwt`'s source. */
  readonly first: string;
  /** `second.cwt`'s source, declaring `key` with different content. */
  readonly second: string;
}

const CONFLICTS: readonly ConflictCase[] = [
  {
    table: "enums",
    key: "hull_class",
    first: ["enums = {", "\tenum[hull_class] = {", "\t\tcorvette", "\t}", "}"].join("\n"),
    second: ["enums = {", "\tenum[hull_class] = {", "\t\tcruiser", "\t}", "}"].join("\n"),
  },
  {
    table: "scopes",
    key: "Colony",
    first: ["scopes = {", "\tColony = {", "\t\taliases = { colony }", "\t}", "}"].join("\n"),
    second: ["scopes = {", "\tColony = {", "\t\taliases = { settlement }", "\t}", "}"].join("\n"),
  },
  {
    table: "links",
    key: "capital_world",
    first: [
      "links = {",
      "\tcapital_world = {",
      "\t\tinput_scopes = { country }",
      "\t\toutput_scope = planet",
      "\t}",
      "}",
    ].join("\n"),
    second: [
      "links = {",
      "\tcapital_world = {",
      "\t\tinput_scopes = { country }",
      "\t\toutput_scope = system",
      "\t}",
      "}",
    ].join("\n"),
  },
  {
    table: "singleAliases",
    key: "my_clause",
    first: ["single_alias[my_clause] = {", "\tflag = bool", "}"].join("\n"),
    second: ["single_alias[my_clause] = {", "\tcount = int", "}"].join("\n"),
  },
  {
    table: "contentTypes",
    key: "my_type",
    first: ["types = {", "\ttype[my_type] = {", '\t\tpath = "common/first"', "\t}", "}"].join("\n"),
    second: ["types = {", "\ttype[my_type] = {", '\t\tpath = "common/second"', "\t}", "}"].join(
      "\n"
    ),
  },
  {
    table: "bodies",
    key: "my_type",
    // The `type[...]` half sits in `first.cwt` so both files can supply a body
    // for it; content types are read from every file before any body is.
    first: [
      "types = {",
      "\ttype[my_type] = {",
      '\t\tpath = "common/my_types"',
      "\t}",
      "}",
      "my_type = {",
      "\tflag = bool",
      "}",
    ].join("\n"),
    second: ["my_type = {", "\tcount = int", "}"].join("\n"),
  },
];

/** The message `build` threw, for assertions that read it rather than match it. */
function messageFrom(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the rule set assembly to throw");
}

/** The conflict message, with each site's line left open. */
function conflictPattern(table: string, key: string, owner: string, other: string): RegExp {
  const at = (file: string): string => `${file.replaceAll(".", "\\.")}:(\\d+)`;
  return new RegExp(
    `${table} key "${key}" is declared by ${at(owner)} and declared again by ${at(other)};`
  );
}

describe("colliding declarations", () => {
  it.each(CONFLICTS)("reject a second $table declaration of $key", (conflict) => {
    const first = file("first.cwt", conflict.first);
    const second = file("second.cwt", conflict.second);
    const { table, key } = conflict;

    expect(() => buildRuleSet([first, second])).toThrow(
      conflictPattern(table, key, "first.cwt", "second.cwt")
    );
    expect(() => buildRuleSet([second, first])).toThrow(
      conflictPattern(table, key, "second.cwt", "first.cwt")
    );
  });

  it.each(CONFLICTS)("reject a repeated $table declaration of $key inside one file", (conflict) => {
    // The readers used to return one map per file, so a file declaring a key
    // twice collapsed it to the last declaration before the collision check saw
    // either — the same silent last-wins, one level down. Concatenating the two
    // sources of the case above puts both declarations in a single file.
    const both = file("only.cwt", `${conflict.first}\n${conflict.second}`);
    const message = messageFrom(() => buildRuleSet([both]));
    const sites = conflictPattern(conflict.table, conflict.key, "only.cwt", "only.cwt").exec(
      message
    );

    expect(sites, message).not.toBeNull();
    // Both declarations are named, rather than the first one named twice.
    expect(sites![1]).not.toBe(sites![2]);
  });

  it("accept an enum redeclared with the same members in another order", () => {
    // What `enums.cwt` and `common/governments.cwt` do to `election_type`.
    const listedSource = [
      "enums = {",
      "\tenum[election_type] = {",
      "\t\tnone",
      "\t\tdemocratic",
      "\t\toligarchic",
      "\t}",
      "}",
    ].join("\n");
    const reorderedSource = [
      "enums = {",
      "\tenum[election_type] = {",
      "\t\tnone",
      "\t\toligarchic",
      "\t\tdemocratic",
      "\t}",
      "}",
    ].join("\n");
    const listed = file("listed.cwt", listedSource);
    const reordered = file("reordered.cwt", reorderedSource);
    const sorted = ["democratic", "none", "oligarchic"];

    expect(buildRuleSet([listed, reordered]).enums.get("election_type")).toEqual(sorted);
    expect(buildRuleSet([reordered, listed]).enums.get("election_type")).toEqual(sorted);

    // The same enum, listed both ways inside one file.
    const inOneFile = file("both.cwt", `${listedSource}\n${reorderedSource}`);
    expect(buildRuleSet([inOneFile]).enums.get("election_type")).toEqual(sorted);
  });

  it("accept a declaration repeated with equal content", () => {
    // What `scopes.cwt` does to `Design`, declaring it identically at lines 60
    // and 102. Nothing about the result can depend on which declaration is
    // kept, so the repeat is accepted rather than reported.
    const twice = file(
      "scopes.cwt",
      [
        "scopes = {",
        "\tDesign = {",
        "\t\taliases = { design }",
        "\t}",
        "\tDesign = {",
        "\t\taliases = { design }",
        "\t}",
        "}",
      ].join("\n")
    );

    expect(buildRuleSet([twice]).scopes.get("Design")).toEqual(["design"]);
  });
});

describe("the CWT file sweep spells paths portably", () => {
  // `path.join` would spell these with `\` on Windows, where two things break
  // at once: the sweep stops recognising the `/`-spelled entries the primary
  // load already covers, and a parse diagnostic reaches the drift baseline
  // under a spelling no other platform produces. Both are invisible on a
  // POSIX runner, so the separator is asserted rather than inferred.
  it("returns nested files as `/`-separated relative paths", () => {
    const nested = cwtFiles(CONFIG).filter((file) => file.includes("/"));

    expect(nested.length).toBeGreaterThan(0);
    expect(cwtFiles(CONFIG).filter((file) => file.includes("\\"))).toEqual([]);
    expect(nested).toContain("events/events.cwt");
  });

  it("spells every swept path the way the primary rule list does", () => {
    // The sweep's dedup is a plain `Set.has`, so a spelling difference silently
    // re-parses every file the primary load already read.
    const swept = new Set(cwtFiles(CONFIG));

    expect(swept.has("common/governments.cwt")).toBe(true);
    expect(swept.has("modifier_categories.cwt")).toBe(true);
  });

  it("gives every diagnostic a portable source file", () => {
    for (const diagnostic of loadRules(CONFIG).diagnostics) {
      expect(diagnostic.file).not.toContain("\\");
    }
  });
});

describe("loadRules against the real rules", () => {
  const rules = loadRules(CONFIG);

  it("still yields the pinned source-count shape", () => {
    // Same counts tests/reconcile.test.ts pins; repeated here so this file's
    // own order-independence claim is checked against the real, full-size
    // load, not only the synthetic pair above.
    expect(rules.triggers.size).toBe(1082);
    expect(rules.effects.size).toBe(1058);
    expect([...rules.triggers.values()].flat()).toHaveLength(1133);
  });

  it("reads the ## api_status annotation onto each declaration", () => {
    const statusOf = (
      table: ReadonlyMap<string, readonly AliasDecl[]>,
      key: string
    ): (string | null)[] => table.get(key)!.map((declaration) => declaration.apiStatus);

    expect(statusOf(rules.triggers, "has_pop_flag")).toEqual(["removed"]);
    expect(statusOf(rules.effects, "pop_event")).toEqual(["removed"]);
    expect(statusOf(rules.effects, "ai_trade_facility")).toEqual(["kept"]);
    expect(statusOf(rules.effects, "run_in_ai_mode")).toEqual(["kept"]);
    expect(statusOf(rules.triggers, "has_country_flag")).toEqual([null]);
  });

  it("merges the two election_type declarations to their sorted members", () => {
    // `enums.cwt:49` and `common/governments.cwt:662` declare the same three
    // members in different orders — the one repeated declaration in the whole
    // vendored config, and the reason enums tolerate an equal member set.
    expect(rules.enums.get("election_type")).toEqual(["democratic", "none", "oligarchic"]);
  });
});

describe("the ## api_status annotation", () => {
  it("rejects a value outside the closed kept/removed set", () => {
    const unknown = file(
      "unknown-status.cwt",
      ["## api_status = deprecated", "alias[trigger:legacy_rule] = $any"].join("\n")
    );

    expect(() => readAliases(unknown.parsed.nodes, unknown.file, "trigger", new Map())).toThrow(
      'unknown-status.cwt:2: unknown ## api_status value "deprecated"; expected "kept" or "removed"'
    );
  });
});
