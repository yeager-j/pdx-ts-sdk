/**
 * Reads parsed `.cwt` files into a single rule set.
 *
 * Pure over parsed nodes: no file system access lives here. The fs shell that
 * finds, reads, and parses the rule files is `cwt/load.ts`, and the composing
 * entry point that supplies the manifest sources and overlay categories is
 * `src/load-rules.ts`.
 */

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
import type {
  CwtAssignment,
  CwtBlock,
  CwtDiagnostic,
  CwtNode,
  CwtOption,
  CwtParseResult,
} from "./parser.ts";

/**
 * A rule's `## api_status` annotation. `"removed"` marks a rule the game no
 * longer accepts; `"kept"` marks one the game's documentation dump omits but
 * still accepts.
 */
export type ApiStatus = "kept" | "removed";

/** One `alias[trigger:has_edict] = <edict>` declaration. A name may have several. */
export interface AliasDecl {
  /** The alias member name. */
  readonly name: string;
  /** The value type accepted by the alias. */
  readonly type: RuleType;
  /** Documentation comments bound to the declaration. */
  readonly docs: readonly string[];
  /** The scope this rule pushes onto its nested block, from `## push_scope`. */
  readonly scope: ScopeContext | null;
  /** Scopes the rule declares itself valid in, from `## scopes`; `null` when unannotated. */
  readonly supportedScopes: readonly string[] | null;
  /** The source file containing the declaration. */
  readonly file: string;
  /** The one-based source line containing the declaration. */
  readonly line: number;
  /** `==` marks a comparison, written in script as `num_moons < 4`. */
  readonly comparison: boolean;
  /** The declared `## api_status`, or `null` when unannotated. */
  readonly apiStatus: ApiStatus | null;
}

/** Alias declarations and recoverable diagnostics read from one CWT source. */
export interface AliasReadResult {
  /** Alias member names and their declarations. */
  readonly aliases: ReadonlyMap<string, readonly AliasDecl[]>;
  /** Recoverable classification diagnostics from the declarations. */
  readonly diagnostics: readonly CwtDiagnostic[];
}

/** One `subtype[...]` declaration and its supported selector metadata. */
export interface ContentSubtype {
  /** The subtype name inside the brackets. */
  readonly name: string;
  /** The subtype group from `## group`, when declared. */
  readonly group: string | null;
  /** The subtype's positive or negative `## type_key_filter`. */
  readonly keyFilter: { readonly key: string; readonly negated: boolean } | null;
  /** The scope pushed for subtype members, when declared. */
  readonly pushScope: string | null;
  /** The subtype display name from `## display_name`, when declared. */
  readonly displayName: string | null;
  /** The field whose absence selects the supported zero-cardinality subtype shape. */
  readonly absentUnless: string | null;
}

/** A CWT `type[...]` declaration and its file-layout metadata. */
export interface ContentType {
  /** The declared type name. */
  readonly name: string;
  /** Another type this declaration swaps for, from CWT's `base_type`. */
  readonly baseType?: string | null;
  /** The directory containing definitions of this type. */
  readonly path: string | null;
  /** The body field that carries identity when definitions are not keyed by id. */
  readonly nameField: string | null;
  /** The normalized file extension, or `null` when CWT uses the `.txt` default. */
  readonly pathExtension?: string | null;
  /** The single enclosing root key, or `null` when none or several are declared. */
  readonly skipRootKey?: string | null;
  /** Every scalar in `skip_root_key`, including its block form. */
  readonly skipRootKeys?: readonly string[];
  /** Whether definitions must live directly in {@link path}. */
  readonly pathStrict?: boolean;
  /** The type's positive or negative `## type_key_filter`. */
  readonly keyFilter: { readonly key: string; readonly negated: boolean } | null;
  /** The type's declared subtypes. */
  readonly subtypes: readonly ContentSubtype[];
  /** The declared localization slots with their subtype provenance. */
  readonly localisation: readonly {
    /** The localization slot name. */
    key: string;
    /** The localization key pattern. */
    pattern: string;
    /** Whether the slot carries `## required`. */
    required: boolean;
    /** Whether the slot carries `## optional`. */
    optional: boolean;
    /** The enclosing subtype, or `null` for a type-level slot. */
    subtype: string | null;
  }[];
}

