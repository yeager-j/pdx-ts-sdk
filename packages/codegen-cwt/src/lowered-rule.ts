import type { RuleField, RuleType } from "./cwt/model.ts";
import type { AliasDecl } from "./cwt/rules.ts";
import { canonicalScopeSet, clauseOf, declaredScopes } from "./emit/shape.ts";
import type { Emitter } from "./emit/types.ts";

export type LoweredRuleScopes = readonly string[] | "universal";

export interface LoweredRuleBody {
  readonly splice: { readonly scope: string | null } | null;
  readonly clauses: ReadonlyMap<string, string | null>;
  readonly args: ReadonlySet<string>;
}

export interface LoweredRuleBlock {
  readonly declaration: AliasDecl;
  readonly type: RuleType & { readonly kind: "block" };
  readonly inheritedScope: string | null;
  readonly named: readonly RuleField[];
  readonly splices: readonly RuleField[];
}

/**
 * One normalized view of a CWT trigger or effect rule.
 *
 * Emitters keep their policy differences, but scopes and block membership are
 * decided here once. Scope-facts is a projection of `body`, not another CWT
 * traversal.
 */
export interface LoweredRule {
  readonly key: string;
  readonly declarations: readonly AliasDecl[];
  readonly supportedScopes: readonly string[];
  readonly scopes: LoweredRuleScopes | null;
  readonly scopeType: string | null;
  readonly comparison: boolean;
  readonly scalars: readonly AliasDecl[];
  readonly blocks: readonly LoweredRuleBlock[];
  readonly body: LoweredRuleBody;
}

function renderedScopeType(scopes: LoweredRuleScopes | null): string | null {
  if (scopes === null) {
    return null;
  }
  return scopes === "universal"
    ? "ScopeName"
    : scopes.map((scope) => JSON.stringify(scope)).join(" | ");
}

export function lowerRule(
  key: string,
  declarations: readonly AliasDecl[],
  doc: { readonly scopes: readonly string[] } | undefined,
  emitter: Emitter,
  scopeIndex: ReadonlyMap<string, string>
): LoweredRule {
  const supportedScopes = declaredScopes(declarations, doc);
  const scopes =
    supportedScopes.length === 0 ? null : canonicalScopeSet(supportedScopes, scopeIndex);
  const scalars: AliasDecl[] = [];
  const blocks: LoweredRuleBlock[] = [];
  let splice: { scope: string | null } | null = null;
  const clauses = new Map<string, string | null>();
  const args = new Set<string>();

  for (const declaration of declarations) {
    if (declaration.type.kind !== "block") {
      scalars.push(declaration);
      continue;
    }
    const inheritedScope = declaration.scope?.this ?? null;
    const named: RuleField[] = [];
    const splices: RuleField[] = [];
    const resolve = (own: string | null): string | null => {
      const pushed = own ?? inheritedScope;
      return pushed === null ? null : emitter.canonicalScope(pushed);
    };

    for (const field of declaration.type.fields) {
      const own = field.scope?.this ?? null;
      if (field.key.kind === "aliasName") {
        splices.push(field);
        if (field.key.category === "trigger" || field.key.category === "effect") {
          splice = { scope: resolve(own) };
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
        clauses.set(field.key.name.toLowerCase(), resolve(own));
      }
    }
    blocks.push({ declaration, type: declaration.type, inheritedScope, named, splices });
  }

  return {
    key,
    declarations,
    supportedScopes,
    scopes,
    scopeType: renderedScopeType(scopes),
    comparison: declarations.some((declaration) => declaration.comparison),
    scalars,
    blocks,
    body: { splice, clauses, args },
  };
}

export function lowerRuleTable(
  table: ReadonlyMap<string, readonly AliasDecl[]>,
  docs: ReadonlyMap<string, { readonly scopes: readonly string[] }>,
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
