/**
 * Reading a tree without being fooled by it.
 *
 * Every filesystem call here takes a path, and a path is re-resolved every
 * time it is used. Between the `lstat` that decided what an entry is and the
 * call that acts on it, the name can come to mean something else — which is
 * how a symlink attack on an output directory is written, and the reason
 * nothing in this module follows a link or trusts a name twice.
 *
 * Both the writer and recovery read the same trees for different reasons: the
 * writer to decide what it may replace, recovery to decide what it may delete.
 * They ask the questions here so that neither can be told a different story
 * about the same directory.
 */

import { createHash } from "node:crypto";
import type { Dir, Dirent, Stats } from "node:fs";
import { lstat, opendir, readFile, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { MaterializationError, type ForeignRefusedEntry } from "../errors.ts";

/**
 * Basenames the operating system creates behind the author's back. They are
 * ordinary foreign entries — preserved like any other — with one consequence:
 * a target holding nothing else is still a first materialization, because a
 * Finder visit must not be what blocks a first build, and a half-published
 * tree holding one is still accountable to recovery.
 */
export const OS_METADATA_BASENAMES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

/** The two numbers that say a directory is still the one that was read. */
export interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** What a fresh `lstat` must still say about a preserved entry at commit time. */
export interface ForeignIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

/** One inode, by the only two numbers that name one: device and number. */
export function sameInode(observed: DirectoryIdentity, expected: DirectoryIdentity): boolean {
  return observed.dev === expected.dev && observed.ino === expected.ino;
}

/** The same file, unmodified: one inode whose size and mtime are unchanged. */
export function sameIdentity(observed: ForeignIdentity, expected: ForeignIdentity): boolean {
  return (
    observed.dev === expected.dev &&
    observed.ino === expected.ino &&
    observed.size === expected.size &&
    observed.mtimeMs === expected.mtimeMs
  );
}

export function identityOf(stats: Stats): ForeignIdentity {
  return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
}

/** Which unpreservable kind an entry is, for a refusal that names it. */
export function specialKind(stats: Stats): ForeignRefusedEntry["kind"] {
  if (stats.isFIFO()) {
    return "fifo";
  }
  if (stats.isSocket()) {
    return "socket";
  }
  if (stats.isCharacterDevice() || stats.isBlockDevice()) {
    return "device";
  }
  return "unknown";
}

/** Something under the target changed identity while it was being read. */
export function entryMoved(target: string, absolute: string, detail: string): MaterializationError {
  return new MaterializationError(target, {
    reason: "busy",
    detail: `${absolute} changed while the target was being read: ${detail}.`,
  });
}

/**
 * Read a directory through a handle, having proved it is the one that was
 * classified.
 *
 * `readdir` takes a path, and a path is re-resolved every time it is used. A
 * foreign directory swapped for a symlink between the `lstat` that classified
 * it and the read that descends into it is followed, and the walk leaves the
 * target — with `preserveForeign` then hardlinking somebody else's files into
 * the staged tree. Opening first and verifying after closes that: the handle
 * reads one directory whatever happens to the name, and a name that a moment
 * later points at a symlink, or at a different inode, is refused rather than
 * read.
 *
 * The entries are drained and the handle closed before the caller descends into
 * any of them. Holding it open across the recursion would cost one descriptor
 * per level of the tree, so a deep enough directory would fail at the process's
 * descriptor limit rather than materialize — and the identity guarantee does
 * not depend on holding it: these entries came through the verified handle,
 * whatever the name means by the time the caller uses them.
 *
 * It is not a full closure. Node exposes no `openat`, and no `fstat` on an open
 * `Dir`, so identity can only be checked through the path — which leaves a
 * window in which a swap put back before the `lstat` reads the substitute
 * through the handle. What remains is a double swap inside microseconds
 * instead of a single swap at leisure, and `revalidateTarget` is still the
 * commit-time backstop: a target whose membership or preserved entries moved
 * during the build refuses at the activation point regardless.
 *
 * @param target The tree being read, which the refusal is reported against.
 * @param absolute The directory to read, which must be `expected`.
 */
export async function readVerifiedDir(
  target: string,
  absolute: string,
  expected: DirectoryIdentity
): Promise<Dirent[]> {
  let dir: Dir;
  try {
    dir = await opendir(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
      throw entryMoved(target, absolute, "it is no longer the directory that was read");
    }
    throw error;
  }
  const stats = await lstatOrUndefined(absolute);
  if (stats === undefined || stats.isSymbolicLink() || !sameInode(stats, expected)) {
    await dir.close();
    throw entryMoved(
      target,
      absolute,
      stats?.isSymbolicLink() === true
        ? "it is now a symlink, which a materialization never follows"
        : "it is not the directory that was read a moment earlier"
    );
  }
  // Exhausting the iterator closes the handle, which is why nothing here needs
  // to unwind it: the read is over before the caller sees an entry.
  const entries: Dirent[] = [];
  for await (const entry of dir) {
    entries.push(entry);
  }
  return entries;
}

/** One entry of a walked tree. */
export interface TreeEntry {
  /** Root-relative, "/"-separated. */
  readonly relPath: string;
  readonly absolute: string;
  /**
   * Absent for an entry that was read from its directory and gone by the time
   * it was stat'd. A name that exists and cannot be stat'd throws instead.
   */
  readonly stats?: Stats;
}

/**
 * Every entry under `root`, parents before children, following nothing.
 *
 * Each directory is read through a handle checked against the identity its own
 * `lstat` just gave, so a directory substituted mid-walk is refused rather than
 * read. A walk that cannot finish throws: the callers decide what a tree holds
 * from the result, and a short answer would read as a smaller tree instead of
 * as the missing evidence it is. An absent root is not a failure — it holds
 * nothing.
 */
export async function walkVerified(root: string): Promise<TreeEntry[]> {
  const found: TreeEntry[] = [];
  const walk = async (relative: string, identity: DirectoryIdentity): Promise<void> => {
    const dir = relative === "" ? root : path.join(root, ...relative.split("/"));
    for (const entry of await readVerifiedDir(root, dir, identity)) {
      const relPath = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const absolute = path.join(dir, entry.name);
      const stats = await lstatOrUndefined(absolute);
      found.push(stats === undefined ? { relPath, absolute } : { relPath, absolute, stats });
      if (stats?.isDirectory() === true) {
        await walk(relPath, stats);
      }
    }
  };
  const rootStats = await lstatOrUndefined(root);
  if (rootStats === undefined) {
    return found;
  }
  await walk("", rootStats);
  return found;
}

/**
 * Whether `lockPath` still names the file behind `handle`.
 *
 * Everything a claim reads goes through the handle, which keeps it reading
 * one file rather than one name — but the winner then acts on the *name*: the
 * recovery that wins unlinks the lock by path when it finishes. A handle can
 * outlive its directory entry, so a claim that verified only through the
 * handle can win on an inode nothing points at any more, and go on to unlink
 * whatever a fresh writer has since created at that path. The verdict has to
 * be about the file the path names, so it is checked here before one is given.
 */
export async function pathStillNames(handle: FileHandle, lockPath: string): Promise<boolean> {
  let named;
  try {
    named = await lstat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const held = await handle.stat();
  return named.dev === held.dev && named.ino === held.ino;
}

/** One file's hash, or nothing when it is missing or not a readable file. */
export async function fileSha256(target: string): Promise<string | undefined> {
  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return undefined;
    }
    return createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
  } catch {
    // The caller compares this against a hash it requires, so an unreadable
    // file is a mismatch it reports rather than a failure it swallows.
    return undefined;
  }
}

/** Whether a name exists at all, following nothing. */
export async function present(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/** One `lstat`, where only a name that is not there answers "nothing". */
export async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
