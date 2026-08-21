/**
 * The pure authoring API's item vocabulary (SDK-22, SDK-23).
 *
 * A capability compiles capability-owned features — never loose items.
 * Capability methods create values, and `mod.feature(stem, items)` places
 * them. The internal raw definers and `createFeature(stem, items)` below
 * remain the lowering vocabulary that the capability and fold share.
 *
 * Each domain owns its item contracts. This module only combines that
 * vocabulary into features and places their items into output file stems.
 */

import type { ContentItem, ContributionItem } from "../content/types.ts";
import type { OnActionHookItem } from "../events/on-actions.ts";
import type { EventItemBase } from "../events/types.ts";
import type { ContentPatchItem } from "../stellaris/vanilla/patch.ts";
import type { AssetFileItem } from "./assets.ts";
import type { LocalizationItem, ReplacementLocalizationItem } from "./localization.ts";

/**
 * A patch item enters as the registry-agnostic {@link ContentPatchItem}: the
 * fold reads the registry off the item, so naming one registry here would be
 * the one place a second patchable registry had to be spelled by hand.
 */
export type ModItem =
  | ContentItem
  | EventItemBase
  | OnActionHookItem
  | ContentPatchItem
  | ContributionItem
  | LocalizationItem<string, string, boolean>
  | ReplacementLocalizationItem
  | AssetFileItem;

/**
 * One output file's worth of items: the file stem and what lands in it. The
 * list is read when the internal fold runs. Generic in its element type so a
 * technology feature's `items` are technology items — the type says what the
 * feature can contain, not just that it contains "something".
 */
export interface Feature<T extends ModItem = ModItem> {
  readonly itemKind: "feature";
  readonly stem: string | undefined;
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
      `Feature file stem "${stem}" must be lowercase snake_case ([a-z][a-z0-9_]*) — ` +
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
 * validated once for every feature the fold receives.
 */
export function createFeature<T extends ModItem>(
  stem: string | undefined,
  items: readonly T[]
): Feature<T> {
  if (stem !== undefined) {
    assertFileStem(stem);
  }
  return { itemKind: "feature", stem, items };
}

export type ModItemInput = Feature | readonly ModItemInput[];

/** An item plus the file stem of the feature that created it. */
export interface PlacedItem {
  readonly item: ModItem;
  readonly stem: string | undefined;
}

export function flattenItems(items: readonly ModItemInput[]): PlacedItem[] {
  const flat: PlacedItem[] = [];
  for (const entry of items) {
    if (Array.isArray(entry)) {
      flat.push(...flattenItems(entry));
    } else {
      const feature = entry as Feature;
      if (feature.stem !== undefined) {
        // Feature values are structural; re-assert stems from hand-built ones.
        assertFileStem(feature.stem);
      }
      for (const item of feature.items) {
        flat.push({ item, stem: feature.stem });
      }
    }
  }
  return flat;
}
