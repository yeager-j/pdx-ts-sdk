/**
 * Loads the `.cwt` files codegen consumes into a single rule set.
 *
 * Trigger/effect infrastructure is fixed; the caller supplies the content
 * registry source files and the extra alias categories to read. The composing
 * entry point that supplies both from the manifest and the overlay is
 * `src/load-rules.ts` — this module stays pure over the rule files themselves.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  classify,
  classifyBlock,
  findOption,
  scopeOf,
  supportedScopesOf,
  type ClassificationReporter,
  type RuleField,
  type RuleType,
  type ScopeContext,
  type SingleAliasResolver,
  type SingleAliasTarget,
} from "./model.ts";
import {
  parseCwt,
  type CwtAssignment,
  type CwtBlock,
  type CwtDiagnostic,
  type CwtNode,
  type CwtParseResult,
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
  /**
   * `## type_key_filter`, keeping which way round it was written — the same
   * shape {@link ContentType.keyFilter} carries, and for the same reason.
   * `asset_selectors.cwt` writes `## type_key_filter <> room_selector` on
   * `subtype[asset]`, so a reader that dropped the negation would take
   * `room_selector` for the key that subtype's definitions *are* written under,
   * when it is the one key they are not.
   */
  readonly keyFilter: { readonly key: string; readonly negated: boolean } | null;
  readonly pushScope: string | null;
  readonly displayName: string | null;
  /**
   * The body field whose *absence* selects this subtype, from the one
   * discriminator shape this reader models: a body of exactly one
   * `## cardinality = 0..0` field asserting `X = yes`. Zero-cardinality is
   * CWT's way of writing "and this key must not appear", so
   * `subtype[not_inheriting_name] = { ## cardinality = 0..0  inherit_name = yes }`
   * says the subtype applies to every definition that does not write
   * `inherit_name`.
   *
   * `null` for every other subtype body — the rest of a subtype's fields are
   * still discarded, and a discriminator this reader cannot state is left
   * unstated rather than approximated. Widening it means a predicate model,
   * which nothing yet needs.
   */
  readonly absentUnless: string | null;
}

