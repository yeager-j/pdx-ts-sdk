/**
 * The install's path inventory: which files the game ships, by name only.
 *
 * Two sources answer that question and both are needed. Most of the game is
 * loose files under the root, so a directory walk finds them. The rest lives
 * inside the DLC archives under `dlc/`, whose entries are game-root-relative
 * (`music/foo.ogg`) and are just as much part of what vanilla occupies — a mod
 * that writes one of those paths still collides with the game.
 *
 * Nothing here reads a byte of content. The walk records names; the archive
 * reader parses the central directory, which is a table of names, and never
 * touches a local header or inflates a stream. That is a licensing boundary
 * rather than an optimization: this inventory is what
 * `@pdx-ts/codegen-vanilla` ships in `@pdx-ts/stellaris-ids`, and a path name
 * is the most it may carry.
 *
 * Every failure is loud. A directory the filesystem claimed exists and then
 * would not read, a malformed archive, an entry name with a backslash in it —
 * each throws {@link VanillaPathInventoryError} rather than being skipped or
 * repaired, because a silently short inventory reads exactly like an install
 * that does not ship the file, and that is the one wrong answer with a
 * consequence: a mod told it may claim a path the game owns.
 */

import { lstatSync, readdirSync, readFileSync, type Stats } from "node:fs";
import path from "node:path";

import { VanillaPathInventoryError } from "../../errors.ts";
import { compareUtf8 } from "../../ordering.ts";

export interface VanillaPathScan {
  /** Every path the install occupies: byte-sorted, deduplicated, junk-free. */
  readonly paths: readonly string[];
  /** Regular files the walk found, junk included — what was looked at. */
  readonly installFiles: number;
  /** DLC archives read, one per `dlc/<name>/<name>.zip`. */
  readonly archives: number;
  /** Non-directory archive entries read, junk included. */
  readonly archiveEntries: number;
  /**
   * Entries from either source dropped as operating-system metadata. Counted
   * rather than ignored: a number that moves says the install picked up
   * something the machine wrote, not something Paradox shipped.
   */
  readonly junkExcluded: number;
}

/** Where DLC archives live, relative to the game root. */
const DLC_DIR = "dlc";

/** The most bytes a zip end-of-central-directory record can sit behind. */
const EOCD_SEARCH_WINDOW = 22 + 0xffff;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_LENGTH = 22;
const ZIP64_LOCATOR_LENGTH = 20;
const CENTRAL_HEADER_LENGTH = 46;

/**
 * Metadata the operating system writes next to the game's own files.
 *
 * These are not vanilla paths — they appear because a Finder window was opened
 * or an archive was unpacked on a Mac — and treating them as vanilla would
 * refuse a mod a path the game never occupies.
 */
export function isOsMetadataPath(filePath: string): boolean {
  const components = filePath.split("/");
  if (components.includes("__MACOSX")) {
    return true;
  }
  const base = components[components.length - 1] ?? "";
  return base === ".DS_Store" || base === "Thumbs.db" || base === "desktop.ini"
    ? true
    : base.startsWith("._");
}

/**
 * The names a zip's central directory lists, and nothing else.
 *
 * Hand-parsed rather than taken from a library because the constraint is what
 * is *not* read: the walk below never reaches a local file header and never
 * inflates a stream, so no compressed byte of a DLC can pass through here even
 * by accident. Directory entries (a trailing `/`) are dropped — they name a
 * container, not a file the game ships.
 *
 * ZIP64 is refused rather than handled. No shipped DLC archive is anywhere
 * near the four-gigabyte or 65,535-entry limits that call for it, so a ZIP64
 * marker means the file is not what this reader thinks it is, and guessing
 * would produce a plausible-looking short inventory.
 */
export function readZipEntryNames(bytes: Uint8Array, context: string): readonly string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const refuse = (reason: string): never => {
    throw new VanillaPathInventoryError(`${context}: ${reason}`);
  };
  const u16 = (offset: number): number => view.getUint16(offset, true);
  const u32 = (offset: number): number => view.getUint32(offset, true);

  const eocd = findEndOfCentralDirectory(view, bytes.byteLength);
  if (eocd === null) {
    return refuse("no zip end-of-central-directory record; the file is not a readable archive");
  }
  if (
    eocd >= ZIP64_LOCATOR_LENGTH &&
    u32(eocd - ZIP64_LOCATOR_LENGTH) === ZIP64_LOCATOR_SIGNATURE
  ) {
    return refuse("carries a ZIP64 locator; this reader refuses ZIP64 rather than guessing at it");
  }
  const entriesOnDisk = u16(eocd + 8);
  const entriesTotal = u16(eocd + 10);
  const directorySize = u32(eocd + 12);
  const directoryOffset = u32(eocd + 16);
  if (entriesOnDisk === 0xffff || entriesTotal === 0xffff) {
    return refuse("states a ZIP64 entry count; this reader refuses ZIP64 rather than guessing");
  }
  if (directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return refuse("states a ZIP64 central directory; this reader refuses ZIP64");
  }
  const end = directoryOffset + directorySize;
  if (end > bytes.byteLength) {
    return refuse(
      `central directory runs to ${end} bytes in a ${bytes.byteLength}-byte file; it is truncated`
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names: string[] = [];
  let records = 0;
  let cursor = directoryOffset;
  while (cursor < end) {
    records += 1;
    if (cursor + CENTRAL_HEADER_LENGTH > end) {
      return refuse(
        `central directory record at ${cursor} overruns the directory; it is truncated`
      );
    }
    if (u32(cursor) !== CENTRAL_SIGNATURE) {
      return refuse(`no central directory record signature at ${cursor}; the archive is malformed`);
    }
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    if (u32(cursor + 42) === 0xffffffff) {
      return refuse(`record at ${cursor} states a ZIP64 local header offset; this reader refuses`);
    }
    const nameStart = cursor + CENTRAL_HEADER_LENGTH;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > end) {
      return refuse(`entry name at ${nameStart} overruns the central directory; it is truncated`);
    }
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    } catch {
      return refuse(`entry name at ${nameStart} is not valid UTF-8`);
    }
    if (name.includes("\\")) {
      return refuse(
        `entry name ${JSON.stringify(name)} contains a backslash; ` +
          "archive entry names are refused, never rewritten"
      );
    }
    if (!name.endsWith("/")) {
      names.push(name);
    }
    cursor = nameEnd + extraLength + commentLength;
  }
  // The archive's own count against the one just walked — directory entries
  // included, because that is what the count counts. Without this, an archive
  // truncated at a record boundary whose directory size was rewritten to match
  // parses cleanly and yields a short inventory, which is the one failure this
  // reader must never produce.
  if (records !== entriesTotal) {
    return refuse(
      `states ${entriesTotal} central directory ${entriesTotal === 1 ? "record" : "records"} ` +
        `and holds ${records}; the archive is truncated or malformed`
    );
  }
  return names;
}

