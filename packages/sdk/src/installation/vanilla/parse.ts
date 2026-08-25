/**
 * Strict parsing and normalization of vanilla sources: which directories this
 * slice reads, the `@variable` tables a file's numbers resolve against, and
 * the per-registry readers that turn one parsed entry into a
 * {@link ParsedDefinition}.
 *
 * Nothing resolves silently: an unknown `@variable`, an invalid `area`, a
 * parser repair diagnostic all throw with file and line. Building the query
 * indexes over the results is `view.ts`'s job, not this module's.
 */

import { createHash } from "node:crypto";
import {
  parse,
  tryNumberValue,
  walkItems,
  type PdxContainer,
  type PdxEntry,
  type PdxItem,
} from "@pdx-ts/pdxscript";

import type { ResearchArea } from "../../generated/enums.ts";
import type { AscensionPerkRef, TechnologyCategoryRef } from "../../generated/refs.ts";
import { compareLogicalPaths, normalizeLogicalPath, type LogicalPath } from "../../ordering.ts";
import { trigger, type Trigger } from "../../script/trigger-core.ts";
import { registryRule } from "./override-rules.ts";
import {
  ParsedAscensionPerkCategory,
  ParsedDefinition,
  ParsedTechnology,
  type ParsedDefinitionInit,
  type ParsedNumber,
  type ParsedRegistryName,
  type Prerequisite,
} from "./parsed-definitions.ts";
import type { VanillaView } from "./view.ts";

const TECHNOLOGY_AREAS: readonly ResearchArea[] = ["physics", "society", "engineering"];

/** A parsed document plus provenance, the unit `VanillaView` is built from. */
export interface ParsedSource {
  readonly path: string;
  readonly sha256: string;
  readonly items: readonly PdxItem[];
}

/** A {@link ParsedSource} whose path has passed {@link normalizeSources}. */
export interface NormalizedSource {
  readonly path: LogicalPath;
  readonly sha256: string;
  readonly items: readonly PdxItem[];
}

/**
 * Parses one source strictly and stamps its content hash. Callers that read
 * raw bytes pass their own hash so the drift input is the bytes on disk.
 */
