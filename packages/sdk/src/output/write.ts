import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MaterializationDriftError,
  UnownedMaterializationError,
  type MaterializationDrift,
} from "../errors.ts";
import { compareUtf8 } from "../ordering.ts";
import { renderedFileBytes, type RenderedMod } from "./rendered.ts";

export const MATERIALIZATION_MANIFEST = ".pdx-sdk-manifest.json";
const MANIFEST_VERSION = 1;

export type MaterializationMode = "build" | "install";

export interface LauncherDescriptorRecord {
  readonly basename: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface MaterializationManifest {
  readonly version: 1;
  readonly prefix: string;
  readonly mode: MaterializationMode;
  readonly sha256: string;
  readonly files: readonly {
    readonly path: string;
    readonly byteLength: number;
    readonly sha256: string;
  }[];
  readonly launcherDescriptor?: LauncherDescriptorRecord;
}

export interface StagedMaterialization {
  readonly target: string;
  readonly staging: string;
  readonly previous: string;
  readonly hadPrevious: boolean;
  readonly hadOwnedPrevious: boolean;
}

const materializationTails = new Map<string, Promise<void>>();

/** Serialize exact materializations that resolve to the same physical target. */
export async function withMaterializationLock<T>(
  target: string,
  operation: () => Promise<T>
): Promise<T> {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const key = path.join(await realpath(parent), path.basename(target));
  const previous = materializationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  materializationTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (materializationTails.get(key) === tail) {
      materializationTails.delete(key);
    }
  }
}

/** Replace an SDK-owned output tree with exactly one rendered snapshot. */
export async function write(outDir: string | URL, rendered: RenderedMod): Promise<void> {
  const target = resolveTarget(outDir);
  await withMaterializationLock(target, async () => {
    const staged = await stageMaterialization(target, rendered, "build");
    await activateMaterialization(staged);
    await discardPrevious(staged);
  });
}

/** Add or overwrite rendered files without deleting unrelated paths. */
export async function mergeWrite(outDir: string | URL, rendered: RenderedMod): Promise<void> {
  const root = resolveTarget(outDir);
  await ensureDirectory(root);
  for (const file of rendered.values()) {
    const target = await safeMergeTarget(root, file.path);
    await writeFile(target, renderedFileBytes(file));
  }
}

export async function stageMaterialization(
  target: string,
  rendered: RenderedMod,
  mode: MaterializationMode,
  launcherDescriptor?: LauncherDescriptorRecord
): Promise<StagedMaterialization> {
  await mkdir(path.dirname(target), { recursive: true });
  const previousKind = await validateExistingMaterialization(target, rendered.prefix, mode);
  const staging = path.join(path.dirname(target), `.pdx-staging-${randomUUID()}`);
  const previous = path.join(path.dirname(target), `.pdx-previous-${randomUUID()}`);
  try {
    await writeRenderedTree(staging, rendered, mode, launcherDescriptor);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    target,
    staging,
    previous,
    hadPrevious: previousKind !== "absent",
    hadOwnedPrevious: previousKind === "owned",
  };
}

export async function activateMaterialization(staged: StagedMaterialization): Promise<void> {
  if (staged.hadPrevious) {
    await rename(staged.target, staged.previous);
  }
  try {
    await rename(staged.staging, staged.target);
  } catch (error) {
    if (staged.hadPrevious) {
      await rename(staged.previous, staged.target);
    }
    await rm(staged.staging, { recursive: true, force: true });
    throw error;
  }
}

export async function rollbackMaterialization(staged: StagedMaterialization): Promise<void> {
  await rm(staged.target, { recursive: true, force: true });
  if (staged.hadPrevious) {
    await rename(staged.previous, staged.target);
  }
  await rm(staged.staging, { recursive: true, force: true });
}

export async function discardPrevious(staged: StagedMaterialization): Promise<void> {
  if (staged.hadPrevious) {
    await rm(staged.previous, { recursive: true, force: true });
  }
}

export async function discardStaging(staged: StagedMaterialization): Promise<void> {
  await rm(staged.staging, { recursive: true, force: true });
}

