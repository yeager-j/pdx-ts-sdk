/**
 * The adaptive trie an oversized registry navigates by.
 *
 * A literal union of 9,000 sprite names is a correct type and an unusable one:
 * the editor builds the whole menu at every completion position. The measured
 * fix — the same one the modifier recorder proved at 45k names — is structure.
 * Ids split on `_` and nest, so every menu a modder sees is small, while the
 * flat union stays around for the checked string call, which never reaches a
 * completion position.
 *
 * Reconstruction is the contract the runtime depends on: the property path
 * joined with `_` *is* the id, and `id` is the terminal accessor. No name data
 * exists at runtime, so an id that cannot survive that round trip cannot be a
 * leaf — it is routed to the flat union only and counted, rather than emitted
 * as a path that would rebuild the wrong string.
 */

/** Bucket sizes above which a level splits, and the level at which it stops. */
export interface TrieShape {
  /** Registries with more ids than this get a trie at all. */
  readonly threshold: number;
  /** A group at or below this size stops splitting and spells out its tails. */
  readonly leafSize: number;
}

export const DEFAULT_TRIE_SHAPE: TrieShape = { threshold: 2000, leafSize: 500 };

export interface TrieNode {
  /** The complete id reachable at this node, when the path spells one out. */
  readonly id: string | null;
  /** Deeper keys, each already relative to this node. */
  readonly children: ReadonlyMap<string, TrieNode>;
}

export interface IdTrie {
  /** Top-level buckets. Each becomes one emitted file. */
  readonly buckets: ReadonlyMap<string, TrieNode>;
  /** Ids the trie cannot represent; they remain in the flat union. */
  readonly excluded: readonly string[];
}

interface Item {
  readonly id: string;
  readonly rest: readonly string[];
}

/** Only `_`-separated word characters can round-trip a property path. */
const NAVIGABLE = /^[A-Za-z0-9_]+$/;

/**
 * Whether an id can be reached by property navigation at all.
 *
 * Three ways it cannot: a character outside the identifier alphabet (quoted
 * sound names contain spaces and dots), a segment spelled `id` — which would
 * collide with the terminal accessor and read as the leaf rather than a step —
 * and, defensively, any id whose split does not rejoin to itself.
 */
export function navigable(id: string): boolean {
  if (!NAVIGABLE.test(id)) {
    return false;
  }
  const segments = id.split("_");
  return segments.join("_") === id && !segments.includes("id");
}

export function buildIdTrie(ids: readonly string[], shape: TrieShape): IdTrie {
  const excluded = ids.filter((id) => !navigable(id));
  const items = ids
    .filter((id) => navigable(id))
    .map((id) => ({ id, rest: id.split("_") }) satisfies Item);
  return { buckets: buildChildren(items, "", shape), excluded };
}

/**
 * One level of children.
 *
 * `keyPrefix` carries fused segments down: when every id at a level shares its
 * next segment, splitting on it would produce a node with exactly one child —
 * a ladder rung that costs a keystroke and shows a menu of one. Every sprite id
 * starts `GFX`, so the root's keys are `GFX_ship`, `GFX_planet`, … rather than
 * a lone `GFX`. The fusion stops where a member *ends* at the shared segment,
 * because that node carries an id and cannot be merged away.
 */
function buildChildren(
  items: readonly Item[],
  keyPrefix: string,
  shape: TrieShape
): ReadonlyMap<string, TrieNode> {
  const children = new Map<string, TrieNode>();
  if (items.length === 0) {
    return children;
  }
  if (items.length <= shape.leafSize) {
    for (const item of items) {
      children.set(keyPrefix + item.rest.join("_"), { id: item.id, children: new Map() });
    }
    return children;
  }
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const segment = item.rest[0]!;
    groups.set(segment, [...(groups.get(segment) ?? []), item]);
  }
  const only = groups.size === 1 ? [...groups][0]! : null;
  if (only !== null && !only[1].some((item) => item.rest.length === 1)) {
    return buildChildren(descend(only[1]), `${keyPrefix}${only[0]}_`, shape);
  }
  for (const [segment, members] of [...groups].sort(([left], [right]) =>
    compareSegments(left, right)
  )) {
    const terminal = members.find((item) => item.rest.length === 1);
    const deeper = descend(members.filter((item) => item.rest.length > 1));
    children.set(keyPrefix + segment, {
      id: terminal?.id ?? null,
      children: buildChildren(deeper, "", shape),
    });
  }
  return children;
}

function descend(items: readonly Item[]): Item[] {
  return items.map((item) => ({ id: item.id, rest: item.rest.slice(1) }));
}

function compareSegments(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