/** The classified rule body for one content type. */
export interface ContentBody {
  /** The body's keyed fields. */
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
  /** The link name. */
  readonly name: string;
  /** Documentation comments bound to the link. */
  readonly docs: readonly string[];
  /** Raw scope tokens; `all` means valid everywhere. */
  readonly inputScopes: readonly string[];
  /** Raw scope token; `any` is runtime-polymorphic. Value links have none. */
  readonly outputScope: string | null;
  /** Absent `type` in the rules means `scope`. */
  readonly type: "scope" | "value";
  /** Whether the link accepts a data-driven suffix. */
  readonly fromData: boolean;
  /** The data-driven link prefix, when declared. */
  readonly prefix: string | null;
  /** The source file containing the link. */
  readonly file: string;
  /** The one-based source line containing the link. */
  readonly line: number;
}

/** One on-action name and its declared event scope context. */
export interface OnActionDecl {
  /** The on-action name. */
  readonly name: string;
  /** The declared event type, when present. */
  readonly eventType: string | null;
  /** The replacement scope names keyed by normalized context name. */
  readonly scopes: ReadonlyMap<string, string>;
  /** Documentation comments bound to the on-action. */
  readonly docs: readonly string[];
  /** The source file containing the on-action. */
  readonly file: string;
  /** The one-based source line containing the on-action. */
  readonly line: number;
}

/** The complete classified projection of the loaded CWT rule files. */
export interface RuleSet {
  /** Simple enum names and their literal members. */
  readonly enums: ReadonlyMap<string, readonly string[]>;
  /** Complex enums that derive members from game files. */
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
  /** Trigger names and all declarations for each name. */
  readonly triggers: ReadonlyMap<string, readonly AliasDecl[]>;
  /** Effect names and all declarations for each name. */
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
  /** Content type declarations keyed by type name. */
  readonly contentTypes: ReadonlyMap<string, ContentType>;
  /** Top-level rule bodies keyed by content type, e.g. `technology = { ... }`. */
  readonly bodies: ReadonlyMap<string, ContentBody>;
  /** Declared on-actions in source order. */
  readonly onActions: readonly OnActionDecl[];
  /** Modifier category -> raw `supported_scopes` tokens (`any` means every scope). */
  readonly modifierCategories: ReadonlyMap<string, readonly string[]>;
  /** Concrete modifier names `modifiers.cwt` declares, with their categories. */
  readonly modifierDecls: ReadonlyMap<string, readonly string[]>;
  /** Templated `modifiers.cwt` rows (`<ship_size>_…`) the game expands from content. */
  readonly modifierTemplates: readonly ModifierTemplate[];
  /** Recoverable parser and classifier diagnostics. */
  readonly diagnostics: readonly CwtDiagnostic[];
}

/** A templated modifier name and the categories it expands into. */
export interface ModifierTemplate {
  /** The raw templated modifier name. */
  readonly name: string;
  /** The modifier categories declared for the template. */
  readonly categories: readonly string[];
}

/** A complex enum that derives names from a configured game-file selector. */
export interface ComplexEnum {
  /** The complex enum name. */
  readonly name: string;
  /** The CWT source file containing the declaration. */
  readonly source: string;
  /** The game directory searched for enum values. */
  readonly path: string;
  /** The file extension included in the search. */
  readonly extension: string;
  /** Whether the search starts at the game root. */
  readonly startFromRoot: boolean;
  /** The nested location and form of each derived enum name. */
  readonly selector: {
    /** Assignment keys traversed before reading a name. */
    readonly path: readonly string[];
    /** Whether the name comes from an assignment key or scalar value. */
    readonly kind: "key" | "scalar";
    /** The assignment key whose scalar value contains the name. */
    readonly key?: string;
  };
}

const ALIAS_KEY = /^alias\[([a-z_]+):(.+)\]$/;
const BRACKET_KEY = /^([a-z_]+)\[(.+)\]$/;