export function parseStrict(path: string, source: string, sha256?: string): ParsedSource {
  const document = parse(source, path);
  if (document.diagnostics.length > 0) {
    const details = document.diagnostics
      .map((diagnostic) => `${diagnostic.line}: ${diagnostic.kind}`)
      .join("; ");
    throw new Error(`${path}: parser repaired malformed input (${details}); refusing to trust it`);
  }
  return { path, sha256: sha256 ?? sha256Hex(source), items: document.items };
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Reads one definition of a registry from its parsed entry, given a body whose
 * `@variables` have already been validated.
 *
 * A registry with no reader gets {@link ParsedDefinition} itself: every entry
 * lands in `rest`, byte-faithful and patchable, which is exactly the guarantee
 * a modelled field has to earn its way past.
 */
type DefinitionReader = (init: ParsedDefinitionInit<string>, vars: VarTable) => ParsedDefinition;

/**
 * The registries this slice parses, as row data.
 *
 * The directory is never spelled here — it comes from the registry's own rule
 * table row, which derives it from the generated content descriptor, so the
 * three can never drift apart. Subdirectories that exist in the real install
 * are pinned by name: they hold *different* registries (technology categories
 * and tiers), out of this slice's scope and outside the registry's own
 * enumeration, which was measured flat. An unknown subdirectory appearing is
 * vanilla changing shape under us: a loud error, never a silent widen or skip.
 */
export interface ParsedRegistryRow {
  readonly registry: ParsedRegistryName;
  readonly knownSubdirs: ReadonlySet<string>;
  readonly read?: DefinitionReader;
}

export const PARSED_REGISTRIES: readonly ParsedRegistryRow[] = [
  { registry: "technology", knownSubdirs: new Set(["category", "tier"]), read: readTechnology },
  // Verified flat against the installed game: `common/buildings` holds 28
  // files and no subdirectory at all.
  { registry: "building", knownSubdirs: new Set<string>() },
  // Verified flat against the installed game: `common/ascension_perk_categories`
  // holds one file and no subdirectory.
  {
    registry: "ascension_perk_category",
    knownSubdirs: new Set<string>(),
    read: readAscensionPerkCategory,
  },
  // Verified flat the same way: `common/megastructures` holds 30 files and no
  // subdirectory at all.
  { registry: "megastructure", knownSubdirs: new Set<string>() },
];

/**
 * `@variable` provenance rather than a patchable registry: the directory is
 * parsed for its cross-file constants, and nothing in it is a definition the
 * SDK patches.
 */
export const VARIABLES_DIR = registryRule("scripted-constants").dir;

/** Each parsed registry's directory, resolved once from the rule table. */
const PARSED_DIRS: readonly { readonly row: ParsedRegistryRow; readonly dir: string }[] =
  PARSED_REGISTRIES.map((row) => ({ row, dir: registryRule(row.registry).dir }));

/** The directory a parsed registry reads, for the loader's enumeration. */
export function parsedRegistryDir(registry: ParsedRegistryName): string {
  return registryRule(registry).dir;
}

/** The registry a logical path belongs to, or undefined outside this slice. */
export function registryOfPath(path: string): ParsedRegistryRow | undefined {
  return PARSED_DIRS.find((entry) => path.startsWith(`${entry.dir}/`))?.row;
}

/**
 * Normalizes every source path, refuses one this slice does not parse, and
 * returns the sources in enumeration order.
 */
export function normalizeSources(sources: readonly ParsedSource[]): NormalizedSource[] {
  const normalized = sources.map((source) => {
    const path = normalizeLogicalPath(source.path);
    if (registryOfPath(path) === undefined && !path.startsWith(`${VARIABLES_DIR}/`)) {
      const parsed = [...PARSED_DIRS.map((entry) => entry.dir), VARIABLES_DIR].join(", ");
      throw new Error(`Unsupported path ${path}: this slice parses ${parsed}`);
    }
    return { ...source, path };
  });
  normalized.sort((a, b) => compareLogicalPaths(a.path, b.path));
  return normalized;
}

/**
 * Resolves `@variable` names for one load: a file's own declarations win over
 * the cross-file `common/scripted_variables` constants of the same name.
 */
export class VarTable {
  private readonly global: ReadonlyMap<string, number>;
  private readonly locals: ReadonlyMap<string, ReadonlyMap<string, number>>;

  /**
   * @param global The cross-file constants `common/scripted_variables` defines,
   * by name.
   * @param locals Each file's own `@variable` definitions, keyed by logical
   * path and then by name. A local shadows a global of the same name.
   */
  constructor(
    global: ReadonlyMap<string, number>,
    locals: ReadonlyMap<string, ReadonlyMap<string, number>>
  ) {
    this.global = global;
    this.locals = locals;
  }

  /**
   * The value `@name` has inside `file`: the file's own definition first, then
   * the global one.
   *
   * @param line The line the reference sits on, for the error; `undefined`
   * when the parser did not record one.
   * @throws Error naming the file, line, and every name that is defined,
   * when neither scope defines `name`. Nothing resolves silently.
   */
  resolve(name: string, file: string, line: number | undefined): number {
    const local = this.locals.get(file)?.get(name);
    if (local !== undefined) {
      return local;
    }
    const global = this.global.get(name);
    if (global !== undefined) {
      return global;
    }
    const defined = [...(this.locals.get(file)?.keys() ?? []), ...this.global.keys()];
    const known = defined.length > 0 ? defined.join(", ") : "none";
    throw new Error(
      `${file}:${line ?? "?"}: ${name} is not defined in ${file} or ${VARIABLES_DIR} ` +
        `(defined: ${known})`
    );
  }
}

/** The `@variable` tables of one load, and the resolver over both. */
export interface VariableTables {
  /** Every `common/scripted_variables` constant, visible from any file. */
  readonly global: ReadonlyMap<string, number>;
  /** Per logical path, the `@variables` that file declares itself. */
  readonly locals: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly vars: VarTable;
}

/** Collects the `@variable` declarations of every normalized source. */
export function variableTables(sources: readonly NormalizedSource[]): VariableTables {
  const global = new Map<string, number>();
  const locals = new Map<string, ReadonlyMap<string, number>>();
  for (const source of sources) {
    const variables = fileVariables(source);
    locals.set(source.path, variables);
    if (source.path.startsWith(`${VARIABLES_DIR}/`)) {
      for (const [name, value] of variables) {
        global.set(name, value);
      }
    }
  }
  return { global, locals, vars: new VarTable(global, locals) };
}

function fileVariables(source: ParsedSource): ReadonlyMap<string, number> {
  const variables = new Map<string, number>();
  for (const item of source.items) {
    if (item.kind !== "entry" || !item.key.startsWith("@")) {
      continue;
    }
    const value = item.value.kind === "num" ? tryNumberValue(item.value.lexeme) : null;
    if (value === null) {
      throw new Error(
        `${source.path}:${item.line ?? "?"}: variable ${item.key} must be a number this SDK ` +
          "can evaluate"
      );
    }
    variables.set(item.key, value);
  }
  return variables;
}

/**
 * Resolves every `@variable` the items mention, reporting a failure at the
 * line of the nearest enclosing entry.
 */
function validateVariables(
  items: readonly PdxItem[],
  file: string,
  line: number | undefined,
  vars: VarTable
): void {
  walkItems(
    items,
    line,
    (item, enclosingLine) => {
      if (item.kind === "var") {
        vars.resolve(item.name, file, enclosingLine);
      }
      return item.kind === "entry" ? (item.line ?? enclosingLine) : enclosingLine;
    },
    { read: true, fileName: file }
  );
}

function entryLine(entry: PdxEntry): number | undefined {
  return entry.line;
}

/**
 * A numeric field, or undefined when vanilla wrote a shape the surface does
 * not model: block costs exist (`cost = { factor = ... inline_script = ... }`,
 * e.g. tech_storm_manipulation) and inline math is uninterpreted. Undefined
 * sends the entry to `rest` — carried through byte-exact, never
 * property-accessible, and `require()` on the field stays an honest witness.
 * A scalar that is neither is still a loud error: that is garbage, not a
 * wider shape.
 */
function numericField(entry: PdxEntry, file: string, vars: VarTable): ParsedNumber | undefined {
  if (entry.value.kind === "num") {
    const value = tryNumberValue(entry.value.lexeme);
    if (value === null) {
      throw new Error(
        `${file}:${entryLine(entry) ?? "?"}: ${entry.key} is ${entry.value.lexeme}, which no ` +
          "JavaScript number holds exactly"
      );
    }
    return { value };
  }
  if (entry.value.kind === "var") {
    return {
      value: vars.resolve(entry.value.name, file, entryLine(entry)),
      ref: entry.value.name,
    };
  }
  if (entry.value.kind === "container" || entry.value.kind === "math") {
    return undefined;
  }
  throw new Error(
    `${file}:${entryLine(entry) ?? "?"}: ${entry.key} must be a number or an @variable`
  );
}

function areaField(entry: PdxEntry, file: string): ResearchArea {
  const value = entry.value;
  const text = value.kind === "str" ? value.value : null;
  const area = TECHNOLOGY_AREAS.find((candidate) => candidate === text);
  if (area === undefined) {
    throw new Error(
      `${file}:${entryLine(entry) ?? "?"}: area must be one of ${TECHNOLOGY_AREAS.join(", ")} — ` +
        `got ${text === null ? "a non-scalar value" : `"${text}"`}`
    );
  }
  return area;
}

function scalarRef(item: PdxItem, entry: PdxEntry, file: string): { id: string } {
  if (item.kind !== "str") {
    throw new Error(
      `${file}:${entryLine(entry) ?? "?"}: ${entry.key} must contain only ids` +
        (entry.key === "prerequisites" ? " and OR groups" : "")
    );
  }
  return { id: item.value };
}

function referenceListField(entry: PdxEntry, file: string): { id: string }[] {
  const value = entry.value;
  if (value.kind === "str") {
    return [{ id: value.value }];
  }
  if (value.kind !== "container") {
    throw new Error(`${file}:${entryLine(entry) ?? "?"}: ${entry.key} must be a list of ids`);
  }
  return value.items.map((item) => scalarRef(item, entry, file));
}

function prerequisitesField(entry: PdxEntry, file: string): Prerequisite[] {
  const value = entry.value;
  if (value.kind === "str") {
    return [{ id: value.value }];
  }
  if (value.kind !== "container") {
    throw new Error(`${file}:${entryLine(entry) ?? "?"}: prerequisites must be a list`);
  }
  return value.items.map((item): Prerequisite => {
    if (item.kind === "entry" && item.key === "OR" && item.value.kind === "container") {
      const options = item.value.items.map((option) => scalarRef(option, entry, file));
      if (options.length === 0) {
        throw new Error(`${file}:${entryLine(entry) ?? "?"}: empty OR group in prerequisites`);
      }
      return { kind: "any-of", options };
    }
    return scalarRef(item, entry, file);
  });
}

function boolField(entry: PdxEntry, file: string): boolean {
  if (entry.value.kind !== "bool") {
    throw new Error(`${file}:${entryLine(entry) ?? "?"}: ${entry.key} must be yes or no`);
  }
  return entry.value.value;
}

function entriesOnly(container: PdxContainer, key: string, file: string, line: number | undefined) {
  return container.items.map((item) => {
    if (item.kind !== "entry") {
      throw new Error(`${file}:${line ?? "?"}: ${key} must contain only key = value entries`);
    }
    return item;
  });
}

function triggerField(entry: PdxEntry, file: string): Trigger<"country"> {
  if (entry.value.kind !== "container") {
    throw new Error(`${file}:${entryLine(entry) ?? "?"}: ${entry.key} must be a trigger block`);
  }
  return trigger<"country">(entriesOnly(entry.value, entry.key, file, entryLine(entry)));
}

/**
 * The shared half of every read: the body is entries-only, every `@variable`
 * it mentions resolves, and nothing else is assumed about it. The registry's
 * own reader — when it has one — then claims whichever entries it models.
 */
export function readDefinition(
  entry: PdxEntry,
  source: { readonly path: LogicalPath; readonly sha256: string },
  row: ParsedRegistryRow,
  origin: VanillaView,
  vars: VarTable
): ParsedDefinition {
  const file = source.path;
  if (entry.value.kind !== "container") {
    throw new Error(
      `${file}:${entryLine(entry) ?? "?"}: ${row.registry} ${entry.key} must be a block`
    );
  }
  const body = entriesOnly(entry.value, entry.key, file, entryLine(entry));
  validateVariables(body, file, entryLine(entry), vars);
  const init: ParsedDefinitionInit<string> = {
    registry: row.registry,
    id: entry.key,
    sourceFile: source.path,
    sourceSha256: source.sha256,
    origin,
    line: entryLine(entry),
    body,
    rest: body,
  };
  return row.read === undefined ? new ParsedDefinition(init) : row.read(init, vars);
}

function readTechnology(init: ParsedDefinitionInit<string>, vars: VarTable): ParsedTechnology {
  const file = init.sourceFile;
  const fields: {
    cost?: ParsedNumber;
    tier?: ParsedNumber;
    weight?: ParsedNumber;
    area?: ResearchArea;
    category?: readonly TechnologyCategoryRef[];
    prerequisites?: readonly Prerequisite[];
    startTech?: boolean;
    isRare?: boolean;
    potential?: Trigger<"country">;
  } = {};
  const rest: PdxEntry[] = [];

  const numeric = (
    field: PdxEntry,
    current: ParsedNumber | undefined
  ): ParsedNumber | undefined => {
    const parsed = numericField(field, file, vars);
    if (parsed === undefined) {
      rest.push(field);
    }
    return current ?? parsed;
  };

  for (const field of init.body) {
    switch (field.key) {
      case "cost":
        fields.cost = numeric(field, fields.cost);
        break;
      case "tier":
        fields.tier = numeric(field, fields.tier);
        break;
      case "weight":
        fields.weight = numeric(field, fields.weight);
        break;
      case "area":
        fields.area ??= areaField(field, file);
        break;
      case "category":
        fields.category ??= referenceListField(field, file);
        break;
      case "prerequisites":
        fields.prerequisites ??= prerequisitesField(field, file);
        break;
      case "start_tech":
        fields.startTech ??= boolField(field, file);
        break;
      case "is_rare":
        fields.isRare ??= boolField(field, file);
        break;
      case "potential":
        fields.potential ??= triggerField(field, file);
        break;
      default:
        rest.push(field);
    }
  }

  if (fields.area === undefined) {
    throw new Error(`${file}:${init.line ?? "?"}: technology ${init.id} has no area`);
  }
  return new ParsedTechnology({
    ...init,
    registry: "technology",
    ...fields,
    area: fields.area,
    category: fields.category ?? [],
    rest,
  });
}

function readAscensionPerkCategory(
  init: ParsedDefinitionInit<string>
): ParsedAscensionPerkCategory {
  const file = init.sourceFile;
  let ascensionPerks: readonly AscensionPerkRef[] | undefined;
  const rest: PdxEntry[] = [];

  for (const field of init.body) {
    if (field.key === "ascension_perks" && ascensionPerks === undefined) {
      ascensionPerks = referenceListField(field, file);
    } else {
      rest.push(field);
    }
  }

  if (ascensionPerks === undefined) {
    throw new Error(
      `${file}:${init.line ?? "?"}: ascension_perk_category ${init.id} has no ascension_perks`
    );
  }
  return new ParsedAscensionPerkCategory({
    ...init,
    registry: "ascension_perk_category",
    ascensionPerks,
    rest,
  });
}
