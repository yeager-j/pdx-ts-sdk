import { formatMalformedBlock, isMeaningful } from "./blocks.ts";

/** A documented trigger or effect from the game's script documentation dumps. */
export interface DocEntry {
  /** Script name of the trigger or effect. */
  readonly name: string;
  /** Human-readable description supplied by the game. */
  readonly summary: string;
  /** Nonblank usage lines after the heading, or an empty string when the dump provides none. */
  readonly usage: string;
  /** Scopes from which the trigger or effect is available. */
  readonly scopes: readonly string[];
  /** Dump file and first meaningful block line, formatted as `<file>:<line>`. */
  readonly location: string;
}

/** Parsed trigger and effect documentation, malformed candidates, and duplicate names. */
export interface DocDump {
  /** Trigger documentation indexed by trigger name. */
  readonly triggers: ReadonlyMap<string, DocEntry>;
  /** Effect documentation indexed by effect name. */
  readonly effects: ReadonlyMap<string, DocEntry>;
  /** Candidate blocks that could not be parsed, identified by file, line, and text. */
  readonly malformed: readonly string[];
  /** Duplicate trigger or effect names, identified by the later block's location. */
  readonly duplicates: readonly string[];
}

interface ParsedSection {
  readonly entries: ReadonlyMap<string, DocEntry>;
  readonly malformed: readonly string[];
  readonly duplicates: readonly string[];
}

const DOC_HEADING_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*) - (.*)$/;
const SUPPORTED_SCOPES_PATTERN = /^Supported Scopes:\s*(.*)$/;

function parseDocBlock(
  lines: readonly string[],
  supportedScopes: string,
  location: string
): DocEntry | null {
  const meaningfulLines = lines.filter(isMeaningful);

  for (const [headingIndex, line] of meaningfulLines.entries()) {
    const heading = DOC_HEADING_PATTERN.exec(line);
    if (heading === null) {
      continue;
    }

    return {
      name: heading[1]!,
      summary: heading[2]!.trim(),
      usage: meaningfulLines.slice(headingIndex + 1).join("\n"),
      scopes: supportedScopes.split(/\s+/).filter((scope) => scope !== ""),
      location,
    };
  }

  return null;
}

/** Ends blocks at `Supported Scopes:` because usage examples can contain blank lines. */
function parseSection(file: string, source: string): ParsedSection {
  const entries = new Map<string, DocEntry>();
  const malformed: string[] = [];
  const duplicates: string[] = [];
  let blockLines: string[] = [];
  let blockStartLine = 1;
  let meaningfulStartLine: number | null = null;
  let lineNumber = 0;

  for (const line of source.split("\n")) {
    lineNumber += 1;
    const supportedScopes = SUPPORTED_SCOPES_PATTERN.exec(line);
    if (supportedScopes === null) {
      if (blockLines.length === 0) {
        blockStartLine = lineNumber;
      }
      if (meaningfulStartLine === null && isMeaningful(line)) {
        meaningfulStartLine = lineNumber;
      }
      blockLines.push(line);
      continue;
    }

    const location = `${file}:${meaningfulStartLine ?? blockStartLine}`;
    const entry = parseDocBlock(blockLines, supportedScopes[1]!, location);
    if (entry === null) {
      malformed.push(formatMalformedBlock(location, blockLines));
    } else {
      if (entries.has(entry.name)) {
        duplicates.push(`${entry.name} — ${location}`);
      }
      entries.set(entry.name, entry);
    }

    blockLines = [];
    meaningfulStartLine = null;
  }

  if (meaningfulStartLine !== null) {
    const location = `${file}:${meaningfulStartLine}`;
    malformed.push(formatMalformedBlock(location, blockLines));
  }

  return { entries, malformed, duplicates };
}

/**
 * Parses the game's trigger and effect documentation dumps into name-indexed maps. Blocks without
 * a readable heading or terminating supported-scope field, and duplicate names with their later
 * locations, remain available for reconciliation.
 */
export function parseTriggerDocs(triggerLog: string, effectLog: string): DocDump {
  const triggerSection = parseSection("triggers.log", triggerLog);
  const effectSection = parseSection("effects.log", effectLog);

  return {
    triggers: triggerSection.entries,
    effects: effectSection.entries,
    malformed: [...triggerSection.malformed, ...effectSection.malformed],
    duplicates: [...triggerSection.duplicates, ...effectSection.duplicates],
  };
}
