/**
 * The fs shell over `cwt/rules.ts`: finds, reads, and parses the `.cwt` files,
 * then hands the parsed nodes to the pure readers.
 *
 * Trigger/effect infrastructure is fixed; the caller supplies the content
 * registry source files and the extra alias categories to read. The composing
 * entry point that supplies both from the manifest and the overlay is
 * `src/load-rules.ts`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseCwt } from "./parser.ts";
import {
  buildRuleSet,
  readContentTypes,
  type ContentType,
  type ParsedRuleFile,
  type RuleSet,
} from "./rules.ts";

const BASE_RULE_FILES = [
  "aliases.cwt",
  "enums.cwt",
  "scopes.cwt",
  "links.cwt",
  "triggers.cwt",
  "effects.cwt",
  "pre_triggers.cwt",
  "dlc_list.cwt",
  "events/events.cwt",
  "events/event_namespaces.cwt",
  "on_actions.cwt",
  "modifiers.cwt",
  "modifier_categories.cwt",
  // For `enum[complex_maths_enum]` and `enum[simple_maths_enum]`, which the
  // weight-block lowering strips out of a `modifier` row to leave the trigger
  // that gates it. They are declared here rather than in enums.cwt, and no
  // registry's own source pulls this file in.
  "modifier_rule.cwt",
  // Sources for the councilor, economic_category, and civic_or_origin alias
  // categories. Loading governments.cwt here also feeds the
  // government_trigger alias category through loadRules proper.
  "common/governments.cwt",
  "common/economic_categories.cwt",
  // The only source of the fleet_action alias category, which `queue_actions`
  // splices. No content registry names this file, so nothing else pulls it in.
  "common/fleet_actions.cwt",
];

function cwtFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  const files: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const child = path.join(relative, name);
    if (statSync(file).isDirectory()) {
      files.push(...cwtFiles(root, child));
      continue;
    }
    if (name.endsWith(".cwt")) {
      files.push(child);
    }
  }
  return files;
}

/** Loads only content type declarations from an explicit list of CWT files. */
export function loadContentTypesFrom(
  root: string,
  files: readonly string[]
): ReadonlyMap<string, ContentType> {
  const contentTypes = new Map<string, ContentType>();
  for (const relative of files) {
    const parsed = parseCwt(readFileSync(path.join(root, relative), "utf8"), relative);
    for (const [name, contentType] of readContentTypes(parsed.nodes)) {
      contentTypes.set(name, contentType);
    }
  }
  return contentTypes;
}

function parseFile(root: string, relative: string): ParsedRuleFile {
  return {
    file: relative,
    parsed: parseCwt(readFileSync(path.join(root, relative), "utf8"), relative),
  };
}

/** Loads the configured CWT sources and builds their complete classified rule set. */
export function loadRules(
  root: string,
  extraSourceFiles: readonly string[],
  extraAliasCategories: readonly string[]
): RuleSet {
  const ruleFiles = [...new Set([...BASE_RULE_FILES, ...extraSourceFiles])];
  const parsedFiles = ruleFiles.map((relative) => parseFile(root, relative));
  const loaded = new Set(ruleFiles);
  const extraComplexEnumFiles = cwtFiles(root)
    .filter((relative) => !loaded.has(relative))
    .map((relative) => parseFile(root, relative));
  return buildRuleSet(parsedFiles, extraComplexEnumFiles, extraAliasCategories);
}
