import { block, kv, list, quoted, scalar, type PdxEntry, type PdxScalar } from "./ast.ts";
import { refId, type TechnologyCategoryRef, type TechnologyRef } from "./generated/refs.ts";
import type { TechnologyFields } from "./generated/technology.ts";

/** A reference to a technology — ours or vanilla's — usable wherever the game expects a tech id. */
export type TechRef = TechnologyRef;

export interface TechnologyDef<Id extends string = string> extends TechnologyFields {
  /** Full tech id including the mod prefix, e.g. "hello_galaxy_tech_crystal_resonance". */
  id: Id;
}

type Category = TechnologyDef["category"];

function categories(value: Category): (TechnologyCategoryRef | string)[] {
  return Array.isArray(value) ? value : [value];
}

function tierValue(value: TechnologyDef["tier"]): string | number {
  return typeof value === "number" ? value : refId(value);
}

export class Technology implements TechRef {
  readonly id: string;
  readonly def: TechnologyDef;

  constructor(def: TechnologyDef) {
    this.id = def.id;
    this.def = def;
  }

  toEntries(): PdxEntry {
    const def = this.def;
    const body: PdxEntry[] = [];
    if (def.cost !== undefined) {
      body.push(kv("cost", def.cost));
    }
    body.push(kv("area", def.area));
    body.push(kv("tier", tierValue(def.tier)));
    body.push(
      list(
        "category",
        categories(def.category).map((category): PdxScalar => scalar(refId(category)))
      )
    );
    if (def.prerequisites !== undefined && def.prerequisites.length > 0) {
      body.push(
        list(
          "prerequisites",
          def.prerequisites.map((p) => quoted(refId(p)))
        )
      );
    }
    if (def.startTech !== undefined) {
      body.push(kv("start_tech", def.startTech));
    }
    if (def.isRare !== undefined) {
      body.push(kv("is_rare", def.isRare));
    }
    if (def.weight !== undefined) {
      body.push(kv("weight", def.weight));
    }
    if (def.potential !== undefined) {
      body.push(block("potential", [...def.potential.entries]));
    }
    return block(this.id, body);
  }
}
