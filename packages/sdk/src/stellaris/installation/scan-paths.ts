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

import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  type Stats,
} from "node:fs";
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

/**
 * The tail worth reading to find the index: the search window plus the record
 * itself. A DLC archive is up to ~100 MB and its index is tens of kilobytes,
 * so this is the difference between reading a gigabyte of compressed audio per
 * scan and reading nothing but names.
 */
const TAIL_WINDOW = EOCD_SEARCH_WINDOW + 22;

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
 * This is the whole-buffer door, which is what a test hands hand-built bytes.
 * The scanner uses {@link readArchiveEntryNames}, which reads two small ranges
 * of a file instead; both share the parsing below.
 *
 * ZIP64 is refused rather than handled. No shipped DLC archive is anywhere
 * near the four-gigabyte or 65,535-entry limits that call for it, so a ZIP64
 * marker means the file is not what this reader thinks it is, and guessing
 * would produce a plausible-looking short inventory.
 */
export function readZipEntryNames(bytes: Uint8Array, context: string): readonly string[] {
  const refuse = refuseWith(context);
  const size = bytes.byteLength;
  const tailStart = Math.max(0, size - TAIL_WINDOW);
  const directory = locateCentralDirectory(bytes.subarray(tailStart), tailStart, size, refuse);
  const end = directory.offset + directory.size;
  if (end > size) {
    return refuse(`central directory runs to ${end} bytes in a ${size}-byte file; it is truncated`);
  }
  return parseCentralDirectory(
    bytes.subarray(directory.offset, end),
    directory.offset,
    directory.entries,
    refuse
  );
}

/**
 * The same names, read from a file rather than from a buffer in hand.
 *
 * Two small reads instead of one enormous one. A DLC archive is up to ~100 MB
 * and the thirty of them come to a gigabyte; what this needs out of each is the
 * tail that holds the index's address and then the index itself, which is
 * kilobytes. `stellaris.load()` runs this scan, so reading the whole archive to
 * find its table of names would make every load pay a gigabyte of I/O for data
 * it is forbidden to look at anyway.
 *
 * The parsing is {@link readZipEntryNames}'s, not a second copy: both hand the
 * same two functions the same bytes, so every refusal proved against the
 * in-memory reader holds here too.
 */
function readArchiveEntryNames(absolute: string, context: string): readonly string[] {
  const refuse = refuseWith(context);
  let fd: number;
  try {
    fd = openSync(absolute, "r");
  } catch (error) {
    return refuse(`cannot be opened — ${describe(error)}`);
  }
  try {
    const size = fstatSync(fd).size;
    const tailLength = Math.min(size, TAIL_WINDOW);
    const tailStart = size - tailLength;
    const tail = readRange(fd, tailStart, tailLength, refuse);
    const directory = locateCentralDirectory(tail, tailStart, size, refuse);
    const end = directory.offset + directory.size;
    if (end > size) {
      return refuse(
        `central directory runs to ${end} bytes in a ${size}-byte file; it is truncated`
      );
    }
    const bytes = readRange(fd, directory.offset, directory.size, refuse);
    return parseCentralDirectory(bytes, directory.offset, directory.entries, refuse);
  } finally {
    closeSync(fd);
  }
}

/** Where an archive states its index is, and how many records it holds. */
interface CentralDirectoryLocation {
  readonly offset: number;
  readonly size: number;
  readonly entries: number;
}

type Refuse = (reason: string) => never;

function refuseWith(context: string): Refuse {
  return (reason: string): never => {
    throw new VanillaPathInventoryError(`${context}: ${reason}`);
  };
}

/**
 * The end-of-central-directory record's answer, read out of the archive's tail.
 *
 * `tail` covers the file from `tailStart` to `size`, which is either the whole
 * archive or its last {@link TAIL_WINDOW} bytes; the record's own rule — that
 * its stated comment reaches exactly the end of the file — holds in either
 * frame, because the tail always ends where the file does.
 */
function locateCentralDirectory(
  tail: Uint8Array,
  tailStart: number,
  size: number,
  refuse: Refuse
): CentralDirectoryLocation {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const u16 = (offset: number): number => view.getUint16(offset, true);
  const u32 = (offset: number): number => view.getUint32(offset, true);

  const eocd = findEndOfCentralDirectory(view, tail.byteLength);
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
  const entries = u16(eocd + 10);
  const directorySize = u32(eocd + 12);
  const offset = u32(eocd + 16);
  if (entriesOnDisk === 0xffff || entries === 0xffff) {
    return refuse("states a ZIP64 entry count; this reader refuses ZIP64 rather than guessing");
  }
  if (directorySize === 0xffffffff || offset === 0xffffffff) {
    return refuse("states a ZIP64 central directory; this reader refuses ZIP64");
  }
  // Only meaningful when the tail is a window rather than the whole file: an
  // index that claims to start after its own record is not an index.
  if (tailStart > 0 && offset >= size) {
    return refuse(`states a central directory at ${offset} in a ${size}-byte file`);
  }
  return { offset, size: directorySize, entries };
}

