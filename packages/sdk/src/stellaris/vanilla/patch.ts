/**
 * Transform-style patching over a parsed technology. The patch type is closed
 * (typos and `id`
 * are compile errors) and a patched field keeps its slot: emission walks the
 * original entry list, substituting patched values in place and appending
 * only genuinely new fields — which is what keeps "always emit complete
 * objects" true for everything the surface does not model.
 *
 * Promotion fix the probe recorded: a `ParsedNumber` passed through whole
 * re-emits as `varRef(ref)`, not a bare string — the package serializer's
 * symmetric quoting rule would quote-promote `"@t3cost"` into a string the
 * game cannot resolve.
 */

import {
  quoted,
  scalar,
  varRef,
  type PdxEntry,
  type PdxItem,
  type PdxValue,
} from "@pdx-ts/pdxscript";

import type { ResearchArea } from "../../generated/enums.ts";
import { refId, type TechnologyCategoryRef, type TechnologyRef } from "../../generated/refs.ts";
import type { ContentRefUse } from "../../references.ts";
import type { Trigger } from "../../script/trigger-core.ts";
import type { AnyOf, ParsedNumber, ParsedTechnology } from "./view.ts";

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
  readonly prerequisites?: readonly (TechnologyRef | string | AnyOf<TechnologyRef>)[];
  readonly startTech?: boolean;
  readonly isRare?: boolean;
  readonly potential?: Trigger<"country">;
}

export interface PatchedTechnology {
  readonly id: string;
  /** The vanilla technology this patch transforms — provenance for the win engine. */
  readonly source: ParsedTechnology;
  /**
   * The content references the patched fields write, for `buildMod`'s
   * dangling-reference guard. A patch is the other way a definition of this
   * mod's own gets named — appending an own technology to a vanilla tech's
   * prerequisites is the calibration anchor itself — so the ids it writes have
   * to resolve on the same terms a `define`'s do.
   */
  readonly refs: readonly ContentRefUse[];
  toEntries(): PdxEntry;
}

/** A vanilla technology patch placed into a capability feature. */
export interface TechnologyPatchItem {
  readonly itemKind: "patch";
  readonly patched: PatchedTechnology;
}

function numberValue(value: number | ParsedNumber): PdxValue {
  if (typeof value === "number") {
    return scalar(value);
  }
  return value.ref !== undefined ? varRef(value.ref) : scalar(value.value);
}

function prerequisiteItem(item: TechnologyRef | string | AnyOf<TechnologyRef>): PdxItem {
  if (typeof item !== "string" && "kind" in item) {
    const options = item.options.map((option) => quoted(refId<string>(option)));
    return { kind: "entry", key: "OR", op: "=", value: { kind: "container", items: options } };
  }
  return quoted(refId<string>(item));
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
    values.set("category", {
      kind: "container",
      items: patch.category.map((c) => scalar(refId(c))),
    });
  }
  if (patch.prerequisites !== undefined) {
    values.set("prerequisites", {
      kind: "container",
      items: patch.prerequisites.map(prerequisiteItem),
    });
  }
  if (patch.startTech !== undefined) {
    values.set("start_tech", scalar(patch.startTech));
  }
  if (patch.isRare !== undefined) {
    values.set("is_rare", scalar(patch.isRare));
  }
  if (patch.potential !== undefined) {
    values.set("potential", { kind: "container", items: [...patch.potential.entries] });
  }
  return values;
}

/** The ids the patched reference fields name, with the registry each names. */
function patchRefs(patch: TechnologyPatch): ContentRefUse[] {
  const refs: ContentRefUse[] = [];
  for (const item of patch.prerequisites ?? []) {
    const options = typeof item !== "string" && "kind" in item ? item.options : [item];
    for (const option of options) {
      refs.push({ targets: ["technology"], id: refId<string>(option), field: "prerequisites" });
    }
  }
  for (const item of patch.category ?? []) {
    refs.push({ targets: ["technology_category"], id: refId<string>(item), field: "category" });
  }
  return refs;
}

export function patchTechnology<T extends ParsedTechnology>(
  tech: T,
  patch: (tech: T) => TechnologyPatch
): PatchedTechnology {
  const patched = patch(tech);
  const values = patchValues(patched);
  return {
    id: tech.id,
    source: tech,
    refs: patchRefs(patched),
    toEntries(): PdxEntry {
      const body: PdxEntry[] = [];
      const substituted = new Set<string>();
      for (const entry of tech.body) {
        const value = values.get(entry.key);
        if (value !== undefined) {
          if (!substituted.has(entry.key)) {
            substituted.add(entry.key);
            body.push({ kind: "entry", key: entry.key, op: "=", value });
          }
          continue;
        }
        body.push(entry);
      }
      for (const [key, value] of values) {
        if (!substituted.has(key)) {
          body.push({ kind: "entry", key, op: "=", value });
        }
      }
      return { kind: "entry", key: tech.id, op: "=", value: { kind: "container", items: body } };
    },
  };
}
