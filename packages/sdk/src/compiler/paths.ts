/**
 * The path-ownership ledger: one claim per output file, adjudicated before a
 * `PureMod` exists.
 *
 * The point of doing this in the fold rather than at serialization is that a
 * `PureMod` is supposed to be the assembled mod. If two channels can still be
 * fighting over a path inside one, the value is a promise the SDK has not
 * checked. After adjudication `render()` is a serializer and nothing more: it
 * cannot overwrite a file, because the set of paths was settled before it ran.
 *
 * The reserved paths live here too, rather than beside the code that writes
 * them, because the fold has to know them and must never import
 * `output/write.ts` — that would pull `node:fs/promises` into the pure compile
 * path.
 */

import {
  PathOwnershipError,
  type PathClaimant,
  type PathConflictReason,
  type PathOwnershipConflict,
  type PathProducerKind,
} from "../errors.ts";
import {
  compareUtf8,
  normalizeLogicalPath,
  portableIdentity,
  portablePathKey,
  type LogicalPath,
} from "../ordering.ts";

/** The descriptor inside the mod folder. The SDK claims it; nothing else may. */
export const DESCRIPTOR_PATH: LogicalPath = normalizeLogicalPath("descriptor.mod");

/**
 * The ownership manifest. Sink metadata rather than Rendered mod content, so it
 * is reserved without ever being claimed: no producer may occupy it, and the
 * materializer writes it after rendering is over.
 */
export const MATERIALIZATION_MANIFEST_PATH: LogicalPath =
  normalizeLogicalPath(".pdx-sdk-manifest.json");

/**
 * The two shared files no Feature owns a stem for: every on-action hook in the
 * mod lands in one file, and so does every ship-size-limit contribution. They
 * are minted here rather than at the point of serialization because the fold
 * has to know every path the build will occupy.
 */
export function onActionsPath(prefix: string): LogicalPath {
  return normalizeLogicalPath(`common/on_actions/${prefix}_on_actions.txt`);
}

export function shipOfSizeLimitsPath(prefix: string): LogicalPath {
  return normalizeLogicalPath(
    `common/country_limits/ownership_limits/${prefix}_ownership_limits.txt`
  );
}

/** Who claimed a path, in the terms a conflict has to report. */
export interface PathProducer {
  readonly kind: PathProducerKind;
  /**
   * Every Feature stem that placed content into this file, sorted. Plural
   * because several producers legitimately merge into one file — content from
   * two registries sharing an output directory, localization keys registered
   * under different stems — and the claim is made by the merged file, never by
   * the item. Empty when no Feature owns the producer, or its feature was
   * unnamed.
   */
  readonly stems: readonly string[];
  /** Human detail — ids, language, registry. For reading, never for parsing. */
  readonly detail: string;
}

/** One output file's final path, submitted for adjudication. */
export interface PathClaim {
  readonly path: LogicalPath;
  readonly producer: PathProducer;
}

/**
 * Which producer kind may occupy each reserved path, keyed by portability
 * identity so an aliased spelling is caught too. The descriptor is reserved from
 * everyone *but its own channel*, which still has to emit it; the manifest is
 * reserved from everyone, and is the one reserved path no claim ever carries.
 * Each entry keeps its real spelling, because that is what a conflict reports.
 */
const RESERVED_OCCUPANTS: ReadonlyMap<
  string,
  { readonly path: LogicalPath; readonly occupant: PathProducerKind | undefined }
> = new Map([
  [portablePathKey(DESCRIPTOR_PATH), { path: DESCRIPTOR_PATH, occupant: "descriptor" as const }],
  [
    portablePathKey(MATERIALIZATION_MANIFEST_PATH),
    { path: MATERIALIZATION_MANIFEST_PATH, occupant: undefined },
  ],
]);

/** Read before "you have this twice": a path you may not have at all. */
const REASON_RANK: readonly PathConflictReason[] = [
  "reserved",
  "vanilla",
  "duplicate",
  "portable-alias",
  "file-directory",
];

/** The claims arriving at one node under one exact spelling of the path to it. */
interface Spelling {
  /** The exact path from the mod root to this node, as claimed. */
  readonly prefix: string;
  /** Claims whose path ends here. */
  readonly files: PathClaim[];
  /** Claims whose path continues past here, so this node must be a directory. */
  readonly through: PathClaim[];
}

interface Node {
  /** The portability identity of the path from the root to this node. */
  readonly key: string;
  readonly children: Map<string, Node>;
  /**
   * Keyed by the exact path prefix rather than by the last component alone.
   * Two claims reaching this node by differently-spelled ancestors are not
   * claims on one path, and keying by component would report them as duplicates
   * of each other rather than as the ancestor's alias.
   */
  readonly spellings: Map<string, Spelling>;
}

