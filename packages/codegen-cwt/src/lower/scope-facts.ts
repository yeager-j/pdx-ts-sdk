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

import { scopeIndex } from "../cwt/rules.ts";
import { classifyLinks } from "../emit/script/links.ts";
import { loadRules } from "../load-rules.ts";
import { parseScopeLinks } from "../logs/scopes.ts";
import { parseTriggerDocs } from "../logs/trigger-docs.ts";
import { Emitter } from "../render/emitter.ts";
import { lowerRuleTable, type LoweredRule } from "./lowered-rule.ts";
import { canonicalScopeSet } from "./script-shape.ts";

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
    /** The canonical pushed scope, or `null` for the enclosing rule scope. */
    readonly scope: string | null;
  } | null;
  /**
   * Named nested-clause fields and their canonical pushed scopes.
   * A `null` value means the clause runs in the enclosing rule scope.
   */
  readonly clauses: ReadonlyMap<string, string | null>;
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
 * Loads CWT rules and documentation dumps and returns their canonical scope facts.
 * Missing or unknown scope declarations are omitted instead of being narrowed by guesswork.
 */
export function loadScopeFacts(configRoot: string, docsRoot: string): ScopeFacts {
  const rules = loadRules(configRoot);
  const emitter = new Emitter(rules);
  const index = scopeIndex(rules);
  const docs = parseTriggerDocs(
    readFileSync(path.join(docsRoot, "triggers.log"), "utf8"),
    readFileSync(path.join(docsRoot, "effects.log"), "utf8")
  );
  const triggers = lowerRuleTable(rules.triggers, docs.triggers, emitter, index);
  const effects = lowerRuleTable(rules.effects, docs.effects, emitter, index);
  const dumpLinks = new Map(
    parseScopeLinks(readFileSync(path.join(docsRoot, "scopes.log"), "utf8")).map((link) => [
      link.name,
      link,
    ])
  );

  const links = linkFactsOf(classifyLinks(emitter, dumpLinks, index).links, index);

  return {
    triggers: factsOf(triggers),
    effects: factsOf(effects),
    links,
  };
}
