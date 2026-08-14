/**
 * Finishing or undoing a materialization that was interrupted.
 *
 * Recovery is a separate operation on purpose. A writer that finds an
 * unfinished transaction refuses; it does not clean up after one, because the
 * two look identical from inside a build ("something is here that I did not
 * put here") and only one of them is safe to act on unattended. Here the
 * journal is the whole authority: every path this module deletes is a path a
 * transaction wrote down before creating it, or a tree whose ownership
 * manifest still hashes to what the journal said it staged.
 *
 * Before the commit point, recovery restores the last committed state rather
 * than finishing the new one. The rename that did not happen may have failed
 * for a reason that is still true, and the old state is the one somebody
 * already had. Only an activation that fully landed is completed.
 *
 * Anything the journal cannot account for stops recovery with
 * `"recovery-required"` and structured evidence, with nothing touched. There
 * is no age heuristic anywhere: an old transaction is not a dead one.
 */

import { lstat, readdir, readFile, realpath, rename, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MATERIALIZATION_MANIFEST_PATH } from "../compiler/paths.ts";
import { MaterializationError, type MaterializationEvidence } from "../errors.ts";
import { modDir } from "../stellaris/launcher/mod-directory.ts";
import { assertInstallDirName } from "./install.ts";
import type { DescriptorSnapshot } from "./receipt.ts";
import {
  claimRecovery,
  lockPathFor,
  processIsAlive,
  readJournal,
  recoveryRequired,
  type Journal,
  type JournalHeader,
  type JournalStaging,
  type MaterializationPhase,
} from "./transaction.ts";
import {
  observeDescriptor,
  withMaterializationLocks,
  type CleanupWarning,
  type MaterializationMode,
} from "./write.ts";

/** Sibling basename prefixes a materialization mints and then journals. */
const SIBLING_PREFIXES = [".pdx-staging-", ".pdx-previous-", ".pdx-descriptor-"];

export interface RecoveryAction {
  readonly kind: "removed" | "renamed" | "released-lock";
  readonly path: string;
  /** A rename's destination; absent for the other kinds. */
  readonly to?: string;
}

export interface RecoveryReport {
  /** The physical target the transaction was against. */
  readonly target: string;
  readonly outcome: "no-transaction" | "cleaned" | "restored-previous" | "completed-activation";
  /** How far the interrupted transaction got, when there was one. */
  readonly phase?: MaterializationPhase;
  readonly actions: readonly RecoveryAction[];
  /** Residue recovery found but has no authority to remove. */
  readonly warnings: readonly CleanupWarning[];
}

export interface RecoverInstallationOptions {
  /** The launcher's mod directory. Defaults to `stellaris.modDir()`. */
  readonly modDir?: string;
  /** The content folder's name inside it. */
  readonly dirName: string;
}

/** Recover an interrupted `write` or `replaceMaterialization` of `outDir`. */
export async function recoverMaterialization(outDir: string | URL): Promise<RecoveryReport> {
  return recoverTarget(await physicalTarget(outDir), []);
}

/**
 * Recover an interrupted `install`, from either half. The descriptor lock is
 * only a marker pointing at the content lock's journal, so both entry paths
 * reach the same account of the same transaction.
 */
export async function recoverInstallation(
  options: RecoverInstallationOptions
): Promise<RecoveryReport> {
  assertInstallDirName(options.dirName);
  const root = path.resolve(options.modDir ?? modDir());
  const target = await physicalTarget(path.join(root, options.dirName));
  const descriptorPath = path.join(path.dirname(target), `${options.dirName}.mod`);
  return recoverTarget(target, [lockPathFor(descriptorPath)]);
}

/** The physical target, without creating a parent recovery may not need. */
async function physicalTarget(target: string | URL): Promise<string> {
  const resolved = path.resolve(target instanceof URL ? fileURLToPath(target) : target);
  try {
    return path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return resolved;
    }
    throw error;
  }
}

/**
 * Recovery takes the same in-process lock a materialization does, so a build
 * and a recovery of one target in one process cannot interleave, and two
 * recoveries queue instead of arbitrating in the file. The lock file itself
 * stays where it is throughout: its presence is what keeps other processes
 * out while the target is being put back together, and it is unlinked last.
 */
