/**
 * The trie an oversized registry navigates by: buckets named after the vanilla
 * files the ids are defined in, holding those ids verbatim as leaves.
 *
 * A literal union of 9,000 sprite names is a correct type and an unusable one:
 * the editor builds the whole menu at every completion position. The measured
 * fix — the same one the modifier recorder proved at 45k names — is structure,
 * while the flat union stays around for the checked string call, which never
 * reaches a completion position.
 *
 * The structure is vanilla's own file layout, for every oversized registry.
 * Splitting ids on `_` instead was tried and dropped: it invents categories the
 * names only accidentally share (static modifiers produced 1,028 segment
 * buckets, most of them one id), it cannot represent a name with a dot or a
 * space in it at all, and the path it produces is the id — so every id has to
 * round-trip through a join. A file bucket has none of those properties: the
 * path is navigation only, the leaf key is the whole id, and a verbatim key is
 * a legal quoted property whatever characters it contains.
 */

import { compareIdentifiers } from "./emit.ts";

/** How much of a source file's path names the bucket an id lands in. */
export type BucketLayout =
  /**
   * The stem alone, with the load-order number and the registry's own token
   * removed: `common/static_modifiers/09_static_modifiers_deficit.txt` ->
   * `deficit`. The `common/` naming convention, where the number is load order
   * and the token is the registry restating itself, so the subject is all
   * that is left. A stem that strips to nothing (`00_static_modifiers.txt`)
   * names no subject, and its ids are leaves at the trie root.
   */
  | "stripped-file"
  /**
   * The verbatim stem: `interface/eventpictures.gfx` -> `eventpictures`.
   * `interface/` carries no load-order numbers and no restated token, so
   * stripping would only mangle real names (`interface/interface.gfx` would
   * strip to nothing and lose its bucket).
   */
  | "file"
  /**
   * Every directory level and then the stem:
   * `sound/toxoids/ships/tox_ships_moves.asset` -> `toxoids`, `ships`,
   * `tox_ships_moves`. The `sound/` tree is deep and its directories are the
   * real categories — DLC, then subject — so flattening to the stem would
   * throw the navigation away.
   */
  | "directory";

/** Id count above which a registry gets a trie at all. */
export const DEFAULT_TRIE_THRESHOLD = 2000;

export interface TrieNode {
  /** The complete id reachable at this node, when a leaf sits here. */
  readonly id: string | null;
  /** Deeper keys, each already relative to this node. */
  readonly children: ReadonlyMap<string, TrieNode>;
}

/**
 * The bucket a vanilla file's basename names under {@link BucketLayout}
 * `stripped-file`.
 *
 * Two files can name the same subject (`16_static_modifiers_paragon`,
 * `19_static_modifiers_paragon`) and merge into one bucket, which is the intent
 * — load order is not a category.
 */
export function fileBucketKey(basename: string, token: string): string {
  const withoutOrder = basename.replace(/^\d+_/, "");
  return withoutOrder === token
    ? ""
    : withoutOrder.startsWith(`${token}_`)
      ? withoutOrder.slice(token.length + 1)
      : withoutOrder;
}

/**
 * The navigation segments a source file contributes, given its path relative
 * to the registry's own directory.
 *
 * `token` is the registry's own word as vanilla spells it in its filenames
 * (`static_modifiers` for `static_modifier`) — plural, and therefore not
 * derivable from the registry name, so it is passed in. Only `stripped-file`
 * reads it.
 */
export function bucketPath(
  relativePath: string,
  layout: BucketLayout,
  token: string
): readonly string[] {
  const parts = relativePath.split("/");
  const stem = stemOf(parts.pop() ?? "");
  const directories = layout === "directory" ? parts : [];
  const key = layout === "stripped-file" ? fileBucketKey(stem, token) : stem;
  return key === "" ? directories : [...directories, key];
}

/** `09_static_modifiers_deficit.txt` -> `09_static_modifiers_deficit`. */
function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Builds the trie: every id walks its file's bucket path and lands as a leaf
 * keyed by the whole id.
 *
 * A key can be reached twice — two files under one directory merge, and an id
 * spelled like a directory or a stem lands on the node that segment already
 * made. Nothing is dropped in either case: the node simply carries both an id
 * and children, which is exactly what `X` being both a complete id and a
 * prefix of deeper ones means.
 */
export function buildTrie(
  ids: readonly string[],
  sourcePaths: ReadonlyMap<string, string>,
  layout: BucketLayout,
  token: string
): ReadonlyMap<string, TrieNode> {
  const root: MutableNode = { id: null, children: new Map() };
  for (const id of ids) {
    const source = sourcePaths.get(id);
    if (source === undefined) {
      throw new Error(`no source file recorded for id ${JSON.stringify(id)}`);
    }
    let node = root;
    for (const segment of bucketPath(source, layout, token)) {
      node = descend(node, segment);
    }
    descend(node, id).id = id;
  }
  return freeze(root).children;
}

interface MutableNode {
  id: string | null;
  readonly children: Map<string, MutableNode>;
}

function descend(node: MutableNode, key: string): MutableNode {
  const existing = node.children.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableNode = { id: null, children: new Map() };
  node.children.set(key, created);
  return created;
}

/** Sorts every level by byte order, so emission does not depend on walk order. */
function freeze(node: MutableNode): TrieNode {
  return {
    id: node.id,
    children: new Map(
      [...node.children]
        .sort(([left], [right]) => compareIdentifiers(left, right))
        .map(([key, child]) => [key, freeze(child)])
    ),
  };
}

/** Ids reachable in this subtree, the size a bucket is measured by. */
export function countLeaves(node: TrieNode): number {
  let total = node.id === null ? 0 : 1;
  for (const child of node.children.values()) {
    total += countLeaves(child);
  }
  return total;
}