/**
 * One declaration a file makes in a table that admits a single declaration per
 * key.
 *
 * The readers return a list of these rather than a map, so a file that repeats
 * a key inside itself still reaches the collision check in
 * {@link mergeUniqueEntries}. A map would have collapsed the repeat to its last
 * value first, which is the silent last-wins this table shape exists to
 * prevent.
 */
interface Declaration<Value> {
  /** The declared key. */
  readonly key: string;
  /** What the reader read at this declaration. */
  readonly value: Value;
  /** The line the declaration sits on, for the collision diagnostic. */
  readonly line: number;
}

/**
 * `single_alias[trigger_clause] = { ... }` declarations, so that a rule written
 * `alias[trigger:any_country] = single_alias_right[trigger_clause]` can be read
 * as the block it stands for.
 */
function readSingleAliases(
  nodes: readonly CwtNode[],
  file: string
): readonly Declaration<SingleAliasTarget>[] {
  const aliases: Declaration<SingleAliasTarget>[] = [];
  for (const entry of assignments(nodes)) {
    const match = BRACKET_KEY.exec(entry.key.text);
    if (match !== null && match[1] === "single_alias") {
      aliases.push({
        key: match[2]!,
        value: { value: entry.value, sourceFile: file },
        line: entry.line,
      });
    }
  }
  return aliases;
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
  const entries: { name: string; block: CwtBlock; entry: CwtAssignment }[] = [];
  for (const outer of assignments(nodes)) {
    if (outer.key.text !== outerKey || outer.value.kind !== "block") {
      continue;
    }
    for (const entry of assignments(outer.value.nodes)) {
      if (entry.value.kind !== "block") {
        continue;
      }
      entries.push({ name: entry.key.text, block: entry.value, entry });
    }
  }
  return entries;
}

/** Every bare scalar standing alone in a block, e.g. `{ planet ship fleet }`. */
function scalarItems(block: CwtBlock): string[] {
  const values: string[] = [];
  for (const node of block.nodes) {
    if (node.kind === "value" && node.value.kind === "scalar") {
      values.push(node.value.text);
    }
  }
  return values;
}

interface EnumTables {
  readonly enums: readonly Declaration<readonly string[]>[];
  readonly complexEnums: readonly Declaration<ComplexEnum>[];
}

function readEnums(nodes: readonly CwtNode[], file: string): EnumTables {
  const enums: Declaration<readonly string[]>[] = [];
  const complexEnums: Declaration<ComplexEnum>[] = [];
  for (const { name: key, block, entry } of keyedTableEntries(nodes, "enums")) {
    const match = BRACKET_KEY.exec(key);
    if (match === null) {
      continue;
    }
    if (match[1] === "complex_enum") {
      const complex = readComplexEnum(match[2]!, file, block);
      if (complex !== null) {
        complexEnums.push({ key: complex.name, value: complex, line: entry.line });
      }
    }
    enums.push({ key: match[2]!, value: scalarItems(block), line: entry.line });
  }
  return { enums, complexEnums };
}

