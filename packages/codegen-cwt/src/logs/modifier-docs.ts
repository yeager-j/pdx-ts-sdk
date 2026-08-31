const MODIFIER_ENTRY_PATTERN = /^- ([A-Za-z0-9_.@]+), Category: (.+?)\s*$/;
const MODIFIER_LOG_FILE = "modifiers.log";

/** Parsed modifier documentation, malformed candidates, and duplicate names. */
export interface ModifierDocs {
  /** Maps each modifier name to the categories assigned by the game. */
  readonly modifiers: ReadonlyMap<string, readonly string[]>;
  /** Candidate entries that could not be parsed, identified by file, line, and text. */
  readonly malformed: readonly string[];
  /** Duplicate modifier names, identified by the later entry's location. */
  readonly duplicates: readonly string[];
}

/**
 * Parses the game's modifier documentation dump. Candidate entry lines that do not match the dump
 * format remain available in {@link ModifierDocs.malformed} for reconciliation. Duplicate names
 * remain available in {@link ModifierDocs.duplicates} with the later entry's location.
 */
export function parseModifierDocs(source: string): ModifierDocs {
  const modifiers = new Map<string, readonly string[]>();
  const malformed: string[] = [];
  const duplicates: string[] = [];

  for (const [index, line] of source.split("\n").entries()) {
    if (!line.startsWith("- ")) {
      continue;
    }

    const match = MODIFIER_ENTRY_PATTERN.exec(line);
    if (match === null) {
      malformed.push(`${MODIFIER_LOG_FILE}:${index + 1} ${line.trim().slice(0, 80)}`);
      continue;
    }

    const name = match[1]!;
    if (modifiers.has(name)) {
      duplicates.push(`${name} — ${MODIFIER_LOG_FILE}:${index + 1}`);
    }
    modifiers.set(name, match[2]!.split(", "));
  }

  return { modifiers, malformed, duplicates };
}
