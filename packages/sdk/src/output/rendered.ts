import { createHash } from "node:crypto";

import { compareLogicalPaths, normalizeLogicalPath, type LogicalPath } from "../ordering.ts";

const encoder = new TextEncoder();

/**
 * One immutable rendered artifact at a validated logical path.
 *
 * Its identity and contents do not change after rendering. Use `bytes()` to
 * read binary content without exposing the stored bytes to mutation.
 */
export interface RenderedFile {
  /** The normalized path relative to the mod root. */
  readonly path: LogicalPath;
  /** Whether this artifact was rendered from text or raw bytes. */
  readonly kind: "text" | "bytes";
  /** The exact number of stored bytes. */
  readonly byteLength: number;
  /** The lowercase hexadecimal SHA-256 hash of the stored bytes. */
  readonly sha256: string;
  /** The source text for a text artifact; `undefined` for a byte artifact. */
  readonly text: string | undefined;
  /** Returns a new copy of the stored bytes. Mutating it does not change this file. */
  bytes(): Uint8Array;
}

/**
 * An immutable, hash-identified snapshot of a rendered mod.
 *
 * File iteration is always in canonical logical-path order. Lookup methods
 * normalize and validate their path input before looking it up.
 */
export interface RenderedMod extends Iterable<readonly [LogicalPath, RenderedFile]> {
  /** The mod prefix that owns this snapshot. */
  readonly prefix: string;
  /** The number of files in this snapshot. */
  readonly size: number;
  /** The lowercase hexadecimal SHA-256 hash of the canonical file identities. */
  readonly sha256: string;
  /**
   * Returns text at `path`, or `undefined` when it is absent or is a byte artifact.
   *
   * This is a text-only compatibility projection; use `file()` for byte artifacts.
   */
  get(path: string): string | undefined;
  /** Returns whether this snapshot contains the normalized `path`. */
  has(path: string): boolean;
  /** Returns the artifact at `path`, or `undefined` when the path is absent. */
  file(path: string): RenderedFile | undefined;
  /** Returns text at `path`, or `undefined` when it is absent or is a byte artifact. */
  text(path: string): string | undefined;
  /** Returns paths in canonical logical-path order. */
  keys(): IterableIterator<LogicalPath>;
  /** Returns files in canonical logical-path order. */
  values(): IterableIterator<RenderedFile>;
  /** Returns path-file pairs in canonical logical-path order. */
  entries(): IterableIterator<readonly [LogicalPath, RenderedFile]>;
  /** Returns the same canonical path-file pairs as `entries()`. */
  [Symbol.iterator](): IterableIterator<readonly [LogicalPath, RenderedFile]>;
}

/**
 * Bytes the SDK itself produced, handed to a rendered file without a copy.
 *
 * `bytes` on a claim is defensive: the caller keeps their array and the
 * rendered file takes a copy, because a claim can come from anywhere. This is
 * the other half — a producer inside the SDK that built a buffer for exactly
 * one rendered file and has no further use for it. The invariant the copy
 * otherwise bought is now the creator's to keep: after handing a buffer here,
 * it must neither retain nor mutate it, since the rendered file publishes those
 * bytes under a hash taken once. `take` is single-use so exactly one file can
 * ever own them.
 */
export class CapturedBytes {
  #bytes: Uint8Array | undefined;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  take(): Uint8Array {
    const bytes = this.#bytes;
    if (bytes === undefined) {
      throw new TypeError("Captured bytes were already adopted by a rendered file");
    }
    this.#bytes = undefined;
    return bytes;
  }
}

/**
 * One file to serialize. There is no producer identity here any more: the fold
 * adjudicated ownership before this module ran, and a second, prose copy of
 * "who made this" that nothing reads would only drift from the ledger's.
 */
export interface RenderedClaim {
  readonly path: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
  /** SDK-produced bytes, adopted rather than copied. See `CapturedBytes`. */
  readonly captured?: CapturedBytes;
}

class ImmutableRenderedFile implements RenderedFile {
  readonly path: LogicalPath;
  readonly kind: "text" | "bytes";
  readonly byteLength: number;
  readonly sha256: string;
  readonly text: string | undefined;
  readonly #bytes: Uint8Array;

