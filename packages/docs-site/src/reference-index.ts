import type { ScriptReferenceAvailability } from "@pdx-ts/sdk/reference";
import type { ScopeName } from "@pdx-ts/sdk/stellaris";

/** A scope named by a reference entry, linked when the site publishes its page. */
export interface ScopeLinkTarget {
  /** Canonical generated scope name. */
  readonly scope: ScopeName;
  /** Published scope-page route, when one exists. */
  readonly href?: string;
  /** Published scope-page title, when one exists. */
  readonly title?: string;
}

/** Availability linked to the scope pages published by the docs site. */
export type ReferenceAvailability =
  | { readonly kind: "universal" }
  | { readonly kind: "scopes"; readonly scopes: readonly ScopeLinkTarget[] };

/** A published scope page, as the site's routing knows it. */
export interface ScopePageLink {
  /** Canonical scope represented by the page. */
  readonly scope: string;
  /** Published page route. */
  readonly href: string;
  /** Published page title. */
  readonly title: string;
}

/** Indexes published scope pages and rejects pages for unknown generated scopes. */
export function scopePagesByScope(
  scopePages: readonly ScopePageLink[],
  scopes: readonly ScopeName[]
): ReadonlyMap<string, ScopePageLink> {
  const known = new Set<string>(scopes);
  const byScope = new Map<string, ScopePageLink>();
  for (const page of scopePages) {
    if (!known.has(page.scope)) {
      throw new Error(
        `Scope page "${page.href}" names missing generated scope "${page.scope}". Use a canonical scope from SCRIPT_REFERENCE_SCOPES.`
      );
    }
    byScope.set(page.scope, page);
  }
  return byScope;
}

/** Links one generated scope to its published page when available. */
export function scopeTarget(
  scope: ScopeName,
  pages: ReadonlyMap<string, ScopePageLink>
): ScopeLinkTarget {
  const page = pages.get(scope);
  return page === undefined ? { scope } : { scope, href: page.href, title: page.title };
}

/** Converts generated availability into site-linked availability. */
export function linkedAvailability(
  availability: ScriptReferenceAvailability,
  pages: ReadonlyMap<string, ScopePageLink>
): ReferenceAvailability {
  if (availability.kind === "universal") {
    return { kind: "universal" };
  }
  return {
    kind: "scopes",
    scopes: availability.scopes.map((scope) => scopeTarget(scope, pages)),
  };
}
