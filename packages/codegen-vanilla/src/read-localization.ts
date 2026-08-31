/**
 * Reading vanilla's localization key inventory out of the install.
 *
 * Keys, never text. The text a key holds is localized game content, which
 * `PROVENANCE.md` puts on the far side of the licensing boundary, so the
 * matcher below captures the key and stops at the colon: the quoted value is
 * never held in a variable, let alone returned.
 *
 * English only. The game falls back to english for any key a language file
 * omits, so `localisation/english` is the set of keys that resolve at all —
 * every other language directory is a subset of it, translated.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { compareIdentifiers } from "./emit.ts";
import type { ExtractionGap } from "./extraction-gap.ts";

/** Where the game's own localization lives, relative to the install root. */
const LOCALIZATION_DIR = "localisation/english";

/**
 * A `key:<version> "text"` line, matched on its key prefix alone.
 *
 * The capture ends at the colon and the trailing `"` is only proof that a
 * value follows, so no character of the text is ever captured. The key charset
 * is what the 4.4.6 tree actually spells: letters, digits and `_`, plus the
 * `.`, `-`, and `'` that some thousands of keys carry.
 *
 * This also has to admit a key that begins `l_`, which is why the file header
 * is told apart by {@link HEADER_LINE} rather than by that prefix: `l_slot` and
 * `l_cluster_openable` are ordinary keys, and a prefix test would silently drop
 * them.
 */
const KEY_LINE = /^\s*([A-Za-z0-9_][A-Za-z0-9_.'-]*):\s*\d*\s*"/;

/** The `l_english:` language header each file opens with, which names no key. */
const HEADER_LINE = /^\s*l_[a-z_]+:\s*(?:#.*)?$/;

/** The vanilla localization keys, and what reading them saw. */
export interface LocalizationKeys {
  /** Every distinct key, in the emitter's byte order. */
  readonly keys: readonly string[];
  readonly files: number;
  /**
   * Lines that named neither a key nor a language header.
   *
   * Zero across the whole 4.4.6 tree. A non-zero count after a patch means
   * vanilla started writing a line shape this reader does not recognise, and
   * whatever key those lines carry is missing from {@link keys}.
   */
  readonly unparsedLines: number;
  /**
   * The files those lines are in, one gap each.
   *
   * This inventory is what `vanilla.localization()` accepts, so a line the
   * reader did not recognise is a key the published package will refuse while
   * the game resolves it. Counting it was not enough: emission refuses while
   * this is non-empty, and the gap names the file and the first line to look
   * at.
   */
  readonly gaps: readonly ExtractionGap[];
  /**
   * The whole `localisation/english` tree is absent. The only read failure
   * that is not thrown: a tree that exists and will not be read is a defect,
   * not an empty inventory.
   */
  readonly missing: boolean;
}

/**
 * Every `.yml` beneath `dir`, with no error tolerated.
 *
 * A directory that will not be read is not an empty directory: swallowing the
 * failure would shrink the inventory silently and publish a package whose
 * `vanilla.localization()` then rejects keys the game really defines. The one
 * absence that is not a failure — the whole tree missing — is settled by
 * {@link readLocalizationKeys} before this is called, so everything here
 * propagates.
 */
function ymlFilesUnder(dir: string): string[] {
  return readdirSync(dir)
    .sort(compareIdentifiers)
    .flatMap((name) => {
      const file = path.join(dir, name);
      return statSync(file).isDirectory()
        ? ymlFilesUnder(file)
        : name.endsWith(".yml")
          ? [file]
          : [];
    });
}

/**
 * Reads the install's english localization tree and returns its keys.
 *
 * @param root - The install root, the directory holding `localisation/`.
 * @throws Error If the tree exists but any part of it cannot be read. Only its
 * complete absence is tolerated, and that is reported as `missing`.
 */
export function readLocalizationKeys(root: string): LocalizationKeys {
  const dir = path.join(root, LOCALIZATION_DIR);
  if (!existsSync(dir)) {
    return { keys: [], files: 0, unparsedLines: 0, gaps: [], missing: true };
  }
  const files = ymlFilesUnder(dir);
  const keys = new Set<string>();
  const gaps: ExtractionGap[] = [];
  let unparsedLines = 0;
  for (const file of files) {
    // One gap per file rather than per line. A patch that introduces a line
    // shape introduces it throughout, and the question a maintainer asks is
    // which files and what the shape looks like — not the same sentence ten
    // thousand times.
    let unparsedHere = 0;
    let firstUnparsed = 0;
    // `utf8` leaves the BOM every one of these files opens with in the string,
    // where it would otherwise become part of that file's first key. Spelled
    // as an escape because the character itself is invisible in a source file.
    const lines = readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .split("\n");
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }
      const key = KEY_LINE.exec(line)?.[1];
      if (key !== undefined) {
        keys.add(key);
        continue;
      }
      if (!HEADER_LINE.test(line)) {
        unparsedHere += 1;
        firstUnparsed = firstUnparsed === 0 ? index + 1 : firstUnparsed;
      }
    }
    unparsedLines += unparsedHere;
    if (unparsedHere > 0) {
      gaps.push({
        inventory: "localization",
        source: path.relative(root, file).split(path.sep).join("/"),
        detail:
          `${unparsedHere} ${unparsedHere === 1 ? "line names" : "lines name"} neither a key ` +
          `nor a language header, first at line ${firstUnparsed}`,
      });
    }
  }
  return {
    keys: [...keys].sort(compareIdentifiers),
    files: files.length,
    unparsedLines,
    gaps,
    // The absent tree returned above. Reaching here means the directory is
    // there, whether or not it happened to hold any `.yml`.
    missing: false,
  };
}
