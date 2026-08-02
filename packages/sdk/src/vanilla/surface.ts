/**
 * The typed surface over parsed vanilla files, promoted from
 * `design/parser-probe/surface.ts` onto the `@pdx-ts/pdxscript` AST.
 *
 * `ParsedTechnology` is a readonly view over the parsed entry list. Fields
 * the surface models are typed, widened where vanilla demands it: numeric
 * fields are `ParsedNumber` (resolved value plus `@variable` provenance —
 * arithmetic is poisoned by the object type, `.value` bakes visibly), refs
 * wear the optional `TypedRef` brand, `area` is validated at parse time, and
 * prerequisites admit vanilla's `OR = { ... }` groups as `AnyOf` values —
 * ordinary data here, where the probe's parser had to refuse them.
 * Everything unmodelled stays in `rest`, carried through in original order
 * and never property-accessible.
 *
 * Nothing resolves silently: an unknown `@variable`, an invalid `area`, a
 * parser repair diagnostic, an unknown technology id all throw with file and
 * line. Each technology carries its provenance — source file, source bytes'
 * sha256, and the view it came from — which is what the win engine computes
 * filenames against and what version-drift detection hashes.
 */

import { createHash } from "node:crypto";
import { parse, type PdxContainer, type PdxEntry, type PdxItem } from "@pdx-ts/pdxscript";

import { SwapPatchError } from "../errors.ts";
import type { ResearchArea } from "../generated/enums.ts";
import type { TechnologyCategoryRef, TechnologyRef } from "../generated/refs.ts";
import {
  compareLogicalPaths,
  normalizeLogicalPath,
  type LogicalPath,
} from "../resolver/path-order.ts";
import { trigger, type Trigger } from "../trigger-core.ts";

/**
 * A number as a vanilla file states it: the resolved value, plus the
 * `@variable` it came from when it was a reference. `t.cost * 2` is a compile
 * error; `t.cost.value * 2` bakes the number visibly; passing the whole
 * object through a patch re-emits the reference.
 */
export interface ParsedNumber {
  readonly value: number;
  /** The `@name` this value resolved from, when it was a reference. */
  readonly ref?: string;
}

/**
 * An `OR = { ... }` group inside a reference list: any one of the options
 * satisfies the requirement. Vanilla writes these in five technology files;
 * they flow through `[...t.prerequisites, myTech]` unchanged.
 */
export interface AnyOf<T> {
  readonly kind: "any-of";
  readonly options: readonly T[];
}

export function anyOf(...options: readonly (TechnologyRef | string)[]): AnyOf<TechnologyRef> {
  if (options.length === 0) {
    throw new Error("anyOf() needs at least one option");
  }
  return {
    kind: "any-of",
    options: options.map((option) => (typeof option === "string" ? { id: option } : option)),
  };
}

/** One prerequisite: a plain ref, or an OR group of alternatives. */
export type Prerequisite = TechnologyRef | AnyOf<TechnologyRef>;

const TECHNOLOGY_AREAS: readonly ResearchArea[] = ["physics", "society", "engineering"];

class VarTable {
  private readonly global: ReadonlyMap<string, number>;
  private readonly locals: ReadonlyMap<string, ReadonlyMap<string, number>>;

  constructor(
    global: ReadonlyMap<string, number>,
    locals: ReadonlyMap<string, ReadonlyMap<string, number>>
  ) {
    this.global = global;
    this.locals = locals;
  }

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
      `${file}:${line ?? "?"}: ${name} is not defined in ${file} or common/scripted_variables ` +
        `(defined: ${known})`
    );
  }
}

/** A parsed source file plus the provenance the win engine needs. */
export interface VanillaFile {
  readonly path: LogicalPath;
  /** sha256 (hex) of the file's source bytes — the version-drift input. */
  readonly sha256: string;
  /** Top-level definition keys in file order; `@variable` definitions excluded. */
  readonly keys: readonly string[];
}

