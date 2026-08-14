import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, type Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LogicalPathError } from "../errors.ts";
import { compareUtf8, normalizeLogicalPath, type LogicalPath } from "../ordering.ts";
import { CapturedBytes } from "../output/rendered.ts";

export interface AssetFileItem {
  readonly itemKind: "asset";
  readonly path: LogicalPath;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface AssetFileInput {
  readonly source: string | URL;
  readonly path: string;
}

export interface AssetTreeInput {
  readonly source: string | URL;
  readonly into?: string;
}

export interface AssetCapabilityOwner {
  readonly assetCapability: symbol;
}

interface AssetRecord {
  readonly owner: AssetCapabilityOwner;
  readonly captured: CapturedBytes;
}

interface Identity {
  readonly dev: number;
  readonly ino: number;
}

interface PlannedFile {
  readonly source: string;
  readonly path: LogicalPath;
  readonly identity: Identity;
}

interface PlannedTree {
  readonly root: string;
  readonly rootIdentity: Identity;
  readonly files: readonly PlannedFile[];
}

const records = new WeakMap<AssetFileItem, AssetRecord>();

/** Test-only seam. This module is deliberately not exported from the package. */
export const _assetCaptureTestHook: {
  current:
    | {
        readonly beforeRead?: (source: string) => void;
        readonly afterRead?: (source: string) => void;
      }
    | undefined;
} = { current: undefined };

export function captureAssetFile(
  owner: AssetCapabilityOwner,
  input: AssetFileInput
): AssetFileItem {
  const source = sourcePath(input.source);
  const planned = planRegularFile(source, normalizeLogicalPath(input.path));
  return capturePlanned(owner, [planned])[0]!;
}

export function captureAssetTree(
  owner: AssetCapabilityOwner,
  input: AssetTreeInput
): readonly AssetFileItem[] {
  const tree = planTree(sourcePath(input.source), input.into);
  assertSameIdentity(tree.root, tree.rootIdentity, "directory", "Asset tree root");
  const items = capturePlanned(owner, tree.files);
  assertSameIdentity(tree.root, tree.rootIdentity, "directory", "Asset tree root");
  return Object.freeze(items);
}

export function assertAssetOwner(item: AssetFileItem, owner: AssetCapabilityOwner): void {
  if (records.get(item)?.owner !== owner) {
    throw new Error("Asset file item does not belong to this mod capability");
  }
}

/** Hands an SDK-owned payload to exactly one rendered file without copying it. */
export function takeAssetBytes(item: AssetFileItem): CapturedBytes {
  const record = records.get(item);
  if (record === undefined) {
    throw new Error("Asset file item was not captured by the SDK");
  }
  return record.captured;
}

function sourcePath(source: string | URL): string {
  if (typeof source === "string") {
    if (!path.isAbsolute(source)) {
      throw new Error(
        "Asset source paths must be absolute; use a file: URL object or an absolute path"
      );
    }
    return source;
  }
  if (!(source instanceof URL) || source.protocol !== "file:") {
    throw new Error("Asset source must be an absolute path or a file: URL object");
  }
  return fileURLToPath(source);
}

function planRegularFile(source: string, destination: LogicalPath): PlannedFile {
  const stat = lstatRequired(source, "Asset file source");
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Asset file source ${JSON.stringify(source)} must be a regular file`);
  }
  return { source, path: destination, identity: identityOf(stat) };
}

function planTree(source: string, into: string | undefined): PlannedTree {
  const prefix = into === undefined ? undefined : normalizeLogicalPath(into);
  const root = lstatRequired(source, "Asset tree source");
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new Error(`Asset tree source ${JSON.stringify(source)} must be a directory`);
  }
  const files: PlannedFile[] = [];
  const pending = [source];
  const rawDestinations = new Map<LogicalPath, string>();

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entrySource = path.join(directory, entry.name);
      const stat = lstatRequired(entrySource, "Asset tree entry");
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Asset tree source ${JSON.stringify(entrySource)} contains a symbolic link`
        );
      }
      if (stat.isDirectory()) {
        pending.push(entrySource);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Asset tree source ${JSON.stringify(entrySource)} contains a non-regular entry`
        );
      }
      const relative = path.relative(source, entrySource).split(path.sep).join("/");
      const rawDestination = prefix === undefined ? relative : `${prefix}/${relative}`;
      const destination = normalizeLogicalPath(rawDestination);
      const previous = rawDestinations.get(destination);
      if (previous !== undefined && previous !== rawDestination) {
        throw new LogicalPathError(
          `Asset tree destinations ${JSON.stringify(previous)} and ${JSON.stringify(rawDestination)} ` +
            `normalize to the same logical path ${JSON.stringify(destination)}`
        );
      }
      rawDestinations.set(destination, rawDestination);
      files.push({ source: entrySource, path: destination, identity: identityOf(stat) });
    }
  }

  if (files.length === 0) {
    throw new Error(`Asset tree source ${JSON.stringify(source)} contains no regular files`);
  }
  files.sort((a, b) => compareUtf8(a.path, b.path));
  return { root: source, rootIdentity: identityOf(root), files };
}

function capturePlanned(
  owner: AssetCapabilityOwner,
  planned: readonly PlannedFile[]
): AssetFileItem[] {
  const captured = planned.map((file) => {
    _assetCaptureTestHook.current?.beforeRead?.(file.source);
    assertSameIdentity(file.source, file.identity, "file", "Asset source");
    const bytes = readFileSync(file.source);
    _assetCaptureTestHook.current?.afterRead?.(file.source);
    assertSameIdentity(file.source, file.identity, "file", "Asset source");
    return { file, bytes };
  });

  return captured.map(({ file, bytes }) => {
    const item = Object.freeze({
      itemKind: "asset" as const,
      path: file.path,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    records.set(item, { owner, captured: new CapturedBytes(bytes) });
    return item;
  });
}

function lstatRequired(source: string, label: string): Stats {
  try {
    return lstatSync(source);
  } catch (error) {
    throw new Error(`${label} ${JSON.stringify(source)} is unavailable`, { cause: error });
  }
}

function identityOf(stat: Stats): Identity {
  return { dev: stat.dev, ino: stat.ino };
}

function assertSameIdentity(
  source: string,
  expected: Identity,
  kind: "file" | "directory",
  label: string
): void {
  const stat = lstatRequired(source, label);
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`${label} ${JSON.stringify(source)} is no longer a regular filesystem entry`);
  }
  if (stat.dev !== expected.dev || stat.ino !== expected.ino) {
    throw new Error(`${label} ${JSON.stringify(source)} changed after capture planning`);
  }
}
