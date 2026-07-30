/**
 * Loads the `.cwt` files this spike consumes into a single rule set.
 *
 * Only the inputs the technology and trigger emitters need are read; the rest
 * parse fine but nothing consumes them yet.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { EXTRA_SCOPES } from "../overlay.ts";
import {
  classify,
  classifyBlock,
  scopeOf,
  supportedScopesOf,
  type RuleField,
  type RuleType,
  type ScopeContext,
  type SingleAliasResolver,
} from "./model.ts";
import {
  parseCwt,
  type CwtAssignment,
  type CwtDiagnostic,
  type CwtNode,
  type CwtValue,
} from "./parser.ts";

/** One `alias[trigger:has_edict] = <edict>` declaration. A name may have several. */
export interface AliasDecl {
  readonly name: string;
  readonly type: RuleType;
  readonly docs: readonly string[];
  /** The scope this rule pushes onto its nested block, from `## push_scope`. */
  readonly scope: ScopeContext | null;
  /** Scopes the rule declares itself valid in, from `## scopes`; `null` when unannotated. */
  readonly supportedScopes: readonly string[] | null;
  readonly file: string;
  readonly line: number;
  /** `==` marks a comparison, written in script as `num_moons < 4`. */
  readonly comparison: boolean;
}

export interface ContentType {
  readonly name: string;
  readonly path: string | null;
  readonly subtypes: readonly string[];
  readonly localisation: readonly { key: string; pattern: string; required: boolean }[];
}

export interface RuleSet {
  readonly enums: ReadonlyMap<string, readonly string[]>;
  /** Canonical scope name -> every alias the game answers to. */
  readonly scopes: ReadonlyMap<string, readonly string[]>;
  readonly triggers: ReadonlyMap<string, readonly AliasDecl[]>;
  /** Loaded only so the drift gate covers effects too; nothing emits them yet. */
  readonly effects: ReadonlyMap<string, readonly AliasDecl[]>;
  readonly contentTypes: ReadonlyMap<string, ContentType>;
  /** Top-level rule bodies keyed by content type, e.g. `technology = { ... }`. */
  readonly bodies: ReadonlyMap<string, readonly RuleField[]>;
  readonly diagnostics: readonly CwtDiagnostic[];
}

const RULE_FILES = [
  "aliases.cwt",
  "enums.cwt",
  "scopes.cwt",
  "triggers.cwt",
  "effects.cwt",
  "common/technologies_consolidated.cwt",
] as const;

const ALIAS_KEY = /^alias\[([a-z_]+):(.+)\]$/;
const BRACKET_KEY = /^([a-z_]+)\[(.+)\]$/;

/**
 * `single_alias[trigger_clause] = { ... }` declarations, so that a rule written
 * `alias[trigger:any_country] = single_alias_right[trigger_clause]` can be read
 * as the block it stands for.
 */
function readSingleAliases(nodes: readonly CwtNode[], into: Map<string, CwtValue>): void {
  for (const entry of assignments(nodes)) {
    const match = BRACKET_KEY.exec(entry.key.text);
    if (match !== null && match[1] === "single_alias") {
      into.set(match[2]!, entry.value);
    }
  }
}

function resolverFor(singleAliases: ReadonlyMap<string, CwtValue>): SingleAliasResolver {
  return (name) => singleAliases.get(name);
}

function assignments(nodes: readonly CwtNode[]): CwtAssignment[] {
  return nodes.filter((node): node is CwtAssignment => node.kind === "assignment");
}

function readEnums(nodes: readonly CwtNode[], into: Map<string, string[]>): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "enums" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      const match = BRACKET_KEY.exec(entry.key.text);
      if (match === null || entry.value.kind !== "block") {
        continue;
      }
      const values = entry.value.nodes.flatMap((node) =>
        node.kind === "value" && node.value.kind === "scalar" ? [node.value.text] : []
      );
      into.set(match[2]!, values);
    }
  }
}

function readScopes(nodes: readonly CwtNode[], into: Map<string, string[]>): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "scopes" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      if (entry.value.kind !== "block") {
        continue;
      }
      const aliases = assignments(entry.value.nodes).flatMap((node) =>
        node.key.text === "aliases" && node.value.kind === "block"
          ? node.value.nodes.flatMap((item) =>
              item.kind === "value" && item.value.kind === "scalar" ? [item.value.text] : []
            )
          : []
      );
      into.set(entry.key.text, aliases);
    }
  }
}