interface TechnologyInit {
  readonly id: string;
  readonly sourceFile: LogicalPath;
  readonly sourceSha256: string;
  readonly origin: VanillaView;
  readonly line: number | undefined;
  readonly body: readonly PdxEntry[];
  readonly cost?: ParsedNumber;
  readonly tier?: ParsedNumber;
  readonly weight?: ParsedNumber;
  readonly area: ResearchArea;
  readonly category: readonly TechnologyCategoryRef[];
  readonly prerequisites?: readonly Prerequisite[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
  readonly rest: readonly PdxEntry[];
}

type RequirableField =
  "cost" | "tier" | "weight" | "prerequisites" | "potential" | "startTech" | "isRare";

export class ParsedTechnology {
  readonly id: string;
  /** The file that defined this technology, as a logical path. */
  readonly sourceFile: LogicalPath;
  /** sha256 (hex) of the defining file's source bytes. */
  readonly sourceSha256: string;
  /** The view this technology was parsed from. @internal */
  readonly origin: VanillaView;
  /** The full parsed body, in file order — the source of truth for emission. */
  readonly body: readonly PdxEntry[];
  readonly cost?: ParsedNumber;
  readonly tier?: ParsedNumber;
  readonly weight?: ParsedNumber;
  readonly area: ResearchArea;
  readonly category: readonly TechnologyCategoryRef[];
  readonly prerequisites?: readonly Prerequisite[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
  /** Entries the surface does not model — carried through, never dropped. */
  readonly rest: readonly PdxEntry[];
  private readonly line: number | undefined;

  constructor(init: TechnologyInit) {
    this.id = init.id;
    this.sourceFile = init.sourceFile;
    this.sourceSha256 = init.sourceSha256;
    this.origin = init.origin;
    this.line = init.line;
    this.body = init.body;
    this.cost = init.cost;
    this.tier = init.tier;
    this.weight = init.weight;
    this.area = init.area;
    this.category = init.category;
    this.prerequisites = init.prerequisites;
    this.startTech = init.startTech;
    this.isRare = init.isRare;
    this.potential = init.potential;
    this.rest = init.rest;
  }

  /** `file:line` of the definition — the linter's citation. */
  get citation(): string {
    return `${this.sourceFile}:${this.line ?? "?"}`;
  }

  /**
   * Asserts optional fields are present here and records that in the type, so
   * a patch can use them without narrowing boilerplate. The rules make these
   * fields optional; this particular technology may still guarantee them.
   */
  require<K extends RequirableField>(
    ...keys: readonly K[]
  ): this & { readonly [P in K]-?: NonNullable<ParsedTechnology[P]> } {
    for (const key of keys) {
      if (this[key] === undefined) {
        throw new Error(
          `${this.id} (${this.sourceFile}) has no ${key} — require() asserts only fields the file defines`
        );
      }
    }
    return this as this & { readonly [P in K]-?: NonNullable<ParsedTechnology[P]> };
  }

  toEntries(): PdxEntry {
    return { kind: "entry", key: this.id, op: "=", value: { kind: "container", items: this.body } };
  }
}

interface SwapRecord {
  readonly parent: string;
  readonly file: LogicalPath;
}

/** A parsed document plus provenance, the unit `VanillaView` is built from. */
export interface ParsedSource {
  readonly path: string;
  readonly sha256: string;
  readonly items: readonly PdxItem[];
}

export interface ViewOptions {
  readonly installPath?: string;
  /** The install's game build (from launcher-settings.json), when known. */
  readonly gameVersion?: string;
  /** Set by the loader when the parse was skipped via the content cache. */
  readonly fromCache?: boolean;
}

export class VanillaView {
  /** Every parsed file, in enumeration order — the win engine's input. */
  readonly files: readonly VanillaFile[];
  readonly installPath?: string;
  readonly gameVersion?: string;
  /** True when this view was rebuilt from cached parse results. */
  readonly fromCache: boolean;
  /**
   * sha256 over the (path, sha256) manifest: two views over byte-identical
   * inputs share it, so a build can tell "same vanilla" from "different loads".
   */
  readonly manifestKey: string;
  private readonly technologies: ReadonlyMap<string, ParsedTechnology>;
  private readonly swaps: ReadonlyMap<string, SwapRecord>;
  private readonly globalVars: ReadonlyMap<string, number>;
  private readonly localVars: ReadonlyMap<string, ReadonlyMap<string, number>>;

  constructor(sources: readonly ParsedSource[], options: ViewOptions = {}) {
    this.installPath = options.installPath;
    this.gameVersion = options.gameVersion;
    this.fromCache = options.fromCache ?? false;

    const normalized = sources.map((source) => {
      const path = normalizeLogicalPath(source.path);
      if (
        !path.startsWith("common/technology/") &&
        !path.startsWith("common/scripted_variables/")
      ) {
        throw new Error(
          `Unsupported path ${path}: this slice parses common/technology and common/scripted_variables`
        );
      }
      return { ...source, path };
    });
    normalized.sort((a, b) => compareLogicalPaths(a.path, b.path));

    const global = new Map<string, number>();
    const locals = new Map<string, ReadonlyMap<string, number>>();
    for (const source of normalized) {
      const variables = fileVariables(source);
      locals.set(source.path, variables);
      if (source.path.startsWith("common/scripted_variables/")) {
        for (const [name, value] of variables) {
          global.set(name, value);
        }
      }
    }
    const vars = new VarTable(global, locals);
    this.globalVars = global;
    this.localVars = locals;

    const technologies = new Map<string, ParsedTechnology>();
    const swaps = new Map<string, SwapRecord>();
    const files: VanillaFile[] = [];
    for (const source of normalized) {
      const keys: string[] = [];
      for (const item of source.items) {
        if (item.kind !== "entry") {
          throw new Error(
            `${source.path}: unexpected top-level ${item.kind}; expected only key = value entries`
          );
        }
        if (item.key.startsWith("@")) {
          continue;
        }
        keys.push(item.key);
        if (source.path.startsWith("common/technology/")) {
          const tech = buildTechnology(item, source, this, vars);
          technologies.set(item.key, tech);
          registerSwaps(item, source.path, swaps);
        }
      }
      files.push({ path: source.path, sha256: source.sha256, keys });
    }

    this.files = files;
    this.technologies = technologies;
    this.swaps = swaps;
    this.manifestKey = manifestKeyOf(files);
  }

