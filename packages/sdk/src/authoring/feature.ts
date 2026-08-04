/**
 * The pure authoring API's item vocabulary (SDK-22, SDK-23).
 *
 * A capability compiles capability-owned features — never loose items.
 * Capability methods create values, and `mod.feature(file, items)` places
 * them. The internal raw definers and `collection(file, items)` below remain
 * the lowering vocabulary that the capability and fold share.
 *
 * The items below are the vocabulary the definers, the collections, and the
 * fold all speak, which is why they live here and not beside any one of them.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";

import type { OnActionRef } from "../events/on-actions.ts";
import type { DefinedEvent } from "../events/types.ts";
import type { ContentReferenceName, ContentTypeName } from "../generated/content-registry.ts";
import type { TypedRef } from "../generated/refs.ts";
import type { ScopeName } from "../generated/scopes.ts";
import type { ContentRefUse } from "../references.ts";
import type { PatchedTechnology } from "../stellaris/vanilla/patch.ts";

export interface ModWarning {
  readonly code:
    | "missing-prefix"
    | "loc-quote-replaced"
    | "unstable-desc-key"
    | "loc-key-looks-like-text"
    | "unchecked-vanilla-ids";
  readonly message: string;
}

/**
 * A content definition as a value: a `TypedRef` for its own registry, so it
 * flows into that registry's reference fields (`prerequisites: [tech]`) and
 * nowhere else. Extending `TypedRef` carries the registry brand without this
 * module naming the phantom symbol — the same trick `EventItem` uses through
 * `DefinedEvent`. The brand stays optional and phantom (raw vanilla id strings
 * still assign to a `TypedRef`); what it buys is that two items with
 * mismatched `K` conflict, so a building is not a `TechnologyRef`.
 *
 * The brand is the registry's CWT *reference* name rather than `K` itself.
 * They differ only where the manifest splits one CWT type into several
 * registries: a utility component template is `<component_template
 * .utility_component_template>` to the rules, and branding it
 * `"utility_component_template"` — a name no rule uses — left it unable to
 * reach any field that references one.
 */
export interface ContentItem<
  K extends ContentTypeName = ContentTypeName,
  D extends { readonly id: string } = { readonly id: string },
> extends TypedRef<ContentReferenceName<K>> {
  readonly itemKind: "content";
  readonly type: K;
  readonly id: D["id"];
  readonly def: D;
}

/**
 * A defined event: finished data. The namespace handle knew the namespace, so the
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
  /** Content references the event's closures wrote, for the build's guard. */
  readonly refs: readonly ContentRefUse[];
  readonly locEntries: ReadonlyArray<readonly [string, string]>;
  /** Diagnostics collected at define time; `buildMod` drains these into `mod.warnings`. */
  readonly warnings: readonly ModWarning[];
}

/**
 * What an event definer returns: a defined event with its scope and FROM
 * contract intact for fire sites and `on()`. Structurally a `DefinedEvent`, so
 * it flows into both unchanged — the FROM brand rides along by intersection
 * without this module naming the phantom symbol.
 */
export type EventItem<
  S extends ScopeName = ScopeName,
  From extends ScopeName | undefined = ScopeName | undefined,
  Kind extends string = S,
> = DefinedEvent<S, From, Kind> & {
  readonly itemKind: "event";
  readonly namespace: string;
  readonly locEntries: ReadonlyArray<readonly [string, string]>;
};

export interface OnActionBindingItem {
  readonly itemKind: "on-action";
  readonly hook: OnActionRef;
  /**
   * The events bound to this hook, in the order the author listed them.
   * That order is author data — the game fires a hook's event list as
   * written — so `buildMod` registers straight down the array and never
   * sorts it, the same rule the per-hook registration order already follows.
   *
   * Identity is the ownership proof: each of these exact values must also be
   * among the collections passed to the same `buildMod`.
   */
  readonly events: readonly EventItemBase[];
}

export interface TechnologyPatchItem {
  readonly itemKind: "patch";
  readonly patched: PatchedTechnology;
}

/** A contribution to a shared, non-id-keyed sink (`default = { ... }`). */
export interface ContributionItem {
  readonly itemKind: "contribution";
  readonly registry: "ship_of_size_limits";
  /** The registry the listed ids name, so own-prefixed ones can be resolved. */
  readonly refRegistry: ContentTypeName;
  readonly ids: readonly string[];
}

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