export interface ContentType {
  readonly name: string;
  /** Another type this declaration swaps for, from CWT's `base_type`. */
  readonly baseType?: string | null;
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
  /** Every scalar in `skip_root_key`, including its block form. */
  readonly skipRootKeys?: readonly string[];
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
  /**
   * The declared localisation slots, each keeping which `subtype[...]` block it
   * was written inside.
   *
   * `required` and `optional` are two independent CWT annotations rather than
   * complements: a slot may carry `## required`, carry `## optional`, or carry
   * neither. Neither means "required exactly where its enclosing subtype
   * applies" — which is only a statement at all for a slot with a `subtype`.
   */
  readonly localisation: readonly {
    key: string;
    pattern: string;
    required: boolean;
    optional: boolean;
    subtype: string | null;
  }[];
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
  readonly complexEnums: ReadonlyMap<string, ComplexEnum>;
  /** Canonical scope name -> every alias the game answers to. */
  readonly scopes: ReadonlyMap<string, readonly string[]>;
  /**
   * `scope_groups` from `scopes.cwt`: group name -> the scopes it admits, as
   * the rules spell them.
   *
   * A group is a coercion, not an identity. `target_country` lists planet,
   * ship and fleet because the game reads a country *out of* each of them —
   * the members are the scopes it will coerce to a country, not scopes that
   * are countries.
   */
  readonly scopeGroups: ReadonlyMap<string, readonly string[]>;
  readonly triggers: ReadonlyMap<string, readonly AliasDecl[]>;
  /** Loaded only so the drift gate covers effects too; nothing emits them yet. */
  readonly effects: ReadonlyMap<string, readonly AliasDecl[]>;
  /**
   * Alias families other than triggers and effects, category -> member -> its
   * declarations. Populated only for the extra categories the caller names
   * (the overlay's `EXTRA_ALIAS_CATEGORIES`), so the ~20 GUI and graphics
   * grammar categories stay out.
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
  readonly modifierTemplates: readonly ModifierTemplate[];
  readonly diagnostics: readonly CwtDiagnostic[];
}

export interface ModifierTemplate {
  readonly name: string;
  readonly categories: readonly string[];
}

export interface ComplexEnum {
  readonly name: string;
  readonly source: string;
  readonly path: string;
  readonly extension: string;
  readonly startFromRoot: boolean;
  readonly selector: {
    readonly path: readonly string[];
    readonly kind: "key" | "scalar";
    readonly key?: string;
  };
}

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
];

const ALIAS_KEY = /^alias\[([a-z_]+):(.+)\]$/;
const BRACKET_KEY = /^([a-z_]+)\[(.+)\]$/;

/**
 * `single_alias[trigger_clause] = { ... }` declarations, so that a rule written
 * `alias[trigger:any_country] = single_alias_right[trigger_clause]` can be read
 * as the block it stands for.
 */
function readSingleAliases(
  nodes: readonly CwtNode[],
  report: ClassificationReporter,
  into: Map<string, SingleAliasTarget>
): void {
  for (const entry of assignments(nodes)) {
    const match = BRACKET_KEY.exec(entry.key.text);
    if (match !== null && match[1] === "single_alias") {
      into.set(match[2]!, { value: entry.value, report });
    }
  }
}

function resolverFor(singleAliases: ReadonlyMap<string, SingleAliasTarget>): SingleAliasResolver {
  return (name) => singleAliases.get(name);
}

function assignments(nodes: readonly CwtNode[]): CwtAssignment[] {
  return nodes.filter((node): node is CwtAssignment => node.kind === "assignment");
}

/**
 * The shape six readers share: find the top-level `outerKey = { ... }`
 * assignment(s) and yield each of its inner assignments that itself has a
 * block value — `{name, block, entry}`, where `name` is the raw (possibly
 * bracketed) inner key text, `block` is that inner assignment's value, and
 * `entry` is the assignment itself for callers that need its docs, line, or
 * options.
 */
function keyedTableEntries(
  nodes: readonly CwtNode[],
  outerKey: string
): { name: string; block: CwtBlock; entry: CwtAssignment }[] {
  return assignments(nodes).flatMap((outer) =>
    outer.key.text !== outerKey || outer.value.kind !== "block"
      ? []
      : assignments(outer.value.nodes).flatMap((entry) =>
          entry.value.kind !== "block" ? [] : [{ name: entry.key.text, block: entry.value, entry }]
        )
  );
}

/** Every bare scalar standing alone in a block, e.g. `{ planet ship fleet }`. */
function scalarItems(block: CwtBlock): string[] {
  return block.nodes.flatMap((node) =>
    node.kind === "value" && node.value.kind === "scalar" ? [node.value.text] : []
  );
}

function readEnums(
  nodes: readonly CwtNode[],
  file: string,
  into: Map<string, string[]>,
  complexInto: Map<string, ComplexEnum>
): void {
  for (const { name: key, block } of keyedTableEntries(nodes, "enums")) {
    const match = BRACKET_KEY.exec(key);
    if (match === null) {
      continue;
    }
    if (match[1] === "complex_enum") {
      const complex = readComplexEnum(match[2]!, file, block);
      if (complex !== null) {
        complexInto.set(complex.name, complex);
      }
    }
    into.set(match[2]!, scalarItems(block));
  }
}

function readComplexEnums(
  nodes: readonly CwtNode[],
  file: string,
  into: Map<string, ComplexEnum>
): void {
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== "enums" || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      const match = BRACKET_KEY.exec(entry.key.text);
      if (match?.[1] !== "complex_enum" || entry.value.kind !== "block") {
        continue;
      }
      const complex = readComplexEnum(match[2]!, file, entry.value);
      if (complex !== null) {
        into.set(complex.name, complex);
      }
    }
  }
}

