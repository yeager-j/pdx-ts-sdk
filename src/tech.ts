import { block, kv, list, quoted, scalar, type PdxEntry } from "./ast.ts";
import type { Trigger } from "./triggers.ts";

/** A reference to a technology — ours or vanilla's — usable wherever the game expects a tech id. */
export interface TechRef {
  readonly id: string;
}

export type ResearchArea = "physics" | "society" | "engineering";

export interface TechnologyDef<Id extends string = string> {
  /** Full tech id including the mod prefix, e.g. "hello_galaxy_tech_crystal_resonance". */
  id: Id;
  /** English display name; emitted to localization under the tech id. */
  name: string;
  /** English description; emitted to localization under `<id>_desc`. */
  description?: string;
  cost: number;
  area: ResearchArea;
  tier: number;
  category: string;
  /** Pass Technology objects for mod techs; raw strings are the escape hatch for vanilla ids. */
  prerequisites?: (TechRef | string)[];
  weight?: number;
  startTech?: boolean;
  isRare?: boolean;
  /** Country-scope condition for the tech appearing in the research pool. */
  potential?: Trigger<"country">;
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
    const body: PdxEntry[] = [
      kv("cost", def.cost),
      kv("area", def.area),
      kv("tier", def.tier),
      list("category", [scalar(def.category)]),
    ];
    if (def.prerequisites !== undefined && def.prerequisites.length > 0) {
      body.push(
        list(
          "prerequisites",
          def.prerequisites.map((p) => quoted(typeof p === "string" ? p : p.id))
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
