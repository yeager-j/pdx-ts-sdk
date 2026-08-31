import type { RuleField, RuleType } from "../cwt/model.ts";
import type { AliasDecl } from "../cwt/rules.ts";
import type { Emitter } from "../render/emitter.ts";
import {
  canonicalScopeSet,
  clauseOf,
  clauseScopeContext,
  clauseScopesAgree,
  declaredScopes,
  skippedRule,
  type ClauseScope,
  type SkippedRule,
} from "./script-shape.ts";

/** The canonical scopes a lowered script rule supports, or all scopes. */
export type LoweredRuleScopes = readonly string[] | "universal";

/** The nested clause and argument facts retained from a rule's block body. */
export interface LoweredRuleBody {
  /** The scope of an unkeyed trigger or effect splice, when present. */
  readonly splice: {
    /** The canonical pushed scope, or `null` for the enclosing rule scope. */
    readonly scope: string | null;
  } | null;
  /** Named clause fields and the scope each clause runs in. */
  readonly clauses: ReadonlyMap<string, string | null>;
  /** Lowercase names of non-clause arguments. */
  readonly args: ReadonlySet<string>;
}

/** A nested clause or splice omitted because its declarations disagree on scope behavior. */
export interface LoweredRuleConflict {
  /** The nested field name, or `splice` for an unkeyed clause splice. */
  readonly name: string;
  /** The stable script-generation skip category for this conflict. */
  readonly category: "conflicting-clause-scope";
  /** The declaration-specific explanation shown in the generation report. */
  readonly detail: string;
}

/** One block-form declaration partitioned into named fields and alias splices. */
export interface LoweredRuleBlock {
  /** The original CWT alias declaration. */
  readonly declaration: AliasDecl;
  /** The declaration's block type, narrowed for downstream consumers. */
  readonly type: RuleType & {
    /** Identifies the declaration as the block variant of `RuleType`. */
    readonly kind: "block";
  };
  /** The raw scope inherited by fields without their own scope annotation. */
  readonly inheritedScope: string | null;
  /** All fields that are not unkeyed alias splices. */
  readonly named: readonly RuleField[];
  /** Unkeyed alias-splice fields. */
  readonly splices: readonly RuleField[];
}

/**
 * Normalized CWT trigger or effect declarations shared by script emitters and scope facts.
 * It retains canonical scopes, scalar and block forms, and nested clause membership.
 */
export interface LoweredRule {
  /** The rule name as declared by CWT. */
  readonly key: string;
  /** All scalar and block declarations for the rule. */
  readonly declarations: readonly AliasDecl[];
  /** Raw supported-scope names before canonicalization. */
  readonly supportedScopes: readonly string[];
  /** Canonical supported scopes, or `null` when no safe set can be derived. */
  readonly scopes: LoweredRuleScopes | null;
  /** The rendered TypeScript scope type, when scopes are known. */
  readonly scopeType: string | null;
  /** Whether any declaration uses comparison syntax. */
  readonly comparison: boolean;
  /** Whether the rules declare the rule removed from the game's script API. */
  readonly removed: boolean;
  /** Non-block declarations in their original order. */
  readonly scalars: readonly AliasDecl[];
  /** Block declarations partitioned for script emitters. */
  readonly blocks: readonly LoweredRuleBlock[];
  /** Facts about the rule's nested clauses and arguments. */
  readonly body: LoweredRuleBody;
  /** Nested clauses or splices omitted because their declarations conflict. */
  readonly conflicts: readonly LoweredRuleConflict[];
}

/** Converts a lowered rule's nested scope conflicts into the shared skip report records. */
export function loweredRuleConflictSkips(rule: LoweredRule): readonly SkippedRule[] {
  return rule.conflicts.map(({ category, detail }) => skippedRule(rule.key, category, detail));
}

/**
 * Reports whether every declaration carries `## api_status = removed`.
 *
 * A name whose declarations disagree is a defect in the rules rather than a
 * shape to guess, so it throws instead of choosing one side.
 */
function declaredRemoved(key: string, declarations: readonly AliasDecl[]): boolean {
  const removed = declarations.filter((declaration) => declaration.apiStatus === "removed");
  if (removed.length === 0) {
    return false;
  }
  if (removed.length !== declarations.length) {
    throw new Error(
      `${key}: some declarations are marked "## api_status = removed" and some are not`
    );
  }
  return true;
}

