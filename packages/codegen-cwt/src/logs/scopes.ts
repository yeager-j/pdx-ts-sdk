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

const SCOPE_LINK_HEADING_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*) - (.*)$/;
const SUPPORTED_SCOPES_PATTERN = /^Supported Scopes:\s*(.*)$/;
const OUTPUT_SCOPE_PATTERN = /^Output Scope:\s*(.*)$/;

function findLineMatch(lines: readonly string[], pattern: RegExp): RegExpExecArray | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match !== null) {
      return match;
    }
  }

  return null;
}

/**
 * Parses complete scope-link blocks from the game's documentation dump. Blocks without a heading,
 * supported-scope field, or output-scope field are omitted.
 */
export function parseScopeLinks(source: string): ScopeLink[] {
  const links: ScopeLink[] = [];

  for (const block of source.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const heading = lines[0] === undefined ? null : SCOPE_LINK_HEADING_PATTERN.exec(lines[0]);
    const supportedScopes = findLineMatch(lines, SUPPORTED_SCOPES_PATTERN);
    const outputScope = findLineMatch(lines, OUTPUT_SCOPE_PATTERN);
    if (heading === null || supportedScopes === null || outputScope === null) {
      continue;
    }

    links.push({
      name: heading[1]!,
      summary: heading[2]!.trim(),
      inputScopes: supportedScopes[1]!.split(/\s+/).filter((scope) => scope !== ""),
      outputScope: outputScope[1]!.trim(),
    });
  }

  return links;
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
