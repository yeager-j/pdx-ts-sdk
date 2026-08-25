/**
 * A minted content id that exists before its definition does (SDK-290).
 *
 * A capability mints an id inside the same call that consumes the definition,
 * so a definition cannot name the id it is about to be given. Nearly every
 * vanilla ascension perk excludes itself in `potential`, and two perks that
 * exclude each other are just as ordinary — both need the id first. Without a
 * handle the author retypes the mint rule as a string literal, which nothing
 * checks: rename the logical name, or change the id profile, and the condition
 * silently stops matching.
 *
 * A handle splits the mint from the definition. It is the content half of the
 * arrangement `CapabilityEventHandle` already gives events, and the capability's
 * eager `mod.<registry>(name, def)` is `handle(name).define(def)` — one code
 * path, so the two entry points cannot mint differently.
 */

import type { ContentReferenceName, ContentTypeName } from "../generated/content-registry.ts";
import type { TypedRef } from "../script/scalar.ts";
import type { ContentItem } from "./types.ts";

/**
 * The identity half of a handle: a minted id wearing its registry's reference
 * brand, with no definition attached yet.
 *
 * It brands as the same reference its `ContentItem` does, so it reaches every
 * field that accepts the registry — which is the point, since that is how a
 * definition names the id being minted for it.
 *
 * It deliberately carries no `itemKind`, so it is not a `ModItem` and
 * `mod.feature(...)` rejects it at compile time. A handle is an identity, not
 * content: what goes in a Feature is the item `define(...)` returns. This is
 * the same guarantee the event handle gets, and for the same reason — a minted
 * id that reached the Fold without a body would emit nothing while every
 * reference to it still resolved.
 */
export interface ContentHandleBase<K extends ContentTypeName, Id extends string> extends TypedRef<
  ContentReferenceName<K>
> {
  readonly handleKind: "content-handle";
  readonly type: K;
  readonly id: Id;
}

/**
 * A handle whose `define` takes nothing but the definition.
 *
 * Every registry uses this except the few whose definition introduces a type
 * parameter of its own — a scope inferred from the def, or a witness. Those
 * cannot use it, because the parameter has to live on `define` where there is a
 * def to infer it from, so their capability method spells
 * {@link ContentHandleBase} intersected with their own `define` instead.
 */
export interface ContentHandle<
  K extends ContentTypeName,
  D extends { readonly id: string },
> extends ContentHandleBase<K, D["id"] & string> {
  /**
   * Attaches the body to the already-minted id, returning the item to place in
   * a Feature. Pure and stateless: calling it twice builds two definitions of
   * one id, which the Fold refuses exactly as it refuses two eager calls.
   */
  define(def: Omit<D, "id">): ContentItem<K, D>;
}

/**
 * The lowering step a capability's eager method and its handle definer share.
 *
 * Everything registry-specific is already decided by the time this runs: the
 * capability minted the id — which is why an invalid logical name throws at the
 * mint site, not here — and closed over the nested-id assertion, the definer,
 * and any provenance record in `define`. This only remembers the id and hands
 * it back merged into the definition.
 */
export function createContentHandle<
  K extends ContentTypeName,
  Id extends string,
  D extends { readonly id: Id },
  Item,
>(
  type: K,
  id: Id,
  define: (def: D) => Item
): ContentHandleBase<K, Id> & { define(def: Omit<D, "id">): Item } {
  return Object.freeze({
    handleKind: "content-handle",
    type,
    id,
    define: (def: Omit<D, "id">) => define({ ...def, id } as D),
  });
}