function newNode(key: string): Node {
  return { key, children: new Map(), spellings: new Map() };
}

/**
 * Adjudicates every claim against every other, against the reserved paths, and
 * against whatever vanilla evidence the build has.
 *
 * Returns the claims in canonical enumeration order on success; throws one
 * `PathOwnershipError` carrying the complete conflict set otherwise.
 *
 * The walk is a trie keyed by portability identity rather than a comparison of
 * every claim against every other. That is what makes the alias and
 * file/directory rules fall out of the structure instead of needing their own
 * passes, and it is what keeps an Asset tree of several hundred files from
 * costing hundreds of thousands of path splits.
 */
export function adjudicatePaths(args: {
  readonly claims: readonly PathClaim[];
  /** Logical paths vanilla occupies; `undefined` when the build loaded none. */
  readonly vanillaPaths: ReadonlySet<string> | undefined;
}): readonly PathClaim[] {
  const root = newNode("");
  for (const claim of args.claims) {
    const components = claim.path.split("/");
    let node = root;
    let prefix = "";
    for (let index = 0; index < components.length; index++) {
      const component = components[index]!;
      const identity = portableIdentity(component);
      prefix = prefix === "" ? component : `${prefix}/${component}`;
      const childKey = node.key === "" ? identity : `${node.key}/${identity}`;
      let child = node.children.get(identity);
      if (child === undefined) {
        child = newNode(childKey);
        node.children.set(identity, child);
      }
      let spelling = child.spellings.get(prefix);
      if (spelling === undefined) {
        spelling = { prefix, files: [], through: [] };
        child.spellings.set(prefix, spelling);
      }
      if (index === components.length - 1) {
        spelling.files.push(claim);
      } else {
        spelling.through.push(claim);
      }
      node = child;
    }
  }

  // Folded once rather than per node: SDK-173 grows this to every path the base
  // game and its DLC occupy, and a lookup is all the tree needs. It maps back to
  // the real spelling rather than being a set of keys, because a conflict has to
  // name a file the author can go and look at — the fold of `Straße.txt` is
  // `strasse.txt`, which is nothing on disk. Two vanilla paths can share one
  // key, so the byte-least wins, the same way a node picks among its spellings.
  const vanillaByKey = args.vanillaPaths === undefined ? undefined : new Map<string, LogicalPath>();
  for (const raw of args.vanillaPaths ?? []) {
    const path = raw as LogicalPath;
    const key = portablePathKey(path);
    const seen = vanillaByKey!.get(key);
    if (seen === undefined || compareUtf8(path, seen) < 0) {
      vanillaByKey!.set(key, path);
    }
  }

  const conflicts: PathOwnershipConflict[] = [];
  collectConflicts(root, vanillaByKey, conflicts);
  if (conflicts.length > 0) {
    conflicts.sort(
      (a, b) =>
        compareUtf8(a.path, b.path) || REASON_RANK.indexOf(a.reason) - REASON_RANK.indexOf(b.reason)
    );
    throw new PathOwnershipError(conflicts);
  }

  return Object.freeze(
    args.claims
      .map((claim) => Object.freeze({ ...claim, producer: freezeProducer(claim.producer) }))
      .sort((a, b) => compareUtf8(a.path, b.path))
  );
}

/**
 * Walks the tree, reporting every reason that holds at every node.
 *
 * The rules are independent on purpose. The adjudicator this replaced ran a
 * precedence ladder, so a node that was both a reserved path and a
 * file/directory clash reported only the first — which meant an author fixed
 * one problem, rebuilt, and met the next. Children are visited in sorted key
 * order, and every claimant list is sorted, so the conflict set is a function
 * of the claims alone and never of the order Features were registered in.
 */
