/**
 * Contact with reality: parse every .txt under the local install's common/
 * tree and assert the semantic fixpoint — parse → serialize → re-parse
 * yields the same tree, byte-stable on the second emit. Runs only where the
 * install exists; the committed gates are the per-claim suite and the
 * property tests.
 *
 * No silent caps: files the parser cannot read are collected and pinned by
 * name, never skipped quietly. Growing a list means vanilla changed under
 * the suite (or a claim is wrong — either is worth knowing).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { parse, serialize, withoutLines, type PdxDocument } from "../src/index.ts";

const STELLARIS_DIR =
  process.env["STELLARIS_PATH"] ??
  join(process.env["HOME"] ?? "", "Library/Application Support/Steam/steamapps/common/Stellaris");
const COMMON = join(STELLARIS_DIR, "common");
const HAS_INSTALL = existsSync(COMMON);

if (!HAS_INSTALL) {
  console.warn(
    `[pdxscript] skipping the vanilla fixpoint: ${COMMON} does not exist; ` +
      "set STELLARIS_PATH to the Stellaris install root"
  );
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (name.endsWith(".txt")) {
      files.push(path);
    }
  }
  return files;
}

// Files that are not PDXScript at all (modding documentation shipped as .txt).
const NOT_PDXSCRIPT = new Set(["HOW_TO_MAKE_NEW_SHIPS.txt", "99_README_EDICTS.txt"]);

describe.skipIf(!HAS_INSTALL)("vanilla corpus (non-gating)", () => {
  it("parse → serialize → re-parse is a fixpoint over all of common/", () => {
    const files = walk(COMMON).filter(
      (path) => !NOT_PDXSCRIPT.has(relative(COMMON, path).split("/").pop()!)
    );
    expect(files.length).toBeGreaterThan(500);

    const unreadable: string[] = [];
    const repaired: string[] = [];
    let entries = 0;

    for (const path of files) {
      const name = relative(COMMON, path);
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
