/**
 * The immutable models of the typed vanilla surface, built on the
 * `@pdx-ts/pdxscript` AST.
 *
 * {@link ParsedDefinition} is a readonly view over one shipped definition's
 * parsed entry list, tagged with the registry it came from so a parsed
 * building cannot be handed to `patchTechnology`. Everything the surface does
 * not model stays in `rest`, carried through in original order and never
 * property-accessible — which for a registry with no reader of its own is the
 * whole body.
 *
 * {@link ParsedTechnology} models the fields patch transforms need: numeric
 * fields are `ParsedNumber` (resolved value plus `@variable`
 * provenance — arithmetic is poisoned by the object type, `.value` bakes
 * visibly), refs wear the optional `TypedRef` brand, `area` is validated at
 * parse time, and prerequisites admit vanilla's `OR = { ... }` groups as
 * `AnyOf` values — ordinary data here, where the probe's parser had to refuse
 * them. {@link ParsedAscensionPerkCategory} models its member list so a patch
 * can preserve the loaded perks before appending one.
 *
 * Each definition carries its provenance — source file, source bytes' sha256,
 * and the view it came from — which is what the win engine computes filenames
 * against and what version-drift detection hashes.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";

import type { ResearchArea } from "../../generated/enums.ts";
import type {
  AscensionPerkRef,
  TechnologyCategoryRef,
  TechnologyRef,
} from "../../generated/refs.ts";
import type { LogicalPath } from "../../ordering.ts";
import type { Trigger } from "../../script/trigger-core.ts";
import type { VanillaView } from "./view.ts";

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

/** A parsed source file plus the provenance the win engine needs. */
export interface VanillaFile {
  readonly path: LogicalPath;
  /** sha256 (hex) of the file's source bytes — the version-drift input. */
  readonly sha256: string;
  /** Top-level definition keys in file order; `@variable` definitions excluded. */
  readonly keys: readonly string[];
}

/** What every parsed definition carries, whatever registry read it. */
export interface ParsedDefinitionInit<R extends string> {
  readonly registry: R;
  readonly id: string;
  readonly sourceFile: LogicalPath;
  readonly sourceSha256: string;
  readonly origin: VanillaView;
  readonly line: number | undefined;
  readonly body: readonly PdxEntry[];
  readonly rest: readonly PdxEntry[];
}

/**
 * One shipped definition, tagged with the registry it was parsed from.
 *
 * The tag is what makes the patch surface registry-safe without any runtime
 * check: `patchBuilding` takes a `ParsedDefinition<"building">`, so a parsed
 * technology is a compile error there and vice versa.
 */
export class ParsedDefinition<R extends string = string> {
  /** The registry this definition belongs to — the compile-time tag. */
  readonly registry: R;
  readonly id: string;
  /** The file that defined it, as a logical path. */
  readonly sourceFile: LogicalPath;
  /** sha256 (hex) of the defining file's source bytes. */
  readonly sourceSha256: string;
  /** The view this definition was parsed from. @internal */
  readonly origin: VanillaView;
  /** The full parsed body, in file order — the source of truth for emission. */
  readonly body: readonly PdxEntry[];
  /** Entries the surface does not model — carried through, never dropped. */
  readonly rest: readonly PdxEntry[];
  private readonly line: number | undefined;

  constructor(init: ParsedDefinitionInit<R>) {
    this.registry = init.registry;
    this.id = init.id;
    this.sourceFile = init.sourceFile;
    this.sourceSha256 = init.sourceSha256;
    this.origin = init.origin;
    this.line = init.line;
    this.body = init.body;
    this.rest = init.rest;
  }

  /** `file:line` of the definition — the linter's citation. */
  get citation(): string {
    return `${this.sourceFile}:${this.line ?? "?"}`;
  }

  toEntries(): PdxEntry {
    return { kind: "entry", key: this.id, op: "=", value: { kind: "container", items: this.body } };
  }
}

/** A parsed vanilla building. Nothing about its body is modelled yet. */
export type ParsedBuilding = ParsedDefinition<"building">;

interface AscensionPerkCategoryInit extends ParsedDefinitionInit<"ascension_perk_category"> {
  readonly ascensionPerks: readonly AscensionPerkRef[];
}

/** A parsed vanilla ascension perk category with its current member list. */
export class ParsedAscensionPerkCategory extends ParsedDefinition<"ascension_perk_category"> {
  /** The ascension perks currently registered in this category. */
  readonly ascensionPerks: readonly AscensionPerkRef[];

  constructor(init: AscensionPerkCategoryInit) {
    super(init);
    this.ascensionPerks = init.ascensionPerks;
  }
}

/** A parsed vanilla megastructure. Nothing about its body is modelled yet. */
export type ParsedMegastructure = ParsedDefinition<"megastructure">;

interface TechnologyInit extends ParsedDefinitionInit<"technology"> {
  readonly cost?: ParsedNumber;
  readonly tier?: ParsedNumber;
  readonly weight?: ParsedNumber;
  readonly area: ResearchArea;
  readonly category: readonly TechnologyCategoryRef[];
  readonly prerequisites?: readonly Prerequisite[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
}

type RequirableField =
  "cost" | "tier" | "weight" | "prerequisites" | "potential" | "startTech" | "isRare";

export class ParsedTechnology extends ParsedDefinition<"technology"> {
  readonly cost?: ParsedNumber;
  readonly tier?: ParsedNumber;
  readonly weight?: ParsedNumber;
  readonly area: ResearchArea;
  readonly category: readonly TechnologyCategoryRef[];
  readonly prerequisites?: readonly Prerequisite[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;

  constructor(init: TechnologyInit) {
    super(init);
    this.cost = init.cost;
    this.tier = init.tier;
    this.weight = init.weight;
    this.area = init.area;
    this.category = init.category;
    this.prerequisites = init.prerequisites;
    this.startTech = init.startTech;
    this.isRare = init.isRare;
    this.potential = init.potential;
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
}

/**
 * The parsed type each registry's definitions have. One row per
 * `PARSED_REGISTRIES` row: a registry whose fields nothing models yet maps to
 * the plain tagged {@link ParsedDefinition}.
 */
export interface ParsedRegistries {
  readonly technology: ParsedTechnology;
  readonly building: ParsedBuilding;
  readonly ascension_perk_category: ParsedAscensionPerkCategory;
  readonly megastructure: ParsedMegastructure;
}

export type ParsedRegistryName = keyof ParsedRegistries;
