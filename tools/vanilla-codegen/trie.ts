/**
 * The trie an oversized registry navigates by, in the two shapes the manifest's
 * `TrieMode` chooses between.
 *
 * A literal union of 9,000 sprite names is a correct type and an unusable one:
 * the editor builds the whole menu at every completion position. The measured
 * fix — the same one the modifier recorder proved at 45k names — is structure,
 * while the flat union stays around for the checked string call, which never
 * reaches a completion position.
 *
 * **`segments`** ({@link buildIdTrie}): ids split on `_` and nest. The property
 * path joined with `_` *is* the id, and `id` is the terminal accessor. No name
 * data exists at runtime, so an id that cannot survive that round trip cannot
 * be a leaf — it is routed to the flat union only and counted, rather than
 * emitted as a path that would rebuild the wrong string.
 *
 * **`file-buckets`** ({@link buildFileBucketTrie}): one level of buckets named
 * after the vanilla files, each holding its ids verbatim as leaves. Here the
 * path is *not* the id — the bucket is navigation only and the leaf key is the
 * whole id — which is also why nothing needs routing to the flat union: a
 * verbatim key is a legal quoted property whatever characters it contains.
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

/**
 * The bucket a vanilla file's stem names.
 *
 * Vanilla writes `<NN>_<registry-token>[_<subject>].txt`, so the load-order
 * number and the registry token are noise and the subject is the real
 * category: `09_static_modifiers_deficit` -> `deficit`. Two files can name the
 * same subject (`16_static_modifiers_paragon`, `19_static_modifiers_paragon`)
 * and merge into one bucket, which is the intent — load order is not a
 * category. A stem that is nothing but number and token
 * (`00_static_modifiers`) yields `""`, meaning "no bucket": its ids are leaves
 * at the trie root, since there is no subject to name them after.
 */
export function fileBucketKey(stem: string, token: string): string {
  const withoutOrder = stem.replace(/^\d+_/, "");
  return withoutOrder === token
    ? ""
    : withoutOrder.startsWith(`${token}_`)
      ? withoutOrder.slice(token.length + 1)
      : withoutOrder;
}

/**
 * The file-bucketed trie: one level of buckets, leaves spelled verbatim.
 *
 * `token` is the registry's own word as vanilla spells it in its filenames
 * (`static_modifiers` for `static_modifier`) — plural, and therefore not
 * derivable from the registry name, so it is passed in.
 */
export function buildFileBucketTrie(
  ids: readonly string[],
  sourceStems: ReadonlyMap<string, string>,
  token: string
): IdTrie {
  const buckets = new Map<string, TrieNode>();
  const grouped = new Map<string, string[]>();
  for (const id of ids) {
    const stem = sourceStems.get(id);
    if (stem === undefined) {
      // Unreachable while the reader fills the map for every id it returns;
      // a leaf at the root is the honest fallback, since the alternative is
      // dropping an id the registry really defines.
      grouped.set("", [...(grouped.get("") ?? []), id]);
      continue;
    }
    const key = fileBucketKey(stem, token);
    grouped.set(key, [...(grouped.get(key) ?? []), id]);
  }
  const rootLeaves = grouped.get("") ?? [];
  grouped.delete("");
  for (const id of rootLeaves) {
    buckets.set(id, { id, children: new Map() });
  }
  for (const [key, members] of [...grouped].sort(([left], [right]) =>
    compareSegments(left, right)
  )) {
    buckets.set(key, {
      id: null,
      children: new Map(members.map((id) => [id, { id, children: new Map<string, TrieNode>() }])),
    });
  }
  return { buckets: sortByKey(buckets), excluded: [] };
}

function sortByKey(map: ReadonlyMap<string, TrieNode>): ReadonlyMap<string, TrieNode> {
  return new Map([...map].sort(([left], [right]) => compareSegments(left, right)));
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
