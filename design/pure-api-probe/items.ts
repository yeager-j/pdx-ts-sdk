/**
 * The pure authoring API's item vocabulary (SDK-22).
 *
 * `buildMod(config, collections)` takes collections — never loose items.
 * Every piece of content is created through a registry-typed factory
 * (`createTechnologies(file?)`, `createEvents(file, namespace)`, ... in
 * factories.ts) whose definers register into their collection at the
 * definition site, so creation IS registration and the "defined it but
 * forgot to pass it" failure mode does not exist below the granularity of
 * a whole collection. Nested arrays flatten, so a pack is a module
 * exporting a collection or an array of them.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";

import type { ContentRefUse } from "../../src/content-refs.ts";
import type { ContentTypeName } from "../../src/generated/content-registry.ts";
import type { ScopeName } from "../../src/generated/scopes.ts";
import type { OnActionRef } from "../../src/on-actions.ts";
import type { PatchedTechnology } from "../../src/vanilla/patch.ts";

export interface ModWarning {
  readonly code: "missing-prefix" | "loc-quote-replaced";
  readonly message: string;
}

/** A content definition as a value: structurally a `TypedRef`, so it flows
 * into reference fields (`prerequisites: [tech]`) exactly like today. */
export interface ContentItem<
  K extends ContentTypeName = ContentTypeName,
  D extends { readonly id: string } = { readonly id: string },
> {
  readonly itemKind: "content";
  readonly type: K;
  readonly id: D["id"];
  readonly def: D;
}

/**
 * A defined event: finished data. The factory knew the namespace, so the
 * recorder closures already ran (define-site stack traces, like the class
 * API), the full id is a plain string, and the definition-side localization
 * rides along for `buildMod` to merge. Structurally a `DefinedEvent`, so it
 * flows into fire sites and the on-action authoring unchanged.
 */
export interface EventItemBase {
  readonly itemKind: "event";
  readonly kind: "event-ref";
  readonly namespace: string;
  readonly scope: ScopeName;
  readonly from: ScopeName | undefined;
  /** The full id, e.g. `pp_mod_ascension.2`. Plain data — no deferral. */
  readonly id: string;
  readonly entry: PdxEntry;
  /** Content references the event's closures wrote; carried so the probe's
   * item stays structurally a `DefinedEvent`. */
  readonly refs: readonly ContentRefUse[];
  readonly locEntries: ReadonlyArray<readonly [string, string]>;
}

export interface OnActionBindingItem {
  readonly itemKind: "on-action";
  readonly hook: OnActionRef;
  /** Identity is the ownership proof: this exact value must also be built. */
  readonly event: EventItemBase;
}

export interface TechnologyPatchItem {
  readonly itemKind: "patch";
  readonly patched: PatchedTechnology;
}

/** A contribution to a shared, non-id-keyed sink (`default = { ... }`). */
export interface ContributionItem {
  readonly itemKind: "contribution";
  readonly registry: "ship_of_size_limits";
  readonly ids: readonly string[];
}

export type ModItem =
  ContentItem | EventItemBase | OnActionBindingItem | TechnologyPatchItem | ContributionItem;

/**
 * What a factory returns (plus its definers): the file stem and the items
 * its definers registered. The list is read when `buildMod` runs. Generic
 * in its element type so a technology collection's `items` are technology
 * items — the type says what the collection can contain, not just that it
 * contains "something".
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
