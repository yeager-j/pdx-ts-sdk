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

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readdir, readFile, readlink, realpath, rename, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MATERIALIZATION_MANIFEST_PATH } from "../compiler/paths.ts";
import { MaterializationError, type MaterializationEvidence } from "../errors.ts";
import { modDir } from "../stellaris/launcher/mod-directory.ts";
import { assertInstallDirName } from "./install.ts";
import type { Journal, JournalHeader, JournalStaging, MaterializationPhase } from "./journal.ts";
import type { DescriptorSnapshot } from "./receipt.ts";
import {
  claimRecovery,
  describeReadFailure,
  LOCK_BASENAME_PREFIX,
  lockPathFor,
  processIsAlive,
  recoveryRequired,
  tryReadJournal,
} from "./transaction.ts";
import {
  observeDescriptor,
  withMaterializationLocks,
  type CleanupWarning,
  type MaterializationManifest,
  type MaterializationMode,
} from "./write.ts";

/** Sibling basename prefixes a materialization mints and then journals. */
const SIBLING_PREFIXES = [".pdx-staging-", ".pdx-previous-", ".pdx-descriptor-"];

/** The UUID a sibling name ends in, so a name cannot be anything at all. */
const UUID_SUFFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Basenames the operating system writes on its own. They are foreign entries
 * like any other, and the one place recovery has to name them is here: a
 * `.DS_Store` a Finder window dropped into a half-activated tree must not be
 * what makes that tree unaccountable.
 */
const OS_METADATA_BASENAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

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
  return freezeRecovery({
    target: header.target,
    outcome,
    phase: lastPhase,
    actions,
    warnings: [
      ...warnings,
      ...(await orphanWarnings(header.target, journaledPaths(journal.staging))),
    ],
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
  const sibling = (candidate: string | undefined, prefix: string, uuid: boolean): void => {
    if (candidate === undefined) {
      return;
    }
    const basename = path.basename(candidate);
    const suffix = basename.slice(prefix.length);
    const legal =
      path.dirname(candidate) === parent &&
      basename.startsWith(prefix) &&
      (!uuid || UUID_SUFFIX.test(suffix));
    if (!legal) {
      evidence.push({
        path: candidate,
        expected: `${parent}/${prefix}${uuid ? "<uuid>" : "…"}`,
        observed: candidate,
      });
    }
  };

  sibling(journal.path, LOCK_BASENAME_PREFIX, false);
  sibling(header.secondaryLockPath, LOCK_BASENAME_PREFIX, false);
  if (header.descriptorPath !== undefined && path.dirname(header.descriptorPath) !== parent) {
    evidence.push({
      path: header.descriptorPath,
      expected: `a launcher descriptor beside ${target}`,
      observed: header.descriptorPath,
    });
  }
  const staging = journal.staging;
  if (staging !== undefined) {
    sibling(staging.staging, ".pdx-staging-", true);
    sibling(staging.previous, ".pdx-previous-", true);
    sibling(staging.descriptorStaging, ".pdx-descriptor-staging-", true);
    sibling(staging.descriptorPrevious, ".pdx-descriptor-previous-", true);
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
  const phase = progressPhase(journal);
  const staging = journal.staging;
  const goal = goalFor(phase, header.mode, {
    targetIsNew: (await manifestSha256(header.target)) === header.renderedSha256,
    descriptorIsNew: await descriptorIsNew(header),
    staging: staging !== undefined && (await present(staging.staging)),
  });
  if (staging === undefined) {
    // Nothing was ever named, so nothing may be deleted; the lock goes and
    // the target is exactly as the interrupted writer found it.
    return { outcome: "cleaned", actions: [] };
  }
  const leftovers = [
    staging.staging,
    staging.previous,
    staging.descriptorStaging,
    staging.descriptorPrevious,
  ].filter((candidate): candidate is string => candidate !== undefined);

  if (goal === "none") {
    // The transaction committed and finished; only its own residue can still
    // be here, and it is journal-named, so removing it needs no other proof.
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
  const targetSha = targetPresent ? await manifestSha256(target) : undefined;
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
  const manifest = await readOwnershipManifest(target);
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

  for (const entry of await walkTree(target)) {
    if (entry.relPath === MATERIALIZATION_MANIFEST_PATH || owned.has(entry.relPath)) {
      continue;
    }
    if (OS_METADATA_BASENAMES.has(entry.relPath.slice(entry.relPath.lastIndexOf("/") + 1))) {
      continue;
    }
    if (
      entry.directory &&
      [...owned.keys()].some((relPath) => relPath.startsWith(`${entry.relPath}/`))
    ) {
      continue;
    }
    if (previous !== undefined && (await isPreservedCounterpart(entry, previous))) {
      continue;
    }
    evidence.push({
      path: path.join(target, ...entry.relPath.split("/")),
      expected: "an entry this transaction staged, or one preserved from the previous output",
      observed: "an entry that exists nowhere else, so deleting it would lose it",
    });
  }

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

/** Whether an entry is the same file as its counterpart in the previous tree. */
async function isPreservedCounterpart(entry: TreeEntry, previous: string): Promise<boolean> {
  const counterpart = path.join(previous, ...entry.relPath.split("/"));
  const stats = await lstatOrUndefined(counterpart);
  if (stats === undefined) {
    return false;
  }
  if (entry.directory) {
    // Directories are recreated in staging rather than linked, so identity
    // cannot be the test; that the previous tree has one here is.
    return stats.isDirectory();
  }
  return stats.dev === entry.dev && stats.ino === entry.ino;
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
  return (await readOwnershipManifest(target))?.sha256;
}

/** One target's ownership manifest, if it has a well-formed one. */
async function readOwnershipManifest(target: string): Promise<MaterializationManifest | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(target, MATERIALIZATION_MANIFEST_PATH), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const manifest = parsed as Record<string, unknown>;
  if (typeof manifest["sha256"] !== "string" || !Array.isArray(manifest["files"])) {
    return undefined;
  }
  const wellFormed = manifest["files"].every(
    (file) =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as Record<string, unknown>)["path"] === "string" &&
      typeof (file as Record<string, unknown>)["sha256"] === "string"
  );
  return wellFormed ? (parsed as MaterializationManifest) : undefined;
}

async function fileSha256(target: string): Promise<string | undefined> {
  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return undefined;
    }
    return createHash("sha256")
      .update(await readFile(target))
      .digest("hex");
  } catch {
    return undefined;
  }
}

/** One entry of a target tree, by relative path and stat identity. */
interface TreeEntry {
  readonly relPath: string;
  readonly directory: boolean;
  readonly dev: number;
  readonly ino: number;
}

/** Every entry under `target`, no-follow, ordered parents before children. */
async function walkTree(target: string): Promise<TreeEntry[]> {
  const found: TreeEntry[] = [];
  const walk = async (relative: string): Promise<void> => {
    const dir = relative === "" ? target : path.join(target, ...relative.split("/"));
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const stats = await lstatOrUndefined(path.join(dir, entry.name));
      if (stats === undefined) {
        continue;
      }
      const directory = stats.isDirectory();
      found.push({ relPath, directory, dev: stats.dev, ino: stats.ino });
      if (directory) {
        await walk(relPath);
      }
    }
  };
  await walk("");
  return found;
}

async function lstatOrUndefined(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
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
