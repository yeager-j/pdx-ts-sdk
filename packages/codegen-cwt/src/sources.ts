/**
 * Where the generator's inputs live in the repository, and how they are read.
 *
 * The rules and the documentation dumps are the two source families of the
 * vendored cwtools config fork. Every consumer that emits from them reads them
 * here, so the docs version and the directory layout are stated once.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuleSet } from "./cwt/rules.ts";
import { loadRules } from "./load-rules.ts";
import { parseModifierDocs, type ModifierDocs } from "./logs/modifier-docs.ts";
import { parseScopeLinks } from "./logs/scopes.ts";
import { parseTriggerDocs } from "./logs/trigger-docs.ts";
import { CWT_SCRIPT_DOCS_VERSION } from "./provenance.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The vendored cwtools config fork (a git submodule). */
export const CWT_REPOSITORY_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "vendor/cwtools-stellaris-config"
);

/** The `.cwt` rule files inside the fork. */
export const CWT_CONFIG_DIRECTORY = path.join(CWT_REPOSITORY_DIRECTORY, "config");

/** The Stellaris documentation dumps of the version named by {@link CWT_SCRIPT_DOCS_VERSION}. */
export const SCRIPT_DOCS_DIRECTORY = path.join(
  CWT_REPOSITORY_DIRECTORY,
  "script-docs",
  CWT_SCRIPT_DOCS_VERSION
);

/** The parsed rules and documentation dumps every emitter reads. */
export interface GeneratorSources {
  /** The loaded `.cwt` rule set. */
  readonly rules: RuleSet;
  /** The trigger and effect documentation dumps. */
  readonly docs: ReturnType<typeof parseTriggerDocs>;
  /** The scope-link documentation dump. */
  readonly links: ReturnType<typeof parseScopeLinks>;
  /** The modifier documentation dump. */
  readonly modifierDocs: ModifierDocs;
}

/**
 * Loads the rules from `configDirectory` and parses the four documentation
 * dumps in `scriptDocsDirectory`.
 *
 * @throws {Error} When a rule file fails to parse or a dump file is missing.
 */
export function readGeneratorSources(
  configDirectory: string,
  scriptDocsDirectory: string
): GeneratorSources {
  const rules = loadRules(configDirectory);
  const docs = parseTriggerDocs(
    readFileSync(path.join(scriptDocsDirectory, "triggers.log"), "utf8"),
    readFileSync(path.join(scriptDocsDirectory, "effects.log"), "utf8")
  );
  const links = parseScopeLinks(readFileSync(path.join(scriptDocsDirectory, "scopes.log"), "utf8"));
  const modifierDocs = parseModifierDocs(
    readFileSync(path.join(scriptDocsDirectory, "modifiers.log"), "utf8")
  );
  return { rules, docs, links, modifierDocs };
}
