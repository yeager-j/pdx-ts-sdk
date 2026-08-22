/**
 * Structural traversal of an item sequence.
 *
 * `itemChildren` is the one place that knows what a `PdxItem` holds, so a new
 * item kind stops compiling here instead of being silently skipped by every
 * consumer that walks a tree. Traversal is shape, not meaning: nothing here
 * reads a key, resolves a value, or interprets a region.
 */

import type { PdxItem } from "./ast.ts";
import { regionItems } from "./parser.ts";

const NO_CHILDREN: readonly PdxItem[] = Object.freeze([]);

/**
 * What a walk does with a `param-text` region: `"skip"` leaves it unentered,
 * and reading parses its body flat with `regionItems`. `fileName` names the
 * source in the errors an unlexable body throws.
 */
export type RegionPolicy = "skip" | { readonly read: true; readonly fileName?: string };

/** Returned from a `walkItems` visit to leave that item's children unvisited. */
export const skipChildren: unique symbol = Symbol("skipChildren");

/**
 * The items structurally inside one item, in source order: an entry's value,
 * a container's or a param block's items, a region's flat body when the policy
 * reads it. Scalars hold none. Keys and container headers are not items and
 * are never returned.
 *
 * A container's and a param block's items are the tree's own array, not a
 * copy; a read region's body is freshly parsed and belongs to no tree.
 */
export function itemChildren(item: PdxItem, regions: RegionPolicy): readonly PdxItem[] {
  switch (item.kind) {
    case "entry":
      return [item.value];
    case "container":
    case "param":
      return item.items;
    case "param-text":
      return regions === "skip" ? NO_CHILDREN : regionItems(item, regions.fileName);
    case "str":
    case "num":
    case "bool":
    case "var":
    case "math":
      return NO_CHILDREN;
    default: {
      const unhandled: never = item;
      throw new Error(`Unhandled item kind: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Walks `items` and everything inside them in pre-order, parent before
 * children and siblings in source order.
 *
 * `visit` receives each item with the context its parent returned; what it
 * returns becomes the context for that item's children, and `skipChildren`
 * leaves them unvisited. Keys and container headers are never visited.
 *
 * @example
 * ```ts
 * const names: string[] = [];
 * walkItems(document.items, undefined, (item) => {
 *   if (item.kind === "var") {
 *     names.push(item.name);
 *   }
 *   return undefined;
 * }, { read: true });
 * ```
 */
export function walkItems<C>(
  items: readonly PdxItem[],
  context: C,
  visit: (item: PdxItem, context: C) => C | typeof skipChildren,
  regions: RegionPolicy
): void {
  for (const item of items) {
    const childContext = visit(item, context);
    if (childContext !== skipChildren) {
      walkItems(itemChildren(item, regions), childContext, visit, regions);
    }
  }
}
