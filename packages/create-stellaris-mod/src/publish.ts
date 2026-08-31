/**
 * Where a generated file is allowed to land, and how it gets there.
 *
 * Two guarantees, and both of them are about somebody else's project rather
 * than about this CLI's convenience:
 *
 * **Containment.** `contentDirectory` comes out of a file an author edits by
 * hand, so it is treated as input rather than as configuration. It is validated
 * as a logical relative path, every existing segment of it is `lstat`ed and
 * required to be a real directory, and the deepest existing ancestor's real
 * path must sit under the project root's real path. A symlinked segment is
 * refused even when it resolves back inside the project: "it points somewhere
 * fine right now" is a statement about this instant, and the publication
 * happens at a later one.
 *
 * **No replacement, ever.** The publisher never overwrites an existing dirent —
 * not a file, not a directory, not a symlink. That is why publication is
 * `link()` rather than `rename()`: `rename` overwrites, which makes any earlier
 * `lstat` a race rather than a check, and `link` fails with `EEXIST` instead.
 * There is deliberately no `rename` fallback. A filesystem that cannot do this
 * gets a loud error, because the alternative is silently destroying the source
 * file an author spent the afternoon in.
 *
 * Node exposes neither `openat` nor `linkat`, so pathname publication cannot be
 * race-free against a process that concurrently replaces project directories.
 * The destination directory and temporary file remain open through publication,
 * identity is checked before and after the hard link, and a link made through a
 * persistent swap is removed when it is still identifiable. These checks reduce
 * the race surface and refuse observed changes; they are not a containment
 * guarantee against hostile concurrent mutation.
 *
 * Nothing here creates a directory before the author has confirmed: `preflight`
 * only looks, and `publishExclusive` is what runs afterwards.
 */

import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import {
  link as fsLink,
  open as fsOpen,
  lstat,
  mkdir,
  opendir,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { parseProjectLayoutField } from "./project-layout.ts";

export { ProjectLayoutError } from "./project-layout.ts";

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

/** The target, or something on the way to it, is not inside the project. */
export class ContainmentError extends PublishError {
  constructor(message: string) {
    super(message);
    this.name = "ContainmentError";
  }
}

/** Something already answers to the target name. */
export class CollisionError extends PublishError {
  constructor(message: string) {
    super(message);
    this.name = "CollisionError";
  }
}

/** The filesystem cannot publish without risking a replacement. */
export class UnsupportedPublicationError extends PublishError {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPublicationError";
  }
}

/**
 * `contentDirectory`, as segments.
 *
 * The logical form is the whole point: one or more `/`-separated segments,
 * relative, with nothing that a path normalizer would rewrite. Anything else is
 * refused rather than normalized, because normalizing means guessing what an
 * author meant by a path that does not mean what it says.
 */
export function validateContentDirectory(raw: string): readonly string[] {
  return parseProjectLayoutField("contentDirectory", raw);
}

/** What the target name currently is, as `lstat` sees it. */
export type TargetKind = "absent" | "file" | "dir" | "symlink" | "other";

export interface TargetPreflight {
  /** The project root, already resolved to its real path. */
  readonly rootDir: string;
  /** The deepest `contentDirectory` segment that exists, real path. */
  readonly existingDir: string;
  /** The segments that do not exist yet, in order, and are not created here. */
  readonly missingSegments: readonly string[];
  readonly basename: string;
  /** Where the file would go. Absolute, and built from real paths. */
  readonly targetPath: string;
  readonly target: TargetKind;
}

/**
 * Look at the target and everything above it, and create nothing.
 *
 * Called before rendering is presented and before any confirmation, so an
 * author is never asked to approve a write into a place that was already
 * refusable.
 */
