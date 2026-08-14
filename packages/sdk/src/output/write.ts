import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  chmod,
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
  openReceipt,
  receiptDigest,
  type DescriptorSnapshot,
  type ForeignSnapshotEntry,
  type MaterializationReceipt,
  type MaterializationSnapshot,
  type OpenedReceipt,
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
  /** Permission bits, so a preserved directory keeps the ones it had. */
  readonly permissions: number;
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
  /** Every target-relative path the inspection accounted for. */
  readonly known: ReadonlySet<string>;
  /** Owned drift a replay receipt matched, and so waived. Otherwise empty. */
  readonly waivedDrift: readonly MaterializationDrift[];
  /**
   * Whether a replay receipt described exactly this state. The descriptor is
   * digested into the receipt but examined by `install` after this pass, so it
   * needs the verdict rather than only its consequence for the owned set.
   */
  readonly receiptAccepted: boolean;
  readonly manifest?: MaterializationManifest;
}

/** A foreign entry as a report names it: what it is, not how to carry it. */
export interface ForeignReportEntry {
  /** Target-relative, "/"-separated. */
  readonly path: string;
  readonly kind: "file" | "directory";
}

/** A leftover the SDK could not remove after the materialization committed. */
export interface CleanupWarning {
  /** Absolute path of the leftover. */
  readonly path: string;
  readonly message: string;
}

export interface MaterializationReport {
  readonly status: "written" | "unchanged";
  /** Absolute path of the ownership manifest. */
  readonly manifestPath: string;
  /** Preserved entries the SDK does not own, minus OS metadata. */
  readonly foreignEntries: readonly ForeignReportEntry[];
  readonly warnings: readonly CleanupWarning[];
}

export interface WriteReport extends MaterializationReport {
  /** The authoritative absolute output path, whatever form the caller gave. */
  readonly outDir: string;
}

export interface InstallReport extends MaterializationReport {
  readonly contentDir: string;
  readonly descriptorPath: string;
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
  readonly known: ReadonlySet<string>;
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
export async function write(outDir: string | URL, rendered: RenderedMod): Promise<WriteReport> {
  return materialize(resolveTarget(outDir), rendered, undefined);
}

/**
 * `write`, plus the authority to replace owned entries that drifted. The
 * receipt converts one refusal and nothing else: it must describe exactly the
 * state found now, and an unowned target is never replaceable at all.
 */
export async function replaceMaterialization(
  outDir: string | URL,
  rendered: RenderedMod,
  receipt: MaterializationReceipt
): Promise<WriteReport> {
  return materialize(resolveTarget(outDir), rendered, openReceipt(receipt));
}

async function materialize(
  target: string,
  rendered: RenderedMod,
  receipt: OpenedReceipt | undefined
): Promise<WriteReport> {
  return withMaterializationLock(target, async () => {
    const inspection = await validateExistingMaterialization(target, rendered, "build", {
      receipt,
    });
    const common = {
      manifestPath: path.join(target, MATERIALIZATION_MANIFEST),
      foreignEntries: reportForeign(inspection.foreign),
    };
    if (ownedSetMatches(inspection, rendered)) {
      return freezeReport({ status: "unchanged", outDir: target, ...common, warnings: [] });
    }
    const staged = await stageMaterialization(target, rendered, "build", inspection);
    await activateMaterialization(staged);
    return freezeReport({
      status: "written",
      outDir: target,
      ...common,
      warnings: await discardPrevious(staged),
    });
  });
}

/**
 * Whether the target already holds exactly this render. Waived drift is the
 * one case where the manifest agrees with the render and the tree does not, so
 * a replay must still stage.
 */
export function ownedSetMatches(
  inspection: MaterializationInspection,
  rendered: RenderedMod
): boolean {
  return (
    inspection.kind === "owned" &&
    inspection.waivedDrift.length === 0 &&
    inspection.manifest?.sha256 === rendered.sha256
  );
}

/** Every foreign entry a report names: OS metadata is carried but not reported. */
export function reportForeign(foreign: readonly ForeignEntry[]): readonly ForeignReportEntry[] {
  return foreign
    .filter(
      (entry) => !OS_METADATA_BASENAMES.has(entry.path.slice(entry.path.lastIndexOf("/") + 1))
    )
    .map((entry) => Object.freeze({ path: entry.path, kind: entry.kind }))
    .sort((a, b) => compareUtf8(a.path, b.path));
}

export function freezeReport<T extends MaterializationReport>(report: T): T {
  return Object.freeze({
    ...report,
    foreignEntries: Object.freeze([...report.foreignEntries]),
    warnings: Object.freeze(report.warnings.map((warning) => Object.freeze({ ...warning }))),
  });
}

export interface StageOptions {
  /** Install mode only: the descriptor record the manifest must record. */
  readonly launcherDescriptor?: LauncherDescriptorRecord;
}

/**
 * Build the replacement tree beside the target. It takes the inspection rather
 * than making one: staging a target nobody classified would carry no foreign
 * entries and refuse nothing, so the two steps stay one decision.
 */
export async function stageMaterialization(
  target: string,
  rendered: RenderedMod,
  mode: MaterializationMode,
  inspection: MaterializationInspection,
  options: StageOptions = {}
): Promise<StagedMaterialization> {
  const launcherDescriptor = options.launcherDescriptor;
  await mkdir(path.dirname(target), { recursive: true });
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
    known: inspection.known,
  };
}

