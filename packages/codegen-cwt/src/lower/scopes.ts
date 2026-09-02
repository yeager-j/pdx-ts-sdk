/** Canonical, render-free scope interpretation shared by lowering consumers. */

import { scopeGroupName } from "../cwt/model.ts";
import { scopeGroupIndex, scopeIndex, type RuleSet } from "../cwt/rules.ts";
import { UNIVERSAL_SCOPES } from "../overlay/index.ts";

/** Scope-only interpretation required by render-free rule lowering. */
export interface ScopeLoweringContext {
  /** Scope groups selected while lowering. */
  readonly usedScopeGroups: Set<string>;
  /** Resolves a scope alias. */
  canonicalScope(name: string): string | null;
  /** Resolves a scope group. */
  scopeGroup(name: string): readonly string[] | null;
}

/** Standalone scope resolver for consumers that do not emit TypeScript. */
export class ScopeResolver implements ScopeLoweringContext {
  readonly usedScopeGroups = new Set<string>();
  private readonly scopes: ReadonlyMap<string, string>;
  private readonly groups: ReadonlyMap<string, readonly string[]>;

  constructor(rules: RuleSet) {
    this.scopes = scopeIndex(rules);
    this.groups = scopeGroupIndex(rules);
  }

  canonicalScope(name: string): string | null {
    return this.scopes.get(name.toLowerCase()) ?? null;
  }

  scopeGroup(name: string): readonly string[] | null {
    return this.groups.get(name.toLowerCase()) ?? null;
  }
}

/** Canonicalizes one declared scope or scope group into its member set. */
export function canonicalThisScope(
  context: ScopeLoweringContext,
  declared: string,
  source: string
): readonly string[] | null {
  if (UNIVERSAL_SCOPES.has(declared.toLowerCase())) {
    return null;
  }
  const group = scopeGroupName(declared);
  if (group === null) {
    const canonical = context.canonicalScope(declared);
    if (canonical === null) {
      throw new Error(`${source} names unknown scope "${declared}".`);
    }
    return [canonical];
  }
  const members = context.scopeGroup(group);
  if (members === null) {
    throw new Error(`${source} names unknown scope group "${group}".`);
  }
  const scopes = members.map((member) => {
    const canonical = context.canonicalScope(member);
    if (canonical === null) {
      throw new Error(`${source} names unknown scope "${member}".`);
    }
    return canonical;
  });
  const unique = [...new Set(scopes)].sort();
  if (unique.length === 0) {
    throw new Error(`${source} names empty scope group "${group}".`);
  }
  context.usedScopeGroups.add(group);
  return unique;
}