function renderedScopeType(scopes: LoweredRuleScopes | null): string | null {
  if (scopes === null) {
    return null;
  }
  return scopes === "universal"
    ? "ScopeName"
    : scopes.map((scope) => JSON.stringify(scope)).join(" | ");
}

/**
 * Normalizes all declarations of one trigger or effect rule for emitters and
 * scope-fact consumers. It preserves declaration and field order.
 */
export function lowerRule(
  key: string,
  declarations: readonly AliasDecl[],
  doc:
    | {
        /** Scope names reported by the Stellaris script documentation dump. */
        readonly scopes: readonly string[];
      }
    | undefined,
  emitter: Emitter,
  scopeIndex: ReadonlyMap<string, string>
): LoweredRule {
  const supportedScopes = declaredScopes(declarations, doc);
  const scopes =
    supportedScopes.length === 0 ? null : canonicalScopeSet(supportedScopes, scopeIndex);
  const scalars: AliasDecl[] = [];
  const blocks: LoweredRuleBlock[] = [];
  const spliceCandidates: ClauseScope[] = [];
  const clauseCandidates = new Map<string, ClauseScope[]>();
  const clauses = new Map<string, string | null>();
  const args = new Set<string>();

  for (const declaration of declarations) {
    if (declaration.type.kind !== "block") {
      scalars.push(declaration);
      continue;
    }
    const inheritedScope = declaration.scope?.this ?? null;
    const inheritedClause = clauseScopeContext(declaration.scope);
    const named: RuleField[] = [];
    const splices: RuleField[] = [];
    const candidateScope = (scope: RuleField["scope"]): ClauseScope => {
      return scope === null ? inheritedClause : clauseScopeContext(scope);
    };

    for (const field of declaration.type.fields) {
      if (field.key.kind === "aliasName") {
        splices.push(field);
        if (field.key.category === "trigger" || field.key.category === "effect") {
          spliceCandidates.push(candidateScope(field.scope));
        }
        continue;
      }
      named.push(field);
      if (field.key.kind !== "name") {
        continue;
      }
      if (clauseOf(field.type) === null) {
        args.add(field.key.name.toLowerCase());
      } else {
        const name = field.key.name.toLowerCase();
        const candidates = clauseCandidates.get(name) ?? [];
        candidates.push(candidateScope(field.scope));
        clauseCandidates.set(name, candidates);
      }
    }
    blocks.push({ declaration, type: declaration.type, inheritedScope, named, splices });
  }

  const conflicts: LoweredRuleConflict[] = [];
  for (const [name, candidates] of clauseCandidates) {
    if (!clauseScopesAgree(candidates)) {
      // A conflicting clause has no safe scope. Leave it absent so ScopeFacts
      // reports unknown rather than manufacturing a narrowing from one winner.
      conflicts.push({
        name,
        category: "conflicting-clause-scope",
        detail: `field "${name}" has incompatible scope transitions across its declarations`,
      });
      continue;
    }
    const candidate = candidates[0]!;
    clauses.set(name, candidate.scope === null ? null : emitter.canonicalScope(candidate.scope));
  }

  let splice: { scope: string | null } | null = null;
  if (clauseScopesAgree(spliceCandidates)) {
    const candidate = spliceCandidates[0];
    if (candidate !== undefined) {
      splice = {
        scope: candidate.scope === null ? null : emitter.canonicalScope(candidate.scope),
      };
    }
  } else {
    conflicts.push({
      name: "splice",
      category: "conflicting-clause-scope",
      detail:
        "the unkeyed clause splice has incompatible scope transitions across its declarations",
    });
  }

  return {
    key,
    declarations,
    supportedScopes,
    scopes,
    scopeType: renderedScopeType(scopes),
    comparison: declarations.some((declaration) => declaration.comparison),
    removed: declaredRemoved(key, declarations),
    scalars,
    blocks,
    body: { splice, clauses, args },
    conflicts,
  };
}

/** Lowers every entry in a trigger or effect rule table without changing key order. */
export function lowerRuleTable(
  table: ReadonlyMap<string, readonly AliasDecl[]>,
  docs: ReadonlyMap<
    string,
    {
      /** Scope names reported by the Stellaris script documentation dump. */
      readonly scopes: readonly string[];
    }
  >,
  emitter: Emitter,
  scopeIndex: ReadonlyMap<string, string>
): ReadonlyMap<string, LoweredRule> {
  return new Map(
    [...table].map(([key, declarations]) => [
      key,
      lowerRule(key, declarations, docs.get(key), emitter, scopeIndex),
    ])
  );
}
