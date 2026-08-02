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
  /** `- `-prefixed lines the entry pattern could not read. */
  readonly malformed: readonly string[];
}

export function parseModifierDocs(log: string): ModifierDocs {
  const modifiers = new Map<string, readonly string[]>();
  const malformed: string[] = [];
  for (const line of log.split("\n")) {
    if (!line.startsWith("- ")) {
      continue;
    }
    const match = ENTRY.exec(line);
    if (match === null) {
      malformed.push(line.trim().slice(0, 80));
      continue;
    }
    modifiers.set(match[1]!, match[2]!.split(", "));
  }
  return { modifiers, malformed };
}