async function recoverTarget(
  target: string,
  alternates: readonly string[]
): Promise<RecoveryReport> {
  return withMaterializationLocks([target], () => recoverUnlocked(target, alternates));
}

async function recoverUnlocked(
  target: string,
  alternates: readonly string[]
): Promise<RecoveryReport> {
  const found = await findJournal(target, alternates);
  if (found === undefined) {
    return freezeRecovery({
      target,
      outcome: "no-transaction",
      actions: [],
      warnings: await orphanWarnings(target, new Set()),
    });
  }
  const actions: RecoveryAction[] = [];
  if (found.journal === undefined) {
    // A marker whose primary journal is gone was written before anything
    // moved: the primary is always unlinked last.
    await unlink(found.lockPath);
    actions.push({ kind: "released-lock", path: found.lockPath });
    return freezeRecovery({
      target,
      outcome: "cleaned",
      actions,
      warnings: await orphanWarnings(target, new Set()),
    });
  }

  const journal = found.journal;
  const header = journal.header;
  if (header === undefined) {
    throw recoveryRequired(
      target,
      journal.path,
      `${journal.path} holds no readable transaction journal, so what it was doing cannot be told.`,
      undefined
    );
  }
  const lastPhase = journal.lastPhase ?? "inspecting";
  assertNotHeld(target, journal, header, lastPhase);
  const claim = await claimRecovery(journal.path, {
    pid: header.pid,
    startedAt: header.startedAt,
  });
  if (claim === "lost") {
    throw new MaterializationError(target, {
      reason: "busy",
      detail: `another recovery of ${target} is already running.`,
    });
  }
  if (claim === "gone") {
    // Another recovery finished this transaction between the read above and
    // the claim. Acting on the journal now would be acting on a description
    // of a state that has already been put right.
    return freezeRecovery({
      target,
      outcome: "no-transaction",
      actions: [],
      warnings: await orphanWarnings(target, new Set()),
    });
  }

  const outcome = await performRecovery(journal, header, actions);
  for (const lockPath of [header.secondaryLockPath, found.markerPath, journal.path]) {
    if (lockPath !== undefined && (await removeIfPresent(lockPath))) {
      actions.push({ kind: "released-lock", path: lockPath });
    }
  }
  return freezeRecovery({
    target: header.target,
    outcome,
    phase: lastPhase,
    actions,
    warnings: await orphanWarnings(header.target, journaledPaths(journal.staging)),
  });
}

interface FoundJournal {
  /** Undefined for a marker whose primary journal no longer exists. */
  readonly journal: Journal | undefined;
  readonly lockPath: string;
  /** The descriptor-side marker, when that is how the journal was reached. */
  readonly markerPath?: string;
}

async function findJournal(
  target: string,
  alternates: readonly string[]
): Promise<FoundJournal | undefined> {
  for (const candidate of [lockPathFor(target), ...alternates]) {
    const journal = await readJournal(candidate);
    if (journal === undefined) {
      continue;
    }
    if (journal.header !== undefined || journal.marker === undefined) {
      return { journal, lockPath: candidate };
    }
    const primary = await readJournal(journal.marker.primary);
    if (primary === undefined) {
      return { journal: undefined, lockPath: candidate };
    }
    return { journal: primary, lockPath: primary.path, markerPath: candidate };
  }
  return undefined;
}

/**
 * A transaction whose writer is still running is in progress, not broken, and
 * recovering it would delete the tree that writer is about to publish. A
 * journal from another machine is not decidable here at all: this host's pid
 * table says nothing about that one's.
 */
function assertNotHeld(
  target: string,
  journal: Journal,
  header: JournalHeader,
  lastPhase: MaterializationPhase
): void {
  if (lastPhase === "failed") {
    return;
  }
  if (header.hostname !== hostname()) {
    throw recoveryRequired(
      target,
      journal.path,
      `${journal.path} was written by ${header.hostname}, so this machine cannot tell whether ` +
        `process ${header.pid} is still running.`,
      lastPhase
    );
  }
  if (processIsAlive(header.pid)) {
    throw new MaterializationError(target, {
      reason: "busy",
      detail: `process ${header.pid} is still materializing ${target} (phase "${lastPhase}").`,
      holder: { pid: header.pid, startedAt: header.startedAt, phase: lastPhase },
    });
  }
}

