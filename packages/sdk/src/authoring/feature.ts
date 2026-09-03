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
import { LOWERCASE_SNAKE_CASE } from "../identity.ts";
import type { ContentPatchItem } from "../installation/vanilla/patch.ts";
import type { AssetFileItem } from "./assets.ts";
import type { ComponentTagItem } from "./component-tags.ts";
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
  | AssetFileItem
  | ComponentTagItem;

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

export function assertFileStem(stem: string): void {
  if (!LOWERCASE_SNAKE_CASE.pattern.test(stem)) {
    throw new Error(
      `Feature file stem "${stem}" must be ${LOWERCASE_SNAKE_CASE.diagnostic} — ` +
        `flat, no "/": the game does not read registry content out of subdirectories`
    );
  }
}

/** Event namespaces share the stem grammar; prefix compliance is checked
 * (as a warning) at `buildMod`, matching the content-id policy. */
export function assertNamespace(namespace: string): void {
  if (!LOWERCASE_SNAKE_CASE.pattern.test(namespace)) {
    throw new Error(`Event namespace "${namespace}" must be ${LOWERCASE_SNAKE_CASE.diagnostic}`);
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
  // The list is copied, not its items: an item is an SDK-built value, while
  // the array around it belongs to the caller and could still be appended to.
  return { itemKind: "feature", stem, items: Object.freeze([...items]) };
}

export type ModItemInput = Feature | readonly ModItemInput[];

/**
 * Whether the value is an Item: content, event, patch, Asset file, or any
 * other value an authoring method returns.
 *
 * `itemKind` is the discriminant every Item carries and nothing else does, so
 * it settles this without naming one kind. An author can of course write
 * `{ itemKind: "…" }` by hand; nothing here believes more than the shape, and
 * whatever comes next (a snapshot sharing it, a placement checking its owner)
 * treats it as the Item it claims to be.
 */
export function isItem(value: unknown): value is { readonly itemKind: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly itemKind?: unknown }).itemKind === "string"
  );
}

/**
 * Whether the value is a Feature: a placed list of Items, as `mod.feature`
 * returns. Structural on purpose, because bag reading meets Features as
 * unknown module exports and has only their shape to go on.
 */
export function isFeature(value: unknown): value is Feature {
  return isItem(value) && value.itemKind === "feature";
}

/** An item plus the file stem of the feature that created it. */
export interface PlacedItem<T extends ModItem = ModItem> {
  readonly item: T;
  readonly stem: string | undefined;
}

/**
 * Refuses an item whose `itemKind` belongs to no arm of {@link ModItem}.
 *
 * The parameter is `never`, so a new arm that no dispatch handles fails to
 * compile; the throw is what catches a value cast past the type, which would
 * otherwise be dropped from the output without a word.
 */
export function refuseUnknownItemKind(item: never): never {
  const kind = (item as ModItem).itemKind;
  throw new Error(
    `Item kind "${String(kind)}" is not one this SDK defines — every item in a Feature must come ` +
      `from a capability method on the mod`
  );
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
