/**
 * The generator's inputs, read once per process, and the derived tables every
 * command and test in this package shares: the rules, the modifier join, the
 * event field policy, and the script vocabulary the usage fixture is filtered
 * to.
 *
 * Reads the vendored rules and documentation dumps from the repository; never
 * an install.
 */

import { cwtFiles, loadRules as loadRulesFrom } from "@pdx-ts/codegen-cwt/cwt/load";
import { scopeIndex, type ContentType } from "@pdx-ts/codegen-cwt/cwt/rules";
import { joinModifierScopes, type ModifierJoin } from "@pdx-ts/codegen-cwt/emit/script/modifiers";
import { ScopeResolver } from "@pdx-ts/codegen-cwt/lower/scopes";
import { EXTRA_ALIAS_CATEGORIES } from "@pdx-ts/codegen-cwt/overlay";
import { createEventFieldPolicy } from "@pdx-ts/codegen-cwt/policy/event-fields";
import { CONTENT_MANIFEST } from "@pdx-ts/codegen-cwt/policy/manifest";
import {
  CWT_CONFIG_DIRECTORY,
  readGeneratorSources,
  SCRIPT_DOCS_DIRECTORY,
  type GeneratorSources,
} from "@pdx-ts/codegen-cwt/sources";

import { declaredTopLevelFields, TYPES_COUNTED_ELSEWHERE } from "./coverage/unexposed.ts";
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

/**
 * Every `.cwt` file under the config root, read as one rule set, for the
 * content types and bodies the manifest does not pull in. The two descriptor
 * files are left out: they declare `mod_descriptor` twice and no type with a
 * path, so nothing here needs them. `RULES` stays what codegen loads.
 */
const DECLARED = loadRulesFrom(
  CWT_CONFIG_DIRECTORY,
  cwtFiles(CWT_CONFIG_DIRECTORY).filter((file) => !file.endsWith("descriptors.cwt")),
  [...EXTRA_ALIAS_CATEGORIES.keys()]
);

/** One CWT type with a `path`, as the registry denominator counts it. */
export interface DeclaredType {
  readonly type: ContentType;
  /** `path` relative to the game root: `game/` stripped. */
  readonly path: string;
  /** The type's declared top-level fields, from `declaredTopLevelFields`. */
  readonly fields: readonly string[];
}

/** The path a CWT type declares, relative to the game root. */
export function relativeTypePath(type: ContentType): string {
  return (type.path ?? "").replace(/^game\//, "");
}

/** Every declared type with a path, in declaration order. */
export const DECLARED_TYPES: readonly DeclaredType[] = [...DECLARED.contentTypes.values()]
  .filter((type) => type.path !== null)
  .map((type) => ({
    type,
    path: relativeTypePath(type),
    fields: declaredTopLevelFields(DECLARED.bodies.get(type.name)),
  }));

const MANIFESTED_TYPES: ReadonlySet<string> = new Set(CONTENT_MANIFEST.map((entry) => entry.type));

/**
 * The declared types with a path that no manifest row exposes and no other
 * surface counts, in declaration order. The registry surface counts these
 * beside the manifested registries.
 */
export const UNEXPOSED_TYPES: readonly DeclaredType[] = DECLARED_TYPES.filter(
  (declared) =>
    !MANIFESTED_TYPES.has(declared.type.name) && !TYPES_COUNTED_ELSEWHERE.has(declared.type.name)
);
