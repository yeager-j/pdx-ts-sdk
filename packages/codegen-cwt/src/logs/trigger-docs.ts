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
  /** The dump file and line this block starts on, e.g. `"triggers.log:42"`. */
  readonly location: string;
}

export interface DocDump {
  readonly triggers: ReadonlyMap<string, DocEntry>;
  readonly effects: ReadonlyMap<string, DocEntry>;
  /**
   * Blocks that had no name line or no `Supported Scopes:` line, as
   * `<log file>:<line> <text>` — the block's own starting line and its first
   * 80 characters, the same identity shape `reconcile.ts`'s `unknownKeywords`
   * carries, so a block that starts parsing cleanly and later breaks is a
   * reviewable diff instead of a bare count moving.
   */
  readonly malformed: readonly string[];
}

const HEADING = /^([A-Za-z_][A-Za-z0-9_]*) - (.*)$/;
const SCOPES = /^Supported Scopes:\s*(.*)$/;

const NOISE = /^=+$/;

function parseBlock(
  lines: readonly string[],
  scopeLine: string,
  location: string
): DocEntry | null {
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
    location,
  };
}

/** As {@link parseBlock}'s own `meaningful` filter — blank and `====` noise lines carry no content. */
function isMeaningful(line: string): boolean {
  return line.trim() !== "" && !NOISE.test(line.trim());
}

/**
 * Blocks are delimited by their trailing `Supported Scopes:` line, not by blank
 * lines: `kill_leader`'s usage example contains one, and splitting on blanks
 * silently drops it.
 *
 * `file` names the dump this body came from (`"triggers.log"` /
 * `"effects.log"`) purely for identity: both `malformed` entries and every
 * parsed {@link DocEntry} carry `<file>:<line>` back to the block that
 * produced them — the line of its first meaningful content, so the location
 * lands on the heading (or, for a malformed block, whatever line the reader
 * can point at) rather than a blank line the file happens to pad it with.
 * Falls back to the buffer's first line for the pathological case of a block
 * with no meaningful content at all.
 */
function parseSection(file: string, body: string, malformed: string[]): Map<string, DocEntry> {
  const entries = new Map<string, DocEntry>();
  let buffer: string[] = [];
  let bufferStart = 1;
  let meaningfulStart: number | null = null;
  let lineNumber = 0;
  for (const line of body.split("\n")) {
    lineNumber += 1;
    if (!SCOPES.test(line)) {
      if (buffer.length === 0) {
        bufferStart = lineNumber;
      }
      if (meaningfulStart === null && isMeaningful(line)) {
        meaningfulStart = lineNumber;
      }
      buffer.push(line);
      continue;
    }
    const location = `${file}:${meaningfulStart ?? bufferStart}`;
    const entry = parseBlock(buffer, line, location);
    if (entry === null) {
      malformed.push(`${location} ${buffer.join(" ").trim().slice(0, 80)}`);
    } else {
      entries.set(entry.name, entry);
    }
    buffer = [];
    meaningfulStart = null;
  }
  // A block with no trailing `Supported Scopes:` line never reaches the loop
  // body above, so without this it silently vanishes at EOF instead of
  // surfacing as either an entry or a malformed block — exactly the shape a
  // truncated dump takes. `meaningfulStart` is the same guard the loop uses:
  // trailing blank/noise-only lines (there are some in the real dumps) leave
  // it `null` and are correctly dropped rather than reported.
  if (meaningfulStart !== null) {
    malformed.push(`${file}:${meaningfulStart} ${buffer.join(" ").trim().slice(0, 80)}`);
  }
  return entries;
}

export function parseTriggerDocs(triggerLog: string, effectLog: string): DocDump {
  const malformed: string[] = [];
  return {
    triggers: parseSection("triggers.log", triggerLog, malformed),
    effects: parseSection("effects.log", effectLog, malformed),
    malformed,
  };
}
