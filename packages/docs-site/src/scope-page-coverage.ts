import type { ScopeName } from "@pdx-ts/sdk";

import type { ScopePageLink } from "./effects-index.ts";

export interface ScopePageClaim {
  readonly id: string;
  readonly href: string;
  readonly title: string;
  readonly routeScope: string;
  readonly declaredScope?: string;
}

const quoted = (values: readonly string[]): string =>
  [...new Set(values)]
    .sort()
    .map((value) => `"${value}"`)
    .join(", ");

export function validateScopePages(
  scopes: readonly ScopeName[],
  pages: readonly ScopePageClaim[]
): ScopePageLink[] {
  const knownScopes = new Set<string>(scopes);
  const counts = new Map<string, number>();
  const missingDeclarations: string[] = [];
  const unknown: string[] = [];
  const orphaned: string[] = [];
  const mismatches: string[] = [];

  for (const page of pages) {
    if (!knownScopes.has(page.routeScope)) orphaned.push(page.routeScope);
    if (page.declaredScope === undefined) {
      missingDeclarations.push(page.id);
      continue;
    }
    counts.set(page.declaredScope, (counts.get(page.declaredScope) ?? 0) + 1);
    if (!knownScopes.has(page.declaredScope)) unknown.push(page.declaredScope);
    if (page.routeScope !== page.declaredScope) {
      mismatches.push(`${page.routeScope} -> ${page.declaredScope}`);
    }
  }

  const missing = scopes.filter((scope) => !counts.has(scope));
  const duplicate = [...counts]
    .filter(([, count]) => count > 1)
    .map(([scope]) => scope)
    .sort();
  const errors = [
    ...(missing.length === 0 ? [] : [`Missing scope pages: ${quoted(missing)}.`]),
    ...(duplicate.length === 0 ? [] : [`Duplicate scope pages: ${quoted(duplicate)}.`]),
    ...(unknown.length === 0 ? [] : [`Unknown page scopes: ${quoted(unknown)}.`]),
    ...(orphaned.length === 0 ? [] : [`Orphaned scope pages: ${quoted(orphaned)}.`]),
    ...(missingDeclarations.length === 0
      ? []
      : [`Scope pages missing "scope" frontmatter: ${quoted(missingDeclarations)}.`]),
    ...(mismatches.length === 0
      ? []
      : [`Scope page route/frontmatter mismatches: ${quoted(mismatches)}.`]),
  ];
  if (errors.length > 0) throw new Error(errors.join("\n"));

  return pages
    .map((page) => ({
      scope: page.declaredScope as ScopeName,
      href: page.href,
      title: page.title,
    }))
    .sort((left, right) => left.scope.localeCompare(right.scope));
}
