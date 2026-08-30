/**
 * Contact with reality: parse every .txt under the local install's common/
 * tree and assert the semantic fixpoint — parse → serialize → re-parse
 * yields the same tree, byte-stable on the second emit.
 *
 * One of the package's two pieces of external evidence. The per-claim and
 * property suites prove it is consistent with itself; only this one says it
 * reads the files the game actually ships. It needs an install, so an
 * ordinary `npm test` skips it — see `vanilla-install.ts` for where a skip is
 * made to fail instead of passing quietly (SDK-320).
 *
 * No silent caps: files the parser cannot read are collected and pinned by
 * name, never skipped quietly. Growing a list means vanilla changed under
 * the suite (or a claim is wrong — either is worth knowing).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parse, serialize, withoutLines, type PdxDocument } from "../src/index.ts";
import {
  requireInstall,
  SKIP_WITHOUT_INSTALL,
  vanillaFiles,
  vanillaName,
} from "./vanilla-install.ts";

describe.skipIf(SKIP_WITHOUT_INSTALL)("vanilla corpus", () => {
  it("parse → serialize → re-parse is a fixpoint over all of common/", () => {
    requireInstall();
    const files = vanillaFiles();
    expect(files.length).toBeGreaterThan(500);

    const unreadable: string[] = [];
    const repaired: string[] = [];
    let entries = 0;

    for (const path of files) {
      const name = vanillaName(path);
      const source = readFileSync(path, "utf8");
      let document: PdxDocument;
      try {
        document = parse(source, name);
      } catch (error) {
        unreadable.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (document.diagnostics.length > 0) {
        repaired.push(`${name}: ${document.diagnostics.map((d) => d.kind).join(", ")}`);
      }
      entries += document.items.length;

      const emitted = serialize(document.items);
      const reparsed = parse(emitted, name);
      expect(withoutLines(reparsed.items), name).toEqual(withoutLines(document.items));
      expect(serialize(reparsed.items), name).toBe(emitted);
    }

    expect(entries).toBeGreaterThan(10_000);
    // Pinned: every file the parser cannot read, and every file it repairs.
    // Both repairs below are genuine vanilla defects the game engine also
    // repairs: trait_bg_active_glow is missing its `=` (line 65), and the
    // ruloc file is missing its final closing brace (111 `{` vs 110 `}`).
    expect(unreadable).toEqual([]);
    expect(repaired).toEqual([
      "named_colors/01_trait_colors.txt: operator-less-entry",
      "scripted_loc/scripted_loc_ruloc.txt: unclosed-at-eof",
    ]);
    // Parses, serializes, and re-parses every file in the game's `common/`
    // tree — seconds of real work, and it sits behind the default 5s budget
    // only by luck on a quiet machine. It shares the run with the other
    // install-gated suites, so it needs a budget of its own.
  }, 60_000);
});
