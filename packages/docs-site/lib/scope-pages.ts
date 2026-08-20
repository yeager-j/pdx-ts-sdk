import { SCRIPT_REFERENCE_SCOPES } from "@pdx-ts/sdk/script-reference";

import { source } from "@/lib/source";
import type { ScopePageLink } from "@/src/effects-index";
import { validateScopePages } from "@/src/scope-page-coverage";

const SCOPE_SECTION = "scopes-and-effects";
const SCOPE_GROUP = "scopes";

/**
 * The scope pages the site publishes, as the effects index needs to see them.
 * A page counts as a scope page when it sits under the scopes section and its
 * own frontmatter declares its canonical generated scope. Routing lives here,
 * the way `lib/coverage-pages.ts` keeps it out of the coverage gate; the pure
 * validator receives page claims without knowing how Fumadocs found them.
 */
export function scopePages(): ScopePageLink[] {
  const claims = source.getPages().flatMap((page) => {
    const [section, group, routeScope] = page.slugs;
    if (
      page.slugs.length !== 3 ||
      section !== SCOPE_SECTION ||
      group !== SCOPE_GROUP ||
      routeScope === undefined
    ) {
      return [];
    }
    return [
      {
        id: page.slugs.join("/"),
        href: `${page.url.replace(/\/$/, "")}/`,
        title: page.data.title,
        routeScope,
        declaredScope: page.data.scope,
      },
    ];
  });
  return validateScopePages(SCRIPT_REFERENCE_SCOPES, claims);
}