/**
 * The records themselves: one name each, and the checks that keep a name a
 * name. `base` is where `directory` sits in the archive, so a refusal names an
 * offset a reader can find in the file rather than one inside a buffer.
 */
function parseCentralDirectory(
  directory: Uint8Array,
  base: number,
  entries: number,
  refuse: Refuse
): readonly string[] {
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const u16 = (offset: number): number => view.getUint16(offset, true);
  const u32 = (offset: number): number => view.getUint32(offset, true);
  const end = directory.byteLength;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names: string[] = [];
  let records = 0;
  let cursor = 0;
  while (cursor < end) {
    records += 1;
    if (cursor + CENTRAL_HEADER_LENGTH > end) {
      return refuse(
        `central directory record at ${base + cursor} overruns the directory; it is truncated`
      );
    }
    if (u32(cursor) !== CENTRAL_SIGNATURE) {
      return refuse(
        `no central directory record signature at ${base + cursor}; the archive is malformed`
      );
    }
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    if (u32(cursor + 42) === 0xffffffff) {
      return refuse(
        `record at ${base + cursor} states a ZIP64 local header offset; this reader refuses`
      );
    }
    const nameStart = cursor + CENTRAL_HEADER_LENGTH;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > end) {
      return refuse(
        `entry name at ${base + nameStart} overruns the central directory; it is truncated`
      );
    }
    let name: string;
    try {
      name = decoder.decode(directory.subarray(nameStart, nameEnd));
    } catch {
      return refuse(`entry name at ${base + nameStart} is not valid UTF-8`);
    }
    assertRelativeEntryName(name, refuse);
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
  if (records !== entries) {
    return refuse(
      `states ${entries} central directory ${entries === 1 ? "record" : "records"} ` +
        `and holds ${records}; the archive is truncated or malformed`
    );
  }
  return names;
}

/** A leading drive letter — `C:/gfx` addresses a machine, not the game root. */
const DRIVE_SHAPE = /^[A-Za-z]:/;

/**
 * An entry name is a path inside the game root, and this is where that is
 * established.
 *
 * The archive is the one input here nobody in this repo wrote, and its names go
 * straight into the inventory the SDK adjudicates a mod's paths against — there
 * is no later gate on the live-scan side. `../common/x.txt` would otherwise
 * enter the inventory as a claim about a directory above the install. Refused,
 * never rewritten: a repaired name is a wrong path presented as a right one.
 */
function assertRelativeEntryName(name: string, refuse: Refuse): void {
  const refuseName = (reason: string): never =>
    refuse(
      `entry name ${JSON.stringify(name)} ${reason}; ` +
        "archive entry names are refused, never rewritten"
    );
  if (name.includes("\\")) {
    refuseName("contains a backslash");
  }
  if (name.startsWith("/") || DRIVE_SHAPE.test(name)) {
    refuseName("is absolute");
  }
  // One trailing separator is the directory marker rather than an empty
  // component; anything else empty is a doubled or leading `/`.
  const body = name.endsWith("/") ? name.slice(0, -1) : name;
  for (const component of body.split("/")) {
    if (component === "") {
      refuseName('has an empty component (a leading or doubled "/")');
    }
    if (component === "." || component === "..") {
      refuseName(`has a ${JSON.stringify(component)} component`);
    }
  }
}

/**
 * Exactly the requested bytes, or a refusal. A short read means the file is
 * smaller than its own index says, which is the truncation this reader exists
 * to catch rather than a condition to retry past.
 */
function readRange(fd: number, position: number, length: number, refuse: Refuse): Uint8Array {
  const bytes = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    let chunk: number;
    try {
      chunk = readSync(fd, bytes, filled, length - filled, position + filled);
    } catch (error) {
      return refuse(`cannot be read — ${describe(error)}`);
    }
    if (chunk === 0) {
      return refuse(
        `ends at ${position + filled} bytes, before the ${position + length} it claims`
      );
    }
    filled += chunk;
  }
  return bytes;
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
    const names = readArchiveEntryNames(path.join(installRoot, archive), archive);
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
