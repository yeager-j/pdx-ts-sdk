/** Render-free scope-link classification shared by facts and TypeScript emission. */

import type { RuleSet } from "../cwt/rules.ts";
import type { ScopeLink } from "../logs/scopes.ts";
import { camelCase, safeIdentifier } from "../naming.ts";
import { canonicalScopeSet, skippedRule, type SkippedRule } from "./script-shape.ts";

/** A static scope link with canonical input and output evidence. */
export interface ClassifiedLink {
  /** The PDXScript key, such as `capital_scope`. */
  readonly key: string;
  /** The generated method identifier, such as `capitalScope`. */
  readonly method: string;
  /** Raw input-scope tokens that resolve through the canonical scope index. */
  readonly inputScopes: readonly string[];
  /** The canonical scope reached through the link. */
  readonly outputScope: string;
  /** Documentation attached to each emitted overload. */
  readonly docs: readonly string[];
}

/** Classified links, explicit skips, and the complete navigation vocabulary. */
export interface LinkClassification {
  /** Static links whose input and output scopes can both be typed. */
  readonly links: readonly ClassifiedLink[];
  /** Link declarations excluded from typed wrappers, with stable reasons. */
  readonly skipped: readonly SkippedRule[];
  /**
   * Every scope-navigation link mapped to its destination.
   * `"any"` retains runtime-polymorphic links that typed wrappers cannot expose.
   */
  readonly navigation: ReadonlyMap<string, string>;
}

/** Classifies CWT links without constructing generated source. */
export function classifyLinks(
  rules: RuleSet,
  dumpLinks: ReadonlyMap<string, ScopeLink>,
  scopes: ReadonlyMap<string, string>
): LinkClassification {
  const links: ClassifiedLink[] = [];
  const skipped: SkippedRule[] = [];
  const navigation = new Map<string, string>();
  for (const name of [...rules.links.keys()].sort()) {
    const link = rules.links.get(name)!;
    if (link.type === "value") {
      skipped.push(
        skippedRule(name, "value-link", "value link (produces a number, not scope navigation)")
      );
      continue;
    }
    if (link.fromData) {
      skipped.push(skippedRule(name, "data-link", "data-driven link (from_data)"));
      continue;
    }
    if (link.outputScope === null) {
      skipped.push(skippedRule(name, "missing-output-scope", "declares no output_scope"));
      continue;
    }
    if (link.outputScope.toLowerCase() === "any") {
      navigation.set(name, "any");
      skipped.push(
        skippedRule(
          name,
          "polymorphic-output-scope",
          "output scope is runtime-polymorphic (any) — gated on situations, see roadmap"
        )
      );
      continue;
    }
    const outputScope = scopes.get(link.outputScope.toLowerCase());
    if (outputScope === undefined) {
      skipped.push(
        skippedRule(
          name,
          "unknown-output-scope",
          `output names no known scope (${link.outputScope})`
        )
      );
      continue;
    }
    if (canonicalScopeSet(link.inputScopes, scopes) === null) {
      skipped.push(
        skippedRule(name, "unknown-input-scope", `unknown scope in ${link.inputScopes.join(" ")}`)
      );
      continue;
    }
    navigation.set(name, outputScope);
    links.push({
      key: name,
      method: safeIdentifier(camelCase(name)),
      inputScopes: link.inputScopes,
      outputScope,
      docs: [link.docs[0] ?? dumpLinks.get(name)?.summary ?? ""],
    });
  }
  return { links, skipped, navigation };
}
