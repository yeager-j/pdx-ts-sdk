/**
 * The generator's inputs, read once per process, and the derived tables every
 * command and test in this package shares: the rules, the modifier join, the
 * event field policy, and the script vocabulary the usage fixture is filtered
 * to.
 *
 * Reads the vendored rules and documentation dumps from the repository; never
 * an install.
 */

import { scopeIndex } from "@pdx-ts/codegen-cwt/cwt/rules";
import { joinModifierScopes, type ModifierJoin } from "@pdx-ts/codegen-cwt/emit/script/modifiers";
import { ScopeResolver } from "@pdx-ts/codegen-cwt/lower/scopes";
import { createEventFieldPolicy } from "@pdx-ts/codegen-cwt/policy/event-fields";
import {
  CWT_CONFIG_DIRECTORY,
  readGeneratorSources,
  SCRIPT_DOCS_DIRECTORY,
  type GeneratorSources,
} from "@pdx-ts/codegen-cwt/sources";

import { scriptVocabulary, type ScriptVocabulary } from "./script-usage.ts";

/** The parsed rules and documentation dumps. */
export const SOURCES: GeneratorSources = readGeneratorSources(
  CWT_CONFIG_DIRECTORY,
  SCRIPT_DOCS_DIRECTORY
);

/** The loaded rule set. */
export const RULES = SOURCES.rules;

/** Scope alias to canonical scope name. */
export const SCOPE_INDEX = scopeIndex(RULES);

/** Every modifier name joined with its scope evidence, as `emitModifiers` reads it. */
export const MODIFIER_JOIN: ModifierJoin = (() => {
  const resolver = new ScopeResolver(RULES);
  return joinModifierScopes(RULES, SOURCES.modifierDocs, (token) => resolver.canonicalScope(token));
})();

/** Every modifier name the join knows, scoped or not. */
export const MODIFIER_NAMES: readonly string[] = [
  ...MODIFIER_JOIN.universal,
  ...[...MODIFIER_JOIN.groups.values()].flat(),
  ...MODIFIER_JOIN.unscoped,
];

/** The reviewed event and option field tables, validated against the rules. */
export const EVENT_FIELD_POLICY = createEventFieldPolicy(RULES);

/** The declared script names the usage fixture records counts for. */
export const SCRIPT_VOCABULARY: ScriptVocabulary = scriptVocabulary({
  triggers: RULES.triggers.keys(),
  effects: RULES.effects.keys(),
  links: RULES.links.values(),
  modifiers: MODIFIER_NAMES,
  eventFields: [...EVENT_FIELD_POLICY.event, ...EVENT_FIELD_POLICY.option]
    .filter((entry) => entry.synthetic !== true)
    .map((entry) => entry.scriptKey),
});
