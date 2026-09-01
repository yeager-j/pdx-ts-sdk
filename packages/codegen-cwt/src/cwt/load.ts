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

import { parseCwt, type CwtDiagnostic } from "./parser.ts";
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

/**
 * Lists every `.cwt` file under `root`, as `/`-separated paths relative to it.
 *
 * The separator is fixed rather than the platform's for two reasons, both of
 * which `path.join` would break on Windows. These strings are compared against
 * the `/`-spelled literals in {@link BASE_RULE_FILES} and the manifest to find
 * the files the primary load already covers, and they become the `file` on a
 * parse diagnostic, which reaches the drift baseline — a reviewed artifact
 * compared byte for byte on every platform CI runs.
 */
export function cwtFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  const files: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const child = relative === "" ? name : `${relative}/${name}`;
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

/** Content type declarations and parser diagnostics loaded from CWT files. */
export interface ContentTypeLoadResult {
  /** Content type declarations keyed by their CWT type name. */
  readonly contentTypes: ReadonlyMap<string, ContentType>;
  /** Recoverable parser diagnostics from the loaded files. */
  readonly diagnostics: readonly CwtDiagnostic[];
}

/** Loads content type declarations and parser diagnostics from explicit CWT files. */
export function loadContentTypesFrom(
  root: string,
  files: readonly string[]
): ContentTypeLoadResult {
  const contentTypes = new Map<string, ContentType>();
  const diagnostics: CwtDiagnostic[] = [];
  for (const relative of files) {
    const parsed = parseCwt(readFileSync(path.join(root, relative), "utf8"), relative);
    diagnostics.push(...parsed.diagnostics);
    for (const { key, value } of readContentTypes(parsed.nodes)) {
      contentTypes.set(key, value);
    }
  }
  return { contentTypes, diagnostics };
}

function parseFile(root: string, relative: string): ParsedRuleFile {
  return {
    file: relative,
    parsed: parseCwt(readFileSync(path.join(root, relative), "utf8"), relative),
  };
}

/** The parsed CWT sources {@link buildRuleSet} reads, split by the role each plays. */
export interface ParsedRuleSources {
  /** The configured rule files, read for every rule table. */
  readonly ruleFiles: readonly ParsedRuleFile[];
  /** The remaining `.cwt` files, swept for complex enum declarations alone. */
  readonly complexEnumFiles: readonly ParsedRuleFile[];
}

/** Finds and parses the configured CWT sources and the complex-enum sweep around them. */
export function parseRuleSources(
  root: string,
  extraSourceFiles: readonly string[]
): ParsedRuleSources {
  const ruleFiles = [...new Set([...BASE_RULE_FILES, ...extraSourceFiles])];
  const loaded = new Set(ruleFiles);
  return {
    ruleFiles: ruleFiles.map((relative) => parseFile(root, relative)),
    complexEnumFiles: cwtFiles(root)
      .filter((relative) => !loaded.has(relative))
      .map((relative) => parseFile(root, relative)),
  };
}

/** Loads the configured CWT sources and builds their complete classified rule set. */
export function loadRules(
  root: string,
  extraSourceFiles: readonly string[],
  extraAliasCategories: readonly string[]
): RuleSet {
  const sources = parseRuleSources(root, extraSourceFiles);
  return buildRuleSet(sources.ruleFiles, sources.complexEnumFiles, extraAliasCategories);
}
