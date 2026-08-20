import { SCRIPT_REFERENCE_SCOPES } from "@pdx-ts/sdk/script-reference";

import { source } from "@/lib/source";
import type { ScopePageLink } from "@/src/effects-index";

const SCOPE_SECTION = "scopes-and-effects";
const SCOPE_NAMES = new Set<string>(SCRIPT_REFERENCE_SCOPES);

/**
 * The scope pages the site publishes, as the effects index needs to see them.
 * A page counts as a scope page when it sits under the scopes section and its
 * own slug is a generated scope name, so the set grows as later work writes
 * more of them. Routing lives here, the way `lib/coverage-pages.ts` keeps it
 * out of the coverage gate; `src/effects-index.ts` only validates the names.
 */
export function scopePages(): ScopePageLink[] {
  return source.getPages().flatMap((page) => {
    const [section, scope] = page.slugs;
    if (
      page.slugs.length !== 2 ||
      section !== SCOPE_SECTION ||
      scope === undefined ||
      !SCOPE_NAMES.has(scope)
    ) {
      return [];
    }
    return [{ scope, href: `${page.url.replace(/\/$/, "")}/`, title: page.data.title }];
  });
}
