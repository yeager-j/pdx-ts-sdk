import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MaterializationError,
  type ForeignClaimConflict,
  type ForeignRefusedEntry,
  type MaterializationDrift,
} from "../errors.ts";
import { compareUtf8 } from "../ordering.ts";
import {
  issueReceipt,
  type ForeignSnapshotEntry,
  type MaterializationSnapshot,
  type OwnedSnapshotEntry,
} from "./receipt.ts";
import { renderedFileBytes, type RenderedMod } from "./rendered.ts";

export const MATERIALIZATION_MANIFEST = ".pdx-sdk-manifest.json";
const MANIFEST_VERSION = 1;

/**
 * Basenames the operating system creates behind the author's back. They are
 * ordinary foreign entries — preserved like any other — with one consequence:
 * a target holding nothing else is still a first materialization, because a
 * Finder visit must not be what blocks a first build.
 */
const OS_METADATA_BASENAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** Link failures that mean "different filesystem or no link support", not "broken". */
const LINK_FALLBACK_CODES = new Set(["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK"]);

export type MaterializationMode = "build" | "install";

export interface LauncherDescriptorRecord {
  readonly basename: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface MaterializationManifest {
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

/** What a fresh `lstat` must still say about a preserved entry at commit time. */
export interface ForeignIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

/** An entry present in the target that the ownership manifest does not own. */
export interface ForeignEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly identity: ForeignIdentity;
}

export interface PreservedEntry {
  readonly path: string;
  readonly source: string;
  readonly identity: ForeignIdentity;
}

export interface MaterializationInspection {
  readonly kind: "absent" | "empty" | "owned";
  readonly foreign: readonly ForeignEntry[];
  readonly snapshot: MaterializationSnapshot;
  readonly manifest?: MaterializationManifest;
}

export interface StagedMaterialization {
  readonly target: string;
  readonly staging: string;
  readonly previous: string;
  readonly hadPrevious: boolean;
  readonly hadOwnedPrevious: boolean;
  readonly mode: MaterializationMode;
  readonly prefix: string;
  readonly snapshot: MaterializationSnapshot;
  readonly preserved: readonly PreservedEntry[];
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

export async function stageMaterialization(
  target: string,
  rendered: RenderedMod,
  mode: MaterializationMode,
  launcherDescriptor?: LauncherDescriptorRecord
): Promise<StagedMaterialization> {
  await mkdir(path.dirname(target), { recursive: true });
  const inspection = await validateExistingMaterialization(target, rendered, mode);
  const staging = path.join(path.dirname(target), `.pdx-staging-${randomUUID()}`);
  const previous = path.join(path.dirname(target), `.pdx-previous-${randomUUID()}`);
  let preserved: readonly PreservedEntry[];
  try {
    await writeRenderedTree(staging, rendered, mode, launcherDescriptor);
    preserved = await preserveForeign(target, staging, inspection.foreign);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    target,
    staging,
    previous,
    hadPrevious: inspection.kind !== "absent",
    hadOwnedPrevious: inspection.kind === "owned",
    mode,
    prefix: rendered.prefix,
    snapshot: inspection.snapshot,
    preserved,
  };
}

export async function activateMaterialization(staged: StagedMaterialization): Promise<void> {
  await revalidatePreserved(staged);
  if (staged.hadPrevious) {
    await rename(staged.target, staged.previous);
  }
  try {
    await rename(staged.staging, staged.target);
  } catch (error) {
    let rolledBack = true;
    if (staged.hadPrevious) {
      try {
        await rename(staged.previous, staged.target);
      } catch {
        rolledBack = false;
      }
    }
    if (rolledBack) {
      await rm(staged.staging, { recursive: true, force: true });
    }
    throw new MaterializationError(
      staged.target,
      { reason: "activation", rolledBack },
      { cause: error }
    );
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

/**
 * Decide what the target is, and refuse in a fixed order: an unowned target
 * first, then foreign kinds that cannot survive activation, then owned drift,
 * then a rendered claim landing on a foreign entry. The order is what makes
 * two runs against one broken target report the same thing.
 */
export async function validateExistingMaterialization(
  target: string,
  rendered: RenderedMod,
  mode: MaterializationMode
): Promise<MaterializationInspection> {
  const targetStats = await lstatOrUndefined(target);
  if (targetStats === undefined) {
    return { kind: "absent", foreign: [], snapshot: emptySnapshot() };
  }
  if (targetStats.isSymbolicLink()) {
    throw unowned(target, `Refusing to replace ${target}: it is a symlink, not an SDK-owned tree.`);
  }
  if (!targetStats.isDirectory()) {
    throw unowned(
      target,
      `Refusing to replace ${target}: it is not a directory, so it is not an SDK-owned tree.`
    );
  }
  const entries = await readdir(target);
  if (entries.length === 0) {
    return { kind: "empty", foreign: [], snapshot: emptySnapshot() };
  }

  if (entries.every((name) => OS_METADATA_BASENAMES.has(name))) {
    const classified = await classifyTarget(target, new Map());
    refuse(target, mode, rendered.prefix, rendered, classified);
    return { kind: "empty", foreign: classified.foreign, snapshot: classified.snapshot };
  }

  const manifestPath = path.join(target, MATERIALIZATION_MANIFEST);
  const manifestStats = await lstatOrUndefined(manifestPath);
  if (manifestStats === undefined || !manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw unowned(
      target,
      `Refusing to replace nonempty ${target}: it has no regular ${MATERIALIZATION_MANIFEST} ownership manifest.`
    );
  }
  const manifest = await readManifest(manifestPath, target);
  if (
    manifest.prefix !== rendered.prefix ||
    manifest.mode !== mode ||
    (mode === "build" && manifest.launcherDescriptor !== undefined) ||
    (mode === "install" && manifest.launcherDescriptor === undefined)
  ) {
    throw unowned(
      target,
      `Refusing to replace ${target}: its ownership manifest belongs to a different mod or materialization mode.`
    );
  }

  const classified = await classifyTarget(
    target,
    new Map(manifest.files.map((file) => [file.path, file]))
  );
  refuse(target, mode, rendered.prefix, rendered, classified);
  return {
    kind: "owned",
    foreign: classified.foreign,
    snapshot: classified.snapshot,
    manifest,
  };
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

interface ClassifiedTarget {
  readonly drift: readonly MaterializationDrift[];
  readonly foreign: readonly ForeignEntry[];
  readonly refused: readonly ForeignRefusedEntry[];
  readonly snapshot: MaterializationSnapshot;
}

/**
 * One no-follow pass over the target. Every entry lands in exactly one of
 * three buckets: an owned path the manifest names (or an ancestor directory
 * one implies), a foreign entry to carry across activation, or a foreign kind
 * that cannot be carried at all.
 */
async function classifyTarget(
  target: string,
  ownedFiles: ReadonlyMap<string, { readonly byteLength: number; readonly sha256: string }>
): Promise<ClassifiedTarget> {
  const ownedDirectories = new Set<string>();
  for (const relPath of ownedFiles.keys()) {
    const components = relPath.split("/");
    for (let index = 1; index < components.length; index++) {
      ownedDirectories.add(components.slice(0, index).join("/"));
    }
  }

  const drift: MaterializationDrift[] = [];
  const foreign: ForeignEntry[] = [];
  const refused: ForeignRefusedEntry[] = [];
  const owned: OwnedSnapshotEntry[] = [];
  const foreignSnapshot: ForeignSnapshotEntry[] = [];
  const seen = new Set<string>();

  const walk = async (relative: string): Promise<void> => {
    const dir = relative === "" ? target : path.join(target, ...relative.split("/"));
    for (const name of await readdir(dir)) {
      const relPath = relative === "" ? name : `${relative}/${name}`;
      if (relPath === MATERIALIZATION_MANIFEST) {
        continue;
      }
      const absolute = path.join(dir, name);
      const stats = await lstat(absolute);

      const expected = ownedFiles.get(relPath);
      if (expected !== undefined) {
        seen.add(relPath);
        if (stats.isSymbolicLink()) {
          drift.push({ path: relPath, kind: "symlink" });
          owned.push({ path: relPath, kind: "symlink", byteLength: 0, sha256: "" });
        } else if (stats.isFile()) {
          const bytes = await readFile(absolute);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          owned.push({ path: relPath, kind: "file", byteLength: bytes.byteLength, sha256 });
          if (bytes.byteLength !== expected.byteLength || sha256 !== expected.sha256) {
            drift.push({ path: relPath, kind: "modified" });
          }
        } else {
          drift.push({ path: relPath, kind: "type-changed" });
          owned.push({
            path: relPath,
            kind: stats.isDirectory() ? "directory" : "other",
            byteLength: 0,
            sha256: "",
          });
        }
        continue;
      }

      if (ownedDirectories.has(relPath)) {
        if (stats.isSymbolicLink()) {
          drift.push({ path: relPath, kind: "symlink" });
          owned.push({ path: relPath, kind: "symlink", byteLength: 0, sha256: "" });
        } else if (stats.isDirectory()) {
          await walk(relPath);
        } else {
          drift.push({ path: relPath, kind: "type-changed" });
          owned.push({ path: relPath, kind: "other", byteLength: 0, sha256: "" });
        }
        continue;
      }

      if (stats.isSymbolicLink()) {
        refused.push({ path: relPath, kind: "symlink" });
      } else if (stats.isDirectory() || stats.isFile()) {
        const kind = stats.isDirectory() ? "directory" : "file";
        const identity = identityOf(stats);
        foreign.push({ path: relPath, kind, identity });
        foreignSnapshot.push({ path: relPath, kind, ...identity });
        if (kind === "directory") {
          await walk(relPath);
        }
      } else {
        refused.push({ path: relPath, kind: specialKind(stats) });
      }
    }
  };
  await walk("");

  for (const relPath of ownedFiles.keys()) {
    if (!seen.has(relPath)) {
      drift.push({ path: relPath, kind: "missing" });
      owned.push({ path: relPath, kind: "missing", byteLength: 0, sha256: "" });
    }
  }

  const byPath = (a: { path: string }, b: { path: string }) => compareUtf8(a.path, b.path);
  return {
    drift: drift.sort(byPath),
    foreign: foreign.sort(byPath),
    refused: refused.sort(byPath),
    snapshot: {
      owned: owned.sort(byPath),
      foreign: foreignSnapshot.sort(byPath),
    },
  };
}

function refuse(
  target: string,
  mode: MaterializationMode,
  prefix: string,
  rendered: RenderedMod,
  classified: ClassifiedTarget
): void {
  if (classified.refused.length > 0) {
    throw new MaterializationError(target, {
      reason: "foreign-unpreservable",
      entries: classified.refused,
    });
  }
  if (classified.drift.length > 0) {
    throw new MaterializationError(target, {
      reason: "drift",
      drift: classified.drift,
      receipt: issueReceipt(target, mode, prefix, classified.snapshot),
    });
  }
  const conflicts = findClaimConflicts(rendered, classified.foreign);
  if (conflicts.length > 0) {
    throw new MaterializationError(target, { reason: "foreign-conflict", conflicts });
  }
}

/**
 * A rendered claim that lands on a foreign entry is a refusal, not a
 * replacement — the author's file would be silently destroyed by activation.
 * Comparison uses the lowercased portable component mapping `createRenderedMod`
 * already uses, because that is what the filesystem may collapse.
 */
function findClaimConflicts(
  rendered: RenderedMod,
  foreign: readonly ForeignEntry[]
): ForeignClaimConflict[] {
  const claimByPortable = new Map<string, string>();
  const claimsBelow = new Map<string, string>();
  for (const file of rendered.values()) {
    const components = file.path.split("/").map((component) => component.toLowerCase());
    claimByPortable.set(components.join("/"), file.path);
    for (let index = 1; index < components.length; index++) {
      const ancestor = components.slice(0, index).join("/");
      const existing = claimsBelow.get(ancestor);
      if (existing === undefined || compareUtf8(file.path, existing) < 0) {
        claimsBelow.set(ancestor, file.path);
      }
    }
  }

  const conflicts: ForeignClaimConflict[] = [];
  for (const entry of foreign) {
    const components = entry.path.split("/").map((component) => component.toLowerCase());
    const portable = components.join("/");
    const claimed = claimByPortable.get(portable);
    if (claimed !== undefined) {
      conflicts.push({
        claimPath: claimed,
        foreignPath: entry.path,
        kind: entry.kind === "file" ? "occupied" : "file-directory",
      });
      continue;
    }
    const under = ancestorClaim(claimByPortable, components);
    if (under !== undefined) {
      conflicts.push({ claimPath: under, foreignPath: entry.path, kind: "file-directory" });
      continue;
    }
    const through = entry.kind === "file" ? claimsBelow.get(portable) : undefined;
    if (through !== undefined) {
      conflicts.push({ claimPath: through, foreignPath: entry.path, kind: "file-directory" });
    }
  }

  const seen = new Set<string>();
  return conflicts
    .filter((conflict) => {
      const key = `${conflict.claimPath}\0${conflict.foreignPath}\0${conflict.kind}`;
      const fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    })
    .sort(
      (a, b) =>
        compareUtf8(a.claimPath, b.claimPath) ||
        compareUtf8(a.foreignPath, b.foreignPath) ||
        compareUtf8(a.kind, b.kind)
    );
}

function ancestorClaim(
  claimByPortable: ReadonlyMap<string, string>,
  components: readonly string[]
): string | undefined {
  for (let index = 1; index < components.length; index++) {
    const claim = claimByPortable.get(components.slice(0, index).join("/"));
    if (claim !== undefined) {
      return claim;
    }
  }
  return undefined;
}

/**
 * Foreign entries join the staged tree after the owned one, by hardlink where
 * the filesystem allows it, so activation stays one rename and the author's
 * bytes are never copied twice.
 */
async function preserveForeign(
  target: string,
  staging: string,
  foreign: readonly ForeignEntry[]
): Promise<readonly PreservedEntry[]> {
  const preserved: PreservedEntry[] = [];
  for (const entry of foreign) {
    const components = entry.path.split("/");
    const source = path.join(target, ...components);
    const destination = path.join(staging, ...components);
    if (entry.kind === "directory") {
      await mkdir(destination, { recursive: true });
    } else {
      await mkdir(path.dirname(destination), { recursive: true });
      await linkOrCopy(source, destination);
    }
    preserved.push({ path: entry.path, source, identity: entry.identity });
  }
  return preserved;
}

async function linkOrCopy(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === undefined || !LINK_FALLBACK_CODES.has(code)) {
      throw error;
    }
    await copyFile(source, destination, constants.COPYFILE_FICLONE);
  }
}

/**
 * The commit point: a preserved entry that changed while the owned tree was
 * being staged would be activated as a stale copy of itself, so the swap is
 * refused instead.
 */
async function revalidatePreserved(staged: StagedMaterialization): Promise<void> {
  const changed: string[] = [];
  for (const entry of staged.preserved) {
    const stats = await lstatOrUndefined(entry.source);
    if (stats === undefined || !sameIdentity(identityOf(stats), entry.identity)) {
      changed.push(entry.path);
    }
  }
  if (changed.length === 0) {
    return;
  }
  await rm(staged.staging, { recursive: true, force: true });
  throw new MaterializationError(staged.target, {
    reason: "busy",
    detail:
      `${changed.length} preserved path${changed.length === 1 ? "" : "s"} changed while the ` +
      `output was being staged: ${changed.join(", ")}.`,
  });
}

function sameIdentity(observed: ForeignIdentity, expected: ForeignIdentity): boolean {
  return (
    observed.dev === expected.dev &&
    observed.ino === expected.ino &&
    observed.size === expected.size &&
    observed.mtimeMs === expected.mtimeMs
  );
}

function identityOf(stats: Stats): ForeignIdentity {
  return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
}

function specialKind(stats: Stats): ForeignRefusedEntry["kind"] {
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

function unowned(target: string, detail: string): MaterializationError {
  return new MaterializationError(target, { reason: "unowned", detail });
}

function emptySnapshot(): MaterializationSnapshot {
  return { owned: [], foreign: [] };
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
    throw unowned(
      target,
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