function readAliases(
  nodes: readonly CwtNode[],
  file: string,
  category: "trigger" | "effect",
  singleAliases: ReadonlyMap<string, CwtValue>,
  into: Map<string, AliasDecl[]>
): void {
  for (const entry of assignments(nodes)) {
    const match = ALIAS_KEY.exec(entry.key.text);
    if (match === null || match[1] !== category) {
      continue;
    }
    const name = match[2]!.trim();
    const declarations = into.get(name) ?? [];
    declarations.push({
      name,
      type: classify(entry.value, resolverFor(singleAliases)),
      docs: entry.docs,
      scope: scopeOf(entry.options),
      supportedScopes: supportedScopesOf(entry.options),
      file,
      line: entry.line,
      comparison: entry.op === "==",
    });
    into.set(name, declarations);
  }
}

function readLocalisation(block: CwtAssignment): ContentType["localisation"] {
  if (block.value.kind !== "block") {
    return [];
  }
  return assignments(block.value.nodes).map((entry) => ({
    key: entry.key.text,
    pattern: entry.value.kind === "scalar" ? entry.value.text : "",
    required: entry.options.some((option) => option.name === "required"),
  }));
}

function readContentTypes(nodes: readonly CwtNode[], into: Map<string, ContentType>): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "types" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      const match = BRACKET_KEY.exec(entry.key.text);
      if (match === null || match[1] !== "type" || entry.value.kind !== "block") {
        continue;
      }
      const inner = assignments(entry.value.nodes);
      const pathNode = inner.find((node) => node.key.text === "path");
      const localisation = inner.find((node) => node.key.text === "localisation");
      into.set(match[2]!, {
        name: match[2]!,
        path: pathNode?.value.kind === "scalar" ? pathNode.value.text : null,
        subtypes: inner.flatMap((node) => {
          const subtype = BRACKET_KEY.exec(node.key.text);
          return subtype !== null && subtype[1] === "subtype" ? [subtype[2]!] : [];
        }),
        localisation: localisation === undefined ? [] : readLocalisation(localisation),
      });
    }
  }
}

function readBodies(
  nodes: readonly CwtNode[],
  known: ReadonlyMap<string, ContentType>,
  singleAliases: ReadonlyMap<string, CwtValue>,
  into: Map<string, readonly RuleField[]>
): void {
  for (const entry of assignments(nodes)) {
    if (!known.has(entry.key.text) || entry.value.kind !== "block") {
      continue;
    }
    const block = classifyBlock(entry.value, resolverFor(singleAliases));
    if (block.kind === "block") {
      into.set(entry.key.text, block.fields);
    }
  }
}

export function loadRules(root: string): RuleSet {
  const enums = new Map<string, string[]>();
  const scopes = new Map<string, string[]>();
  const triggers = new Map<string, AliasDecl[]>();
  const effects = new Map<string, AliasDecl[]>();
  const contentTypes = new Map<string, ContentType>();
  const bodies = new Map<string, readonly RuleField[]>();
  const singleAliases = new Map<string, CwtValue>();
  const diagnostics: CwtDiagnostic[] = [];

  for (const relative of RULE_FILES) {
    const source = readFileSync(path.join(root, relative), "utf8");
    const parsed = parseCwt(source, relative);
    diagnostics.push(...parsed.diagnostics);
    readSingleAliases(parsed.nodes, singleAliases);
    readEnums(parsed.nodes, enums);
    readScopes(parsed.nodes, scopes);
    readAliases(parsed.nodes, relative, "trigger", singleAliases, triggers);
    readAliases(parsed.nodes, relative, "effect", singleAliases, effects);
    readContentTypes(parsed.nodes, contentTypes);
    readBodies(parsed.nodes, contentTypes, singleAliases, bodies);
  }

  return { enums, scopes, triggers, effects, contentTypes, bodies, diagnostics };
}

/**
 * Maps every canonical scope name and every alias the game answers to onto the
 * canonical name, so `trait` and `Species trait` both resolve to `species_trait`.
 */
export function scopeIndex(rules: RuleSet): Map<string, string> {
  const index = new Map<string, string>();
  for (const scope of EXTRA_SCOPES) {
    index.set(scope, scope);
  }
  for (const [canonical, aliases] of rules.scopes) {
    const key = canonical.toLowerCase().replaceAll(" ", "_");
    index.set(key, key);
    for (const alias of aliases) {
      index.set(alias.toLowerCase(), key);
    }
  }
  return index;
}
