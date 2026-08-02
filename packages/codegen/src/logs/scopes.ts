/**
 * Reads the game's scope-link dump.
 *
 * Nothing emits scope links yet, but this dump names every scope the game
 * actually has, which is how codegen checks that the scopes claimed by
 * `trigger_docs.log` are real. Upstream's own `Readme.txt` warns that the two
 * dumps drift apart, so this cross-check is not ceremonial.
 */

export interface ScopeLink {
  readonly name: string;
  readonly summary: string;
  readonly inputScopes: readonly string[];
  readonly outputScope: string;
}

const HEADING = /^([A-Za-z_][A-Za-z0-9_]*) - (.*)$/;
const SUPPORTED = /^Supported Scopes:\s*(.*)$/;
const OUTPUT = /^Output Scope:\s*(.*)$/;

export function parseScopeLinks(source: string): ScopeLink[] {
  const links: ScopeLink[] = [];
  for (const block of source.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const heading = lines[0] === undefined ? null : HEADING.exec(lines[0]);
    const supported = lines.map((line) => SUPPORTED.exec(line)).find((match) => match !== null);
    const output = lines.map((line) => OUTPUT.exec(line)).find((match) => match !== null);
    if (heading === null || supported === undefined || output === undefined) {
      continue;
    }
    links.push({
      name: heading[1]!,
      summary: heading[2]!.trim(),
      inputScopes: supported[1]!.split(/\s+/).filter((scope) => scope !== ""),
      outputScope: output[1]!.trim(),
    });
  }
  return links;
}

/** Every scope name mentioned anywhere in the dump, as inputs or outputs. */
export function scopeVocabulary(links: readonly ScopeLink[]): Set<string> {
  const names = new Set<string>();
  for (const link of links) {
    for (const scope of link.inputScopes) {
      names.add(scope);
    }
    names.add(link.outputScope);
  }
  return names;
}