function readComplexEnums(
  nodes: readonly CwtNode[],
  file: string
): readonly Declaration<ComplexEnum>[] {
  const enums: Declaration<ComplexEnum>[] = [];
  for (const { name, block, entry } of keyedTableEntries(nodes, "enums")) {
    const match = BRACKET_KEY.exec(name);
    if (match?.[1] !== "complex_enum") {
      continue;
    }
    const complex = readComplexEnum(match[2]!, file, block);
    if (complex !== null) {
      enums.push({ key: complex.name, value: complex, line: entry.line });
    }
  }
  return enums;
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

function readScopes(nodes: readonly CwtNode[]): readonly Declaration<readonly string[]>[] {
  const scopes: Declaration<readonly string[]>[] = [];
  for (const { name, block, entry } of keyedTableEntries(nodes, "scopes")) {
    const aliases = assignments(block.nodes).flatMap((node) =>
      node.key.text === "aliases" && node.value.kind === "block" ? scalarItems(node.value) : []
    );
    scopes.push({ key: name, value: aliases, line: entry.line });
  }
  return scopes;
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
function readScopeGroups(nodes: readonly CwtNode[]): readonly Declaration<readonly string[]>[] {
  const groups: Declaration<readonly string[]>[] = [];
  for (const { name, block, entry } of keyedTableEntries(nodes, "scope_groups")) {
    groups.push({ key: name, value: [...new Set(scalarItems(block))], line: entry.line });
  }
  return groups;
}

function readLinks(nodes: readonly CwtNode[], file: string): readonly Declaration<LinkDecl>[] {
  const links: Declaration<LinkDecl>[] = [];
  for (const { name, block, entry } of keyedTableEntries(nodes, "links")) {
    const inputScopes = assignments(block.nodes).flatMap((node) =>
      node.key.text === "input_scopes" && node.value.kind === "block" ? scalarItems(node.value) : []
    );
    links.push({
      key: name,
      value: {
        name,
        docs: entry.docs,
        inputScopes,
        outputScope: scalar(block, "output_scope"),
        type: scalar(block, "type") === "value" ? "value" : "scope",
        fromData: scalar(block, "from_data") === "yes",
        prefix: scalar(block, "prefix"),
        file,
        line: entry.line,
      },
      line: entry.line,
    });
  }
  return links;
}

function readModifierCategories(
  nodes: readonly CwtNode[]
): readonly Declaration<readonly string[]>[] {
  const categories: Declaration<readonly string[]>[] = [];
  for (const { name, block, entry } of keyedTableEntries(nodes, "modifier_categories")) {
    const scopes = assignments(block.nodes).flatMap((node) =>
      node.key.text === "supported_scopes" && node.value.kind === "block"
        ? scalarItems(node.value)
        : []
    );
    categories.push({ key: name, value: scopes, line: entry.line });
  }
  return categories;
}

interface ModifierTables {
  readonly declarations: readonly Declaration<readonly string[]>[];
  readonly templates: readonly ModifierTemplate[];
}

function readModifierDecls(nodes: readonly CwtNode[]): ModifierTables {
  const declarations: Declaration<readonly string[]>[] = [];
  const templates: ModifierTemplate[] = [];
  for (const { name, block, entry } of keyedTableEntries(nodes, "modifiers")) {
    const categories = scalarItems(block);
    if (name.includes("<") || name.includes("[")) {
      templates.push({ name, categories });
      continue;
    }
    declarations.push({ key: name, value: categories, line: entry.line });
  }
  return { declarations, templates };
}

interface ClassificationCollector {
  readonly diagnostics: CwtDiagnostic[];
  readonly report: ClassificationReporter;
}

function createClassificationCollector(file: string): ClassificationCollector {
  const diagnostics: CwtDiagnostic[] = [];
  return {
    diagnostics,
    report: (diagnostic, sourceFile) => {
      diagnostics.push({ ...diagnostic, file: sourceFile ?? file });
    },
  };
}

/**
 * Reads the `## api_status` annotation as a closed set.
 *
 * An unrecognized value throws rather than being carried through as live: a
 * typo in a vendored rules update must stop the build instead of publishing an
 * API status the generator does not understand.
 */
function apiStatusOf(entry: CwtAssignment, file: string): ApiStatus | null {
  const status = scalarOption(entry.options, "api_status");
  if (status === null) {
    return null;
  }
  if (status !== "kept" && status !== "removed") {
    throw new Error(
      `${file}:${entry.line}: unknown ## api_status value "${status}"; expected "kept" or "removed"`
    );
  }
  return status;
}

/** Reads one alias category's declarations and diagnostics from CWT nodes. */
export function readAliases(
  nodes: readonly CwtNode[],
  file: string,
  category: string,
  singleAliases: ReadonlyMap<string, SingleAliasTarget>
): AliasReadResult {
  const aliases = new Map<string, AliasDecl[]>();
  const collector = createClassificationCollector(file);
  for (const entry of assignments(nodes)) {
    const match = ALIAS_KEY.exec(entry.key.text);
    if (match === null || match[1] !== category) {
      continue;
    }
    const name = match[2]!.trim();
    const declarations = aliases.get(name) ?? [];
    declarations.push({
      name,
      type: classify(entry.value, resolverFor(singleAliases), collector.report),
      docs: entry.docs,
      scope: scopeOf(entry.options, collector.report),
      supportedScopes: supportedScopesOf(entry.options),
      file,
      line: entry.line,
      comparison: entry.op === "==",
      apiStatus: apiStatusOf(entry, file),
    });
    aliases.set(name, declarations);
  }
  return { aliases, diagnostics: collector.diagnostics };
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

function scalarValue(entry: CwtAssignment | undefined): string | null {
  return entry?.value.kind === "scalar" ? entry.value.text : null;
}

function scalarOption(options: readonly CwtOption[], name: string): string | null {
  const option = findOption(options, name);
  return option?.value?.kind === "scalar" ? option.value.text : null;
}

function keyFilterOf(
  options: readonly CwtOption[]
): { readonly key: string; readonly negated: boolean } | null {
  const option = findOption(options, "type_key_filter");
  return option?.value?.kind === "scalar"
    ? { key: option.value.text, negated: option.negated }
    : null;
}

function skipRootKeysOf(entry: CwtAssignment | undefined): string[] {
  if (entry?.value.kind === "scalar") {
    return [entry.value.text];
  }
  return entry?.value.kind === "block" ? scalarItems(entry.value) : [];
}

function readSubtypes(block: CwtBlock): ContentSubtype[] {
  const subtypes: ContentSubtype[] = [];
  for (const entry of assignments(block.nodes)) {
    const match = BRACKET_KEY.exec(entry.key.text);
    if (match === null || match[1] !== "subtype") {
      continue;
    }
    subtypes.push({
      name: match[2]!,
      group: scalarOption(entry.options, "group"),
      keyFilter: keyFilterOf(entry.options),
      pushScope: scopeOf(entry.options)?.this ?? null,
      displayName: scalarOption(entry.options, "display_name"),
      absentUnless: absentUnlessOf(entry),
    });
  }
  return subtypes;
}

function readContentType(
  name: string,
  block: CwtBlock,
  options: readonly CwtOption[]
): ContentType {
  const entries = new Map(assignments(block.nodes).map((entry) => [entry.key.text, entry]));
  const nameField = scalarValue(entries.get("name_field"));
  const localisation = entries.get("localisation");
  const pathExtension = scalarValue(entries.get("path_extension"));
  const skipRootKeys = skipRootKeysOf(entries.get("skip_root_key"));

  return {
    name,
    baseType: scalarValue(entries.get("base_type")),
    path: scalarValue(entries.get("path")),
    nameField,
    pathExtension: pathExtension === null ? null : dotted(pathExtension),
    skipRootKey: skipRootKeys.length === 1 ? skipRootKeys[0]! : null,
    skipRootKeys,
    pathStrict: scalarValue(entries.get("path_strict")) === "yes",
    keyFilter: keyFilterOf(options),
    subtypes: readSubtypes(block),
    localisation: localisation === undefined ? [] : readLocalisation(localisation, nameField),
  };
}

/** Reads every `type[...]` declaration in the supplied CWT nodes, in file order. */
export function readContentTypes(nodes: readonly CwtNode[]): readonly Declaration<ContentType>[] {
  const contentTypes: Declaration<ContentType>[] = [];
  for (const { name: key, block, entry } of keyedTableEntries(nodes, "types")) {
    const match = BRACKET_KEY.exec(key);
    if (match === null || match[1] !== "type") {
      continue;
    }
    contentTypes.push({
      key: match[2]!,
      value: readContentType(match[2]!, block, entry.options),
      line: entry.line,
    });
  }
  return contentTypes;
}

interface BodyReadResult {
  readonly bodies: readonly Declaration<ContentBody>[];
  readonly diagnostics: readonly CwtDiagnostic[];
}

function readBodies(
  nodes: readonly CwtNode[],
  file: string,
  known: ReadonlyMap<string, ContentType>,
  singleAliases: ReadonlyMap<string, SingleAliasTarget>
): BodyReadResult {
  const bodies: Declaration<ContentBody>[] = [];
  const collector = createClassificationCollector(file);
  for (const entry of assignments(nodes)) {
    if (!known.has(entry.key.text) || entry.value.kind !== "block") {
      continue;
    }
    const block = classifyBlock(entry.value, resolverFor(singleAliases), collector.report);
    bodies.push({
      key: entry.key.text,
      value: { fields: block.fields, scope: scopeOf(entry.options, collector.report) },
      line: entry.line,
    });
  }
  return { bodies, diagnostics: collector.diagnostics };
}

function readOnActions(nodes: readonly CwtNode[], file: string): readonly OnActionDecl[] {
  const onActions: OnActionDecl[] = [];
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
      onActions.push({
        name: node.value.text,
        eventType: eventType?.value?.kind === "scalar" ? eventType.value.text : null,
        scopes,
        docs: node.docs,
        file,
        line: node.line,
      });
    }
  }
  return onActions;
}

/** One rule file, already parsed — the unit {@link buildRuleSet} reads. */
export interface ParsedRuleFile {
  /** The source file name used for diagnostics and provenance. */
  readonly file: string;
  /** The parsed source and its recoverable diagnostics. */
  readonly parsed: CwtParseResult;
}

/** Where one declaration was read, as the collision diagnostic spells it. */
interface DeclarationSite {
  /** The file that declared the key. */
  readonly file: string;
  /** The line the declaration sits on. */
  readonly line: number;
}

/**
 * Table name -> declared key -> where it was first declared.
 *
 * Keyed by table rather than globally: `carrier` is both a scope and a scope
 * group, and the two tables answer different questions.
 */
type DeclarationOwners = Map<string, Map<string, DeclarationSite>>;

interface RuleSetAccumulator extends RuleSet {
  readonly enums: Map<string, readonly string[]>;
  readonly complexEnums: Map<string, ComplexEnum>;
  readonly scopes: Map<string, readonly string[]>;
  readonly scopeGroups: Map<string, readonly string[]>;
  readonly triggers: Map<string, AliasDecl[]>;
  readonly effects: Map<string, AliasDecl[]>;
  readonly aliasCategories: Map<string, Map<string, AliasDecl[]>>;
  readonly links: Map<string, LinkDecl>;
  readonly contentTypes: Map<string, ContentType>;
  readonly bodies: Map<string, ContentBody>;
  readonly onActions: OnActionDecl[];
  readonly modifierCategories: Map<string, readonly string[]>;
  readonly modifierDecls: Map<string, readonly string[]>;
  readonly modifierTemplates: ModifierTemplate[];
  readonly singleAliases: Map<string, SingleAliasTarget>;
  readonly diagnostics: CwtDiagnostic[];
  readonly classificationDiagnosticKeys: Set<string>;
  readonly declarationOwners: DeclarationOwners;
}

function createRuleSetAccumulator(extraAliasCategories: readonly string[]): RuleSetAccumulator {
  return {
    enums: new Map(),
    complexEnums: new Map(),
    scopes: new Map(),
    scopeGroups: new Map(),
    triggers: new Map(),
    effects: new Map(),
    aliasCategories: new Map(extraAliasCategories.map((category) => [category, new Map()])),
    links: new Map(),
    contentTypes: new Map(),
    bodies: new Map(),
    onActions: [],
    modifierCategories: new Map(),
    modifierDecls: new Map(),
    modifierTemplates: [],
    singleAliases: new Map(),
    diagnostics: [],
    classificationDiagnosticKeys: new Set(),
    declarationOwners: new Map(),
  };
}

/**
 * Records `site` as the declaring site of `key` in `table`, and returns the
 * site that declared it first when one already had.
 */
function claimDeclaration(
  owners: DeclarationOwners,
  table: string,
  key: string,
  site: DeclarationSite
): DeclarationSite | undefined {
  let declared = owners.get(table);
  if (declared === undefined) {
    declared = new Map();
    owners.set(table, declared);
  }
  const owner = declared.get(key);
  if (owner === undefined) {
    declared.set(key, site);
  }
  return owner;
}

function declarationConflict(
  table: string,
  key: string,
  owner: DeclarationSite,
  site: DeclarationSite
): Error {
  const where = (at: DeclarationSite): string => `${at.file}:${at.line}`;
  return new Error(
    `${table} key "${key}" is declared by ${where(owner)} and declared again by ${where(site)}; ` +
      "rule set assembly accepts one declaration per key"
  );
}

/**
 * Whether a plain value, array or object tree holds the same content as
 * another.
 *
 * Anything else — a `Map`, a `Set`, a class instance — compares by identity, so
 * an unfamiliar shape reads as a disagreement and is reported rather than
 * quietly accepted. The comparison only ever decides whether a repeat is
 * allowed through, so erring towards "different" errs towards the diagnostic.
 */
function sameDeclaration(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameDeclaration(item, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && sameDeclaration(left[key], right[key]))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Merges one file's declarations into a table that admits one per key.
 *
 * Every declaration the reader read arrives here, including a key a single file
 * declared twice, so one place decides what a repeat means. A repeat is
 * accepted only when it says the same thing, which cannot make file order
 * matter: whichever declaration is kept, the table is the same. The vendored
 * rules need it once — `scopes.cwt` declares `Design` at lines 60 and 102, both
 * times as `aliases = { design }`.
 *
 * @throws Error when a repeated declaration says something different.
 */
function mergeUniqueEntries<Value>(
  target: Map<string, Value>,
  declarations: readonly Declaration<Value>[],
  table: string,
  file: string,
  owners: DeclarationOwners
): void {
  for (const { key, value, line } of declarations) {
    const site: DeclarationSite = { file, line };
    const owner = claimDeclaration(owners, table, key, site);
    if (owner === undefined) {
      target.set(key, value);
      continue;
    }
    if (!sameDeclaration(target.get(key), value)) {
      throw declarationConflict(table, key, owner, site);
    }
  }
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  const members = new Set(left);
  return members.size === new Set(right).size && right.every((member) => members.has(member));
}

/**
 * Merges one file's enum declarations, accepting a repeated declaration whose
 * members are the same set and storing those members sorted.
 *
 * Enums say the same thing more loosely than the other tables do: an enum's
 * members are a set, so a second declaration listing them in another order
 * still says the same thing. The vendored rules do exactly that: `enums.cwt:49`
 * and `common/governments.cwt:662` both declare `election_type` as none,
 * democratic and oligarchic, in different orders. Sorting keeps the merged
 * members the same whichever file is read first.
 *
 * @throws Error when the same enum is declared again with different members.
 */
function mergeEnumEntries(
  target: Map<string, readonly string[]>,
  declarations: readonly Declaration<readonly string[]>[],
  file: string,
  owners: DeclarationOwners
): void {
  for (const { key, value: members, line } of declarations) {
    const site: DeclarationSite = { file, line };
    const owner = claimDeclaration(owners, "enums", key, site);
    if (owner === undefined) {
      target.set(key, members);
      continue;
    }
    if (!sameMembers(target.get(key) ?? [], members)) {
      throw declarationConflict("enums", key, owner, site);
    }
    target.set(key, [...new Set(members)].sort());
  }
}

function appendEntries<Key, Value>(
  target: Map<Key, Value[]>,
  source: ReadonlyMap<Key, readonly Value[]>
): void {
  for (const [key, values] of source) {
    const existing = target.get(key) ?? [];
    existing.push(...values);
    target.set(key, existing);
  }
}

function mergeClassificationDiagnostics(
  state: RuleSetAccumulator,
  diagnostics: readonly CwtDiagnostic[]
): void {
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.file}:${diagnostic.line}:${diagnostic.text}`;
    if (state.classificationDiagnosticKeys.has(key)) {
      continue;
    }
    state.classificationDiagnosticKeys.add(key);
    state.diagnostics.push(diagnostic);
  }
}

function mergeParserDiagnostics(files: readonly ParsedRuleFile[], state: RuleSetAccumulator): void {
  for (const { parsed } of files) {
    state.diagnostics.push(...parsed.diagnostics);
  }
}

function mergeReferencedDeclarations(
  files: readonly ParsedRuleFile[],
  state: RuleSetAccumulator
): void {
  const owners = state.declarationOwners;
  for (const { file, parsed } of files) {
    mergeUniqueEntries(
      state.singleAliases,
      readSingleAliases(parsed.nodes, file),
      "singleAliases",
      file,
      owners
    );
    mergeUniqueEntries(
      state.contentTypes,
      readContentTypes(parsed.nodes),
      "contentTypes",
      file,
      owners
    );
  }
}

function mergeResolvedRules(files: readonly ParsedRuleFile[], state: RuleSetAccumulator): void {
  const owners = state.declarationOwners;
  for (const { file, parsed } of files) {
    const enums = readEnums(parsed.nodes, file);
    mergeEnumEntries(state.enums, enums.enums, file, owners);
    mergeUniqueEntries(state.complexEnums, enums.complexEnums, "complexEnums", file, owners);
    mergeUniqueEntries(state.scopes, readScopes(parsed.nodes), "scopes", file, owners);
    mergeUniqueEntries(
      state.scopeGroups,
      readScopeGroups(parsed.nodes),
      "scopeGroups",
      file,
      owners
    );
    mergeUniqueEntries(state.links, readLinks(parsed.nodes, file), "links", file, owners);

    const triggers = readAliases(parsed.nodes, file, "trigger", state.singleAliases);
    appendEntries(state.triggers, triggers.aliases);
    mergeClassificationDiagnostics(state, triggers.diagnostics);

    const effects = readAliases(parsed.nodes, file, "effect", state.singleAliases);
    appendEntries(state.effects, effects.aliases);
    mergeClassificationDiagnostics(state, effects.diagnostics);

    for (const [category, members] of state.aliasCategories) {
      const aliases = readAliases(parsed.nodes, file, category, state.singleAliases);
      appendEntries(members, aliases.aliases);
      mergeClassificationDiagnostics(state, aliases.diagnostics);
    }

    const bodies = readBodies(parsed.nodes, file, state.contentTypes, state.singleAliases);
    mergeUniqueEntries(state.bodies, bodies.bodies, "bodies", file, owners);
    mergeClassificationDiagnostics(state, bodies.diagnostics);

    state.onActions.push(...readOnActions(parsed.nodes, file));
    mergeUniqueEntries(
      state.modifierCategories,
      readModifierCategories(parsed.nodes),
      "modifierCategories",
      file,
      owners
    );
    const modifiers = readModifierDecls(parsed.nodes);
    mergeUniqueEntries(state.modifierDecls, modifiers.declarations, "modifierDecls", file, owners);
    state.modifierTemplates.push(...modifiers.templates);
  }
}

function mergeExtraComplexEnums(files: readonly ParsedRuleFile[], state: RuleSetAccumulator): void {
  const owners = state.declarationOwners;
  for (const { file, parsed } of files) {
    mergeUniqueEntries(
      state.complexEnums,
      readComplexEnums(parsed.nodes, file),
      "complexEnums",
      file,
      owners
    );
  }
}

/**
 * Builds a rule set from already-parsed CWT files, independent of the order the
 * files are supplied in.
 *
 * Order independence is enforced rather than assumed: a second declaration of
 * an enum, scope, scope group, link, content type, body, modifier category,
 * modifier declaration or single alias throws. The check does not care whether
 * the two declarations came from two files or from one file twice, because the
 * readers hand over every declaration they read rather than a map that would
 * have collapsed the repeat first.
 *
 * A repeat that says the same thing is accepted, since no reading of it can
 * depend on file order: for a scope or any other table the two declarations
 * must be equal, and for an enum they must have the same members, which merge
 * to those members sorted. Trigger, effect and alias-category declarations
 * accumulate per name instead, so several files may declare one name.
 *
 * @throws Error when a key in a single-declaration table is declared twice
 * with different content.
 */
export function buildRuleSet(
  parsedFiles: readonly ParsedRuleFile[],
  extraComplexEnumFiles: readonly ParsedRuleFile[] = [],
  extraAliasCategories: readonly string[] = []
): RuleSet {
  const state = createRuleSetAccumulator(extraAliasCategories);
  mergeParserDiagnostics(parsedFiles, state);
  mergeParserDiagnostics(extraComplexEnumFiles, state);
  mergeReferencedDeclarations(parsedFiles, state);
  mergeResolvedRules(parsedFiles, state);
  mergeExtraComplexEnums(extraComplexEnumFiles, state);
  return state;
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
