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

export interface RenderedClaim {
  readonly path: string;
  readonly owner: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
}

class ImmutableRenderedFile implements RenderedFile {
  readonly path: LogicalPath;
  readonly kind: "text" | "bytes";
  readonly byteLength: number;
  readonly sha256: string;
  readonly text: string | undefined;
  readonly #bytes: Uint8Array;

  constructor(path: LogicalPath, claim: RenderedClaim) {
    if ((claim.text === undefined) === (claim.bytes === undefined)) {
      throw new TypeError(`Rendered claim ${path} must carry exactly one of text or bytes`);
    }
    this.path = path;
    this.kind = claim.text === undefined ? "bytes" : "text";
    this.text = claim.text;
    this.#bytes =
      claim.text === undefined ? Uint8Array.from(claim.bytes!) : encoder.encode(claim.text);
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
  const normalized = claims.map((claim) => ({ claim, path: normalizeLogicalPath(claim.path) }));
  for (const { claim, path } of normalized) {
    if (path === MANIFEST_PATH) {
      conflicts.push({
        path,
        owners: canonicalOwners(claim.owner, "materializer"),
        reason: "reserved",
      });
    }
  }

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
          reason: left.path === right.path ? "duplicate" : "portable-alias",
        });
      } else if (common === shared) {
        conflicts.push({
          path: canonicalFirst(left.path, right.path),
          owners: canonicalOwners(left.claim.owner, right.claim.owner),
          reason: "file-directory",
        });
      } else if (alias) {
        conflicts.push({
          path: canonicalFirst(left.path, right.path),
          owners: canonicalOwners(left.claim.owner, right.claim.owner),
          reason: "portable-alias",
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