function scalar(block: CwtBlock, key: string): string | null {
  const entry = assignments(block.nodes).find((node) => node.key.text === key);
  return entry?.value.kind === "scalar" ? entry.value.text : null;
}

function selectorOf(block: CwtBlock, path: readonly string[] = []): ComplexEnum["selector"] | null {
  for (const node of block.nodes) {
    if (node.kind === "value" && node.value.kind === "scalar" && node.value.text === "enum_name") {
      return { path, kind: "key" };
    }
    if (node.kind !== "assignment") {
      continue;
    }
    if (node.key.text === "enum_name") {
      return { path, kind: "key" };
    }
    if (node.value.kind === "scalar" && node.value.text === "enum_name") {
      return { path, kind: "scalar", key: node.key.text };
    }
    if (node.value.kind === "block") {
      const found = selectorOf(node.value, [...path, node.key.text]);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function readComplexEnum(name: string, source: string, block: CwtBlock): ComplexEnum | null {
  const path = scalar(block, "path");
  const nameEntry = assignments(block.nodes).find((entry) => entry.key.text === "name");
  if (path === null || nameEntry?.value.kind !== "block") {
    return null;
  }
  const selector = selectorOf(nameEntry.value);
  if (selector === null) {
    return null;
  }
  return {
    name,
    source,
    path,
    extension: scalar(block, "path_extension") ?? ".txt",
    startFromRoot: scalar(block, "start_from_root") === "yes",
    selector,
  };
}

function cwtFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const file = path.join(directory, name);
      const child = path.join(relative, name);
      return statSync(file).isDirectory()
        ? cwtFiles(root, child)
        : name.endsWith(".cwt")
          ? [child]
          : [];
    });
}

function readScopes(nodes: readonly CwtNode[], into: Map<string, string[]>): void {
  for (const { name, block } of keyedTableEntries(nodes, "scopes")) {
    const aliases = assignments(block.nodes).flatMap((node) =>
      node.key.text === "aliases" && node.value.kind === "block" ? scalarItems(node.value) : []
    );
    into.set(name, aliases);
  }
}

/**
 * Reads `scope_groups = { celestial_coordinate = { planet ship ... } }`.
 *
 * Members are bare scalars in the group's block, and the vendored table
 * repeats `carrier` inside three of its groups, so the list is deduped here
 * rather than by every reader. Groups keep their own table because a group and
 * a scope may share a name — `carrier` is both — and collapsing the two would
 * silently answer one question with the other.
 */
function readScopeGroups(nodes: readonly CwtNode[], into: Map<string, string[]>): void {
  for (const { name, block } of keyedTableEntries(nodes, "scope_groups")) {
    into.set(name, [...new Set(scalarItems(block))]);
  }
}

function readLinks(nodes: readonly CwtNode[], file: string, into: Map<string, LinkDecl>): void {
  for (const { name, block, entry } of keyedTableEntries(nodes, "links")) {
    const inputScopes = assignments(block.nodes).flatMap((node) =>
      node.key.text === "input_scopes" && node.value.kind === "block" ? scalarItems(node.value) : []
    );
    into.set(name, {
      name,
      docs: entry.docs,
      inputScopes,
      outputScope: scalar(block, "output_scope"),
      type: scalar(block, "type") === "value" ? "value" : "scope",
      fromData: scalar(block, "from_data") === "yes",
      prefix: scalar(block, "prefix"),
      file,
      line: entry.line,
    });
  }
}

function readModifierCategories(nodes: readonly CwtNode[], into: Map<string, string[]>): void {
  for (const { name, block } of keyedTableEntries(nodes, "modifier_categories")) {
    const scopes = assignments(block.nodes).flatMap((node) =>
      node.key.text === "supported_scopes" && node.value.kind === "block"
        ? scalarItems(node.value)
        : []
    );
    into.set(name, scopes);
  }
}

