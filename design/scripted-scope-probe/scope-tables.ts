/**
 * The scope facts codegen already owns, as data.
 *
 * `packages/codegen-cwt` resolves every trigger's and effect's legal scopes on
 * its way to emitting `Trigger<"country">`, then stringifies the list away
 * (`scopeType`). Its sibling `canonicalScopeSet` returns the same thing as a
 * list and is already exported; `classifyLinks` already returns each scope
 * link's input set and output scope. So this module invents nothing — it joins
 * three existing readers and keeps the lists.
 *
 * `packages/sdk/tests/codegen/corpus-conformance.test.ts` builds the trigger
 * half of this at test time and throws it away. If the probe's verdict is to
 * ship, this becomes a generated `TRIGGER_META`/`LINK_META` and both callers
 * read it instead.
 *
 * Two facts per rule, not one. `scopes` is where the key itself is legal;
 * `pushes` is the scope its nested block runs in, from `## push_scope`. A walk
 * that knows only the first produces the empty set for any body that navigates
 * (`owner = { is_country_type = ... }`), which is most of them.
 */

import { readFileSync } from "node:fs";
import { loadRules, scopeIndex, type AliasDecl } from "@pdx-ts/codegen-cwt/cwt/rules";
import { classifyLinks } from "@pdx-ts/codegen-cwt/emit/links";
import { canonicalScopeSet, clauseOf, declaredScopes } from "@pdx-ts/codegen-cwt/emit/shape";
import { Emitter } from "@pdx-ts/codegen-cwt/emit/types";
import { parseScopeLinks } from "@pdx-ts/codegen-cwt/logs/scopes";
import { parseTriggerDocs, type DocEntry } from "@pdx-ts/codegen-cwt/logs/trigger-docs";

const CONFIG = "vendor/cwtools-stellaris-config/config";
const DOCS = "vendor/cwtools-stellaris-config/script-docs/v4.4.1";

/**
 * A scope set, or `"universal"` for a rule legal everywhere. `"universal"` is
 * the intersection *identity*, never a member — a rule that constrains nothing
 * must not narrow anything.
 */
export type RuleScopes = readonly string[] | "universal";

export interface RuleFact {
  /** Scopes the key itself is legal in. */
  readonly scopes: RuleScopes;
  /**
   * Set when the rule's block body is nothing but spliced clauses — the
   * `any_owned_planet = { <triggers> }` shape. `scope` is where those clauses
   * run: a pushed scope, or `null` for the enclosing one (`custom_tooltip`).
   */
  readonly splice: { readonly scope: string | null } | null;
  /**
   * Named fields holding a nested clause, and the scope that clause runs in
   * (`null` for the enclosing scope). `count_owned_planet`'s `limit` is planet
   * even though the rule itself pushes nothing — the push sits on the field.
   *
   * A key of a block rule that is NOT in here is an argument, not a condition
   * (`count = 2`), and a walk must ignore it rather than treat it as an unknown
   * trigger.
   */
  readonly clauses: ReadonlyMap<string, string | null>;
  /**
   * The rule's named non-clause fields — `while`'s `count`, `random`'s
   * `chance`. A rule can have both these and a splice (`while = { count = 5
   * <effects> }`), so "not a clause field" is not enough to tell an argument
   * from a spliced condition; this is.
   */
  readonly args: ReadonlySet<string>;
}

export interface LinkFact {
  readonly inputScopes: RuleScopes;
  readonly outputScope: string;
}

export interface ScopeTables {
  /** Keyed lowercase, matching how script writes them. */
  readonly triggers: ReadonlyMap<string, RuleFact>;
  readonly effects: ReadonlyMap<string, RuleFact>;
  readonly links: ReadonlyMap<string, LinkFact>;
}

function factsOf(
  table: ReadonlyMap<string, readonly AliasDecl[]>,
  docs: ReadonlyMap<string, DocEntry>,
  emitter: Emitter,
  index: ReadonlyMap<string, string>
): Map<string, RuleFact> {
  const out = new Map<string, RuleFact>();
  for (const [key, declarations] of table) {
    const supported = declaredScopes(declarations, docs.get(key));
    const scopes = supported.length === 0 ? null : canonicalScopeSet(supported, index);
    if (scopes === null) {
      // Neither the rules nor the game's dump names a scope, or one of them
      // names a scope the index does not know. Either way this rule says
      // nothing about scope, and a walk must treat it as unknown rather than
      // invent a set. Omitted, so `get` returns undefined and the caller sees
      // "unknown" rather than a fabricated "universal".
      continue;
    }
    out.set(key.toLowerCase(), { scopes, ...bodyOf(declarations, emitter) });
  }
  return out;
}

/**
 * Where a block rule's nested clauses live and what scope each runs in,
 * resolved the way `emit/shape.ts`'s `clauseScope` resolves it: the field's own
 * `## push_scope`, else the declaration's, else the enclosing scope.
 */
function bodyOf(
  declarations: readonly AliasDecl[],
  emitter: Emitter
): {
  splice: { scope: string | null } | null;
  clauses: ReadonlyMap<string, string | null>;
  args: ReadonlySet<string>;
} {
  let splice: { scope: string | null } | null = null;
  const clauses = new Map<string, string | null>();
  const args = new Set<string>();
  for (const declaration of declarations) {
    if (declaration.type.kind !== "block") {
      continue;
    }
    const inherited = declaration.scope?.this ?? null;
    const resolve = (own: string | null): string | null => {
      const pushed = own ?? inherited;
      return pushed === null ? null : emitter.canonicalScope(pushed);
    };
    for (const field of declaration.type.fields) {
      const own = field.scope?.this ?? null;
      if (field.key.kind === "aliasName") {
        if (field.key.category === "trigger" || field.key.category === "effect") {
          splice = { scope: resolve(own) };
        }
        continue;
      }
      if (field.key.kind !== "name") {
        continue;
      }
      if (clauseOf(field.type) === null) {
        args.add(field.key.name.toLowerCase());
      } else {
        clauses.set(field.key.name.toLowerCase(), resolve(own));
      }
    }
  }
  return { splice, clauses, args };
}

export function loadScopeTables(): ScopeTables {
  const rules = loadRules(CONFIG);
  const emitter = new Emitter(rules);
  const index = scopeIndex(rules);
  const docs = parseTriggerDocs(
    readFileSync(`${DOCS}/triggers.log`, "utf8"),
    readFileSync(`${DOCS}/effects.log`, "utf8")
  );
  const dumpLinks = new Map(
    parseScopeLinks(readFileSync(`${DOCS}/scopes.log`, "utf8")).map((link) => [link.name, link])
  );

  const links = new Map<string, LinkFact>();
  for (const link of classifyLinks(emitter, dumpLinks, index).links) {
    const inputScopes = canonicalScopeSet(link.inputScopes, index);
    if (inputScopes === null) {
      continue;
    }
    links.set(link.key.toLowerCase(), { inputScopes, outputScope: link.outputScope });
  }

  return {
    triggers: factsOf(rules.triggers, docs.triggers, emitter, index),
    effects: factsOf(rules.effects, docs.effects, emitter, index),
    links,
  };
}
