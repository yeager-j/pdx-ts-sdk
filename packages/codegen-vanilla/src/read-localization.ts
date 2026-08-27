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

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { compareIdentifiers } from "./emit.ts";

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
   * the keys on those lines are missing from the inventory rather than wrong —
   * so it is reported rather than thrown on.
   */
  readonly unparsedLines: number;
  readonly missing: boolean;
}

function ymlFilesUnder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort(compareIdentifiers);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? ymlFilesUnder(file) : name.endsWith(".yml") ? [file] : [];
  });
}

/**
 * Reads the install's english localization tree and returns its keys.
 *
 * @param root - The install root, the directory holding `localisation/`.
 */
export function readLocalizationKeys(root: string): LocalizationKeys {
  const files = ymlFilesUnder(path.join(root, LOCALIZATION_DIR));
  const keys = new Set<string>();
  let unparsedLines = 0;
  for (const file of files) {
    // `utf8` leaves the BOM every one of these files opens with in the string,
    // where it would otherwise become part of that file's first key. Spelled
    // as an escape because the character itself is invisible in a source file.
    for (const line of readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .split("\n")) {
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
        unparsedLines += 1;
      }
    }
  }
  return {
    keys: [...keys].sort(compareIdentifiers),
    files: files.length,
    unparsedLines,
    missing: files.length === 0,
  };
}