export async function preflightTarget(
  rootDir: string,
  segments: readonly string[],
  basename: string
): Promise<TargetPreflight> {
  let existingDir = rootDir;
  const missingSegments: string[] = [];

  for (const segment of segments) {
    if (missingSegments.length > 0) {
      // Past the first missing segment nothing can exist, so the rest of the
      // suffix is recorded rather than stat'ed.
      missingSegments.push(segment);
      continue;
    }

    const candidate = path.join(existingDir, segment);
    const stats = await lstatOrUndefined(candidate);
    if (stats === undefined) {
      missingSegments.push(segment);
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new ContainmentError(
        `${candidate} is a symbolic link, and generated source is only written into real ` +
          `directories inside the project. Where a link points is a fact about right now, not ` +
          `about the moment the file would be written.`
      );
    }
    if (!stats.isDirectory()) {
      throw new ContainmentError(
        `${candidate} is not a directory, so the content directory the manifest names does not ` +
          `exist and cannot be created.`
      );
    }
    existingDir = candidate;
  }

  const real = await realpath(existingDir);
  requireContainment(rootDir, real, existingDir);

  const targetPath = path.join(real, ...missingSegments, basename);
  return {
    rootDir,
    existingDir: real,
    missingSegments,
    basename,
    targetPath,
    target: missingSegments.length > 0 ? "absent" : await classify(targetPath),
  };
}

/** The part of a `FileHandle` publication uses. */
export interface ExclusiveFile {
  /** Returns the identity of the file opened with exclusive creation. */
  stat(): Promise<Stats>;
  /** Writes the generated source bytes. */
  writeFile(contents: string, encoding: BufferEncoding): Promise<void>;
  /** Flushes the complete file before publication. */
  sync(): Promise<void>;
  /** Releases the temporary file handle. */
  close(): Promise<void>;
}

/**
 * The two filesystem primitives publication cannot do without, injectable for
 * one reason each — and for no other reason. Nothing in the product passes
 * either.
 *
 * A filesystem that cannot hard-link, and a disk that fills up halfway through
 * a write, are both states this code must handle and neither can be mounted on
 * demand in a test. Everything else in this module is exercised against a real
 * temporary directory.
 */
export interface PublishOptions {
  /** The no-replace publication primitive. */
  readonly link?: (existingPath: string, newPath: string) => Promise<void>;
  /** Exclusive creation of the temporary file. */
  readonly open?: (path: string, flags: "wx", mode: number) => Promise<ExclusiveFile>;
}

/**
 * Create the missing directories, then publish the bytes without ever being
 * able to replace anything.
 *
 * Only called after the author has confirmed, which is why this is the first
 * function in the module that mutates anything.
 */
export async function publishExclusive(
  preflight: TargetPreflight,
  contents: string,
  options: PublishOptions = {}
): Promise<string> {
  const link = options.link ?? fsLink;
  const open = options.open ?? fsOpen;

  let dir = preflight.existingDir;
  for (const segment of preflight.missingSegments) {
    const next = path.join(dir, segment);
    try {
      // Not `recursive`: one segment at a time is what lets a directory that
      // raced into existence be inspected rather than accepted.
      await mkdir(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const stats = await lstatOrUndefined(next);
      if (stats === undefined || stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new ContainmentError(
          `${next} appeared while this command was running, and is not a real directory. ` +
            `Nothing was written.`
        );
      }
    }
    dir = next;
  }

  // The chain is complete now, so containment is checked against what actually
  // exists rather than against what existed before the directories were made.
  const real = await realpath(dir);
  requireContainment(preflight.rootDir, real, dir);
  const directoryIdentity = await requireRealDirectory(real);
  const directoryHandle = await opendir(real);

  const target = path.join(real, preflight.basename);
  const temporary = path.join(real, `.${preflight.basename}.${randomBytes(12).toString("hex")}`);

  try {
    await requireUnchangedDirectory(preflight.rootDir, real, directoryIdentity);
    const handle = await open(temporary, "wx", 0o644);
    let temporaryIdentity: Stats | undefined;
    try {
      temporaryIdentity = await handle.stat();
      await requireUnchangedDirectory(preflight.rootDir, real, directoryIdentity);
      await requireUnchangedFile(temporary, temporaryIdentity);
      await handle.writeFile(contents, "utf8");
      // Flushed before it is published, so the name never appears pointing at
      // bytes that are not on the disk yet.
      await handle.sync();

      await requireUnchangedDirectory(preflight.rootDir, real, directoryIdentity);
      await requireUnchangedFile(temporary, temporaryIdentity);
      try {
        await link(temporary, target);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          throw new CollisionError(collisionMessage(target));
        }
        throw new UnsupportedPublicationError(
          `${real} cannot publish a file without risking replacing one (${code ?? "unknown error"} ` +
            `from link()). This CLI will not fall back to rename(), which overwrites — on that ` +
            `path a file of somebody's own could be destroyed to write this one. Generate into a ` +
            `directory on an ordinary local filesystem instead.`
        );
      }

      try {
        await requireUnchangedDirectory(preflight.rootDir, real, directoryIdentity);
        await requireUnchangedFile(target, temporaryIdentity);
      } catch (error) {
        await unlinkIfSameFile(target, temporaryIdentity);
        throw error;
      }
    } finally {
      try {
        await handle.close();
      } finally {
        if (temporaryIdentity !== undefined) {
          await unlinkIfSameFile(temporary, temporaryIdentity);
        }
      }
    }
  } finally {
    await directoryHandle.close();
  }

  return target;
}

