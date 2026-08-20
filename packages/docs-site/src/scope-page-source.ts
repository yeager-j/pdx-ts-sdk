export interface ScopePageSource {
  readonly scope: string;
  readonly title: string;
  readonly prose: string;
}

export function parseScopePageSource(scope: string, source: string): ScopePageSource {
  const normalized = source.replaceAll("\r\n", "\n").trim();
  const firstBreak = normalized.indexOf("\n");
  const titleLine = firstBreak === -1 ? normalized : normalized.slice(0, firstBreak);
  const title = titleLine.startsWith("# ") ? titleLine.slice(2).trim() : "";
  if (title === "") throw new Error(`Scope prose "${scope}" must start with one H1 title.`);

  const prose = normalized.slice(firstBreak + 1).trim();
  const commonEntriesHeading = "## Common entry points";
  const headingIndex = prose.indexOf(`\n${commonEntriesHeading}\n`);
  if (headingIndex === -1) {
    throw new Error(
      `Scope prose "${scope}" must contain exactly one "${commonEntriesHeading}" section.`
    );
  }
  const representation = prose.slice(0, headingIndex).trim();
  const commonEntries = prose.slice(headingIndex + commonEntriesHeading.length + 2).trim();
  if (representation === "" || commonEntries === "") {
    throw new Error(`Scope prose "${scope}" must contain both required prose sections.`);
  }
  if (/^#{1,6} /m.test(representation) || /^#{1,6} /m.test(commonEntries)) {
    throw new Error(
      `Scope prose "${scope}" may not add headings for generated event or method inventories.`
    );
  }
  if (/^import |^export |<\/?[A-Z]/m.test(prose)) {
    throw new Error(
      `Scope prose "${scope}" may not declare MDX components or data; the page template owns them.`
    );
  }
  return { scope, title, prose };
}