function collectConflicts(
  node: Node,
  vanillaByKey: ReadonlyMap<string, LogicalPath> | undefined,
  conflicts: PathOwnershipConflict[]
): void {
  const spellings = [...node.spellings.values()].sort((a, b) => compareUtf8(a.prefix, b.prefix));
  if (spellings.length > 0) {
    const nodePath = spellings[0]!.prefix;
    const files = spellings.flatMap((spelling) =>
      spelling.files.map((claim) => claimantOf(spelling, claim, "file"))
    );
    const through = spellings.flatMap((spelling) =>
      spelling.through.map((claim) => claimantOf(spelling, claim, "directory"))
    );

    // One spelling per directory node — but only counting divergence that
    // happens *here*. Two claims that already diverged in an ancestor reach
    // this node under different prefixes, and that is the ancestor's conflict,
    // reported there rather than again at every depth below it.
    for (const group of byParent(spellings)) {
      if (group.length > 1) {
        conflicts.push({
          path: group[0]!.prefix,
          reason: "portable-alias",
          claimants: claimantsIn(group),
        });
      }
    }

    // A node cannot be a file for one producer and a directory for another.
    if (files.length > 0 && through.length > 0) {
      conflicts.push({
        path: nodePath,
        reason: "file-directory",
        claimants: [...files, ...through].sort(compareClaimants),
      });
    }

    // Exclusive ownership, judged on the exact path. Identical bytes are no
    // defence: two producers each believing they own the file is the defect.
    for (const spelling of spellings) {
      if (spelling.files.length > 1) {
        conflicts.push({
          path: spelling.prefix,
          reason: "duplicate",
          claimants: spelling.files
            .map((claim) => claimantOf(spelling, claim, "file"))
            .sort(compareClaimants),
        });
      }
    }

    const reserved = RESERVED_OCCUPANTS.get(node.key);
    if (reserved !== undefined) {
      const trespassers = [...files, ...through].filter(
        (claimant) => claimant.kind !== reserved.occupant
      );
      if (trespassers.length > 0) {
        conflicts.push({
          path: nodePath,
          reason: "reserved",
          claimants: [...trespassers, reservedClaimant(reserved.path)].sort(compareClaimants),
        });
      }
    }

    // Emitting over a vanilla file replaces that file wholesale. Reserved nodes
    // are exempt: `descriptor.mod` is every mod's own and never lands in the
    // game's own tree.
    const occupied = vanillaByKey?.get(node.key);
    if (occupied !== undefined && reserved === undefined && files.length > 0) {
      conflicts.push({
        path: nodePath,
        reason: "vanilla",
        claimants: [...files, vanillaClaimant(occupied)].sort(compareClaimants),
      });
    }
  }

  for (const identity of [...node.children.keys()].sort(compareUtf8)) {
    collectConflicts(node.children.get(identity)!, vanillaByKey, conflicts);
  }
}

/** Groups a node's spellings by the ancestor path they arrived through. */
function byParent(spellings: readonly Spelling[]): Spelling[][] {
  const groups = new Map<string, Spelling[]>();
  for (const spelling of spellings) {
    const cut = spelling.prefix.lastIndexOf("/");
    const parent = cut === -1 ? "" : spelling.prefix.slice(0, cut);
    const group = groups.get(parent);
    if (group === undefined) {
      groups.set(parent, [spelling]);
    } else {
      group.push(spelling);
    }
  }
  return [...groups.keys()].sort(compareUtf8).map((parent) => groups.get(parent)!);
}

function claimantsIn(spellings: readonly Spelling[]): PathClaimant[] {
  return spellings
    .flatMap((spelling) => [
      ...spelling.files.map((claim) => claimantOf(spelling, claim, "file" as const)),
      ...spelling.through.map((claim) => claimantOf(spelling, claim, "directory" as const)),
    ])
    .sort(compareClaimants);
}

function claimantOf(
  spelling: Spelling,
  claim: PathClaim,
  role: "file" | "directory"
): PathClaimant {
  return {
    path: claim.path,
    kind: claim.producer.kind,
    stems: claim.producer.stems,
    detail: claim.producer.detail,
    role,
  };
}

/**
 * The other side of a reserved or vanilla conflict. Both take a real logical
 * path rather than the node's portability identity: a claimant's `path` is the
 * exact spelling of a file, and the fold of `Straße.txt` is `strasse.txt` —
 * accurate as an identity, useless to an author trying to find the file.
 */
function reservedClaimant(path: LogicalPath): PathClaimant {
  return { path, kind: "reserved", stems: [], detail: "reserved by the SDK", role: "file" };
}

function vanillaClaimant(path: LogicalPath): PathClaimant {
  return {
    path,
    kind: "vanilla",
    stems: [],
    detail: "a file the base game or its DLC already occupies",
    role: "file",
  };
}

function compareClaimants(a: PathClaimant, b: PathClaimant): number {
  return (
    compareUtf8(a.path, b.path) ||
    compareUtf8(a.kind, b.kind) ||
    compareUtf8(a.stems.join(" "), b.stems.join(" ")) ||
    compareUtf8(a.detail, b.detail) ||
    compareUtf8(a.role, b.role)
  );
}

function freezeProducer(producer: PathProducer): PathProducer {
  return Object.freeze({ ...producer, stems: Object.freeze([...producer.stems]) });
}
