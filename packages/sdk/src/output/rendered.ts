import { createHash } from "node:crypto";

import { PathOwnershipError, type PathOwnershipConflict } from "../errors.ts";
import {
  compareLogicalPaths,
  compareUtf8,
  normalizeLogicalPath,
  type LogicalPath,
} from "../ordering.ts";

const encoder = new TextEncoder();
const MANIFEST_PATH = ".pdx-sdk-manifest.json";

export interface RenderedFile {
  readonly path: LogicalPath;
  readonly kind: "text" | "bytes";
  readonly byteLength: number;
  readonly sha256: string;
  readonly text: string | undefined;
  bytes(): Uint8Array;
}

export interface RenderedMod extends Iterable<readonly [LogicalPath, RenderedFile]> {
  readonly prefix: string;
  readonly size: number;
  readonly sha256: string;
  /** Text-only compatibility projection; use `file()` for byte artifacts. */
  get(path: string): string | undefined;
  has(path: string): boolean;
  file(path: string): RenderedFile | undefined;
  text(path: string): string | undefined;
  keys(): IterableIterator<LogicalPath>;
  values(): IterableIterator<RenderedFile>;
  entries(): IterableIterator<readonly [LogicalPath, RenderedFile]>;
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

export interface RenderedClaim {
  readonly path: string;
  readonly owner: string;
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
    return claim.captured.take();
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
    return `${this.#descriptorHeader}path="${contentDir}"\n`;
  }
}

export function createRenderedMod(
  prefix: string,
  descriptorHeader: string,
  claims: readonly RenderedClaim[]
): RenderedMod {
  const conflicts: PathOwnershipConflict[] = [];
  const normalized = [
    ...claims.map((claim) => ({ claim, path: normalizeLogicalPath(claim.path), reserved: false })),
    {
      claim: { path: MANIFEST_PATH, owner: "materializer", text: "" },
      path: normalizeLogicalPath(MANIFEST_PATH),
      reserved: true,
    },
  ];

  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex++) {
    const left = normalized[leftIndex]!;
    const leftComponents = left.path.split("/");
    const leftPortable = leftComponents.map((component) => component.toLowerCase());
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex++) {
      const right = normalized[rightIndex]!;
      const rightComponents = right.path.split("/");
      const rightPortable = rightComponents.map((component) => component.toLowerCase());
      const shared = Math.min(leftPortable.length, rightPortable.length);
      let common = 0;
      let alias = false;
      while (common < shared && leftPortable[common] === rightPortable[common]) {
        alias ||= leftComponents[common] !== rightComponents[common];
        common++;
      }
      if (common === shared && leftPortable.length === rightPortable.length) {
        conflicts.push({
          path: canonicalFirst(left.path, right.path),
          owners: canonicalOwners(left.claim.owner, right.claim.owner),
          reason:
            left.reserved || right.reserved
              ? "reserved"
              : left.path === right.path
                ? "duplicate"
                : "portable-alias",
        });
      } else if (common === shared) {
        conflicts.push({
          path: canonicalFirst(left.path, right.path),
          owners: canonicalOwners(left.claim.owner, right.claim.owner),
          reason: left.reserved || right.reserved ? "reserved" : "file-directory",
        });
      } else if (alias) {
        conflicts.push({
          path: canonicalFirst(left.path, right.path),
          owners: canonicalOwners(left.claim.owner, right.claim.owner),
          reason: left.reserved || right.reserved ? "reserved" : "portable-alias",
        });
      }
    }
  }

  if (conflicts.length > 0) {
    conflicts.sort(
      (a, b) =>
        compareUtf8(a.path, b.path) ||
        compareUtf8(a.reason, b.reason) ||
        compareUtf8(a.owners.join("\0"), b.owners.join("\0"))
    );
    throw new PathOwnershipError(conflicts);
  }

  const files = normalized
    .filter(({ reserved }) => !reserved)
    .map(({ claim, path }) => new ImmutableRenderedFile(path, claim))
    .sort((a, b) => compareLogicalPaths(a.path, b.path));
  return new ImmutableRenderedMod(prefix, descriptorHeader, files);
}

function canonicalFirst(left: LogicalPath, right: LogicalPath): LogicalPath {
  return compareLogicalPaths(left, right) <= 0 ? left : right;
}

function canonicalOwners(left: string, right: string): readonly string[] {
  return [left, right].sort(compareUtf8);
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
