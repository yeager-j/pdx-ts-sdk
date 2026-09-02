/**
 * The scope facts this generator already computes, kept as data.
 *
 * Every trigger, effect, and scope link's legal scopes are resolved on the way
 * to emitting `Trigger<"country">`, then stringified away by `scopeType`. Its
 * sibling `canonicalScopeSet` returns the same thing as a list; `classifyLinks`
 * already returns each link's input set and output scope. This module joins the
 * three readers and keeps the lists, so a consumer that needs to *reason* about
 * scope rather than print it has somewhere to read from.
 *
 * Which of the two disagreeing sources a rule's scopes come from is not decided
 * here. The reviewed drift baseline decides it once, and both this module and
 * the emitters read that decision, so the facts and the generated types can
 * never describe a rule differently.
 *
 * That decision is only good for the sources it was reviewed against, so the
 * baseline is reconciled against the rules and dumps at the supplied roots
 * before any of it is applied. `@pdx-ts/codegen-vanilla` reads these facts
 * without running the CWT generator, so without that check a vendor change
 * could feed a stale decision into `@pdx-ts/stellaris-ids` until someone
 * happened to run `npm run codegen`. Both generators now share the one gate.
 *
 * The one consumer today is `@pdx-ts/codegen-vanilla`, which intersects these
 * facts over vanilla's scripted trigger and effect bodies to infer each
 * definition's scope (SDK-13); `packages/codegen-vanilla/tests/callsites.test.ts`
 * is the standing gate on that inference.
 *
 * Deliberately NOT emitted into `packages/sdk/src/generated/`. It is build-time
 * data with no runtime consumer, and the SDK is the package that ships.
 *
 * Two facts per rule, not one. `scopes` is where the key itself is legal;
 * `splice` and `clauses` say where its nested conditions run. An analysis with
 * only the first produces the empty set for any body that navigates
 * (`owner = { is_country_type = ... }`), which is most of them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { scopeIndex } from "./cwt/rules.ts";
import { loadRules } from "./load-rules.ts";
import { parseModifierDocs } from "./logs/modifier-docs.ts";
import { parseScopeLinks } from "./logs/scopes.ts";
import { parseTriggerDocs } from "./logs/trigger-docs.ts";
import { classifyLinks } from "./lower/links.ts";
import { lowerRuleTable, type LoweredRule } from "./lower/lowered-rule.ts";
import { ScopeResolver } from "./lower/scopes.ts";
import { canonicalScopeSet } from "./lower/script-shape.ts";
import { compareToBaseline, loadBaseline } from "./reconcile/baseline.ts";
import { reconcile, type DriftBaseline, type DriftReport } from "./reconcile/reconcile.ts";
import { scopeAuthorityOf } from "./reconcile/scope-authority.ts";

/**
 * A scope set, or `"universal"` for a rule legal everywhere. `"universal"` is
 * the intersection *identity* and the union absorber, never a member — the two
 * properties that let a consumer treat "unknown" as safe.
 */
export type RuleScopes = readonly string[] | "universal";

/** Scope and nested-body facts for one trigger or effect rule. */
export interface RuleFact {
  /** Scopes the key itself is legal in. */
  readonly scopes: RuleScopes;
  /**
   * The scope of an unkeyed clause splice, when the rule body exposes one.
   * `null` inside the value means the splice runs in the enclosing rule scope.
   */
  readonly splice: {
    /** The canonical pushed scopes, or `null` for the enclosing scope. */
    readonly scope: readonly string[] | null;
  } | null;
  /**
   * Named nested-clause fields and their canonical pushed scopes.
   * A `null` value means the clause runs in the enclosing rule scope.
   */
  readonly clauses: ReadonlyMap<string, readonly string[] | null>;
  /**
   * Lowercase names of the rule's non-clause arguments.
   * Use this set to distinguish arguments from unkeyed clause entries.
   */
  readonly args: ReadonlySet<string>;
}

/** The legal input scopes and fixed output scope of one scope link. */
export interface LinkFact {
  /** Canonical scopes from which the link can be used. */
  readonly inputScopes: RuleScopes;
  /** The canonical scope reached through the link. */
  readonly outputScope: string;
}

/** Build-time scope facts keyed by lowercase PDXScript names. */
export interface ScopeFacts {
  /** Trigger facts keyed lowercase, matching how script writes them. */
  readonly triggers: ReadonlyMap<string, RuleFact>;
  /** Effect facts keyed lowercase, matching how script writes them. */
  readonly effects: ReadonlyMap<string, RuleFact>;
  /** Scope-link facts keyed lowercase, matching how script writes them. */
  readonly links: ReadonlyMap<string, LinkFact>;
}

