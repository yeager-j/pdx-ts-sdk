/**
 * Loads the `.cwt` files codegen consumes into a single rule set.
 *
 * Trigger/effect infrastructure is fixed; content registry sources come from
 * the explicit public-interface manifest.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { CONTENT_MANIFEST } from "../content-manifest.ts";
import { EXTRA_SCOPES } from "../overlay.ts";
import {
  classify,
  classifyBlock,
  findOption,
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

/**
 * One `subtype[...]` declaration with the options that ride on it. For the
 * event type these carry the whole event-kind table: `## group = event_type`,
 * `## type_key_filter = country_event`, `## push_scope = country`.
 */
export interface ContentSubtype {
  readonly name: string;
  readonly group: string | null;
  readonly keyFilter: string | null;
  readonly pushScope: string | null;
  readonly displayName: string | null;
}

export interface ContentType {
  readonly name: string;
  readonly path: string | null;
  readonly subtypes: readonly ContentSubtype[];
  readonly localisation: readonly { key: string; pattern: string; required: boolean }[];
}

export interface ContentBody {
  readonly fields: readonly RuleField[];
  /** Scope inherited by fields without their own replace/push annotation. */
  readonly scope: ScopeContext | null;
}

export interface OnActionDecl {
  readonly name: string;
  readonly eventType: string | null;
  readonly scopes: ReadonlyMap<string, string>;
  readonly docs: readonly string[];
  readonly file: string;
  readonly line: number;
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
  readonly bodies: ReadonlyMap<string, ContentBody>;
  readonly onActions: readonly OnActionDecl[];
  /** Modifier category -> raw `supported_scopes` tokens (`any` means every scope). */
  readonly modifierCategories: ReadonlyMap<string, readonly string[]>;
  /** Concrete modifier names `modifiers.cwt` declares, with their categories. */
  readonly modifierDecls: ReadonlyMap<string, readonly string[]>;
  /** Templated `modifiers.cwt` rows (`<ship_size>_…`) the game expands from content. */
  readonly modifierTemplates: readonly string[];
  readonly diagnostics: readonly CwtDiagnostic[];
}

const RULE_FILES = [
  "aliases.cwt",
  "enums.cwt",
  "scopes.cwt",
  "triggers.cwt",
  "effects.cwt",
  "events/events.cwt",
  "events/event_namespaces.cwt",
  "on_actions.cwt",
  "modifiers.cwt",
  "modifier_categories.cwt",
  ...CONTENT_MANIFEST.map((entry) => entry.source),
].filter((file, index, files) => files.indexOf(file) === index);

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

function readModifierCategories(nodes: readonly CwtNode[], into: Map<string, string[]>): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "modifier_categories" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      if (entry.value.kind !== "block") {
        continue;
      }
      const scopes = assignments(entry.value.nodes).flatMap((node) =>
        node.key.text === "supported_scopes" && node.value.kind === "block"
          ? node.value.nodes.flatMap((item) =>
              item.kind === "value" && item.value.kind === "scalar" ? [item.value.text] : []
            )
          : []
      );
      into.set(entry.key.text, scopes);
    }
  }
}

function readModifierDecls(
  nodes: readonly CwtNode[],
  into: Map<string, string[]>,
  templates: string[]
): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "modifiers" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      if (entry.value.kind !== "block") {
        continue;
      }
      if (entry.key.text.includes("<") || entry.key.text.includes("[")) {
        templates.push(entry.key.text);
        continue;
      }
      const categories = entry.value.nodes.flatMap((item) =>
        item.kind === "value" && item.value.kind === "scalar" ? [item.value.text] : []
      );
      into.set(entry.key.text, categories);
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
  return assignments(block.value.nodes).flatMap((entry) => {
    const subtype = BRACKET_KEY.exec(entry.key.text);
    if (subtype !== null && subtype[1] === "subtype") {
      return readLocalisation(entry);
    }
    return [
      {
        key: entry.key.text,
        pattern: entry.value.kind === "scalar" ? entry.value.text : "",
        required: entry.options.some((option) => option.name === "required"),
      },
    ];
  });
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
          if (subtype === null || subtype[1] !== "subtype") {
            return [];
          }
          const scalarOption = (name: string): string | null => {
            const option = findOption(node.options, name);
            return option?.value?.kind === "scalar" ? option.value.text : null;
          };
          return [
            {
              name: subtype[2]!,
              group: scalarOption("group"),
              keyFilter: scalarOption("type_key_filter"),
              pushScope: scopeOf(node.options)?.this ?? null,
              displayName: scalarOption("display_name"),
            },
          ];
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
  into: Map<string, ContentBody>
): void {
  for (const entry of assignments(nodes)) {
    if (!known.has(entry.key.text) || entry.value.kind !== "block") {
      continue;
    }
    const block = classifyBlock(entry.value, resolverFor(singleAliases));
    if (block.kind === "block") {
      into.set(entry.key.text, {
        fields: block.fields,
        scope: scopeOf(entry.options),
      });
    }
  }
}

function readOnActions(nodes: readonly CwtNode[], file: string, into: OnActionDecl[]): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "on_actions" || outer.value.kind !== "block") {
      continue;
    }
    for (const node of outer.value.nodes) {
      if (node.kind !== "value" || node.value.kind !== "scalar") {
        continue;
      }
      const eventType = findOption(node.options, "event_type");
      const replaceScopes = findOption(node.options, "replace_scopes");
      const scopes = new Map<string, string>();
      if (replaceScopes?.value?.kind === "block") {
        for (const scope of assignments(replaceScopes.value.nodes)) {
          if (scope.value.kind === "scalar") {
            scopes.set(scope.key.text.toLowerCase(), scope.value.text);
          }
        }
      }
      into.push({
        name: node.value.text,
        eventType: eventType?.value?.kind === "scalar" ? eventType.value.text : null,
        scopes,
        docs: node.docs,
        file,
        line: node.line,
      });
    }
  }
}

export function loadRules(root: string): RuleSet {
  const enums = new Map<string, string[]>();
  const scopes = new Map<string, string[]>();
  const triggers = new Map<string, AliasDecl[]>();
  const effects = new Map<string, AliasDecl[]>();
  const contentTypes = new Map<string, ContentType>();
  const bodies = new Map<string, ContentBody>();
  const onActions: OnActionDecl[] = [];
  const modifierCategories = new Map<string, string[]>();
  const modifierDecls = new Map<string, string[]>();
  const modifierTemplates: string[] = [];
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
    readOnActions(parsed.nodes, relative, onActions);
    readModifierCategories(parsed.nodes, modifierCategories);
    readModifierDecls(parsed.nodes, modifierDecls, modifierTemplates);
  }

  return {
    enums,
    scopes,
    triggers,
    effects,
    contentTypes,
    bodies,
    onActions,
    modifierCategories,
    modifierDecls,
    modifierTemplates,
    diagnostics,
  };
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
