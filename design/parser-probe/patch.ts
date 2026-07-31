/**
 * Transform-style patching over a parsed technology, the design notes' big
 * step. The patch type is closed (typos and `id` are compile errors) and a
 * patched field keeps its slot: emission walks the original entry list,
 * substituting patched values in place and appending only genuinely new
 * fields — which is what keeps "always emit complete objects" true for
 * everything `TechnologyFields` does not model.
 */

import { quoted, scalar, type PdxEntry, type PdxValue } from "../../src/ast.ts";
import type { ResearchArea } from "../../src/generated/enums.ts";
import { refId, type TechnologyCategoryRef, type TechnologyRef } from "../../src/generated/refs.ts";
import type { Trigger } from "../../src/trigger-core.ts";
import { lowerEntry } from "./emit.ts";
import type { ParsedNumber, ParsedTechnology } from "./surface.ts";

/**
 * What a patch may change: the fields the surface types, nothing else. `id`
 * is deliberately absent — a patched technology keeps vanilla's identity,
 * because the override must target the vanilla key to win.
 */
export interface TechnologyPatch {
  readonly cost?: number | ParsedNumber;
  readonly tier?: number | ParsedNumber;
  readonly weight?: number | ParsedNumber;
  readonly area?: ResearchArea;
  readonly category?: readonly (TechnologyCategoryRef | string)[];
  readonly prerequisites?: readonly (TechnologyRef | string)[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
}

export interface PatchedTechnology {
  readonly id: string;
  toEntries(): PdxEntry;
}

function numberValue(value: number | ParsedNumber): PdxValue {
  if (typeof value === "number") {
    return scalar(value);
  }
  return value.ref !== undefined ? scalar(value.ref) : scalar(value.value);
}

/** The patched fields as serializer values, keyed by their PDXScript keys. */
function patchValues(patch: TechnologyPatch): Map<string, PdxValue> {
  const values = new Map<string, PdxValue>();
  if (patch.cost !== undefined) {
    values.set("cost", numberValue(patch.cost));
  }
  if (patch.tier !== undefined) {
    values.set("tier", numberValue(patch.tier));
  }
  if (patch.weight !== undefined) {
    values.set("weight", numberValue(patch.weight));
  }
  if (patch.area !== undefined) {
    values.set("area", scalar(patch.area));
  }
  if (patch.category !== undefined) {
    values.set("category", { kind: "list", items: patch.category.map((c) => scalar(refId(c))) });
  }
  if (patch.prerequisites !== undefined) {
    values.set("prerequisites", {
      kind: "list",
      items: patch.prerequisites.map((p) => quoted(refId(p))),
    });
  }
  if (patch.startTech !== undefined) {
    values.set("start_tech", scalar(patch.startTech));
  }
  if (patch.isRare !== undefined) {
    values.set("is_rare", scalar(patch.isRare));
  }
  if (patch.potential !== undefined) {
    values.set("potential", { kind: "block", entries: [...patch.potential.entries] });
  }
  return values;
}

export function patchTechnology<T extends ParsedTechnology>(
  tech: T,
  patch: (tech: T) => TechnologyPatch
): PatchedTechnology {
  const values = patchValues(patch(tech));
  return {
    id: tech.id,
    toEntries(): PdxEntry {
      const body: PdxEntry[] = [];
      const substituted = new Set<string>();
      for (const entry of tech.body) {
        const value = values.get(entry.key);
        if (value !== undefined) {
          if (!substituted.has(entry.key)) {
            substituted.add(entry.key);
            body.push({ key: entry.key, op: "=", value });
          }
          continue;
        }
        body.push(lowerEntry(entry));
      }
      for (const [key, value] of values) {
        if (!substituted.has(key)) {
          body.push({ key, op: "=", value });
        }
      }
      return { key: tech.id, op: "=", value: { kind: "block", entries: body } };
    },
  };
}