type Goal = "none" | "clean" | "restore" | "complete";

/**
 * The row that applies, from the last phase the writer itself announced —
 * `failed` and `recovering` are excluded, because neither is progress and a
 * recovery that died must not change which row a later one reads.
 */
function progressPhase(journal: Journal): MaterializationPhase {
  let phase: MaterializationPhase = "inspecting";
  for (const record of journal.records) {
    if (record.record === "header" || record.record === "staging") {
      phase = record.phase;
    } else if (
      record.record === "phase" &&
      record.phase !== "recovering" &&
      record.phase !== "failed"
    ) {
      phase = record.phase;
    }
  }
  return phase;
}

function goalFor(
  phase: MaterializationPhase,
  mode: MaterializationMode,
  landed: {
    readonly targetIsNew: boolean;
    readonly descriptorIsNew: boolean;
    readonly staging: boolean;
  }
): Goal {
  switch (phase) {
    case "done":
      return "none";
    case "inspecting":
    case "staging":
    case "staged":
      return "clean";
    case "content-activating":
      // For a build this rename is the commit; for an install it is not, and
      // the pair is only consistent again once the descriptor follows it.
      return mode === "build" && !landed.staging && landed.targetIsNew ? "complete" : "restore";
    case "descriptor-activating":
      return landed.targetIsNew && landed.descriptorIsNew ? "complete" : "restore";
    case "committed":
      return "complete";
    default:
      return "restore";
  }
}

async function performRecovery(
  journal: Journal,
  header: JournalHeader,
  actions: RecoveryAction[]
): Promise<RecoveryReport["outcome"]> {
  const phase = progressPhase(journal);
  const staging = journal.staging;
  const remove = async (target: string): Promise<boolean> => {
    if (!(await removeIfPresent(target))) {
      return false;
    }
    actions.push({ kind: "removed", path: target });
    return true;
  };
  const move = async (from: string, to: string): Promise<void> => {
    await rename(from, to);
    actions.push({ kind: "renamed", path: from, to });
  };

  const goal = goalFor(phase, header.mode, {
    targetIsNew: (await manifestSha256(header.target)) === header.renderedSha256,
    descriptorIsNew: await descriptorIsNew(header),
    staging: staging !== undefined && (await present(staging.staging)),
  });
  if (goal === "none") {
    return "cleaned";
  }
  if (staging === undefined) {
    // Nothing was ever named, so nothing may be deleted; the lock goes and
    // the target is exactly as the interrupted writer found it.
    return "cleaned";
  }

  if (goal === "clean") {
    for (const leftover of [staging.previous, staging.descriptorPrevious]) {
      if (leftover !== undefined && (await present(leftover))) {
        throw refuse(
          journal,
          phase,
          `${leftover} exists, and at phase "${phase}" nothing had been set aside yet.`,
          [{ path: leftover, expected: "nothing set aside yet", observed: "a set-aside tree" }]
        );
      }
    }
    await remove(staging.staging);
    if (staging.descriptorStaging !== undefined) {
      await remove(staging.descriptorStaging);
    }
    return "cleaned";
  }

  if (goal === "complete") {
    await assertLanded(journal, header, phase);
    await remove(staging.staging);
    await remove(staging.previous);
    if (staging.descriptorStaging !== undefined) {
      await remove(staging.descriptorStaging);
    }
    if (staging.descriptorPrevious !== undefined) {
      await remove(staging.descriptorPrevious);
    }
    return "completed-activation";
  }

  const restoredContent = await restoreContent(journal, header, staging, phase, remove, move);
  const restoredDescriptor = await restoreDescriptor(journal, header, staging, phase, remove, move);
  await remove(staging.staging);
  if (staging.descriptorStaging !== undefined) {
    await remove(staging.descriptorStaging);
  }
  return restoredContent || restoredDescriptor ? "restored-previous" : "cleaned";
}

