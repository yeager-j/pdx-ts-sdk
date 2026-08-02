import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, scopeIndex } from "@pdx-ts/codegen/cwt/rules";
import { emitModifiers, joinModifierScopes } from "@pdx-ts/codegen/emit/modifiers";
import { parseModifierDocs } from "@pdx-ts/codegen/logs/modifier-docs";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");

const rules = loadRules(CONFIG);
const docs = parseModifierDocs(readFileSync(`${DOCS}/modifiers.log`, "utf8"));
const index = scopeIndex(rules);
const join = joinModifierScopes(rules, docs, (token) => index.get(token.toLowerCase()) ?? null);

describe("the modifier dump", () => {
  it("reads every entry", () => {
    expect(docs.modifiers.size).toBe(45501);
    expect(docs.malformed).toEqual([]);
  });
});

describe("the modifier scope join", () => {
  it("files the generated economic modifiers the curated rules cannot list", () => {
    expect(rules.modifierDecls.has("country_unity_produces_mult")).toBe(false);
    expect(join.universal).toContain("country_unity_produces_mult");
    const colonyNames = [...join.groups]
      .filter(([key]) => key.split(" ").includes("colony"))
      .flatMap(([, names]) => names);
    expect(colonyNames).toContain("planet_jobs_society_research_produces_mult");
  });

  it("normalises the raw game scope spellings away", () => {
    const scopes = [...join.groups.keys()].flatMap((key) => key.split(" "));
    expect(scopes).not.toContain("galacticobject");
    expect(scopes).not.toContain("spynetwork");
    // `pop_happiness` is a Pops modifier, and Pops declares `galacticobject`.
    const popsKey = [...join.groups.keys()].find((key) =>
      join.groups.get(key)!.includes("pop_happiness")
    );
    expect(popsKey!.split(" ")).toContain("system");
  });

  it("partitions every dumped name into exactly one bucket", () => {
    const grouped = [...join.groups.values()].reduce((count, names) => count + names.length, 0);
    expect(join.universal.length + grouped + join.unscoped.length).toBe(docs.modifiers.size);
    expect(join.unscoped).toEqual([]);
  });

  it("holds the version-pinned shape, so a game bump is a reviewed number change", () => {
    const emission = emitModifiers(join);
    expect(join.universal).toHaveLength(1360);
    expect(join.groups.size).toBe(29);
    expect(emission.scopes).toBe(19);
    expect(emission.names).toBe(45501);
    // 3456 per-scope path types plus exactly one for the any-scope root: every
    // subtree below it is one a per-scope root already emitted, so the recorder
    // for unscoped positions costs a single interface.
    expect(emission.trieTypes).toBe(3457);
  });
});