function factsOf(table: ReadonlyMap<string, LoweredRule>): Map<string, RuleFact> {
  const out = new Map<string, RuleFact>();
  for (const [key, rule] of table) {
    if (rule.removed) {
      // The game no longer accepts the rule, so no consumer should infer a
      // scope from a body that writes it.
      continue;
    }
    if (rule.scopes === null) {
      // Neither source names a scope, or one of them names a scope the index
      // does not know. The rule is dropped WHOLE rather than narrowed to its
      // recognizable members: dropping members would manufacture a narrowing
      // the rules do not support, and an absent key reads as "unknown", which
      // every consumer must already treat as unconstraining.
      continue;
    }
    out.set(key.toLowerCase(), { scopes: rule.scopes, ...rule.body });
  }
  return out;
}

function linkFactsOf(
  links: readonly {
    readonly key: string;
    readonly inputScopes: readonly string[];
    readonly outputScope: string;
  }[],
  index: ReadonlyMap<string, string>
): Map<string, LinkFact> {
  const facts = new Map<string, LinkFact>();
  for (const link of links) {
    const inputScopes = canonicalScopeSet(link.inputScopes, index);
    if (inputScopes !== null) {
      facts.set(link.key.toLowerCase(), { inputScopes, outputScope: link.outputScope });
    }
  }
  return facts;
}

/**
 * Fails unless the committed baseline was reviewed against the rule sources it is
 * about to decide for, so a stale decision cannot reach a generator that never
 * runs the drift gate itself.
 */
function assertBaselineMatches(baseline: DriftBaseline, report: DriftReport): void {
  const differences = compareToBaseline(report, baseline);
  if (differences.length === 0) {
    return;
  }
  throw new Error(
    "The drift baseline does not match these rule sources, so its scope decisions " +
      "cannot be applied. Review drift with `npm run codegen`.\n" +
      differences.join("\n")
  );
}

function readScopeFacts(configRoot: string, docsRoot: string): ScopeFacts {
  const rules = loadRules(configRoot);
  const scopeResolver = new ScopeResolver(rules);
  const index = scopeIndex(rules);
  const docs = parseTriggerDocs(
    readFileSync(path.join(docsRoot, "triggers.log"), "utf8"),
    readFileSync(path.join(docsRoot, "effects.log"), "utf8")
  );
  const scopeLinks = parseScopeLinks(readFileSync(path.join(docsRoot, "scopes.log"), "utf8"));
  const modifierDocs = parseModifierDocs(
    readFileSync(path.join(docsRoot, "modifiers.log"), "utf8")
  );

  const baseline = loadBaseline();
  assertBaselineMatches(baseline, reconcile(rules, docs, modifierDocs, scopeLinks));
  const authority = scopeAuthorityOf(baseline, index);

  const triggers = lowerRuleTable(
    rules.triggers,
    docs.triggers,
    scopeResolver,
    index,
    authority.triggers
  );
  const effects = lowerRuleTable(
    rules.effects,
    docs.effects,
    scopeResolver,
    index,
    authority.effects
  );
  const dumpLinks = new Map(scopeLinks.links.map((link) => [link.name, link]));

  const links = linkFactsOf(classifyLinks(rules, dumpLinks, index).links, index);

  return {
    triggers: factsOf(triggers),
    effects: factsOf(effects),
    links,
  };
}

const factsByRoot = new Map<string, ScopeFacts>();

/**
 * Loads CWT rules and documentation dumps and returns their canonical scope facts.
 *
 * Scopes come from the committed drift baseline's reviewed decision, the same
 * authority the emitters read. The baseline is reconciled against the rules and
 * dumps at these roots first, so its decisions are only applied to the sources
 * they were reviewed against. Missing or unknown scope declarations are omitted
 * instead of being narrowed by guesswork.
 *
 * The result is read once per root pair per process and shared afterwards, so a
 * caller that edits files under a root within one process must pass a different
 * root to see the change.
 *
 * @throws When the committed baseline does not match the rules and documentation
 *   at these roots. Drift is reviewed by `npm run codegen`, never here. A failed
 *   check is not retained, so a later call repeats it.
 */
export function loadScopeFacts(configRoot: string, docsRoot: string): ScopeFacts {
  const key = JSON.stringify([configRoot, docsRoot]);
  const cached = factsByRoot.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const facts = readScopeFacts(configRoot, docsRoot);
  factsByRoot.set(key, facts);
  return facts;
}
