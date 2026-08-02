/**
 * The typed surface over parsed vanilla files — the probe's real subject.
 *
 * `ParsedTechnology` is a readonly view over the parsed entry list. Fields
 * `TechnologyFields` models are surfaced typed, widened where vanilla demands
 * it: numeric fields are `ParsedNumber` (resolved value plus `@variable`
 * provenance — arithmetic is poisoned by the object type, `.value` bakes
 * visibly), refs wear the optional `TypedRef` brand, `area` is validated at
 * parse time. Everything unmodelled stays in `rest`, carried through in
 * original order and never property-accessible — the surface types only what
 * it can stand behind.
 *
 * Nothing resolves silently: an unknown `@variable`, an invalid `area`, an
 * unknown technology id all throw with file and line.
 */

import { type PdxEntry } from "@pdx-ts/pdxscript";

import type { ResearchArea } from "../../packages/sdk/src/generated/enums.ts";
import type {
  TechnologyCategoryRef,
  TechnologyRef,
} from "../../packages/sdk/src/generated/refs.ts";
import { trigger, type Trigger } from "../../packages/sdk/src/trigger-core.ts";
import { lowerEntries } from "./emit.ts";
import { parseSource, type ParsedEntry, type ParsedValue } from "./parser.ts";

/**
 * A number as a vanilla file states it: the resolved value, plus the
 * `@variable` it came from when it was a reference. `t.cost * 2` is a compile
 * error; `t.cost.value * 2` bakes the number visibly; passing the whole
 * object through a patch re-emits the reference.
 */
export interface ParsedNumber {
  readonly value: number;
  readonly ref?: string;
}

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

  resolve(name: string, file: string, line: number): number {
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
      `${file}:${line}: ${name} is not defined in ${file} or common/scripted_variables ` +
        `(defined: ${known})`
    );
  }
}

interface TechnologyInit {
  readonly id: string;
  readonly file: string;
  readonly body: readonly ParsedEntry[];
  readonly cost?: ParsedNumber;
  readonly tier?: ParsedNumber;
  readonly weight?: ParsedNumber;
  readonly area: ResearchArea;
  readonly category: readonly TechnologyCategoryRef[];
  readonly prerequisites?: readonly TechnologyRef[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
  readonly rest: readonly ParsedEntry[];
}

type RequirableField =
  "cost" | "tier" | "weight" | "prerequisites" | "potential" | "startTech" | "isRare";

export class ParsedTechnology {
  readonly id: string;
  /** The full parsed body, in file order — the source of truth for emission. */
  readonly body: readonly ParsedEntry[];
  readonly cost?: ParsedNumber;
  readonly tier?: ParsedNumber;
  readonly weight?: ParsedNumber;
  readonly area: ResearchArea;
  readonly category: readonly TechnologyCategoryRef[];
  readonly prerequisites?: readonly TechnologyRef[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
  /** Entries `TechnologyFields` does not model — carried through, never dropped. */
  readonly rest: readonly ParsedEntry[];
  private readonly file: string;

  constructor(init: TechnologyInit) {
    this.id = init.id;
    this.file = init.file;
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
          `${this.id} (${this.file}) has no ${key} — require() asserts only fields the file defines`
        );
      }
    }
    return this as this & { readonly [P in K]-?: NonNullable<ParsedTechnology[P]> };
  }

  toEntries(): PdxEntry {
    return {
      kind: "entry",
      key: this.id,
      op: "=",
      value: { kind: "container", items: lowerEntries(this.body) },
    };
  }
}

export class VanillaView {
  private readonly technologies: ReadonlyMap<string, ParsedTechnology>;

  constructor(technologies: ReadonlyMap<string, ParsedTechnology>) {
    this.technologies = technologies;
  }

  technology(id: string): ParsedTechnology {
    const tech = this.technologies.get(id);
    if (tech === undefined) {
      const known = [...this.technologies.keys()].join(", ");
      throw new Error(`Unknown technology "${id}"; the parsed files define: ${known}`);
    }
    return tech;
  }
}

function validateVariables(entries: readonly ParsedEntry[], file: string, vars: VarTable): void {
  for (const entry of entries) {
    validateValue(entry.value, file, entry.line, vars);
  }
}

function validateValue(value: ParsedValue, file: string, line: number, vars: VarTable): void {
  if (value.kind === "var") {
    vars.resolve(value.name, file, line);
    return;
  }
  if (value.kind === "block") {
    validateVariables(value.entries, file, vars);
    return;
  }
  if (value.kind === "list") {
    for (const item of value.items) {
      validateValue(item, file, line, vars);
    }
  }
}

