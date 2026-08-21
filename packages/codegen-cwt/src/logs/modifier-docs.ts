/**
 * Reads the game's modifier dump.
 *
 * This is the only source that lists the *generated* modifier names — the
 * economic-category products like `country_unity_produces_mult` and the
 * per-ship-size stats — which the curated `modifiers.cwt` can only describe as
 * templates. Lines look like:
 *
 *     - pop_happiness, Category: Pops
 *     - country_unity_produces_mult, Category: Economic Units, AI Economy
 */

const ENTRY = /^- ([A-Za-z0-9_.@]+), Category: (.+?)\s*$/;

export interface ModifierDocs {
  /** Modifier name -> the categories the game filed it under. */
  readonly modifiers: ReadonlyMap<string, readonly string[]>;
  /**
   * `- `-prefixed lines the entry pattern could not read, as
   * `modifiers.log:<line> <text>` — the same `<file>:<line> <text>` identity
   * `reconcile.ts`'s `unknownKeywords` carries, so a line that starts parsing
   * cleanly and later breaks is a reviewable diff instead of a bare count
   * moving.
   */
  readonly malformed: readonly string[];
}

const FILE = "modifiers.log";

export function parseModifierDocs(log: string): ModifierDocs {
  const modifiers = new Map<string, readonly string[]>();
  const malformed: string[] = [];
  const lines = log.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("- ")) {
      continue;
    }
    const match = ENTRY.exec(line);
    if (match === null) {
      malformed.push(`${FILE}:${index + 1} ${line.trim().slice(0, 80)}`);
      continue;
    }
    modifiers.set(match[1]!, match[2]!.split(", "));
  }
  return { modifiers, malformed };
}
