import { formatMalformedBlock, isMeaningful } from "./blocks.ts";

/** A named scope transition from the game's scope-link documentation dump. */
export interface ScopeLink {
  /** Name used to invoke the scope link. */
  readonly name: string;
  /** Human-readable description supplied by the game. */
  readonly summary: string;
  /** Scopes from which the link is available. */
  readonly inputScopes: readonly string[];
  /** Scope selected by the link. */
  readonly outputScope: string;
}

/** Parsed scope-link documentation, malformed candidates, and duplicate names. */
export interface ScopeLinks {
  /** Scope links parsed from the documentation dump. */
  readonly links: readonly ScopeLink[];
  /** Candidate blocks that could not be parsed, identified by file, line, and text. */
  readonly malformed: readonly string[];
  /** Duplicate scope-link names, identified by the later block's location. */
  readonly duplicates: readonly string[];
}

const SCOPE_LINK_HEADING_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*) - (.*)$/;
const SUPPORTED_SCOPES_PATTERN = /^Supported Scopes:\s*(.*)$/;
const OUTPUT_SCOPE_PATTERN = /^Output Scope:\s*(.*)$/;
const SCOPE_LINK_LOG_FILE = "scopes.log";

function findLineMatch(lines: readonly string[], pattern: RegExp): RegExpExecArray | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match !== null) {
      return match;
    }
  }

  return null;
}

interface ParsedScopeBlock {
  readonly link: ScopeLink | null;
  readonly malformed: string | null;
}

function parseScopeBlock(lines: readonly string[], location: string): ParsedScopeBlock {
  const meaningfulLines = lines.filter(isMeaningful);
  const heading =
    meaningfulLines[0] === undefined ? null : SCOPE_LINK_HEADING_PATTERN.exec(meaningfulLines[0]);
  const supportedScopes = findLineMatch(lines, SUPPORTED_SCOPES_PATTERN);
  const outputScope = findLineMatch(lines, OUTPUT_SCOPE_PATTERN);
  const looksLikeLinkAttempt = heading !== null || supportedScopes !== null || outputScope !== null;
  if (!looksLikeLinkAttempt) {
    return { link: null, malformed: null };
  }
  if (heading === null || supportedScopes === null || outputScope === null) {
    return { link: null, malformed: formatMalformedBlock(location, lines) };
  }

  return {
    link: {
      name: heading[1]!,
      summary: heading[2]!.trim(),
      inputScopes: supportedScopes[1]!.split(/\s+/).filter((scope) => scope !== ""),
      outputScope: outputScope[1]!.trim(),
    },
    malformed: null,
  };
}

/**
 * Parses scope-link blocks from the game's documentation dump. Blocks that look like link attempts
 * but lack a heading, supported-scope field, or output-scope field remain available for
 * reconciliation, as do duplicate names with their later locations.
 */
export function parseScopeLinks(source: string): ScopeLinks {
  const links: ScopeLink[] = [];
  const malformed: string[] = [];
  const duplicates: string[] = [];
  const names = new Set<string>();
  let blockLines: string[] = [];
  let blockStartLine = 1;
  let meaningfulStartLine: number | null = null;

  const flushBlock = (): void => {
    if (blockLines.length === 0) {
      return;
    }
    const location = `${SCOPE_LINK_LOG_FILE}:${meaningfulStartLine ?? blockStartLine}`;
    const parsed = parseScopeBlock(blockLines, location);
    if (parsed.malformed !== null) {
      malformed.push(parsed.malformed);
    }
    if (parsed.link !== null) {
      if (names.has(parsed.link.name)) {
        duplicates.push(`${parsed.link.name} — ${location}`);
      }
      names.add(parsed.link.name);
      links.push(parsed.link);
    }
    blockLines = [];
    meaningfulStartLine = null;
  };

  for (const [index, line] of source.split("\n").entries()) {
    if (line.trim() === "") {
      flushBlock();
      continue;
    }
    if (blockLines.length === 0) {
      blockStartLine = index + 1;
    }
    if (meaningfulStartLine === null && isMeaningful(line)) {
      meaningfulStartLine = index + 1;
    }
    blockLines.push(line);
  }
  flushBlock();

  return { links, malformed, duplicates };
}

/** Collects every input and output scope referenced by the supplied links. */
export function scopeVocabulary(links: readonly ScopeLink[]): Set<string> {
  const scopes = new Set<string>();

  for (const link of links) {
    for (const inputScope of link.inputScopes) {
      scopes.add(inputScope);
    }
    scopes.add(link.outputScope);
  }

  return scopes;
}
