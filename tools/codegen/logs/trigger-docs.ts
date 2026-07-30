/**
 * Reads Paradox's own trigger and effect documentation dumps.
 *
 * The rules carry `## scopes` themselves, so this is no longer the only source
 * of scope information — it is the independent second opinion that the drift
 * gate checks them against. The dumps are also the only source of the usage
 * examples that become TSDoc.
 *
 * Blocks look like:
 *
 *     has_edict - Checks if the country has a specific edict enabled
 *     has_edict = crystal_sonar
 *     Supported Scopes: country
 */

export interface DocEntry {
  readonly name: string;
  readonly summary: string;
  /** The usage example, verbatim, or "" when the dump omits one. */
  readonly usage: string;
  readonly scopes: readonly string[];
}

export interface DocDump {
  readonly triggers: ReadonlyMap<string, DocEntry>;
  readonly effects: ReadonlyMap<string, DocEntry>;
  /** Blocks that had no name line or no `Supported Scopes:` line. */
  readonly malformed: readonly string[];
}

const HEADING = /^([A-Za-z_][A-Za-z0-9_]*) - (.*)$/;
const SCOPES = /^Supported Scopes:\s*(.*)$/;

const NOISE = /^=+$/;

function parseBlock(lines: readonly string[], scopeLine: string): DocEntry | null {
  const meaningful = lines.filter((line) => line.trim() !== "" && !NOISE.test(line.trim()));
  const headingIndex = meaningful.findIndex((line) => HEADING.test(line));
  if (headingIndex === -1) {
    return null;
  }
  const heading = HEADING.exec(meaningful[headingIndex]!)!;
  return {
    name: heading[1]!,
    summary: heading[2]!.trim(),
    usage: meaningful.slice(headingIndex + 1).join("\n"),
    scopes: SCOPES.exec(scopeLine)![1]!
      .split(/\s+/)
      .filter((scope) => scope !== ""),
  };
}

/**
 * Blocks are delimited by their trailing `Supported Scopes:` line, not by blank
 * lines: `kill_leader`'s usage example contains one, and splitting on blanks
 * silently drops it.
 */
function parseSection(body: string, malformed: string[]): Map<string, DocEntry> {
  const entries = new Map<string, DocEntry>();
  let buffer: string[] = [];
  for (const line of body.split("\n")) {
    if (!SCOPES.test(line)) {
      buffer.push(line);
      continue;
    }
    const entry = parseBlock(buffer, line);
    if (entry === null) {
      malformed.push(buffer.join(" ").trim().slice(0, 80));
    } else {
      entries.set(entry.name, entry);
    }
    buffer = [];
  }
  return entries;
}

export function parseTriggerDocs(triggerLog: string, effectLog: string): DocDump {
  const malformed: string[] = [];
  return {
    triggers: parseSection(triggerLog, malformed),
    effects: parseSection(effectLog, malformed),
    malformed,
  };
}