export async function activateMaterialization(staged: StagedMaterialization): Promise<void> {
  await revalidateTarget(staged);
  if (staged.hadPrevious) {
    try {
      await rename(staged.target, staged.previous);
    } catch (error) {
      // The target never moved, so the previous output is exactly as found.
      await removeQuietly(staged.staging);
      throw new MaterializationError(
        staged.target,
        { reason: "activation", rolledBack: true },
        { cause: error }
      );
    }
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
      await removeQuietly(staged.staging);
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

/**
 * Post-commit cleanup. The materialization is already published, so a leftover
 * that cannot be removed is news for the report rather than a failure: throwing
 * here would tell a caller their build failed when it succeeded.
 */
export async function discardPrevious(
  staged: StagedMaterialization
): Promise<readonly CleanupWarning[]> {
  return staged.hadPrevious ? discardLeftover(staged.previous) : [];
}

export async function discardLeftover(leftover: string): Promise<readonly CleanupWarning[]> {
  try {
    await rm(leftover, { recursive: true, force: true });
    return [];
  } catch (error) {
    return [{ path: leftover, message: error instanceof Error ? error.message : String(error) }];
  }
}

export async function discardStaging(staged: StagedMaterialization): Promise<void> {
  await rm(staged.staging, { recursive: true, force: true });
}

export interface InspectionOptions {
  /** Install mode only: the launcher descriptor's state, observed already. */
  readonly descriptor?: DescriptorSnapshot;
  /** A replay receipt, which waives owned drift it describes exactly. */
  readonly receipt?: OpenedReceipt;
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
  mode: MaterializationMode,
  options: InspectionOptions = {}
): Promise<MaterializationInspection> {
  const descriptor = options.descriptor;
  const targetStats = await lstatOrUndefined(target);
  if (targetStats === undefined) {
    return { kind: "absent", ...unmaterialized(descriptor) };
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
    return { kind: "empty", ...unmaterialized(descriptor) };
  }

  if (entries.every((name) => OS_METADATA_BASENAMES.has(name))) {
    const classified = await classifyTarget(target, new Map(), descriptor);
    const verdict = refuse(target, mode, rendered.prefix, rendered, classified, options.receipt);
    return {
      kind: "empty",
      foreign: classified.foreign,
      snapshot: classified.snapshot,
      known: classified.known,
      ...verdict,
    };
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
    new Map(manifest.files.map((file) => [file.path, file])),
    descriptor
  );
  const verdict = refuse(target, mode, rendered.prefix, rendered, classified, options.receipt);
  return {
    kind: "owned",
    foreign: classified.foreign,
    snapshot: classified.snapshot,
    known: classified.known,
    manifest,
    ...verdict,
  };
}

/**
 * The launcher descriptor's observed state. `install` reads it before staging
 * so that a drift receipt covers both halves of an installed materialization:
 * two installs differing only in their descriptor must not digest the same.
 */
export async function observeDescriptor(descriptorPath: string): Promise<DescriptorSnapshot> {
  const stats = await lstatOrUndefined(descriptorPath);
  if (stats === undefined) {
    return { state: "absent" };
  }
  if (stats.isSymbolicLink()) {
    return { state: "symlink" };
  }
  if (!stats.isFile()) {
    return { state: "other" };
  }
  const bytes = await readFile(descriptorPath);
  return {
    state: "file",
    basename: path.basename(descriptorPath),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
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
  readonly known: ReadonlySet<string>;
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
  ownedFiles: ReadonlyMap<string, { readonly byteLength: number; readonly sha256: string }>,
  descriptor?: DescriptorSnapshot
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
  const known = new Set<string>([MATERIALIZATION_MANIFEST]);

  /**
   * An owned path found as a directory is drift, but which directory it is
   * matters to anyone reviewing it: without the subtree, every possible set
   * of contents under it digests the same.
   */
  const record = async (relative: string): Promise<void> => {
    const dir = path.join(target, ...relative.split("/"));
    for (const name of await readdir(dir)) {
      const relPath = `${relative}/${name}`;
      const stats = await lstat(path.join(dir, name));
      known.add(relPath);
      foreignSnapshot.push({ path: relPath, kind: observedKind(stats), ...identityOf(stats) });
      if (stats.isDirectory()) {
        await record(relPath);
      }
    }
  };

  const walk = async (relative: string): Promise<void> => {
    const dir = relative === "" ? target : path.join(target, ...relative.split("/"));
    for (const name of await readdir(dir)) {
      const relPath = relative === "" ? name : `${relative}/${name}`;
      if (relPath === MATERIALIZATION_MANIFEST) {
        continue;
      }
      const absolute = path.join(dir, name);
      const stats = await lstat(absolute);
      known.add(relPath);

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
        } else if (stats.isDirectory()) {
          drift.push({ path: relPath, kind: "type-changed" });
          owned.push({ path: relPath, kind: "directory", byteLength: 0, sha256: "" });
          await record(relPath);
        } else {
          drift.push({ path: relPath, kind: "type-changed" });
          owned.push({ path: relPath, kind: "other", byteLength: 0, sha256: "" });
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
        foreign.push({ path: relPath, kind, identity, permissions: stats.mode & 0o7777 });
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
    known,
    snapshot: {
      owned: owned.sort(byPath),
      foreign: foreignSnapshot.sort(byPath),
      ...(descriptor === undefined ? {} : { descriptor }),
    },
  };
}

/** What a pass through `refuse` leaves the inspection to carry. */
type RefusalVerdict = Pick<MaterializationInspection, "waivedDrift" | "receiptAccepted">;

function refuse(
  target: string,
  mode: MaterializationMode,
  prefix: string,
  rendered: RenderedMod,
  classified: ClassifiedTarget,
  receipt: OpenedReceipt | undefined
): RefusalVerdict {
  if (classified.refused.length > 0) {
    throw new MaterializationError(target, {
      reason: "foreign-unpreservable",
      entries: classified.refused,
    });
  }
  const accepted =
    receipt !== undefined && describesState(receipt, target, mode, prefix, classified.snapshot);
  if (classified.drift.length > 0 && !accepted) {
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
  return { waivedDrift: accepted ? classified.drift : [], receiptAccepted: accepted };
}

/**
 * Whether a receipt is a review of the state just observed. The digest already
 * covers target, mode and prefix, but comparing them on their own is what
 * makes a receipt from somewhere else read as the mismatch it is.
 */
function describesState(
  receipt: OpenedReceipt,
  target: string,
  mode: MaterializationMode,
  prefix: string,
  snapshot: MaterializationSnapshot
): boolean {
  return (
    receipt.target === target &&
    receipt.mode === mode &&
    receipt.prefix === prefix &&
    receipt.digest === receiptDigest(target, mode, prefix, snapshot)
  );
}

/**
 * A rendered claim that lands on a foreign entry is a refusal, not a
 * replacement — the author's file would be silently destroyed by activation.
 * Comparison uses the lowercased portable component mapping `createRenderedMod`
 * already uses, because that is what the filesystem may collapse. Foreign
 * names are normalized as well as folded: logical paths are NFC, and macOS
 * hands back decomposed names for the same file.
 */
function findClaimConflicts(
  rendered: RenderedMod,
  foreign: readonly ForeignEntry[]
): ForeignClaimConflict[] {
  const claimByPortable = new Map<string, string>();
  const claimsBelow = new Map<string, string>();
  for (const file of rendered.values()) {
    const components = file.path.split("/").map(portableComponent);
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
    const components = entry.path.split("/").map(portableComponent);
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

function portableComponent(component: string): string {
  return component.normalize("NFC").toLowerCase();
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
 * bytes are never copied twice. A hardlinked or copied file keeps its own
 * permissions; a recreated directory does not, so its mode is applied here —
 * after the tree is populated, since a directory the author made unwritable
 * cannot be filled first. ACLs and extended attributes are out of scope: the
 * contract preserves the entry, not every attribute a filesystem can carry.
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
  for (const entry of foreign) {
    if (entry.kind === "directory") {
      await chmod(path.join(staging, ...entry.path.split("/")), entry.permissions);
    }
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
 * The commit point. Two ways the target can have moved on since it was
 * classified, and the swap destroys evidence of both: a preserved entry that
 * changed would be published as a stale copy of itself, and an entry that
 * appeared afterwards — the author saving a file, the OS writing metadata
 * mid-build — would ride into the set-aside tree and be deleted with it.
 * Neither is worth guessing at, so both refuse.
 */
async function revalidateTarget(staged: StagedMaterialization): Promise<void> {
  const changed: string[] = [];
  for (const entry of staged.preserved) {
    const stats = await lstatOrUndefined(entry.source);
    if (stats === undefined || !sameIdentity(identityOf(stats), entry.identity)) {
      changed.push(entry.path);
    }
  }
  const appeared = (await membership(staged.target))
    .filter((relPath) => !staged.known.has(relPath))
    .sort(compareUtf8);

  if (changed.length === 0 && appeared.length === 0) {
    return;
  }
  await removeQuietly(staged.staging);
  const moved = [...changed.sort(compareUtf8), ...appeared];
  throw new MaterializationError(staged.target, {
    reason: "busy",
    detail:
      `${moved.length} path${moved.length === 1 ? "" : "s"} changed or appeared while the ` +
      `output was being staged: ${moved.join(", ")}.`,
  });
}

/**
 * Every target-relative path present right now, by kind only — no hashing and
 * no `lstat` per entry, since this runs on the way into every activation.
 */
async function membership(target: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    const dir = relative === "" ? target : path.join(target, ...relative.split("/"));
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const relPath = relative === "" ? entry.name : `${relative}/${entry.name}`;
      found.push(relPath);
      // `readdir` never follows, so a symlink to a directory is not one here.
      if (entry.isDirectory()) {
        await walk(relPath);
      }
    }
  };
  await walk("");
  return found;
}

/**
 * Cleanup after a refusal is best effort: the refusal is the news, and a
 * staging directory that cannot be removed (a parent turned read-only, which
 * is often what failed the activation in the first place) must not replace
 * the error explaining why.
 */
async function removeQuietly(target: string): Promise<void> {
  try {
    await rm(target, { recursive: true, force: true });
  } catch {
    // Deliberately swallowed; see above.
  }
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

function observedKind(stats: Stats): ForeignSnapshotEntry["kind"] {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  return stats.isFile() ? "file" : "other";
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

/** The inspection of a target holding no materialization to drift from. */
function unmaterialized(
  descriptor: DescriptorSnapshot | undefined
): Omit<MaterializationInspection, "kind"> {
  return {
    foreign: [],
    snapshot: { owned: [], foreign: [], ...(descriptor === undefined ? {} : { descriptor }) },
    known: new Set(),
    waivedDrift: [],
    receiptAccepted: false,
  };
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
