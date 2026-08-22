/**
 * The doc-dump parsers' malformed-block identity, and proof that a block
 * neither parser can read reaches `npm run codegen`'s drift gate rather than
 * only `npm test`'s pinned counts (see `reconcile.ts`'s `malformedDocBlocks`
 * / `malformedModifierBlocks` and their doc comments).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules } from "@pdx-ts/codegen-cwt/load-rules";
import { parseModifierDocs } from "@pdx-ts/codegen-cwt/logs/modifier-docs";
import { parseScopeLinks } from "@pdx-ts/codegen-cwt/logs/scopes";
import { parseTriggerDocs } from "@pdx-ts/codegen-cwt/logs/trigger-docs";
import {
  compareToBaseline,
  reconcile,
  type DriftBaseline,
} from "@pdx-ts/codegen-cwt/reconcile/reconcile";
import { describe, expect, it } from "vitest";

/** The repo root, from this module — never the directory vitest was started in. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFIG = path.join(ROOT, "vendor/cwtools-stellaris-config/config");
const DOCS = path.join(ROOT, "vendor/cwtools-stellaris-config/script-docs/v4.4.1");

describe("malformed doc-dump blocks carry a re-findable identity", () => {
  it("names a trigger/effect block with no readable heading as triggers.log:<line>", () => {
    const docs = parseTriggerDocs("not a heading at all\nSupported Scopes: country\n", "");
    expect(docs.malformed).toEqual(["triggers.log:1 not a heading at all"]);
  });

  it("names an effect-side block the same way, against effects.log", () => {
    const docs = parseTriggerDocs("", "\n\nstill no heading\nSupported Scopes: country\n");
    expect(docs.malformed).toEqual(["effects.log:3 still no heading"]);
  });

  it("still reads a well-formed block cleanly, with a location on the entry", () => {
    const docs = parseTriggerDocs("has_thing - Checks a thing\nSupported Scopes: country\n", "");
    expect(docs.malformed).toEqual([]);
    expect(docs.triggers.get("has_thing")?.location).toBe("triggers.log:1");
  });

  it("names a modifier line the entry pattern cannot read as modifiers.log:<line>", () => {
    const docs = parseModifierDocs("- valid_entry, Category: Pops\n- not even close\n");
    expect(docs.malformed).toEqual(["modifiers.log:2 - not even close"]);
  });

  it("reports a final block with no terminating Supported Scopes line, instead of dropping it", () => {
    // No trailing "Supported Scopes:" line at all — a truncated dump, the one
    // shape of corruption a terminator-only flush cannot see.
    const docs = parseTriggerDocs("truncated_trigger - this block never closes\n", "");
    expect(docs.malformed).toEqual(["triggers.log:1 truncated_trigger - this block never closes"]);
    expect(docs.triggers.size).toBe(0);
  });

  it("does not report a malformed block for trailing blank or noise-only lines at EOF", () => {
    // The real dumps end this way (see the "still zero malformed entries"
    // check below) — a file that ends in padding, not a truncated block, must
    // not gain a bogus malformed entry from the EOF flush.
    const docs = parseTriggerDocs(
      "has_thing - Checks a thing\nSupported Scopes: country\n\n====\n\n",
      ""
    );
    expect(docs.malformed).toEqual([]);
    expect(docs.triggers.size).toBe(1);
  });
});

describe("a malformed doc-dump block reaches the codegen-time drift gate", () => {
  const rules = loadRules(CONFIG);
  const realDocs = parseTriggerDocs(
    readFileSync(`${DOCS}/triggers.log`, "utf8"),
    readFileSync(`${DOCS}/effects.log`, "utf8")
  );
  const modifierDocs = parseModifierDocs(readFileSync(`${DOCS}/modifiers.log`, "utf8"));
  const dumpLinks = parseScopeLinks(readFileSync(`${DOCS}/scopes.log`, "utf8"));
  const baseline = JSON.parse(
    readFileSync(new URL("../src/drift-baseline.json", import.meta.url), "utf8")
  ) as DriftBaseline;

  it("holds the baseline before any corruption — the vendored dumps parse cleanly", () => {
    expect(
      compareToBaseline(reconcile(rules, realDocs, modifierDocs, dumpLinks), baseline)
    ).toEqual([]);
  });

  it("fails compareToBaseline once a trigger/effect block stops parsing", () => {
    const corrupted = parseTriggerDocs(
      `${readFileSync(`${DOCS}/triggers.log`, "utf8")}\nnot a heading\nSupported Scopes: country\n`,
      readFileSync(`${DOCS}/effects.log`, "utf8")
    );
    const differences = compareToBaseline(
      reconcile(rules, corrupted, modifierDocs, dumpLinks),
      baseline
    );
    expect(differences.some((line) => line.includes("malformed trigger/effect doc block"))).toBe(
      true
    );
  });

  it("fails compareToBaseline once a modifier line stops parsing", () => {
    const corrupted = parseModifierDocs(
      `${readFileSync(`${DOCS}/modifiers.log`, "utf8")}\n- not even close\n`
    );
    const differences = compareToBaseline(
      reconcile(rules, realDocs, corrupted, dumpLinks),
      baseline
    );
    expect(differences.some((line) => line.includes("malformed modifier doc block"))).toBe(true);
  });

  it("fails compareToBaseline once a NEW reference to an already-accepted scope appears", () => {
    // "pop" is already accepted in the committed baseline. A first-sighting-
    // only recording would leave the baseline holding once this fires — the
    // exact gap the review caught: a per-file token count instead moves.
    const corrupted = parseTriggerDocs(
      `${readFileSync(`${DOCS}/triggers.log`, "utf8")}\n` +
        "synthetic_new_pop_reference - test only, not a real trigger\n" +
        "Supported Scopes: pop\n",
      readFileSync(`${DOCS}/effects.log`, "utf8")
    );
    const differences = compareToBaseline(
      reconcile(rules, corrupted, modifierDocs, dumpLinks),
      baseline
    );
    expect(differences.some((line) => line.includes("unknown scope") && line.includes("pop"))).toBe(
      true
    );
  });
});