  constructor(path: LogicalPath, claim: RenderedClaim) {
    const carried = [claim.text, claim.bytes, claim.captured].filter(
      (source) => source !== undefined
    );
    if (carried.length !== 1) {
      throw new TypeError(
        `Rendered claim ${path} must carry exactly one of text, bytes or captured`
      );
    }
    this.path = path;
    this.kind = claim.text === undefined ? "bytes" : "text";
    this.text = claim.text;
    this.#bytes = adopt(claim);
    this.byteLength = this.#bytes.byteLength;
    this.sha256 = createHash("sha256").update(this.#bytes).digest("hex");
    Object.freeze(this);
  }

  bytes(): Uint8Array {
    return this.#bytes.slice();
  }

  ownedBytes(): Uint8Array {
    return this.#bytes;
  }
}

/** The claim's one source of bytes, copied only where the caller kept theirs. */
function adopt(claim: RenderedClaim): Uint8Array {
  if (claim.captured !== undefined) {
    // Rewrapped over the same memory, never copied. A capture producer reading
    // a file gets a `Buffer`, whose `slice` returns a shared view rather than a
    // copy — so storing one directly would make `bytes()` hand out a window
    // onto content already published under a hash taken once.
    const taken = claim.captured.take();
    return new Uint8Array(taken.buffer, taken.byteOffset, taken.byteLength);
  }
  return claim.bytes === undefined ? encoder.encode(claim.text) : Uint8Array.from(claim.bytes);
}

class ImmutableRenderedMod implements RenderedMod {
  readonly prefix: string;
  readonly size: number;
  readonly sha256: string;
  readonly #files: readonly ImmutableRenderedFile[];
  readonly #byPath: ReadonlyMap<LogicalPath, ImmutableRenderedFile>;
  readonly #descriptorHeader: string;

  constructor(prefix: string, descriptorHeader: string, files: readonly ImmutableRenderedFile[]) {
    this.prefix = prefix;
    this.size = files.length;
    this.#descriptorHeader = descriptorHeader;
    this.#files = Object.freeze([...files]);
    this.#byPath = new Map(files.map((file) => [file.path, file]));
    this.sha256 = hashRenderedMod(files);
    Object.freeze(this);
  }

  file(path: string): RenderedFile | undefined {
    return this.#byPath.get(normalizeLogicalPath(path));
  }

  get(path: string): string | undefined {
    return this.text(path);
  }

  has(path: string): boolean {
    return this.file(path) !== undefined;
  }

  text(path: string): string | undefined {
    return this.file(path)?.text;
  }

  *keys(): IterableIterator<LogicalPath> {
    for (const file of this.#files) {
      yield file.path;
    }
  }

  values(): IterableIterator<RenderedFile> {
    return this.#files.values();
  }

  *entries(): IterableIterator<readonly [LogicalPath, RenderedFile]> {
    for (const file of this.#files) {
      yield [file.path, file] as const;
    }
  }

  [Symbol.iterator](): IterableIterator<readonly [LogicalPath, RenderedFile]> {
    return this.entries();
  }

  launcherDescriptor(contentDir: string): string {
    return `${this.#descriptorHeader}path="${contentDir}"`;
  }
}

/**
 * Builds the rendered mod from claims the fold has already adjudicated.
 *
 * The ownership rules — aliases, file/directory clashes, reserved and vanilla
 * paths — are settled in `compiler/paths.ts` before a `PureMod` exists, so
 * nothing here rules on them. What stays is the structural invariant this
 * object cannot hold without: one file per path. Two claims on one path would
 * leave `#byPath` deduplicated while `#files` kept both, so `size` would
 * over-count, the mod hash would fold the path twice, and the tree writer would
 * write it twice with the second silently winning. Reaching that state means
 * the SDK built the claim list wrong, not that the author did something — hence
 * `TypeError`, like the other misuse guards in this file.
 */
export function createRenderedMod(
  prefix: string,
  descriptorHeader: string,
  claims: readonly RenderedClaim[]
): RenderedMod {
  const files = claims
    .map((claim) => new ImmutableRenderedFile(normalizeLogicalPath(claim.path), claim))
    .sort((a, b) => compareLogicalPaths(a.path, b.path));
  const paths = new Set(files.map((file) => file.path));
  if (paths.size !== files.length) {
    throw new TypeError(
      `render() produced ${files.length} files for ${paths.size} distinct paths; ` +
        `claims reaching this point are already adjudicated, so this is an SDK defect`
    );
  }
  return new ImmutableRenderedMod(prefix, descriptorHeader, files);
}

export function launcherDescriptor(rendered: RenderedMod, contentDir: string): string {
  if (!(rendered instanceof ImmutableRenderedMod)) {
    throw new TypeError("Expected a RenderedMod created by render()");
  }
  return rendered.launcherDescriptor(contentDir);
}

export function renderedFileBytes(file: RenderedFile): Uint8Array {
  if (!(file instanceof ImmutableRenderedFile)) {
    throw new TypeError("Expected a rendered file created by render()");
  }
  return file.ownedBytes();
}

function hashRenderedMod(files: readonly ImmutableRenderedFile[]): string {
  const hash = createHash("sha256");
  hash.update("pdx-sdk-rendered-mod\0");
  for (const file of files) {
    hash.update(lengthPrefix(encoder.encode(file.path).byteLength));
    hash.update(file.path);
    hash.update(lengthPrefix(file.byteLength));
    hash.update(file.sha256);
  }
  return hash.digest("hex");
}

function lengthPrefix(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}