/**
 * The end-of-central-directory record, found from the back.
 *
 * A zip's index is at the end, and an archive comment may follow it, so the
 * only way in is to scan backwards for the signature. A candidate counts only
 * when its stated comment length reaches exactly the end of the file —
 * otherwise the four bytes are a coincidence inside compressed data.
 */
function findEndOfCentralDirectory(view: DataView, length: number): number | null {
  const floor = Math.max(0, length - EOCD_SEARCH_WINDOW);
  for (let offset = length - EOCD_LENGTH; offset >= floor; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) {
      continue;
    }
    if (offset + EOCD_LENGTH + view.getUint16(offset + 20, true) === length) {
      return offset;
    }
  }
  return null;
}

/**
 * Every path the install occupies, from the loose files and the DLC archives.
 *
 * Deduplicated because the two sources overlap: a DLC archive can carry the
 * same logical path a loose file already claims, and the inventory answers
 * "does vanilla occupy this path", which is one answer either way.
 */
export function scanInstallPaths(installRoot: string): VanillaPathScan {
  const found = new Set<string>();
  let junkExcluded = 0;
  const keep = (relative: string): void => {
    if (isOsMetadataPath(relative)) {
      junkExcluded += 1;
      return;
    }
    found.add(relative);
  };

  const walked = walkFiles(installRoot);
  for (const relative of walked) {
    keep(relative);
  }

  const archives = dlcArchives(installRoot);
  let archiveEntries = 0;
  for (const archive of archives) {
    const absolute = path.join(installRoot, archive);
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(absolute);
    } catch (error) {
      throw new VanillaPathInventoryError(`${archive}: cannot be read — ${describe(error)}`);
    }
    const names = readZipEntryNames(bytes, archive);
    archiveEntries += names.length;
    for (const name of names) {
      keep(name);
    }
  }

  return {
    paths: [...found].sort(compareUtf8),
    installFiles: walked.length,
    archives: archives.length,
    archiveEntries,
    junkExcluded,
  };
}

/**
 * Every regular file under the root, as `/`-separated relative paths.
 *
 * Symlinks and special files are skipped rather than followed: a symlink names
 * no file of its own, and following one could walk out of the install or in a
 * circle. `lstatSync` is what makes that distinction visible.
 */
function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (absolute: string, prefix: string): void => {
    for (const name of readDirectory(absolute)) {
      const child = path.join(absolute, name);
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const stats = statOf(child);
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        continue;
      }
      if (stats.isDirectory()) {
        visit(child, relative);
        continue;
      }
      files.push(relative);
    }
  };
  visit(root, "");
  return files;
}

/**
 * The DLC archives, as install-relative paths.
 *
 * An install with no `dlc/` directory has no archives, which is an ordinary
 * answer — a fixture install, or a copy of the game with no DLC unpacked. Any
 * other failure is not: the directory said it was there and then would not be
 * read.
 */
function dlcArchives(root: string): string[] {
  const dlcRoot = path.join(root, DLC_DIR);
  let names: string[];
  try {
    names = readdirSync(dlcRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new VanillaPathInventoryError(`${DLC_DIR}/: cannot be read — ${describe(error)}`);
  }
  const archives: string[] = [];
  for (const name of names.sort(compareUtf8)) {
    const child = path.join(dlcRoot, name);
    if (!statOf(child).isDirectory()) {
      continue;
    }
    for (const entry of readDirectory(child)) {
      if (entry.endsWith(".zip") && statOf(path.join(child, entry)).isFile()) {
        archives.push(`${DLC_DIR}/${name}/${entry}`);
      }
    }
  }
  return archives;
}

function readDirectory(absolute: string): string[] {
  try {
    return readdirSync(absolute).sort(compareUtf8);
  } catch (error) {
    throw new VanillaPathInventoryError(
      `${absolute}: directory cannot be listed — ${describe(error)}`
    );
  }
}

function statOf(absolute: string): Stats {
  try {
    return lstatSync(absolute);
  } catch (error) {
    throw new VanillaPathInventoryError(`${absolute}: cannot be inspected — ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
