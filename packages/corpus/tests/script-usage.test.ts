/**
 * The vanilla key counter, over files written to a temp directory.
 *
 * The counting rule is asserted case by case because the fixture it produces
 * is committed evidence: a rule that silently changed would move every
 * `used` weight in the coverage report with no test naming why.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import {
  countScriptKeys,
  readScriptUsage,
  scriptKeySegments,
  scriptVocabulary,
} from "../src/script-usage.ts";

function countsOf(source: string): Record<string, number> {
  const counts = new Map<string, number>();
  countScriptKeys(parse(source).items, counts);
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function installOf(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-script-usage-"));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, "utf8");
  }
  return root;
}

describe("scriptKeySegments", () => {
  it("splits a dotted path into its segments", () => {
    expect(scriptKeySegments("owner.capital_scope")).toEqual(["owner", "capital_scope"]);
  });

  it("lowercases", () => {
    expect(scriptKeySegments("NOT")).toEqual(["not"]);
  });

  it("drops a trailing optional marker", () => {
    expect(scriptKeySegments("starbase?")).toEqual(["starbase"]);
  });

  it("counts a prefixed segment as its prefix, colon kept", () => {
    expect(scriptKeySegments("parameter:foo.owner")).toEqual(["parameter:", "owner"]);
  });

  it("keeps a bare key apart from the prefixed form of the same text", () => {
    expect(scriptKeySegments("modifier")).toEqual(["modifier"]);
    expect(scriptKeySegments("modifier:x")).toEqual(["modifier:"]);
  });

  it("drops empty segments", () => {
    expect(scriptKeySegments("a..b")).toEqual(["a", "b"]);
  });
});

describe("countScriptKeys", () => {
  it("counts every entry key once per occurrence, at every depth", () => {
    expect(countsOf("a = { b = 1 b = 2 c = { b = 3 } }")).toEqual({ a: 1, b: 3, c: 1 });
  });

  it("descends into bare containers", () => {
    expect(countsOf("list = { { b = 1 } { b = 2 } }")).toEqual({ list: 1, b: 2 });
  });

  it("descends into param blocks", () => {
    expect(countsOf("[[FLAG] b = 1 ]")).toEqual({ b: 1 });
  });

  it("skips param-text regions", () => {
    expect(countsOf("[[FLAG] b = { ]")).toEqual({});
  });

  it("never counts values", () => {
    expect(countsOf("location = target\ncount = value:my_value")).toEqual({
      count: 1,
      location: 1,
    });
  });

  it("applies the segment rule to keys", () => {
    expect(countsOf("Owner.capital_scope? = { parameter:x = yes }")).toEqual({
      capital_scope: 1,
      owner: 1,
      "parameter:": 1,
    });
  });
});

describe("scriptVocabulary", () => {
  it("unions every surface, lowercased and deduplicated", () => {
    const vocabulary = scriptVocabulary({
      triggers: ["NOT", "has_flag"],
      effects: ["has_flag"],
      links: [{ name: "pop_faction_parameter", prefix: "parameter:" }],
      modifiers: ["pop_growth"],
      eventFields: ["id"],
    });
    expect([...vocabulary.keys].sort()).toEqual([
      "has_flag",
      "id",
      "not",
      "parameter:",
      "pop_faction_parameter",
      "pop_growth",
    ]);
  });

  it("adds a link's prefix as declared, colon included", () => {
    const vocabulary = scriptVocabulary({
      triggers: [],
      effects: [],
      links: [{ name: "script_value", prefix: "value:" }],
      modifiers: [],
      eventFields: [],
    });
    expect([...vocabulary.keys].sort()).toEqual(["script_value", "value:"]);
  });

  it("fingerprints the sorted list, whatever the input order", () => {
    const one = scriptVocabulary({
      triggers: ["b", "a"],
      effects: [],
      links: [],
      modifiers: [],
      eventFields: [],
    });
    const other = scriptVocabulary({
      triggers: [],
      effects: ["a"],
      links: [],
      modifiers: ["b"],
      eventFields: [],
    });
    expect(one.fingerprint).toBe(other.fingerprint);
    expect(one.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("readScriptUsage", () => {
  const files = {
    "common/a/one.txt": "x = { y = 1 }",
    "common/a/nested/two.txt": "x = 2",
    "events/e.txt": "country_event = { id = a.1 }",
    "common/README.txt": 'Prose with an unterminated "quote',
  };

  it("counts per root and recurses into subdirectories", () => {
    const usage = readScriptUsage(installOf(files), ["common", "events"]);
    expect(usage.files).toBe(4);
    expect([...usage.counts.get("common")!].sort()).toEqual([
      ["x", 2],
      ["y", 1],
    ]);
    expect([...usage.counts.get("events")!].sort()).toEqual([
      ["country_event", 1],
      ["id", 1],
    ]);
  });

  it("records a file the parser rejects and still fingerprints it", () => {
    const usage = readScriptUsage(installOf(files), ["common", "events"]);
    expect(usage.failedFiles).toEqual(["common/README.txt"]);
    const withoutProse = { ...files };
    delete (withoutProse as Record<string, string>)["common/README.txt"];
    const other = readScriptUsage(installOf(withoutProse), ["common", "events"]);
    expect(other.failedFiles).toEqual([]);
    expect(other.fingerprint).not.toBe(usage.fingerprint);
  });

  it("gives the same fingerprint for the same bytes", () => {
    expect(readScriptUsage(installOf(files), ["common", "events"]).fingerprint).toBe(
      readScriptUsage(installOf(files), ["common", "events"]).fingerprint
    );
  });

  it("keeps an empty root present", () => {
    const usage = readScriptUsage(installOf({ "common/a.txt": "x = 1" }), ["common", "events"]);
    expect(usage.counts.get("events")).toEqual(new Map());
  });
});