function numericField(entry: ParsedEntry, file: string, vars: VarTable): ParsedNumber {
  if (entry.value.kind === "num") {
    return { value: entry.value.value };
  }
  if (entry.value.kind === "var") {
    return { value: vars.resolve(entry.value.name, file, entry.line), ref: entry.value.name };
  }
  throw new Error(`${file}:${entry.line}: ${entry.key} must be a number or an @variable`);
}

function areaField(entry: ParsedEntry, file: string): ResearchArea {
  const value = entry.value;
  const text = value.kind === "str" ? value.value : null;
  const area = TECHNOLOGY_AREAS.find((candidate) => candidate === text);
  if (area === undefined) {
    throw new Error(
      `${file}:${entry.line}: area must be one of ${TECHNOLOGY_AREAS.join(", ")} — ` +
        `got ${text === null ? "a non-scalar value" : `"${text}"`}`
    );
  }
  return area;
}

function refListField(entry: ParsedEntry, file: string): { id: string }[] {
  const value = entry.value;
  if (value.kind === "str") {
    return [{ id: value.value }];
  }
  if (value.kind !== "list") {
    throw new Error(`${file}:${entry.line}: ${entry.key} must be a list of ids`);
  }
  return value.items.map((item) => {
    if (item.kind !== "str") {
      throw new Error(`${file}:${entry.line}: ${entry.key} must contain only ids`);
    }
    return { id: item.value };
  });
}

function boolField(entry: ParsedEntry, file: string): boolean {
  if (entry.value.kind !== "bool") {
    throw new Error(`${file}:${entry.line}: ${entry.key} must be yes or no`);
  }
  return entry.value.value;
}

function triggerField(entry: ParsedEntry, file: string): Trigger<"country"> {
  if (entry.value.kind !== "block") {
    throw new Error(`${file}:${entry.line}: ${entry.key} must be a trigger block`);
  }
  return trigger<"country">(lowerEntries(entry.value.entries));
}

function buildTechnology(entry: ParsedEntry, file: string, vars: VarTable): ParsedTechnology {
  if (entry.value.kind !== "block") {
    throw new Error(`${file}:${entry.line}: technology ${entry.key} must be a block`);
  }
  const body = entry.value.entries;
  validateVariables(body, file, vars);

  const fields: {
    cost?: ParsedNumber;
    tier?: ParsedNumber;
    weight?: ParsedNumber;
    area?: ResearchArea;
    category?: readonly TechnologyCategoryRef[];
    prerequisites?: readonly TechnologyRef[];
    startTech?: boolean;
    isRare?: boolean;
    potential?: Trigger<"country">;
  } = {};
  const rest: ParsedEntry[] = [];

  for (const field of body) {
    switch (field.key) {
      case "cost":
        fields.cost ??= numericField(field, file, vars);
        break;
      case "tier":
        fields.tier ??= numericField(field, file, vars);
        break;
      case "weight":
        fields.weight ??= numericField(field, file, vars);
        break;
      case "area":
        fields.area ??= areaField(field, file);
        break;
      case "category":
        fields.category ??= refListField(field, file);
        break;
      case "prerequisites":
        fields.prerequisites ??= refListField(field, file);
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
    throw new Error(`${file}:${entry.line}: technology ${entry.key} has no area`);
  }
  return new ParsedTechnology({
    id: entry.key,
    file,
    body,
    ...fields,
    area: fields.area,
    category: fields.category ?? [],
    rest,
  });
}

/**
 * Parses a set of vanilla files, keyed by their game-relative paths. Eager by
 * design: every technology is built — areas validated, every `@variable`
 * resolved — before the view is returned, so bad input fails at the parse,
 * not at first use.
 */
export function parseVanilla(files: Readonly<Record<string, string>>): VanillaView {
  const parsed = Object.entries(files).map(([path, source]) => {
    if (!path.startsWith("common/technology/") && !path.startsWith("common/scripted_variables/")) {
      throw new Error(
        `Unsupported path ${path}: the probe parses common/technology and common/scripted_variables`
      );
    }
    return parseSource(source, path);
  });

  const global = new Map<string, number>();
  for (const file of parsed) {
    if (file.file.startsWith("common/scripted_variables/")) {
      for (const [name, value] of file.variables) {
        global.set(name, value);
      }
    }
  }
  const locals = new Map(parsed.map((file) => [file.file, file.variables]));
  const vars = new VarTable(global, locals);

  const technologies = new Map<string, ParsedTechnology>();
  for (const file of parsed) {
    if (!file.file.startsWith("common/technology/")) {
      continue;
    }
    for (const entry of file.entries) {
      if (entry.key.startsWith("@")) {
        continue;
      }
      technologies.set(entry.key, buildTechnology(entry, file.file, vars));
    }
  }
  return new VanillaView(technologies);
}
