/**
 * Loads the `.cwt` files codegen consumes into a single rule set.
 *
 * Trigger/effect infrastructure is fixed; content registry sources come from
 * the explicit public-interface manifest.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { CONTENT_MANIFEST } from "../content-manifest.ts";
import { EXTRA_ALIAS_CATEGORIES, EXTRA_SCOPES } from "../overlay.ts";
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
  /**
   * The body field carrying the definition's id, when the top-level key is a
   * repeated keyword instead — `utility_component_template = { key = "..." }`
   * rather than `my_id = { ... }`.
   *
   * The keyword itself is NOT recoverable from here. Some types declare it as
   * `## type_key_filter`, but `section_template` and `ambient_object` declare
   * nothing while vanilla writes `ship_section_template` and `ambient_object`,
   * so it comes from the overlay.
   */
  readonly nameField: string | null;
  /**
   * `path_extension`, normalized to include the leading dot. Registries whose
   * files are not `.txt` declare it — sounds are `.asset`, sprites `.gfx`.
   * Absent means the rules say nothing and `.txt` is the game's default.
   *
   * Optional rather than `| null` alone so a synthetic `ContentType` built by
   * an emitter — one standing in for a type the rules never declared, and so
   * having no file layout at all — needs no placeholder for it.
   */
  readonly pathExtension?: string | null;
  /**
   * `skip_root_key`: the definitions live one level inside a root block with
   * this key rather than at the top level. Sprites sit inside `spriteTypes`.
   */
  readonly skipRootKey?: string | null;
  /**
   * `path_strict = yes`: definitions live directly in `path`, never in a
   * subdirectory of it. `technology` declares it because
   * `common/technology/tier` and `common/technology/category` hold
   * `technology_tier` and `technology_category` definitions — different types
   * that a recursive walk would otherwise read as technologies.
   *
   * Optional for the same reason as `pathExtension`: a synthetic `ContentType`
   * has no file layout to describe.
   */
  readonly pathStrict?: boolean;
  /**
   * Type-level `## type_key_filter`, when the type declares exactly one.
   *
   * Carries the negation because CWT writes it both ways and the two mean
   * opposite things: `## type_key_filter = random_list` says the type's entries
   * are *only* the `random_list` ones, while `## type_key_filter <> random_list`
   * says they are everything *but*. Storing the bare key would read the second
   * as the first — so a consumer matching a keyword against it has to check
   * `negated` before believing the key names what the entries are written under.
   */
  readonly keyFilter: { readonly key: string; readonly negated: boolean } | null;
  readonly subtypes: readonly ContentSubtype[];
  readonly localisation: readonly { key: string; pattern: string; required: boolean }[];
}

export interface ContentBody {
  readonly fields: readonly RuleField[];
  /** Scope inherited by fields without their own replace/push annotation. */
  readonly scope: ScopeContext | null;
}

/**
 * One entry of `links.cwt`'s `links = { ... }` table. A static scope link
 * (`owner = { is_at_war = yes }`) navigates from any of its input scopes to its
 * output scope; `type = value` entries produce numbers instead, and
 * `from_data = yes` entries take a data-driven second half (`parameter:x`).
 */
