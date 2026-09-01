/**
 * The reviewed drift baseline read as the decision about where each rule is legal.
 *
 * Reconciliation records which evidence source won for every scope disagreement
 * and every unannotated rule. Lowering reads that decision here instead of
 * re-deriving one, so the baseline is the single authority both the emitters and
 * the scope facts consume.
 */

import type { DriftBaseline, ScopeResolution } from "./reconcile.ts";

/** Separates a rule name from the two scope sets in a baseline conflict entry. */
export const SCOPE_CONFLICT_NAME_SUFFIX = ": rules say ";

/** The reviewed baseline's decision for one rule's legal scopes. */
export interface RuleScopeDecision {
  /** The {@link ScopeResolution.id} that made the decision. */
  readonly resolution: string;
  /** The evidence source the resolution selected. */
  readonly authority: "rules" | "docs" | "mixed" | "none";
  /** The reviewed canonical scope set, present only for a `mixed` authority. */
  readonly scopes?: readonly string[];
}

/** Decisions keyed by rule name, one table per clause kind. */
export interface ScopeAuthority {
  /** Decisions for trigger rules. */
  readonly triggers: ReadonlyMap<string, RuleScopeDecision>;
  /** Decisions for effect rules. */
  readonly effects: ReadonlyMap<string, RuleScopeDecision>;
}

/** The two clause kinds a scope resolution decides rules for. */
export const SCOPE_CLAUSE_KINDS = ["triggers", "effects"] as const;

/** One clause kind, naming both a conflict list and a reviewed scope table. */
export type ScopeClauseKind = (typeof SCOPE_CLAUSE_KINDS)[number];

/** The rule name a baseline conflict or unscoped-rule entry decides. */
export function decidedRuleName(entry: string): string {
  const suffix = entry.indexOf(SCOPE_CONFLICT_NAME_SUFFIX);
  return suffix === -1 ? entry : entry.slice(0, suffix);
}

/** Every rule name one resolution decides for one clause kind. */
export function resolutionRuleNames(
  resolution: ScopeResolution,
  kind: ScopeClauseKind
): readonly string[] {
  return [...resolution.conflicts[kind], ...resolution.unscopedRules[kind]].map(decidedRuleName);
}

function canonicalReviewedScope(
  resolution: ScopeResolution,
  name: string,
  scope: string,
  canonicalScopes: ReadonlyMap<string, string>
): string {
  const canonical = canonicalScopes.get(scope.toLowerCase());
  if (canonical === undefined) {
    throw new Error(
      `Scope resolution "${resolution.id}" gives rule "${name}" the unknown scope "${scope}"`
    );
  }
  return canonical;
}

function decisionFor(
  resolution: ScopeResolution,
  kind: ScopeClauseKind,
  name: string,
  canonicalScopes: ReadonlyMap<string, string>
): RuleScopeDecision {
  const decision = { resolution: resolution.id, authority: resolution.selectedAuthority };
  if (resolution.selectedAuthority !== "mixed") {
    return decision;
  }
  const reviewed = resolution.resolvedScopes?.[kind]?.[name];
  if (reviewed === undefined || reviewed.length === 0) {
    throw new Error(
      `Scope resolution "${resolution.id}" resolves rule "${name}" to a mixed authority ` +
        `without a resolvedScopes.${kind} entry`
    );
  }
  return {
    ...decision,
    scopes: reviewed.map((scope) =>
      canonicalReviewedScope(resolution, name, scope, canonicalScopes)
    ),
  };
}

function decisionsOf(
  resolutions: readonly ScopeResolution[],
  kind: ScopeClauseKind,
  canonicalScopes: ReadonlyMap<string, string>
): Map<string, RuleScopeDecision> {
  const decisions = new Map<string, RuleScopeDecision>();
  for (const resolution of resolutions) {
    for (const name of resolutionRuleNames(resolution, kind)) {
      const claimed = decisions.get(name);
      if (claimed !== undefined) {
        throw new Error(
          `Scope resolutions "${claimed.resolution}" and "${resolution.id}" ` +
            `both decide rule "${name}"`
        );
      }
      decisions.set(name, decisionFor(resolution, kind, name, canonicalScopes));
    }
  }
  return decisions;
}

/**
 * Reads every scope resolution in the baseline into per-rule decisions.
 *
 * A rule absent from the result has no reviewed decision: the rules' own
 * `## scopes` stand alone for it.
 *
 * @throws When two resolutions decide one rule, or a `mixed` resolution lacks a
 *   reviewed scope set for a rule it decides or names a scope the index rejects.
 */
export function scopeAuthorityOf(
  baseline: DriftBaseline,
  canonicalScopes: ReadonlyMap<string, string>
): ScopeAuthority {
  return {
    triggers: decisionsOf(baseline.scopeResolutions, "triggers", canonicalScopes),
    effects: decisionsOf(baseline.scopeResolutions, "effects", canonicalScopes),
  };
}

/**
 * The scopes one rule is legal in, as the reviewed baseline decided.
 *
 * Without a decision the rules' own `## scopes` are the only evidence used: an
 * unannotated rule with no resolution is drift the gate already rejects, so
 * lowering reports the empty set rather than guessing from the documentation.
 */
export function resolveRuleScopes(
  declarations: readonly { readonly supportedScopes: readonly string[] | null }[],
  doc:
    | {
        /** Scope names reported by the Stellaris script documentation dump. */
        readonly scopes: readonly string[];
      }
    | undefined,
  decision: RuleScopeDecision | undefined
): readonly string[] {
  const declared = declarations.flatMap((declaration) => declaration.supportedScopes ?? []);
  if (decision === undefined) {
    return declared;
  }
  switch (decision.authority) {
    case "rules":
      return declared;
    case "docs":
      return doc?.scopes ?? [];
    case "mixed":
      return decision.scopes ?? [];
    case "none":
      return [];
  }
}
