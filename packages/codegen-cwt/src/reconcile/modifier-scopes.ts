/** Joins modifier documentation with CWT category scope evidence. */

import type { RuleSet } from "../cwt/rules.ts";
import type { ModifierDocs } from "../logs/modifier-docs.ts";
import { UNIVERSAL_SCOPES } from "../overlay/index.ts";

/** Resolves a raw scope token to its canonical name, or `null` if unknown. */
export type CanonicalScope = (token: string) => string | null;

/** Source-level modifier scope facts shared by reconciliation and emission. */
export interface ReconciledModifierScopes {
  /** Names valid in every scope. */
  readonly universal: readonly string[];
  /** Exact sorted scope-set key to modifier names. */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  /** Names with no usable scope evidence. */
  readonly unscoped: readonly string[];
  /** Categories absent from `modifier_categories.cwt`. */
  readonly unknownCategories: readonly string[];
  /** Unknown scope tokens identified by their category. */
  readonly unknownScopeTokens: readonly string[];
  /** Canonical scope evidence per modifier category. */
  readonly categoryScopes: ReadonlyMap<string, "any" | ReadonlySet<string>>;
}

/** Reconciles modifier names and categories without constructing TypeScript output. */
export function reconcileModifierScopes(
  rules: RuleSet,
  docs: ModifierDocs,
  canonical: CanonicalScope
): ReconciledModifierScopes {
  const categoryScopes = new Map<string, "any" | ReadonlySet<string>>();
  const unknownScopeTokens = new Set<string>();
  for (const [category, tokens] of rules.modifierCategories) {
    let universal = false;
    const scopes = new Set<string>();
    for (const token of tokens) {
      if (UNIVERSAL_SCOPES.has(token)) {
        universal = true;
        continue;
      }
      const scope = canonical(token);
      if (scope === null) {
        unknownScopeTokens.add(`${token} — modifier_categories.cwt category:${category}`);
      } else {
        scopes.add(scope);
      }
    }
    categoryScopes.set(category, universal ? "any" : scopes);
  }

  const unknownCategories = new Set<string>();
  const noteCategories = (categories: readonly string[]): void => {
    for (const category of categories) {
      if (!categoryScopes.has(category)) {
        unknownCategories.add(category);
      }
    }
  };
  for (const categories of rules.modifierDecls.values()) {
    noteCategories(categories);
  }
  for (const template of rules.modifierTemplates) {
    noteCategories(template.categories);
  }

  const universal: string[] = [];
  const unscoped: string[] = [];
  const groups = new Map<string, string[]>();
  for (const [name, categories] of docs.modifiers) {
    noteCategories(categories);
    const scopes = new Set<string>();
    let any = false;
    for (const category of categories) {
      const resolved = categoryScopes.get(category);
      if (resolved === "any") {
        any = true;
      } else if (resolved !== undefined) {
        for (const scope of resolved) {
          scopes.add(scope);
        }
      }
    }
    if (any) {
      universal.push(name);
    } else if (scopes.size === 0) {
      unscoped.push(name);
    } else {
      const key = [...scopes].sort().join(" ");
      groups.set(key, [...(groups.get(key) ?? []), name]);
    }
  }

  return {
    universal: universal.sort(),
    groups,
    unscoped: unscoped.sort(),
    unknownCategories: [...unknownCategories].sort(),
    unknownScopeTokens: [...unknownScopeTokens].sort(),
    categoryScopes,
  };
}