  /**
   * The `@variables` declared at the top of one file — file-scoped in the
   * game, unlike `common/scripted_variables` definitions. An emission that
   * carries a reference to one of these into a *different* file must
   * re-declare it there, or the game corrupts the definition silently.
   */
  localVariables(file: string): ReadonlyMap<string, number> {
    return this.localVars.get(normalizeLogicalPath(file)) ?? new Map();
  }

  /** True when the name is a cross-file `common/scripted_variables` constant. */
  isGlobalVariable(name: string): boolean {
    return this.globalVars.has(name);
  }

  /** Every parsed technology, in enumeration-then-definition order. */
  allTechnologies(): readonly ParsedTechnology[] {
    return [...this.technologies.values()];
  }

  technology(id: string): ParsedTechnology {
    const tech = this.technologies.get(id);
    if (tech !== undefined) {
      return tech;
    }
    const swap = this.swaps.get(id);
    if (swap !== undefined) {
      throw new SwapPatchError(
        `"${id}" is a technology_swap inside ${swap.parent} (${swap.file}): patching into a ` +
          `swap is refused — swap override semantics have no oracle evidence ` +
          `(docs/handoff-patches.md, open question 3). Patch ${swap.parent} instead; its swaps ` +
          `ride through unchanged.`
      );
    }
    const near = [...this.technologies.keys()].filter((key) => key.includes(id)).slice(0, 5);
    const hint = near.length > 0 ? ` (did you mean: ${near.join(", ")}?)` : "";
    throw new Error(
      `Unknown technology "${id}"; the parsed files define ${this.technologies.size} technologies${hint}`
    );
  }
}

/**
 * Parses a set of vanilla sources keyed by game-relative path. Eager by
 * design: every technology is built — areas validated, every `@variable`
 * resolved — before the view returns, so bad input fails at the parse, not
 * at first use. Strict: a parser repair diagnostic is an error here.
 */
export function viewFromFiles(
  files: Readonly<Record<string, string>>,
  options: ViewOptions = {}
): VanillaView {
  const sources = Object.entries(files).map(([path, source]) => parseStrict(path, source));
  return new VanillaView(sources, options);
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

function manifestKeyOf(files: readonly VanillaFile[]): string {
  const manifest = files.map((file) => `${file.path}\t${file.sha256}`).join("\n");
  return sha256Hex(manifest);
}

function fileVariables(source: ParsedSource): ReadonlyMap<string, number> {
  const variables = new Map<string, number>();
  for (const item of source.items) {
    if (item.kind !== "entry" || !item.key.startsWith("@")) {
      continue;
    }
    if (item.value.kind !== "num") {
      throw new Error(`${source.path}:${item.line ?? "?"}: variable ${item.key} must be a number`);
    }
    variables.set(item.key, item.value.value);
  }
  return variables;
}

function validateVariables(
  items: readonly PdxItem[],
  file: string,
  line: number | undefined,
  vars: VarTable
): void {
  for (const item of items) {
    switch (item.kind) {
      case "entry":
        validateVariables([item.value], file, item.line ?? line, vars);
        break;
      case "container":
      case "param":
        validateVariables(item.items, file, line, vars);
        break;
      case "var":
        vars.resolve(item.name, file, line);
        break;
      default:
        break;
    }
  }
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
    return { value: entry.value.value };
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

function categoryField(entry: PdxEntry, file: string): { id: string }[] {
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

function buildTechnology(
  entry: PdxEntry,
  source: { readonly path: LogicalPath; readonly sha256: string },
  origin: VanillaView,
  vars: VarTable
): ParsedTechnology {
  const file = source.path;
  if (entry.value.kind !== "container") {
    throw new Error(`${file}:${entryLine(entry) ?? "?"}: technology ${entry.key} must be a block`);
  }
  const body = entriesOnly(entry.value, entry.key, file, entryLine(entry));
  validateVariables(body, file, entryLine(entry), vars);

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

  for (const field of body) {
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
        fields.category ??= categoryField(field, file);
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
    throw new Error(`${file}:${entryLine(entry) ?? "?"}: technology ${entry.key} has no area`);
  }
  return new ParsedTechnology({
    id: entry.key,
    sourceFile: source.path,
    sourceSha256: source.sha256,
    origin,
    line: entryLine(entry),
    body,
    ...fields,
    area: fields.area,
    category: fields.category ?? [],
    rest,
  });
}

function registerSwaps(entry: PdxEntry, file: LogicalPath, swaps: Map<string, SwapRecord>): void {
  if (entry.value.kind !== "container") {
    return;
  }
  for (const item of entry.value.items) {
    if (
      item.kind !== "entry" ||
      item.key !== "technology_swap" ||
      item.value.kind !== "container"
    ) {
      continue;
    }
    for (const inner of item.value.items) {
      if (inner.kind === "entry" && inner.key === "name" && inner.value.kind === "str") {
        swaps.set(inner.value.value, { parent: entry.key, file });
      }
    }
  }
}
