/**
 * The pure authoring API's item vocabulary (SDK-22, SDK-23).
 *
 * A capability compiles capability-owned features — never loose items.
 * Capability methods create values, and `mod.feature(file, items)` places
 * them. The internal raw definers and `collection(file, items)` below remain
 * the lowering vocabulary that the capability and fold share.
 *
 * Each domain owns its item contracts. This module only combines that
 * vocabulary into features and places their items into output file stems.
 */

import type { ContentItem, ContributionItem } from "../content/types.ts";
import type { OnActionBindingItem } from "../events/on-actions.ts";
import type { EventItemBase } from "../events/types.ts";
import type { TechnologyPatchItem } from "../stellaris/vanilla/patch.ts";

export type ModItem =
  ContentItem | EventItemBase | OnActionBindingItem | TechnologyPatchItem | ContributionItem;

/**
 * One output file's worth of items: the file stem and what lands in it. The
 * list is read when the internal fold runs. Generic in its element type so a
 * technology collection's `items` are technology items — the type says what
 * the collection can contain, not just that it contains "something".
 */
export interface Collection<T extends ModItem = ModItem> {
  readonly itemKind: "collection";
  readonly file: string | undefined;
  readonly items: readonly T[];
}

/** Same shape as the mod prefix: lowercase snake_case, ASCII, flat. The
 * game does not read registry content out of subdirectories — the subdirs
 * under `common/technology/` (`category/`, `tier/`) are different
 * registries, not layout — so stems carry no `/`. */
export const FILE_STEM_PATTERN = /^[a-z][a-z0-9_]*$/;

export function assertFileStem(stem: string): void {
  if (!FILE_STEM_PATTERN.test(stem)) {
    throw new Error(
      `Collection file stem "${stem}" must be lowercase snake_case ([a-z][a-z0-9_]*) — ` +
        `flat, no "/": the game does not read registry content out of subdirectories`
    );
  }
}

/** Event namespaces share the stem grammar; prefix compliance is checked
 * (as a warning) at `buildMod`, matching the content-id policy. */
export function assertNamespace(namespace: string): void {
  if (!FILE_STEM_PATTERN.test(namespace)) {
    throw new Error(
      `Event namespace "${namespace}" must be lowercase snake_case ([a-z][a-z0-9_]*)`
    );
  }
}

/**
 * Internal lowering primitive over items that already exist. Capability
 * `feature()` delegates here after it has checked ownership; the stem is
 * validated once for every collection the fold receives.
 */
export function collection<T extends ModItem>(
  file: string | undefined,
  items: readonly T[]
): Collection<T> {
  if (file !== undefined) {
    assertFileStem(file);
  }
  return { itemKind: "collection", file, items };
}

export type ModItemInput = Collection | readonly ModItemInput[];

/** An item plus the file stem of the collection that created it. */
export interface PlacedItem {
  readonly item: ModItem;
  readonly file: string | undefined;
}

export function flattenItems(items: readonly ModItemInput[]): PlacedItem[] {
  const flat: PlacedItem[] = [];
  for (const entry of items) {
    if (Array.isArray(entry)) {
      flat.push(...flattenItems(entry));
    } else {
      const collection = entry as Collection;
      if (collection.file !== undefined) {
        // Collection values are structural; re-assert stems from hand-built ones.
        assertFileStem(collection.file);
      }
      for (const item of collection.items) {
        flat.push({ item, file: collection.file });
      }
    }
  }
  return flat;
}
