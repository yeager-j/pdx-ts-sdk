import { loadRules as loadConfiguredRuleFiles } from "./cwt/load.ts";
import type { RuleSet } from "./cwt/rules.ts";
import { EXTRA_ALIAS_CATEGORIES } from "./overlay/index.ts";
import { CONTENT_MANIFEST } from "./policy/manifest.ts";

/**
 * Loads the complete generator rule set from a cwtools config directory.
 * Manifest sources and overlay alias categories are included automatically.
 */
export function loadRules(configDirectory: string): RuleSet {
  return loadConfiguredRuleFiles(
    configDirectory,
    CONTENT_MANIFEST.map((entry) => entry.source),
    [...EXTRA_ALIAS_CATEGORIES.keys()]
  );
}