/** The sentence both the preflight and the publisher say about a collision. */
export function collisionMessage(targetPath: string): string {
  return (
    `${targetPath} already exists, and nothing here replaces a file that is already yours. ` +
    `Generate under a different name, or move the existing file first.`
  );
}

async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
}

async function classify(targetPath: string): Promise<TargetKind> {
  const stats = await lstatOrUndefined(targetPath);
  if (stats === undefined) {
    return "absent";
  }
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "dir";
  }
  return stats.isFile() ? "file" : "other";
}

async function requireRealDirectory(target: string): Promise<Stats> {
  const stats = await lstatOrUndefined(target);
  if (stats === undefined || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new ContainmentError(
      `${target} changed while publication was preparing it and is no longer a real directory. ` +
        `Nothing was published.`
    );
  }
  return stats;
}

async function requireUnchangedDirectory(
  rootDir: string,
  target: string,
  expected: Stats
): Promise<void> {
  const observed = await lstatOrUndefined(target);
  if (
    observed === undefined ||
    observed.isSymbolicLink() ||
    !observed.isDirectory() ||
    !sameInode(observed, expected)
  ) {
    throw new ContainmentError(
      `${target} changed identity while publication was running. Nothing was published.`
    );
  }
  const resolved = await realpath(target);
  requireContainment(rootDir, resolved, target);
  if (resolved !== target) {
    throw new ContainmentError(
      `${target} changed identity while publication was running. Nothing was published.`
    );
  }
}

async function requireUnchangedFile(target: string, expected: Stats): Promise<void> {
  const observed = await lstatOrUndefined(target);
  if (
    observed === undefined ||
    observed.isSymbolicLink() ||
    !observed.isFile() ||
    !sameInode(observed, expected)
  ) {
    throw new ContainmentError(
      `${target} changed identity while publication was running. Nothing was published.`
    );
  }
}

async function unlinkIfSameFile(target: string, expected: Stats): Promise<void> {
  const observed = await lstatOrUndefined(target);
  if (observed !== undefined && observed.isFile() && sameInode(observed, expected)) {
    await unlink(target).catch(() => undefined);
  }
}

function sameInode(observed: Stats, expected: Stats): boolean {
  return observed.dev === expected.dev && observed.ino === expected.ino;
}

function requireContainment(rootDir: string, real: string, shown: string): void {
  const relative = path.relative(rootDir, real);
  // `..` and `../…` are escapes; `..generated` is a directory with an unusual
  // but perfectly legal name, and refusing it would be this check inventing a
  // rule about filenames rather than about containment.
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`);
  if (relative !== "" && (escapes || path.isAbsolute(relative))) {
    throw new ContainmentError(
      `${shown} resolves to ${real}, which is outside the project at ${rootDir}. Generated ` +
        `source is only ever written inside the project its manifest describes.`
    );
  }
}