export async function validateExistingMaterialization(
  target: string,
  prefix: string,
  mode: MaterializationMode
): Promise<"absent" | "empty" | "owned"> {
  const targetStats = await lstatOrUndefined(target);
  if (targetStats === undefined) {
    return "absent";
  }
  if (targetStats.isSymbolicLink()) {
    throw new MaterializationDriftError(target, [{ path: ".", kind: "symlink" }]);
  }
  if (!targetStats.isDirectory()) {
    throw new MaterializationDriftError(target, [{ path: ".", kind: "type-changed" }]);
  }
  if ((await readdir(target)).length === 0) {
    return "empty";
  }

  const manifestPath = path.join(target, MATERIALIZATION_MANIFEST);
  const manifestStats = await lstatOrUndefined(manifestPath);
  if (manifestStats === undefined || !manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new UnownedMaterializationError(
      `Refusing to replace nonempty ${target}: it has no regular ${MATERIALIZATION_MANIFEST} ownership manifest.`
    );
  }
  const manifest = await readManifest(manifestPath, target);
  if (
    manifest.prefix !== prefix ||
    manifest.mode !== mode ||
    (mode === "build" && manifest.launcherDescriptor !== undefined) ||
    (mode === "install" && manifest.launcherDescriptor === undefined)
  ) {
    throw new UnownedMaterializationError(
      `Refusing to replace ${target}: its ownership manifest belongs to a different mod or materialization mode.`
    );
  }

  const drift = await findDrift(target, manifest);
  if (drift.length > 0) {
    throw new MaterializationDriftError(target, drift);
  }
  return "owned";
}

export async function installedDescriptorRecord(
  target: string
): Promise<LauncherDescriptorRecord | undefined> {
  const manifest = await readManifest(path.join(target, MATERIALIZATION_MANIFEST), target);
  return manifest.launcherDescriptor;
}

