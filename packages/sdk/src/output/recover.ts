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

import type { Stats } from "node:fs";
import { readdir, readlink, rename, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

import { MATERIALIZATION_MANIFEST_PATH } from "../compiler/paths.ts";
import { MaterializationError, type MaterializationEvidence } from "../errors.ts";
import { modDir } from "../installation/launcher/mod-directory.ts";
import { assertInstallDirName } from "./install.ts";
import {
  progressPhase,
  recoveryGoal,
  type Journal,
  type JournalHeader,
  type JournalStaging,
  type MaterializationPhase,
} from "./journal.ts";
import {
  isLockSibling,
  isMintedSibling,
  journaledSiblings,
  LOCK_BASENAME_PREFIX,
  lockPathFor,
  physicalTarget,
  SIBLING_PREFIXES,
  type SiblingRole,
} from "./layout.ts";
import { readOwnershipManifest, type MaterializationManifest } from "./manifest.ts";
import type { DescriptorSnapshot } from "./receipt.ts";
import {
  claimRecovery,
  describeReadFailure,
  processIsAlive,
  recoveryRequired,
  tryReadJournal,
} from "./transaction.ts";
import {
  fileSha256,
  lstatOrUndefined,
  OS_METADATA_BASENAMES,
  present,
  walkVerified,
  type TreeEntry,
} from "./tree.ts";
import { observeDescriptor, withMaterializationLocks, type CleanupWarning } from "./write.ts";

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
  assertJournalDescribes(target, journal, header);
  assertNotHeld(target, journal, header, lastPhase);
  const claim = await claimRecovery(target, journal.path, {
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

  // Decided in full before any of it happens, so a refusal is always about
  // the tree as it was found rather than one this recovery half-changed.
  const plan = await planRecovery(journal, header);
  const warnings: CleanupWarning[] = [];
  const outcome = await executePlan(plan, actions, warnings);
  for (const lockPath of [header.secondaryLockPath, found.markerPath, journal.path]) {
    if (lockPath !== undefined && (await removeIfPresent(lockPath))) {
      actions.push({ kind: "released-lock", path: lockPath });
    }
  }
  const journaled = journal.staging === undefined ? [] : journaledSiblings(journal.staging);
  return freezeRecovery({
    target: header.target,
    outcome,
    phase: lastPhase,
    actions,
    warnings: [...warnings, ...(await orphanWarnings(header.target, new Set(journaled)))],
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
    const found = await readOrRefuse(target, candidate);
    if (found === undefined) {
      continue;
    }
    if (found.header !== undefined || found.marker === undefined) {
      return { journal: found, lockPath: candidate };
    }
    const primary = await readOrRefuse(target, found.marker.primary);
    if (primary === undefined) {
      return { journal: undefined, lockPath: candidate };
    }
    return { journal: primary, lockPath: primary.path, markerPath: candidate };
  }
  return undefined;
}

/**
 * A lock that exists and cannot be read is evidence, not an errno. Recovery
 * is the operation somebody reaches for when a target is already wrong, so
 * "EISDIR" with no path in it is the least useful thing it could say.
 */
async function readOrRefuse(target: string, lockPath: string): Promise<Journal | undefined> {
  const read = await tryReadJournal(lockPath);
  if (read.ok) {
    return read.journal;
  }
  throw recoveryRequired(
    target,
    lockPath,
    `${lockPath} exists and could not be read (${describeReadFailure(read.error)}).`,
    undefined
  );
}

/**
 * Whether the journal describes the target the caller asked about, and names
 * only paths a materialization of that target could have minted.
 *
 * The journal is a file in the directory it protects, so it is only as
 * trustworthy as that directory: anyone who can write there can write a
 * journal too. What keeps that from turning recovery into a delete-anything
 * primitive is that a journal may only name its own siblings — the target
 * itself, and names of the exact shapes materialization mints beside it. A
 * journal pointing somewhere else is not a transaction this operation can
 * finish; it is refused whole, and nothing on either side is touched.
 */
function assertJournalDescribes(target: string, journal: Journal, header: JournalHeader): void {
  const evidence: MaterializationEvidence[] = [];
  if (header.target !== target) {
    evidence.push({
      path: header.target,
      expected: `a transaction against ${target}`,
      observed: `a journal against ${header.target}`,
    });
  }
  const parent = path.dirname(target);
  const minted = (candidate: string | undefined, role: SiblingRole): void => {
    if (candidate === undefined || isMintedSibling(candidate, parent, role)) {
      return;
    }
    evidence.push({
      path: candidate,
      expected: `${parent}/${SIBLING_PREFIXES[role]}<uuid>`,
      observed: candidate,
    });
  };
  const lock = (candidate: string | undefined): void => {
    if (candidate === undefined || isLockSibling(candidate, parent)) {
      return;
    }
    evidence.push({
      path: candidate,
      expected: `${parent}/${LOCK_BASENAME_PREFIX}…`,
      observed: candidate,
    });
  };

  lock(journal.path);
  lock(header.secondaryLockPath);
  if (header.descriptorPath !== undefined && path.dirname(header.descriptorPath) !== parent) {
    evidence.push({
      path: header.descriptorPath,
      expected: `a launcher descriptor beside ${target}`,
      observed: header.descriptorPath,
    });
  }
  const staging = journal.staging;
  if (staging !== undefined) {
    minted(staging.staging, "staging");
    minted(staging.previous, "previous");
    minted(staging.descriptorStaging, "descriptorStaging");
    minted(staging.descriptorPrevious, "descriptorPrevious");
  }

  if (evidence.length > 0) {
    throw recoveryRequired(
      target,
      journal.path,
      `${journal.path} names ${evidence.length} path${evidence.length === 1 ? "" : "s"} that no ` +
        `materialization of ${target} could have created, so it is not a transaction this ` +
        `recovery may act on.`,
      journal.lastPhase,
      evidence
    );
  }
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

/**
 * What recovery intends to do, decided before it does any of it.
 *
 * `required` marks a removal something later in the list depends on — the new
 * target that has to go before the set-aside copy can be renamed back into
 * its place. Everything else is cleanup, where a removal that fails is a
 * warning rather than the end of the recovery.
 */
type PlannedAction =
  | { readonly kind: "remove"; readonly path: string; readonly required: boolean }
  | { readonly kind: "rename"; readonly path: string; readonly to: string };

interface RecoveryPlan {
  readonly outcome: RecoveryReport["outcome"];
  readonly actions: readonly PlannedAction[];
}

/**
 * Both halves are planned before either is touched.
 *
 * An install is one materialization in two renames, so its recovery is one
 * decision about a pair. Deciding the content half, acting on it, and only
 * then discovering the descriptor half is unaccountable would leave a target
 * that is neither what recovery found nor what it meant to produce — and the
 * refusal would be reporting a state it had itself half-changed. Planning
 * dry means a refusal is always about the tree exactly as it was found.
 */
async function planRecovery(journal: Journal, header: JournalHeader): Promise<RecoveryPlan> {
  const staging = journal.staging;
  if (staging === undefined) {
    // Nothing was ever named, so nothing may be deleted — and nothing about
    // the target is this recovery's to judge either: a transaction that never
    // named a sibling never had authority over anything here, so a target it
    // only looked at is not evidence it has to be able to read. The lock
    // goes, and the target is exactly as the interrupted writer found it.
    return { outcome: "cleaned", actions: [] };
  }
  const phase = progressPhase(journal);
  const goal = recoveryGoal(phase, header.mode, {
    targetIsNew:
      (await ownershipManifest(journal, phase, header.target))?.sha256 === header.renderedSha256,
    descriptorIsNew: await descriptorIsNew(header),
    staging: await present(staging.staging),
  });
  const leftovers = journaledSiblings(staging);

  if (goal === "none") {
    // "done" says the commit and the cleanup both happened, so what the
    // journal names is this transaction's own residue. What proves that is
    // the target, not the record: over a target that never took the new tree,
    // the same record would have recovery delete the set-aside copy of the
    // only output there is.
    await assertLanded(journal, header, phase);
    return { outcome: "cleaned", actions: await plannedRemovals(leftovers) };
  }

  if (goal === "clean") {
    for (const setAside of [staging.previous, staging.descriptorPrevious]) {
      if (setAside !== undefined && (await present(setAside))) {
        throw refuse(
          journal,
          phase,
          `${setAside} exists, and at phase "${phase}" nothing had been set aside yet.`,
          [{ path: setAside, expected: "nothing set aside yet", observed: "a set-aside tree" }]
        );
      }
    }
    return {
      outcome: "cleaned",
      actions: await plannedRemovals([staging.staging, staging.descriptorStaging]),
    };
  }

  if (goal === "complete") {
    await assertLanded(journal, header, phase);
    return { outcome: "completed-activation", actions: await plannedRemovals(leftovers) };
  }

  const content = await planContentRestore(journal, header, staging, phase);
  const descriptor = await planDescriptorRestore(journal, header, staging, phase);
  return {
    outcome: content.restored || descriptor.restored ? "restored-previous" : "cleaned",
    actions: [
      ...content.actions,
      ...descriptor.actions,
      ...(await plannedRemovals([staging.staging, staging.descriptorStaging])),
    ],
  };
}

/** Cleanup removals, for the journal-named paths that are actually there. */
async function plannedRemovals(
  candidates: readonly (string | undefined)[]
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  for (const candidate of candidates) {
    if (candidate !== undefined && (await present(candidate))) {
      actions.push({ kind: "remove", path: candidate, required: false });
    }
  }
  return actions;
}

async function executePlan(
  plan: RecoveryPlan,
  actions: RecoveryAction[],
  warnings: CleanupWarning[]
): Promise<RecoveryReport["outcome"]> {
  for (const action of plan.actions) {
    if (action.kind === "rename") {
      await rename(action.path, action.to);
      actions.push({ kind: "renamed", path: action.path, to: action.to });
      continue;
    }
    try {
      if (await removeIfPresent(action.path)) {
        actions.push({ kind: "removed", path: action.path });
      }
    } catch (error) {
      if (action.required) {
        throw error;
      }
      // Cleanup only. The tree is already back to a state somebody can use,
      // and a leftover nobody could remove is news rather than a failure.
      warnings.push({
        path: action.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return plan.outcome;
}

/** What one half of a restore intends to do, and whether it undoes anything. */
interface PlannedHalf {
  readonly actions: readonly PlannedAction[];
  readonly restored: boolean;
}

/** Put the content directory back the way the transaction found it. */
async function planContentRestore(
  journal: Journal,
  header: JournalHeader,
  staging: JournalStaging,
  phase: MaterializationPhase
): Promise<PlannedHalf> {
  const target = header.target;
  const targetPresent = await present(target);
  const previousPresent = await present(staging.previous);
  const targetSha = targetPresent
    ? (await ownershipManifest(journal, phase, target))?.sha256
    : undefined;
  const targetIsNew = targetSha === header.renderedSha256;
  const notStaged = (): MaterializationError =>
    refuse(journal, phase, `${target} is not the tree this transaction staged.`, [
      {
        path: target,
        expected: `ownership manifest sha256 ${header.renderedSha256}`,
        observed: targetSha ?? "no readable ownership manifest",
      },
    ]);

  if (!staging.hadPrevious) {
    if (!targetPresent) {
      return { actions: [], restored: false };
    }
    if (!targetIsNew) {
      throw notStaged();
    }
    await assertOnlyStagedContent(journal, header, phase, undefined);
    return { actions: [{ kind: "remove", path: target, required: true }], restored: true };
  }

  if (!targetPresent) {
    if (!previousPresent) {
      throw refuse(journal, phase, `neither ${target} nor its set-aside copy exists.`, [
        { path: target, expected: "the previous output", observed: "nothing" },
        { path: staging.previous, expected: "the set-aside previous output", observed: "nothing" },
      ]);
    }
    return {
      actions: [{ kind: "rename", path: staging.previous, to: target }],
      restored: true,
    };
  }
  if (previousPresent) {
    if (!targetIsNew) {
      throw notStaged();
    }
    await assertOnlyStagedContent(journal, header, phase, staging.previous);
    return {
      actions: [
        { kind: "remove", path: target, required: true },
        { kind: "rename", path: staging.previous, to: target },
      ],
      restored: true,
    };
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
  return { actions: [], restored: false };
}

/**
 * Whether the tree about to be deleted is only what the transaction put there.
 *
 * The ownership manifest's own hash says which render was staged; it says
 * nothing about what happened to the tree afterwards. Between the crash and
 * the recovery somebody may have opened the half-published output and changed
 * it, and that edit exists nowhere else. So every owned file is compared byte
 * for byte before the delete, and anything the manifest does not list has to
 * account for itself: OS metadata, or an entry preserved from the previous
 * generation, which is the same inode as its counterpart there and so loses
 * nothing when this link goes. Anything else refuses.
 */
async function assertOnlyStagedContent(
  journal: Journal,
  header: JournalHeader,
  phase: MaterializationPhase,
  previous: string | undefined
): Promise<void> {
  const target = header.target;
  const manifest = await ownershipManifest(journal, phase, target);
  if (manifest === undefined) {
    throw refuse(journal, phase, `${target} has no readable ownership manifest to check against.`, [
      {
        path: path.join(target, MATERIALIZATION_MANIFEST_PATH),
        expected: "the ownership manifest this transaction wrote",
        observed: "nothing readable",
      },
    ]);
  }

  const evidence: MaterializationEvidence[] = [];
  const owned = new Map(manifest.files.map((file) => [file.path, file]));
  for (const [relPath, file] of owned) {
    const absolute = path.join(target, ...relPath.split("/"));
    const found = await fileSha256(absolute);
    if (found !== file.sha256) {
      evidence.push({
        path: absolute,
        expected: `sha256 ${file.sha256}`,
        observed: found ?? "missing, or not a readable regular file",
      });
    }
  }

  evidence.push(
    ...(await unaccountedEntries(journal, phase, target, new Set(owned.keys()), previous))
  );

  if (evidence.length > 0) {
    throw refuse(
      journal,
      phase,
      `${target} holds ${evidence.length} entr${evidence.length === 1 ? "y" : "ies"} that this ` +
        `transaction did not put there, so it cannot be removed to put the previous output back.`,
      evidence
    );
  }
}

/**
 * Every entry in the target that the transaction did not put there, as the
 * evidence a refusal carries.
 *
 * The tree is about to be deleted, so a traversal that cannot finish is a
 * refusal of its own: a directory that would not open may hold the only copy
 * of something, and an empty answer would read as a tree with nothing in it.
 */
async function unaccountedEntries(
  journal: Journal,
  phase: MaterializationPhase,
  target: string,
  ownedPaths: ReadonlySet<string>,
  previous: string | undefined
): Promise<MaterializationEvidence[]> {
  const evidence: MaterializationEvidence[] = [];
  try {
    for (const entry of await walkVerified(target)) {
      const stats = entry.stats;
      // Read from its directory and gone by the time it was stat'd: there is
      // nothing left at that name for the delete to lose.
      if (stats === undefined) {
        continue;
      }
      if (entry.relPath === MATERIALIZATION_MANIFEST_PATH || ownedPaths.has(entry.relPath)) {
        continue;
      }
      if (OS_METADATA_BASENAMES.has(entry.relPath.slice(entry.relPath.lastIndexOf("/") + 1))) {
        continue;
      }
      if (
        stats.isDirectory() &&
        [...ownedPaths].some((relPath) => relPath.startsWith(`${entry.relPath}/`))
      ) {
        continue;
      }
      if (previous !== undefined && (await isPreservedCounterpart(entry, stats, previous))) {
        continue;
      }
      evidence.push({
        path: entry.absolute,
        expected: "an entry this transaction staged, or one preserved from the previous output",
        observed: "an entry that exists nowhere else, so deleting it would lose it",
      });
    }
  } catch (error) {
    if (!isFilesystemFailure(error)) {
      throw error;
    }
    throw refuse(
      journal,
      phase,
      `${target} could not be read in full, so what it holds cannot be told.`,
      [
        {
          path: (error as NodeJS.ErrnoException).path ?? target,
          expected: "a readable tree",
          observed: error instanceof Error ? error.message : String(error),
        },
      ]
    );
  }
  return evidence;
}

/** A refusal or an errno from the filesystem, rather than a fault in this code. */
function isFilesystemFailure(error: unknown): boolean {
  return (
    error instanceof MaterializationError ||
    (error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string")
  );
}

/** Whether an entry is the same file as its counterpart in the previous tree. */
async function isPreservedCounterpart(
  entry: TreeEntry,
  stats: Stats,
  previous: string
): Promise<boolean> {
  const counterpart = path.join(previous, ...entry.relPath.split("/"));
  const found = await lstatOrUndefined(counterpart);
  if (found === undefined) {
    return false;
  }
  if (stats.isDirectory()) {
    // Directories are recreated in staging rather than linked, so identity
    // cannot be the test; that the previous tree has one here is.
    return found.isDirectory();
  }
  return found.dev === stats.dev && found.ino === stats.ino;
}

/** Put the launcher descriptor back the way the transaction found it. */
async function planDescriptorRestore(
  journal: Journal,
  header: JournalHeader,
  staging: JournalStaging,
  phase: MaterializationPhase
): Promise<PlannedHalf> {
  const descriptorPath = header.descriptorPath;
  const descriptorPrevious = staging.descriptorPrevious;
  if (descriptorPath === undefined || descriptorPrevious === undefined) {
    return { actions: [], restored: false };
  }
  const observed: DescriptorSnapshot = staging.descriptorObserved ?? { state: "absent" };
  const current = await observeDescriptor(descriptorPath);
  const isNew = current.state === "file" && current.sha256 === header.descriptorSha256;
  const mismatch = (): MaterializationError =>
    refuse(
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

  if (await present(descriptorPrevious)) {
    if (current.state === "absent") {
      return {
        actions: [{ kind: "rename", path: descriptorPrevious, to: descriptorPath }],
        restored: true,
      };
    }
    // The set-aside copy is about to be discarded, so "the same state" has to
    // mean the same descriptor and not merely the same word for its kind.
    if (await isRestoredCopy(current, observed, descriptorPath, descriptorPrevious)) {
      return {
        actions: [{ kind: "remove", path: descriptorPrevious, required: false }],
        restored: true,
      };
    }
    if (isNew) {
      return {
        actions: [
          { kind: "remove", path: descriptorPath, required: true },
          { kind: "rename", path: descriptorPrevious, to: descriptorPath },
        ],
        restored: true,
      };
    }
    throw mismatch();
  }

  // Nothing is discarded on this side, so a state-only match is enough: the
  // descriptor that is there is left exactly as it is.
  if (sameDescriptorState(current, observed)) {
    return { actions: [], restored: false };
  }
  if (isNew && observed.state === "absent") {
    return {
      actions: [{ kind: "remove", path: descriptorPath, required: true }],
      restored: true,
    };
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

/**
 * Whether the descriptor in place is already the one that was set aside, to
 * the point that the set-aside copy can be thrown away.
 *
 * A file answers by its hash. A symlink does not: two symlinks are both "a
 * symlink" and may point at completely different things, and discarding the
 * set-aside copy on that basis would destroy the only record of where the
 * author's link pointed. So symlinks are compared by referent, and `other` —
 * a directory, a device, whatever the snapshot could not describe — can never
 * be compared at all, and never authorizes the discard.
 */
async function isRestoredCopy(
  current: DescriptorSnapshot,
  observed: DescriptorSnapshot,
  descriptorPath: string,
  descriptorPrevious: string
): Promise<boolean> {
  if (current.state !== observed.state) {
    return false;
  }
  if (current.state === "file") {
    return sameDescriptorState(current, observed);
  }
  if (current.state !== "symlink") {
    return false;
  }
  try {
    return (await readlink(descriptorPath)) === (await readlink(descriptorPrevious));
  } catch {
    return false;
  }
}

/** Both halves verifiably hold what the journal says was published. */
async function assertLanded(
  journal: Journal,
  header: JournalHeader,
  phase: MaterializationPhase
): Promise<void> {
  const targetSha = (await ownershipManifest(journal, phase, header.target))?.sha256;
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

/**
 * The ownership manifest of the tree at `target`, or nothing when it has none.
 *
 * A manifest that is there and cannot be decoded refuses instead. Recovery
 * decides what to delete from this file, so "no claim on this tree" and "the
 * claim could not be read" must not arrive as the same answer.
 */
async function ownershipManifest(
  journal: Journal,
  phase: MaterializationPhase,
  target: string
): Promise<MaterializationManifest | undefined> {
  const read = await readOwnershipManifest(target);
  if (read.state === "unreadable") {
    throw refuse(journal, phase, `${target} holds an ownership manifest that cannot be read.`, [
      {
        path: path.join(target, MATERIALIZATION_MANIFEST_PATH),
        expected: "the ownership manifest this transaction wrote",
        observed: read.problem,
      },
    ]);
  }
  return read.state === "manifest" ? read.manifest : undefined;
}

async function removeIfPresent(target: string): Promise<boolean> {
  if (!(await present(target))) {
    return false;
  }
  await rm(target, { recursive: true, force: true });
  return true;
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
    // The only thing lost is a report about paths recovery may not touch
    // anyway, so a parent that will not open is not worth failing a recovery
    // that has already put the target right.
    return [];
  }
  const prefixes = Object.values(SIBLING_PREFIXES);
  const warnings: CleanupWarning[] = [];
  for (const name of entries.sort()) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) {
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