/** Put the content directory back the way the transaction found it. */
async function restoreContent(
  journal: Journal,
  header: JournalHeader,
  staging: JournalStaging,
  phase: MaterializationPhase,
  remove: (target: string) => Promise<boolean>,
  move: (from: string, to: string) => Promise<void>
): Promise<boolean> {
  const target = header.target;
  const targetPresent = await present(target);
  const previousPresent = await present(staging.previous);
  const targetSha = targetPresent ? await manifestSha256(target) : undefined;
  const targetIsNew = targetSha === header.renderedSha256;

  if (!staging.hadPrevious) {
    if (!targetPresent) {
      return false;
    }
    if (!targetIsNew) {
      throw refuse(
        journal,
        phase,
        `${target} exists, and the transaction that made it is not the one this journal describes.`,
        [
          {
            path: target,
            expected: `ownership manifest sha256 ${header.renderedSha256}`,
            observed: targetSha ?? "no readable ownership manifest",
          },
        ]
      );
    }
    await remove(target);
    return true;
  }

  if (!targetPresent) {
    if (!previousPresent) {
      throw refuse(journal, phase, `neither ${target} nor its set-aside copy exists.`, [
        { path: target, expected: "the previous output", observed: "nothing" },
        { path: staging.previous, expected: "the set-aside previous output", observed: "nothing" },
      ]);
    }
    await move(staging.previous, target);
    return true;
  }
  if (previousPresent) {
    if (!targetIsNew) {
      throw refuse(
        journal,
        phase,
        `${target} and its set-aside copy both exist, and ${target} is not the tree this ` +
          `transaction staged.`,
        [
          {
            path: target,
            expected: `ownership manifest sha256 ${header.renderedSha256}`,
            observed: targetSha ?? "no readable ownership manifest",
          },
        ]
      );
    }
    await remove(target);
    await move(staging.previous, target);
    return true;
  }
  if (targetIsNew && staging.previousManifestSha256 !== header.renderedSha256) {
    throw refuse(
      journal,
      phase,
      `${target} holds the tree this transaction staged and the previous output it replaced is gone.`,
      [
        {
          path: staging.previous,
          expected: "the set-aside previous output",
          observed: "nothing",
        },
      ]
    );
  }
  return false;
}

/** Put the launcher descriptor back the way the transaction found it. */
async function restoreDescriptor(
  journal: Journal,
  header: JournalHeader,
  staging: JournalStaging,
  phase: MaterializationPhase,
  remove: (target: string) => Promise<boolean>,
  move: (from: string, to: string) => Promise<void>
): Promise<boolean> {
  const descriptorPath = header.descriptorPath;
  const descriptorPrevious = staging.descriptorPrevious;
  if (descriptorPath === undefined || descriptorPrevious === undefined) {
    return false;
  }
  const observed: DescriptorSnapshot = staging.descriptorObserved ?? { state: "absent" };
  const current = await observeDescriptor(descriptorPath);
  const isObserved = sameDescriptorState(current, observed);
  const isNew = current.state === "file" && current.sha256 === header.descriptorSha256;

  if (await present(descriptorPrevious)) {
    if (current.state === "absent") {
      await move(descriptorPrevious, descriptorPath);
      return true;
    }
    if (isObserved) {
      // Already restored by an earlier recovery; the set-aside copy is a
      // journaled duplicate of a state that is back where it belongs.
      await remove(descriptorPrevious);
      return true;
    }
    if (isNew) {
      await remove(descriptorPath);
      await move(descriptorPrevious, descriptorPath);
      return true;
    }
    throw refuse(
      journal,
      phase,
      `${descriptorPath} is neither the descriptor this install observed nor the one it wrote.`,
      [
        {
          path: descriptorPath,
          expected: describeDescriptor(observed),
          observed: describeDescriptor(current),
        },
      ]
    );
  }

  if (isObserved) {
    return false;
  }
  if (isNew && observed.state === "absent") {
    await remove(descriptorPath);
    return true;
  }
  throw refuse(
    journal,
    phase,
    `${descriptorPath} cannot be put back: the descriptor this install observed is not there and ` +
      `no set-aside copy of it exists.`,
    [
      {
        path: descriptorPath,
        expected: describeDescriptor(observed),
        observed: describeDescriptor(current),
      },
    ]
  );
}