export interface LinkDecl {
  readonly name: string;
  readonly docs: readonly string[];
  /** Raw scope tokens; `all` means valid everywhere. */
  readonly inputScopes: readonly string[];
  /** Raw scope token; `any` is runtime-polymorphic. Value links have none. */
  readonly outputScope: string | null;
  /** Absent `type` in the rules means `scope`. */
  readonly type: "scope" | "value";
  readonly fromData: boolean;
  readonly prefix: string | null;
  readonly file: string;
  readonly line: number;
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
  /**
   * Alias families other than triggers and effects, category -> member -> its
   * declarations. Populated only for the categories `EXTRA_ALIAS_CATEGORIES`
   * names, so the ~20 GUI and graphics grammar categories stay out.
   *
   * `triggers` and `effects` keep their own fields: they are read by every
   * emitter and their absence from a category table would be a silent hole.
   */
  readonly aliasCategories: ReadonlyMap<string, ReadonlyMap<string, readonly AliasDecl[]>>;
  /** Scope links from `links.cwt`, the `owner = { ... }` navigation table. */
  readonly links: ReadonlyMap<string, LinkDecl>;
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
  // Loaded ahead of their registries (councilor, economic_category,
  // civic_or_origin). Loading governments.cwt here also feeds the
  // government_trigger alias category through loadRules proper.
  "common/governments.cwt",
  "common/economic_categories.cwt",
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

function readLinks(nodes: readonly CwtNode[], file: string, into: Map<string, LinkDecl>): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "links" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      if (entry.value.kind !== "block") {
        continue;
      }
      const fields = assignments(entry.value.nodes);
      const scalar = (name: string): string | null => {
        const field = fields.find((node) => node.key.text === name);
        return field?.value.kind === "scalar" ? field.value.text : null;
      };
      const inputScopes = fields.flatMap((node) =>
        node.key.text === "input_scopes" && node.value.kind === "block"
          ? node.value.nodes.flatMap((item) =>
              item.kind === "value" && item.value.kind === "scalar" ? [item.value.text] : []
            )
          : []
      );
      into.set(entry.key.text, {
        name: entry.key.text,
        docs: entry.docs,
        inputScopes,
        outputScope: scalar("output_scope"),
        type: scalar("type") === "value" ? "value" : "scope",
        fromData: scalar("from_data") === "yes",
        prefix: scalar("prefix"),
        file,
        line: entry.line,
      });
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

/**
 * Reads every `alias[<category>:<name>] = ...` declaration in one file into a
 * member table.
 *
 * Exported because a category can be read from a rule file that `loadRules`
 * deliberately does not load — `common/governments.cwt` carries malformed
 * option comments that the drift gate rejects, so `government_trigger` is
 * parsed on its own in tests until that file is clean.
 */
export function readAliases(
  nodes: readonly CwtNode[],
  file: string,
  category: string,
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

/**
 * `nameField` carries the type's own `name_field`, when it has one. A
 * `name_field` registry's id is not a top-level key an author writes — it is
 * the *value* of that one body field — so a localisation entry that points
 * back at the same field (`localisation = { name = name }` alongside
 * `name_field = name`, as `global_ship_design` and five other vendored types
 * declare) is a bare pointer meaning "this slot's key is the id", the exact
 * thing pattern `"$"` already means for an ordinarily id-keyed registry.
 * Recognized structurally — the pointer's target equals `nameField` — rather
 * than by type name, so any future `name_field` registry gets the same
 * treatment without a new row. A pointer at any *other* field (astral_rift's
 * `name = name` with no `name_field` at all, where the body's own `name` is
 * typed `localisation` and an author writes a foreign loc key into it
 * directly) is a different, still-unhandled shape — SDK-44 found it but left
 * it alone, since no exposed registry currently uses it.
 */
function readLocalisation(
  block: CwtAssignment,
  nameField: string | null
): ContentType["localisation"] {
  if (block.value.kind !== "block") {
    return [];
  }
  return assignments(block.value.nodes).flatMap((entry) => {
    const subtype = BRACKET_KEY.exec(entry.key.text);
    if (subtype !== null && subtype[1] === "subtype") {
      return readLocalisation(entry, nameField);
    }
    const rawPattern = entry.value.kind === "scalar" ? entry.value.text : "";
    const pattern = nameField !== null && rawPattern === nameField ? "$" : rawPattern;
    return [
      {
        key: entry.key.text,
        pattern,
        required: entry.options.some((option) => option.name === "required"),
      },
    ];
  });
}

/**
 * `path_extension` is written both ways across the rule files — `.asset` in
 * sound.cwt, `txt` elsewhere — so the leading dot is normalized in rather than
 * left for every reader to guess at.
 */
function dotted(extension: string): string {
  return extension.startsWith(".") ? extension : `.${extension}`;
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
      // Written both quoted and bare across the rule files: `name_field = "key"`
      // in components.cwt, `name_field = name` in global_ship_designs.cwt.
      const nameFieldNode = inner.find((node) => node.key.text === "name_field");
      const extensionNode = inner.find((node) => node.key.text === "path_extension");
      const skipRootKeyNode = inner.find((node) => node.key.text === "skip_root_key");
      const pathStrictNode = inner.find((node) => node.key.text === "path_strict");
      const typeKeyFilter = findOption(entry.options, "type_key_filter");
      const nameField = nameFieldNode?.value.kind === "scalar" ? nameFieldNode.value.text : null;
      into.set(match[2]!, {
        name: match[2]!,
        path: pathNode?.value.kind === "scalar" ? pathNode.value.text : null,
        nameField,
        pathExtension:
          extensionNode?.value.kind === "scalar" ? dotted(extensionNode.value.text) : null,
        skipRootKey: skipRootKeyNode?.value.kind === "scalar" ? skipRootKeyNode.value.text : null,
        pathStrict: pathStrictNode?.value.kind === "scalar" && pathStrictNode.value.text === "yes",
        keyFilter:
          typeKeyFilter?.value?.kind === "scalar"
            ? { key: typeKeyFilter.value.text, negated: typeKeyFilter.negated }
            : null,
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
        localisation: localisation === undefined ? [] : readLocalisation(localisation, nameField),
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

/**
 * Reads just the `type[...]` declarations out of an arbitrary set of `.cwt`
 * files.
 *
 * {@link loadRules} deliberately loads a fixed file list, and its drift gate is
 * calibrated against exactly that list. Sounds and sprites are declared in
 * files outside it, and the vanilla-identifier generator needs their paths,
 * keywords, and extensions without widening what the main pipeline reads —
 * hence a second, narrower entry point over the same reader.
 */
export function loadContentTypesFrom(
  root: string,
  files: readonly string[]
): ReadonlyMap<string, ContentType> {
  const contentTypes = new Map<string, ContentType>();
  for (const relative of files) {
    const parsed = parseCwt(readFileSync(path.join(root, relative), "utf8"), relative);
    readContentTypes(parsed.nodes, contentTypes);
  }
  return contentTypes;
}

export function loadRules(root: string): RuleSet {
  const enums = new Map<string, string[]>();
  const scopes = new Map<string, string[]>();
  const triggers = new Map<string, AliasDecl[]>();
  const effects = new Map<string, AliasDecl[]>();
  const aliasCategories = new Map<string, Map<string, AliasDecl[]>>(
    [...EXTRA_ALIAS_CATEGORIES.keys()].map((category) => [category, new Map()])
  );
  const links = new Map<string, LinkDecl>();
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
    readLinks(parsed.nodes, relative, links);
    readAliases(parsed.nodes, relative, "trigger", singleAliases, triggers);
    readAliases(parsed.nodes, relative, "effect", singleAliases, effects);
    for (const [category, members] of aliasCategories) {
      readAliases(parsed.nodes, relative, category, singleAliases, members);
    }
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
    aliasCategories,
    links,
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
