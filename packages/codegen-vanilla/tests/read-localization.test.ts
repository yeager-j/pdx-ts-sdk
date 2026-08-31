/**
 * The localization reader, and the one distinction it has to keep: a tree that
 * is absent versus a tree that will not be read.
 *
 * Only the first is an empty inventory. Treating the second as one would ship a
 * package short of keys the game really defines, whose `vanilla.localization()`
 * then rejects them — a silent, published wrong answer rather than a build that
 * stopped.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { readLocalizationKeys } from "../src/read-localization.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_INSTALL = path.join(ROOT, "fixtures/fake-install");

const temps: string[] = [];

/** An install root with a `localisation/english` tree, empty unless filled. */
function installWithLocalisation(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-loc-"));
  temps.push(root);
  mkdirSync(path.join(root, "localisation/english"), { recursive: true });
  return root;
}

afterAll(() => {
  for (const dir of temps) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readLocalizationKeys", () => {
  it("reads keys and never the text beside them", () => {
    const read = readLocalizationKeys(FIXTURE_INSTALL);

    expect(read.keys).toEqual([
      "FAKE_TECH_DESC",
      "FAKE_TECH_NAME",
      "fake.dotted-key",
      "fake_apostrophe's_key",
      // The `l_english:` header and this key both open `l_`; only the quoted
      // value tells them apart, so a prefix test would drop this one.
      "l_slot",
    ]);
    expect(read).toMatchObject({ files: 1, unparsedLines: 0, gaps: [], missing: false });
  });

  it("records a line it does not recognise as a gap rather than only counting it", () => {
    // The inventory is what `vanilla.localization()` accepts, so a line shape
    // the reader stopped recognising is a key the published package refuses
    // while the game resolves it. A count in the report did not stop that.
    const root = installWithLocalisation();
    writeFileSync(
      path.join(root, "localisation/english/keys.yml"),
      'l_english:\n kept:0 "Text"\n this line carries no key the reader knows\n'
    );

    const read = readLocalizationKeys(root);

    expect(read.keys).toEqual(["kept"]);
    expect(read.unparsedLines).toBe(1);
    expect(read.gaps).toEqual([
      {
        inventory: "localization",
        source: "localisation/english/keys.yml",
        detail: "1 line names neither a key nor a language header, first at line 3",
      },
    ]);
  });

  it("reports one gap per file, however many lines it lost", () => {
    const root = installWithLocalisation();
    writeFileSync(
      path.join(root, "localisation/english/keys.yml"),
      "l_english:\n first bad line\n second bad line\n"
    );

    expect(readLocalizationKeys(root).gaps).toEqual([
      {
        inventory: "localization",
        source: "localisation/english/keys.yml",
        detail: "2 lines name neither a key nor a language header, first at line 2",
      },
    ]);
  });

  it("reports an absent tree rather than failing on it", () => {
    const read = readLocalizationKeys(mkdtempSync(path.join(tmpdir(), "pdx-loc-none-")));

    expect(read.missing).toBe(true);
    expect(read.keys).toEqual([]);
    expect(read.files).toBe(0);
  });

  it("tells an empty tree from an absent one", () => {
    // Both ship no keys, and only one of them is a reason to look at the
    // install: `missing` is what the report prints, so it has to mean the
    // directory, not the count.
    expect(readLocalizationKeys(installWithLocalisation()).missing).toBe(false);
  });

  it("throws when the tree is there but is not a directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pdx-loc-file-"));
    temps.push(root);
    mkdirSync(path.join(root, "localisation"));
    writeFileSync(path.join(root, "localisation/english"), "not a directory");

    expect(() => readLocalizationKeys(root)).toThrow(/ENOTDIR/);
  });

  it.skipIf(process.platform === "win32")("throws on an unreadable nested path", () => {
    const root = installWithLocalisation();
    const nested = path.join(root, "localisation/english/deep");
    mkdirSync(nested);
    // A dangling symlink: `statSync` on it raises ENOENT, which the walk must
    // propagate rather than read as "this subtree holds no keys".
    symlinkSync(path.join(root, "nowhere"), path.join(nested, "dangling"));

    expect(() => readLocalizationKeys(root)).toThrow(/ENOENT/);
  });
});