/** Both halves verifiably hold what the journal says was published. */
async function assertLanded(
  journal: Journal,
  header: JournalHeader,
  phase: MaterializationPhase
): Promise<void> {
  const targetSha = await manifestSha256(header.target);
  if (targetSha !== header.renderedSha256) {
    throw refuse(
      journal,
      phase,
      `${header.target} does not hold the tree this transaction staged.`,
      [
        {
          path: header.target,
          expected: `ownership manifest sha256 ${header.renderedSha256}`,
          observed: targetSha ?? "no readable ownership manifest",
        },
      ]
    );
  }
  if (header.descriptorPath === undefined) {
    return;
  }
  const current = await observeDescriptor(header.descriptorPath);
  if (current.state !== "file" || current.sha256 !== header.descriptorSha256) {
    throw refuse(
      journal,
      phase,
      `${header.descriptorPath} does not hold the descriptor this install wrote.`,
      [
        {
          path: header.descriptorPath,
          expected: `sha256 ${header.descriptorSha256}`,
          observed: describeDescriptor(current),
        },
      ]
    );
  }
}

async function descriptorIsNew(header: JournalHeader): Promise<boolean> {
  if (header.descriptorPath === undefined) {
    return false;
  }
  const current = await observeDescriptor(header.descriptorPath);
  return current.state === "file" && current.sha256 === header.descriptorSha256;
}

function sameDescriptorState(left: DescriptorSnapshot, right: DescriptorSnapshot): boolean {
  if (left.state !== right.state) {
    return false;
  }
  return left.state !== "file" || right.state !== "file"
    ? true
    : left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}

function describeDescriptor(snapshot: DescriptorSnapshot): string {
  return snapshot.state === "file" ? `sha256 ${snapshot.sha256}` : snapshot.state;
}

function refuse(
  journal: Journal,
  phase: MaterializationPhase,
  detail: string,
  evidence: readonly MaterializationEvidence[]
): MaterializationError {
  return recoveryRequired(
    journal.header?.target ?? journal.path,
    journal.path,
    `an interrupted materialization cannot be recovered automatically: ${detail}`,
    phase,
    evidence
  );
}

/** The ownership manifest's own hash, or nothing readable at all. */
async function manifestSha256(target: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(target, MATERIALIZATION_MANIFEST_PATH), "utf8")
    ) as Record<string, unknown>;
    return typeof parsed["sha256"] === "string" ? parsed["sha256"] : undefined;
  } catch {
    return undefined;
  }
}

async function present(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeIfPresent(target: string): Promise<boolean> {
  if (!(await present(target))) {
    return false;
  }
  await rm(target, { recursive: true, force: true });
  return true;
}

function journaledPaths(staging: JournalStaging | undefined): ReadonlySet<string> {
  if (staging === undefined) {
    return new Set();
  }
  return new Set(
    [
      staging.staging,
      staging.previous,
      staging.descriptorStaging,
      staging.descriptorPrevious,
    ].filter((value): value is string => value !== undefined)
  );
}

/**
 * Siblings that look like materialization residue and that no journal names.
 * They are reported and never removed: an unexplained directory is somebody
 * else's until a journal says otherwise.
 */
async function orphanWarnings(
  target: string,
  journaled: ReadonlySet<string>
): Promise<readonly CleanupWarning[]> {
  const parent = path.dirname(target);
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch {
    return [];
  }
  const warnings: CleanupWarning[] = [];
  for (const name of entries.sort()) {
    if (!SIBLING_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      continue;
    }
    const absolute = path.join(parent, name);
    if (journaled.has(absolute)) {
      continue;
    }
    warnings.push({
      path: absolute,
      message:
        "materialization residue no transaction journal names; recovery left it alone. Remove it by hand once you know what it is.",
    });
  }
  return warnings;
}

function freezeRecovery(report: RecoveryReport): RecoveryReport {
  return Object.freeze({
    ...report,
    actions: Object.freeze(report.actions.map((action) => Object.freeze({ ...action }))),
    warnings: Object.freeze(report.warnings.map((warning) => Object.freeze({ ...warning }))),
  });
}
