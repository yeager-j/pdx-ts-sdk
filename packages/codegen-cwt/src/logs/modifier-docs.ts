const MODIFIER_ENTRY_PATTERN = /^- ([A-Za-z0-9_.@]+), Category: (.+?)\s*$/;
const MODIFIER_LOG_FILE = "modifiers.log";

/** Parsed modifier documentation and candidate entries that the parser could not read. */
export interface ModifierDocs {
  /** Maps each modifier name to the categories assigned by the game. */
  readonly modifiers: ReadonlyMap<string, readonly string[]>;
  /** Candidate entries that could not be parsed, identified by file, line, and text. */
  readonly malformed: readonly string[];
}

/**
 * Parses the game's modifier documentation dump. Candidate entry lines that do not match the dump
 * format remain available in {@link ModifierDocs.malformed} for reconciliation.
 */
export function parseModifierDocs(source: string): ModifierDocs {
  const modifiers = new Map<string, readonly string[]>();
  const malformed: string[] = [];

  for (const [index, line] of source.split("\n").entries()) {
    if (!line.startsWith("- ")) {
      continue;
    }

    const match = MODIFIER_ENTRY_PATTERN.exec(line);
    if (match === null) {
      malformed.push(`${MODIFIER_LOG_FILE}:${index + 1} ${line.trim().slice(0, 80)}`);
      continue;
    }

    modifiers.set(match[1]!, match[2]!.split(", "));
  }

  return { modifiers, malformed };
}
