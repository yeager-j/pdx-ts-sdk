/**
 * The one-call rule-set entry point the pipeline and every test uses.
 *
 * `cwt/load.ts` stays pure over the rule files it is told to read; this
 * module composes it with the two inputs that decide *which* extras it reads:
 * the content manifest's source files and the overlay's extra alias
 * categories. Callers that deliberately want a narrower load pass explicit
 * parameters to `cwt/load.ts` directly.
 */

import { loadRules as loadRulesFromFiles } from "./cwt/load.ts";
import type { RuleSet } from "./cwt/rules.ts";
import { EXTRA_ALIAS_CATEGORIES } from "./overlay/index.ts";
import { CONTENT_MANIFEST } from "./policy/manifest.ts";

export function loadRules(root: string): RuleSet {
  return loadRulesFromFiles(
    root,
    CONTENT_MANIFEST.map((entry) => entry.source),
    [...EXTRA_ALIAS_CATEGORIES.keys()]
  );
}