export function descriptorRecord(basename: string, contents: string): LauncherDescriptorRecord {
  const bytes = new TextEncoder().encode(contents);
  return Object.freeze({
    basename,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

async function writeRenderedTree(
  staging: string,
  rendered: RenderedMod,
  mode: MaterializationMode,
  launcherDescriptor?: LauncherDescriptorRecord
): Promise<void> {
  await mkdir(staging);
  for (const file of rendered.values()) {
    const target = path.join(staging, ...file.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, renderedFileBytes(file));
  }
  const manifest: MaterializationManifest = {
    version: MANIFEST_VERSION,
    prefix: rendered.prefix,
    mode,
    sha256: rendered.sha256,
    files: [...rendered.values()].map((file) => ({
      path: file.path,
      byteLength: file.byteLength,
      sha256: file.sha256,
    })),
    ...(launcherDescriptor === undefined ? {} : { launcherDescriptor }),
  };
  await writeFile(
    path.join(staging, MATERIALIZATION_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function readManifest(source: string, target: string): Promise<MaterializationManifest> {
  try {
    const parsed = JSON.parse(await readFile(source, "utf8")) as unknown;
    if (!isManifest(parsed)) {
      throw new Error("invalid manifest shape");
    }
    return parsed;
  } catch (error) {
    throw new UnownedMaterializationError(
      `Refusing to replace ${target}: ${MATERIALIZATION_MANIFEST} is invalid (${error instanceof Error ? error.message : String(error)}).`
    );
  }
}

function isManifest(value: unknown): value is MaterializationManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record["version"] !== MANIFEST_VERSION ||
    typeof record["prefix"] !== "string" ||
    (record["mode"] !== "build" && record["mode"] !== "install") ||
    typeof record["sha256"] !== "string" ||
    !Array.isArray(record["files"])
  ) {
    return false;
  }
  const filesValid = record["files"].every(
    (file) =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as Record<string, unknown>)["path"] === "string" &&
      typeof (file as Record<string, unknown>)["byteLength"] === "number" &&
      typeof (file as Record<string, unknown>)["sha256"] === "string"
  );
  const descriptor = record["launcherDescriptor"];
  const descriptorValid =
    descriptor === undefined ||
    (typeof descriptor === "object" &&
      descriptor !== null &&
      typeof (descriptor as Record<string, unknown>)["basename"] === "string" &&
      typeof (descriptor as Record<string, unknown>)["byteLength"] === "number" &&
      typeof (descriptor as Record<string, unknown>)["sha256"] === "string");
  return filesValid && descriptorValid;
}

async function findDrift(
  target: string,
  manifest: MaterializationManifest
): Promise<MaterializationDrift[]> {
  const actual = await scanTree(target);
  actual.delete(MATERIALIZATION_MANIFEST);
  const expectedFiles = new Map(manifest.files.map((file) => [file.path, file]));
  const expectedDirectories = new Set<string>();
  for (const file of manifest.files) {
    const components = file.path.split("/");
    for (let index = 1; index < components.length; index++) {
      expectedDirectories.add(components.slice(0, index).join("/"));
    }
  }
  const drift: MaterializationDrift[] = [];
  for (const [relPath, entry] of actual) {
    const expected = expectedFiles.get(relPath);
    if (expected === undefined) {
      if (entry.kind === "directory" && expectedDirectories.has(relPath)) {
        continue;
      }
      drift.push({ path: relPath, kind: entry.kind === "symlink" ? "symlink" : "added" });
      continue;
    }
    if (entry.kind === "symlink") {
      drift.push({ path: relPath, kind: "symlink" });
    } else if (entry.kind !== "file") {
      drift.push({ path: relPath, kind: "type-changed" });
    } else if (entry.byteLength !== expected.byteLength || entry.sha256 !== expected.sha256) {
      drift.push({ path: relPath, kind: "modified" });
    }
  }
  for (const relPath of expectedFiles.keys()) {
    if (!actual.has(relPath)) {
      drift.push({ path: relPath, kind: "missing" });
    }
  }
  return drift.sort((a, b) => compareUtf8(a.path, b.path));
}

type TreeEntry =
  | { readonly kind: "directory" | "symlink" | "other" }
  | { readonly kind: "file"; readonly byteLength: number; readonly sha256: string };

async function scanTree(root: string, relative = ""): Promise<Map<string, TreeEntry>> {
  const found = new Map<string, TreeEntry>();
  const dir = relative === "" ? root : path.join(root, ...relative.split("/"));
  for (const name of await readdir(dir)) {
    const relPath = relative === "" ? name : `${relative}/${name}`;
    const absolute = path.join(dir, name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      found.set(relPath, { kind: "symlink" });
    } else if (stats.isDirectory()) {
      found.set(relPath, { kind: "directory" });
      for (const [childPath, entry] of await scanTree(root, relPath)) {
        found.set(childPath, entry);
      }
    } else if (stats.isFile()) {
      const bytes = await readFile(absolute);
      found.set(relPath, {
        kind: "file",
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    } else {
      found.set(relPath, { kind: "other" });
    }
  }
  return found;
}

async function safeMergeTarget(root: string, relPath: string): Promise<string> {
  const components = relPath.split("/");
  let dir = root;
  for (const component of components.slice(0, -1)) {
    const next = path.join(dir, component);
    const stats = await lstatOrUndefined(next);
    if (stats === undefined) {
      await mkdir(next);
    } else if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Refusing to merge through non-directory path ${next}`);
    }
    dir = next;
  }
  const target = path.join(dir, components.at(-1)!);
  const stats = await lstatOrUndefined(target);
  if (stats?.isSymbolicLink() || stats?.isDirectory()) {
    throw new Error(`Refusing to merge over non-file path ${target}`);
  }
  return target;
}

async function ensureDirectory(root: string): Promise<void> {
  const stats = await lstatOrUndefined(root);
  if (stats === undefined) {
    await mkdir(root, { recursive: true });
  } else if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing to write through non-directory output root ${root}`);
  }
}

function resolveTarget(target: string | URL): string {
  return path.resolve(target instanceof URL ? fileURLToPath(target) : target);
}

async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