function readModifierDecls(
  nodes: readonly CwtNode[],
  into: Map<string, string[]>,
  templates: ModifierTemplate[]
): void {
  for (const { name, block } of keyedTableEntries(nodes, "modifiers")) {
    const categories = scalarItems(block);
    if (name.includes("<") || name.includes("[")) {
      templates.push({ name, categories });
      continue;
    }
    into.set(name, categories);
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
  singleAliases: ReadonlyMap<string, SingleAliasTarget>,
  into: Map<string, AliasDecl[]>,
  report?: ClassificationReporter
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
      type: classify(entry.value, resolverFor(singleAliases), report),
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
 *
 * A `subtype[...]` block inside the localisation table is descended into, and
 * `subtype` records which one each slot came from. Flattening the provenance
 * away used to make a conditionally-required slot indistinguishable from an
 * unconditionally-optional one — `swapped_tradition`'s `name` is required of
 * every swap that does not inherit its name, and read flat it is just another
 * unannotated slot.
 */
function readLocalisation(
  block: CwtAssignment,
  nameField: string | null,
  subtype: string | null = null
): ContentType["localisation"] {
  if (block.value.kind !== "block") {
    return [];
  }
  return assignments(block.value.nodes).flatMap((entry) => {
    const nested = BRACKET_KEY.exec(entry.key.text);
    if (nested !== null && nested[1] === "subtype") {
      return readLocalisation(entry, nameField, nested[2]!);
    }
    const rawPattern = entry.value.kind === "scalar" ? entry.value.text : "";
    const pattern = nameField !== null && rawPattern === nameField ? "$" : rawPattern;
    return [
      {
        key: entry.key.text,
        pattern,
        required: entry.options.some((option) => option.name === "required"),
        optional: entry.options.some((option) => option.name === "optional"),
        subtype,
      },
    ];
  });
}

/**
 * Reads {@link ContentSubtype.absentUnless} out of a `subtype[...]` body.
 *
 * Deliberately narrow: exactly one field, asserting `X = yes`, under
 * `## cardinality = 0..0`. Anything else returns `null` — the body may still be
 * a real discriminator, but stating it would take a predicate model, and an
 * approximation here would silently mis-declare requiredness downstream.
 */
function absentUnlessOf(subtype: CwtAssignment): string | null {
  if (subtype.value.kind !== "block" || subtype.value.nodes.length !== 1) {
    return null;
  }
  const only = subtype.value.nodes[0]!;
  if (only.kind !== "assignment" || only.value.kind !== "scalar" || only.value.text !== "yes") {
    return null;
  }
  const cardinality = findOption(only.options, "cardinality");
  if (cardinality?.value?.kind !== "scalar" || cardinality.value.text !== "0..0") {
    return null;
  }
  return only.key.text;
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
      const baseTypeNode = inner.find((node) => node.key.text === "base_type");
      const localisation = inner.find((node) => node.key.text === "localisation");
      // Written both quoted and bare across the rule files: `name_field = "key"`
      // in components.cwt, `name_field = name` in global_ship_designs.cwt.
      const nameFieldNode = inner.find((node) => node.key.text === "name_field");
      const extensionNode = inner.find((node) => node.key.text === "path_extension");
      const skipRootKeyNode = inner.find((node) => node.key.text === "skip_root_key");
      const pathStrictNode = inner.find((node) => node.key.text === "path_strict");
      const typeKeyFilter = findOption(entry.options, "type_key_filter");
      const nameField = nameFieldNode?.value.kind === "scalar" ? nameFieldNode.value.text : null;
      const skipRootKeys =
        skipRootKeyNode?.value.kind === "scalar"
          ? [skipRootKeyNode.value.text]
          : skipRootKeyNode?.value.kind === "block"
            ? skipRootKeyNode.value.nodes.flatMap((node) =>
                node.kind === "value" && node.value.kind === "scalar" ? [node.value.text] : []
              )
            : [];
      into.set(match[2]!, {
        name: match[2]!,
        baseType: baseTypeNode?.value.kind === "scalar" ? baseTypeNode.value.text : null,
        path: pathNode?.value.kind === "scalar" ? pathNode.value.text : null,
        nameField,
        pathExtension:
          extensionNode?.value.kind === "scalar" ? dotted(extensionNode.value.text) : null,
        skipRootKey: skipRootKeys.length === 1 ? skipRootKeys[0]! : null,
        skipRootKeys,
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
          const subtypeKeyFilter = findOption(node.options, "type_key_filter");
          return [
            {
              name: subtype[2]!,
              group: scalarOption("group"),
              keyFilter:
                subtypeKeyFilter?.value?.kind === "scalar"
                  ? { key: subtypeKeyFilter.value.text, negated: subtypeKeyFilter.negated }
                  : null,
              pushScope: scopeOf(node.options)?.this ?? null,
              displayName: scalarOption("display_name"),
              absentUnless: absentUnlessOf(node),
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
  singleAliases: ReadonlyMap<string, SingleAliasTarget>,
  into: Map<string, ContentBody>,
  report?: ClassificationReporter
): void {
  for (const entry of assignments(nodes)) {
    if (!known.has(entry.key.text) || entry.value.kind !== "block") {
      continue;
    }
    const block = classifyBlock(entry.value, resolverFor(singleAliases), report);
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

/** One rule file, already parsed — the unit {@link buildRuleSet} reads. */
export interface ParsedRuleFile {
  readonly file: string;
  readonly parsed: CwtParseResult;
}

/**
 * Builds a {@link RuleSet} from already-parsed rule files, in three passes
 * rather than one, because two symbol tables are cross-referenced by files
 * anywhere else in `parsedFiles`: a `single_alias[x] = { ... }` declared in
 * one file can be consumed as `single_alias_right[x]` by a rule in a file
 * loaded earlier (`readAliases`, `readBodies`), and a
 * `types = { type[x] = { ... } }` declaration in one file can have its body
 * (`x = { ... }`) in another (`readBodies`). A single pass made both
 * resolutions see only what had already loaded, so file order silently
 * doubled as a dependency order. Building the two tables to completion before
 * anything consumes them removes that constraint: `parsedFiles`' order no
 * longer changes the result.
 *
 * `extraComplexEnumFiles` covers {@link loadRules}' second, independent sweep
 * for `enum[complex_enum]` declarations in `.cwt` files outside its main list
 * — unrelated to the phase-ordering fix, but folded in here so the whole
 * build stays inside one function with plain, non-`readonly` locals.
 *
 * `extraAliasCategories` names the alias families beyond triggers and effects
 * to read into {@link RuleSet.aliasCategories}. The pipeline supplies the
 * overlay's `EXTRA_ALIAS_CATEGORIES` keys through `src/load-rules.ts`.
 *
 * Exported (alongside {@link loadRules}) so a test can prove the order
 * independence directly, against synthetic sources, without going through
 * disk I/O or `RULE_FILES`.
 */
export function buildRuleSet(
  parsedFiles: readonly ParsedRuleFile[],
  extraComplexEnumFiles: readonly ParsedRuleFile[] = [],
  extraAliasCategories: readonly string[] = []
): RuleSet {
  const enums = new Map<string, string[]>();
  const complexEnums = new Map<string, ComplexEnum>();
  const scopes = new Map<string, string[]>();
  const scopeGroups = new Map<string, string[]>();
  const triggers = new Map<string, AliasDecl[]>();
  const effects = new Map<string, AliasDecl[]>();
  const aliasCategories = new Map<string, Map<string, AliasDecl[]>>(
    extraAliasCategories.map((category) => [category, new Map()])
  );
  const links = new Map<string, LinkDecl>();
  const contentTypes = new Map<string, ContentType>();
  const bodies = new Map<string, ContentBody>();
  const onActions: OnActionDecl[] = [];
  const modifierCategories = new Map<string, string[]>();
  const modifierDecls = new Map<string, string[]>();
  const modifierTemplates: ModifierTemplate[] = [];
  const singleAliases = new Map<string, SingleAliasTarget>();
  const diagnostics: CwtDiagnostic[] = [];
  const classificationDiagnostics = new Set<string>();

  const reporterFor =
    (file: string): ClassificationReporter =>
    (diagnostic) => {
      const key = `${file}:${diagnostic.line}:${diagnostic.text}`;
      if (classificationDiagnostics.has(key)) {
        return;
      }
      classificationDiagnostics.add(key);
      diagnostics.push({ ...diagnostic, file });
    };

  for (const { parsed } of parsedFiles) {
    diagnostics.push(...parsed.diagnostics);
  }

  // Phase 2: build the two tables other files' rules can reference — single
  // aliases and content types — from every parsed file, before anything
  // resolves against them.
  for (const { file, parsed } of parsedFiles) {
    readSingleAliases(parsed.nodes, reporterFor(file), singleAliases);
    readContentTypes(parsed.nodes, contentTypes);
  }

  // Phase 3: read everything else against the now-complete tables.
  for (const { file, parsed } of parsedFiles) {
    const report = reporterFor(file);
    readEnums(parsed.nodes, file, enums, complexEnums);
    readScopes(parsed.nodes, scopes);
    readScopeGroups(parsed.nodes, scopeGroups);
    readLinks(parsed.nodes, file, links);
    readAliases(parsed.nodes, file, "trigger", singleAliases, triggers, report);
    readAliases(parsed.nodes, file, "effect", singleAliases, effects, report);
    for (const [category, members] of aliasCategories) {
      readAliases(parsed.nodes, file, category, singleAliases, members, report);
    }
    readBodies(parsed.nodes, contentTypes, singleAliases, bodies, report);
    readOnActions(parsed.nodes, file, onActions);
    readModifierCategories(parsed.nodes, modifierCategories);
    readModifierDecls(parsed.nodes, modifierDecls, modifierTemplates);
  }

  for (const { file, parsed } of extraComplexEnumFiles) {
    readComplexEnums(parsed.nodes, file, complexEnums);
  }

  return {
    enums,
    complexEnums,
    scopes,
    scopeGroups,
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

function parseFile(root: string, relative: string): ParsedRuleFile {
  return {
    file: relative,
    parsed: parseCwt(readFileSync(path.join(root, relative), "utf8"), relative),
  };
}

export function loadRules(
  root: string,
  extraSourceFiles: readonly string[],
  extraAliasCategories: readonly string[]
): RuleSet {
  const ruleFiles = [...BASE_RULE_FILES, ...extraSourceFiles].filter(
    (file, index, files) => files.indexOf(file) === index
  );
  const parsedFiles = ruleFiles.map((relative) => parseFile(root, relative));
  const loaded = new Set(ruleFiles);
  const extraComplexEnumFiles = cwtFiles(root)
    .filter((relative) => !loaded.has(relative))
    .map((relative) => parseFile(root, relative));
  return buildRuleSet(parsedFiles, extraComplexEnumFiles, extraAliasCategories);
}

/**
 * Maps every canonical scope name and every alias the game answers to onto the
 * canonical name, so `trait` and `Species trait` both resolve to `species_trait`.
 */
export function scopeIndex(rules: RuleSet): Map<string, string> {
  const index = new Map<string, string>();
  for (const [canonical, aliases] of rules.scopes) {
    const key = canonical.toLowerCase().replaceAll(" ", "_");
    index.set(key, key);
    for (const alias of aliases) {
      index.set(alias.toLowerCase(), key);
    }
  }
  return index;
}
