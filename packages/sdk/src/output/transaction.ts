/**
 * The materialization transaction: one exclusive sibling lock file that is
 * also the journal of what the writer was about to do next.
 *
 * One file rather than two, because a lock without a journal cannot say what
 * an interrupted writer left behind, and a journal without a lock is not
 * proof that only one writer is producing it. The name derives from the
 * target's raw basename so two spellings of one physical target — a case
 * variant, a decomposed Unicode form — converge on one inode instead of two
 * locks that do not see each other.
 *
 * Every record is appended and fsynced before the action it announces, so the
 * journal is always at least as far along as the disk. A writer killed
 * mid-append leaves valid earlier records plus a partial tail, which readers
 * ignore. Nothing here decides anything from how old a lock is: a crashed
 * transaction is recognized by a dead pid or a `failed` record, never by age.
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

import { MaterializationError, type MaterializationLockHolder } from "../errors.ts";
import { compareUtf8 } from "../ordering.ts";
import {
  JOURNAL_VERSION,
  JournalFormatError,
  parseJournal,
  type Journal,
  type JournalHeader,
  type JournalMarker,
  type JournalPhase,
  type JournalRecord,
  type JournalStaging,
  type MaterializationPhase,
} from "./journal.ts";
import { _materializationTestPoint } from "./test-hooks.ts";
import type { MaterializationMode } from "./write.ts";

/** The lock file's basename prefix, a sibling like `.pdx-staging-*` is. */
export const LOCK_BASENAME_PREFIX = ".pdx-lock-";

export function lockPathFor(target: string): string {
  return path.join(path.dirname(target), LOCK_BASENAME_PREFIX + path.basename(target));
}

/** Whether a pid names a running process, counting "not mine" as running. */
export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is a process this user may not signal — alive, and not ours.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readJournal(lockPath: string): Promise<Journal | undefined> {
  const read = await tryReadJournal(lockPath);
  if (!read.ok) {
    throw read.error;
  }
  return read.journal;
}

/**
 * A journal read that reports why it failed instead of throwing.
 *
 * A lock that cannot be read at all is a refusal with a path in it, not a
 * stray errno: a directory or a root-owned file sitting where the lock goes
 * is exactly the kind of thing somebody has to look at, and `EISDIR` on its
 * own does not say which file, or what the caller was trying to do.
 */
export type JournalRead =
  | { readonly ok: true; readonly journal: Journal | undefined }
  | { readonly ok: false; readonly error: Error };

export async function tryReadJournal(lockPath: string): Promise<JournalRead> {
  try {
    return { ok: true, journal: parseJournal(lockPath, await readFile(lockPath, "utf8")) };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === "ENOENT") {
      return { ok: true, journal: undefined };
    }
    return { ok: false, error: failure };
  }
}

/**
 * Why a lock file could not be read, for a refusal message. A file that is
 * not a journal already says which record and which rule, so it is quoted
 * whole; anything else is an errno, which needs the caller's path around it.
 */
export function describeReadFailure(error: Error): string {
  if (error instanceof JournalFormatError) {
    return error.message;
  }
  return (error as NodeJS.ErrnoException).code ?? error.message;
}

/**
 * What a step that only announces its own intent needs from a transaction.
 * The activation renames take this rather than the whole transaction so they
 * cannot decide how it ends: disposition belongs to the sink that knows every
 * path the failure could have left behind.
 */
export interface MaterializationJournal {
  record(phase: MaterializationPhase, detail?: string): Promise<void>;
}

/** What a writer needs before it can open a transaction on a target. */
export interface TransactionRequest {
  /** The canonical physical target this lock protects. */
  readonly target: string;
  readonly mode: MaterializationMode;
  readonly prefix: string;
  readonly renderedSha256: string;
  /** Install mode only: the descriptor half, locked in the same transaction. */
  readonly descriptor?: {
    readonly path: string;
    readonly sha256: string;
    readonly byteLength: number;
  };
}

/**
 * One held transaction: the primary lock on the content target, plus the
 * descriptor marker lock when there is one. Disposal is idempotent, so a step
 * that already decided how the transaction ends is never undone by the
 * catch-all above it.
 */
export class MaterializationTransaction {
  readonly target: string;
  readonly journalPath: string;

  #primary: FileHandle | undefined;
  #secondary: { readonly path: string; readonly handle: FileHandle } | undefined;
  #disposed = false;

  constructor(
    target: string,
    journalPath: string,
    primary: FileHandle,
    secondary?: { readonly path: string; readonly handle: FileHandle }
  ) {
    this.target = target;
    this.journalPath = journalPath;
    this.#primary = primary;
    this.#secondary = secondary;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async record(phase: MaterializationPhase, detail?: string): Promise<void> {
    await this.#append({
      record: "phase",
      phase,
      at: new Date().toISOString(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  async journalStaging(staging: Omit<JournalStaging, "record" | "phase" | "at">): Promise<void> {
    await this.#append({
      record: "staging",
      phase: "staging",
      at: new Date().toISOString(),
      ...staging,
    });
  }

  /** The transaction ended with nothing of its own left on disk. */
  async releaseClean(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    // The secondary goes first so a reader following a marker never finds one
    // pointing at a journal that has already gone.
    if (this.#secondary !== undefined) {
      await closeAndUnlink(this.#secondary.handle, this.#secondary.path);
      this.#secondary = undefined;
    }
    if (this.#primary !== undefined) {
      await closeAndUnlink(this.#primary, this.journalPath);
      this.#primary = undefined;
    }
  }

  /**
   * The transaction ended with residue on disk. The journal stays exactly
   * because it is the only account of what that residue is: the next writer
   * reads it and refuses with `"recovery-required"` rather than guessing.
   */
  async preserveAsEvidence(detail: string): Promise<void> {
    if (this.#disposed) {
      return;
    }
    await this.record("failed", detail);
    this.#disposed = true;
    if (this.#secondary !== undefined) {
      await this.#secondary.handle.close();
      this.#secondary = undefined;
    }
    if (this.#primary !== undefined) {
      await this.#primary.close();
      this.#primary = undefined;
    }
  }

  async #append(record: JournalRecord): Promise<void> {
    const handle = this.#primary;
    if (handle === undefined) {
      throw new Error(
        `Materialization journal ${this.journalPath} is already closed; nothing may be appended to it.`
      );
    }
    await appendRecord(handle, record);
  }
}

/** One record, all of it, then fsync. */
async function appendRecord(handle: FileHandle, record: JournalRecord): Promise<void> {
  await writeWholly(handle, Buffer.from(`${JSON.stringify(record)}\n`, "utf8"));
  await handle.sync();
  await announce(record);
}

/**
 * Every byte, however many writes it takes.
 *
 * `write` is allowed to write fewer bytes than it was given, and a journal is
 * only evidence if a record is either wholly there or recognizably torn. A
 * short write left unlooped would produce a record that parses as valid JSON
 * up to the cut — or worse, splices the next record onto the remainder — so
 * the loop runs to completion before anything is synced or announced.
 */
async function writeWholly(handle: FileHandle, bytes: Buffer): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.byteLength - written);
    if (bytesWritten <= 0) {
      throw new Error(
        `Materialization journal write stalled after ${written} of ${bytes.byteLength} bytes.`
      );
    }
    written += bytesWritten;
  }
}

/**
 * The instant a journal record is on the disk and the action it announces has
 * not happened yet. That is the only moment worth killing a writer at:
 * everything the journal claims is true, and nothing after it is. The point is
 * named after the record's own phase, so the crash matrix reads as the phase
 * list it is testing. A marker carries no phase and announces nothing.
 */
async function announce(record: JournalRecord): Promise<void> {
  if ("phase" in record) {
    await _materializationTestPoint(record.phase);
  }
}

/**
 * Take the transaction's locks, in one canonical order so an install of "A"
 * and an install of "A.mod" — whose lock sets overlap on `.pdx-lock-A.mod` —
 * queue on the shared inode instead of deadlocking against each other.
 *
 * The second acquisition failing releases the first, which by then holds one
 * header record and nothing on disk.
 */
export async function acquireTransaction(
  request: TransactionRequest
): Promise<MaterializationTransaction> {
  const journalPath = lockPathFor(request.target);
  const secondaryPath =
    request.descriptor === undefined ? undefined : lockPathFor(request.descriptor.path);
  const header: JournalHeader = {
    record: "header",
    version: JOURNAL_VERSION,
    phase: "inspecting",
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    mode: request.mode,
    prefix: request.prefix,
    target: request.target,
    renderedSha256: request.renderedSha256,
    ...(request.descriptor === undefined
      ? {}
      : {
          descriptorPath: request.descriptor.path,
          descriptorSha256: request.descriptor.sha256,
          descriptorByteLength: request.descriptor.byteLength,
          secondaryLockPath: secondaryPath,
        }),
  };
  const marker: JournalMarker = {
    record: "marker",
    pid: process.pid,
    hostname: hostname(),
    primary: journalPath,
  };

  const ordered = [
    { lockPath: journalPath, first: header as JournalRecord },
    ...(secondaryPath === undefined ? [] : [{ lockPath: secondaryPath, first: marker }]),
  ].sort((left, right) => compareUtf8(path.basename(left.lockPath), path.basename(right.lockPath)));

  const held: { path: string; handle: FileHandle }[] = [];
  for (const step of ordered) {
    let handle: FileHandle;
    try {
      handle = await createLockFile(request.target, step.lockPath, step.first);
    } catch (error) {
      for (const open of held.reverse()) {
        await closeAndUnlink(open.handle, open.path);
      }
      throw error;
    }
    held.push({ path: step.lockPath, handle });
  }

  const primary = held.find((open) => open.path === journalPath)!;
  const secondary = held.find((open) => open.path !== journalPath);
  return new MaterializationTransaction(
    request.target,
    journalPath,
    primary.handle,
    secondary === undefined ? undefined : { path: secondary.path, handle: secondary.handle }
  );
}

async function createLockFile(
  target: string,
  lockPath: string,
  first: JournalRecord
): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx", 0o644);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw await refuseHeldLock(target, lockPath);
    }
    throw error;
  }
  try {
    await appendRecord(handle, first);
  } catch (error) {
    await closeAndUnlink(handle, lockPath);
    throw error;
  }
  return handle;
}

/**
 * Classify a lock somebody else already holds. A live holder is a refusal to
 * wait for; anything else — a dead pid, another machine, a journal that
 * cannot be read, a transaction that already recorded its own failure — is
 * evidence a person has to look at, so it names the journal and the recovery
 * call rather than being cleared automatically.
 */
async function refuseHeldLock(target: string, lockPath: string): Promise<MaterializationError> {
  const read = await tryReadJournal(lockPath);
  if (!read.ok) {
    return recoveryRequired(
      target,
      lockPath,
      `${lockPath} exists and could not be read (${describeReadFailure(read.error)}), so whether ` +
        `a materialization is in progress cannot be told.`,
      undefined
    );
  }
  const journal = read.journal;
  if (journal === undefined) {
    // Released between the failed create and the read: the caller retries by
    // running again, which is a decision for them rather than a loop here.
    return new MaterializationError(target, {
      reason: "busy",
      detail: `another writer holds ${lockPath}.`,
    });
  }
  const holder = await describeHolder(journal);
  if (holder === undefined) {
    return recoveryRequired(
      target,
      lockPath,
      `${lockPath} exists but holds no readable transaction journal.`,
      undefined
    );
  }
  if ("unreadable" in holder) {
    return recoveryRequired(
      target,
      holder.unreadable,
      `${lockPath} points at ${holder.unreadable}, which could not be read (${holder.cause}).`,
      undefined
    );
  }
  if (holder.phase === "failed") {
    return recoveryRequired(
      target,
      holder.journalPath,
      `a previous materialization of ${target} failed and left residue behind.`,
      holder.phase
    );
  }
  if (holder.hostname !== hostname()) {
    return recoveryRequired(
      target,
      holder.journalPath,
      `${holder.journalPath} was written by ${holder.hostname}, so this machine cannot tell ` +
        `whether process ${holder.pid} is still running.`,
      holder.phase
    );
  }
  if (!processIsAlive(holder.pid)) {
    return recoveryRequired(
      target,
      holder.journalPath,
      `process ${holder.pid} left an unfinished materialization of ${target} at phase ` +
        `"${holder.phase}".`,
      holder.phase
    );
  }
  return new MaterializationError(target, {
    reason: "busy",
    detail: `process ${holder.pid} is materializing ${target} (phase "${holder.phase}").`,
    holder: { pid: holder.pid, startedAt: holder.startedAt, phase: holder.phase },
  });
}

interface HolderDescription extends MaterializationLockHolder {
  readonly hostname: string;
  /** The primary journal, which for a marker lock is the one it points at. */
  readonly journalPath: string;
}

/** A journal that exists and cannot be read, which decides nothing. */
interface UnreadableJournal {
  readonly unreadable: string;
  readonly cause: string;
}

/** Who a journal — or the marker pointing at one — says is transacting. */
async function describeHolder(
  journal: Journal
): Promise<HolderDescription | UnreadableJournal | undefined> {
  if (journal.header !== undefined) {
    return {
      pid: journal.header.pid,
      hostname: journal.header.hostname,
      startedAt: journal.header.startedAt,
      phase: journal.lastPhase ?? "inspecting",
      journalPath: journal.path,
    };
  }
  if (journal.marker === undefined) {
    return undefined;
  }
  const followed = await tryReadJournal(journal.marker.primary);
  if (!followed.ok) {
    // Unreadable is not absent, and only absent proves the transaction ended.
    return { unreadable: journal.marker.primary, cause: describeReadFailure(followed.error) };
  }
  const primary = followed.journal;
  if (primary?.header === undefined) {
    // A marker whose primary is gone was written before anything moved: the
    // primary is unlinked last, so its absence proves the transaction ended.
    return {
      pid: journal.marker.pid,
      hostname: journal.marker.hostname,
      startedAt: "",
      phase: "inspecting",
      journalPath: journal.marker.primary,
    };
  }
  return {
    pid: primary.header.pid,
    hostname: primary.header.hostname,
    startedAt: primary.header.startedAt,
    phase: primary.lastPhase ?? "inspecting",
    journalPath: primary.path,
  };
}

export function recoveryRequired(
  target: string,
  journalPath: string | undefined,
  detail: string,
  phase: MaterializationPhase | undefined,
  evidence?: readonly { path: string; expected: string; observed: string }[]
): MaterializationError {
  return new MaterializationError(target, {
    reason: "recovery-required",
    detail: `${detail} Recover it with recoverMaterialization() or recoverInstallation().`,
    ...(journalPath === undefined ? {} : { journalPath }),
    ...(phase === undefined ? {} : { phase }),
    ...(evidence === undefined ? {} : { evidence }),
  });
}

/** Which transaction a recovery believes it is about to recover. */
export interface TransactionIdentity {
  readonly pid: number;
  readonly startedAt: string;
}

/**
 * `"gone"` means the journal the caller read is no longer the file at that
 * path: the transaction ended, or a fresh one replaced it, while the claim
 * was being made. It is not a refusal — there is simply nothing left of the
 * transaction the caller was going to recover.
 */
export type RecoveryClaim = "won" | "lost" | "gone";

/**
 * Claim the right to recover a journal nobody holds. The file is the only
 * shared thing two processes have, so they arbitrate in it: each appends a
 * token and re-reads, and the first live claim wins. Claims from dead
 * recoveries are ignored, or a recovery that was itself killed would lock the
 * target out for good, and so are this process's own earlier claims: a
 * recovery that refused and was then retried must not be blocked by the
 * record it left the first time. Two recoveries inside one process are held
 * apart by the in-process lock, not by this.
 *
 * The lock is opened `O_APPEND` without `O_CREAT`, and both reads go through
 * that handle at an explicit offset. Between the caller reading the journal
 * and arriving here, another recovery can finish and unlink the lock, and a
 * new writer can then create its own — so a mode that creates the file would
 * conjure a lock for a transaction that no longer exists and act on a journal
 * read before all of it happened. Opening without creating catches the first
 * case; comparing the header against the transaction the caller read catches
 * the second, before anything is appended to a stranger's journal.
 *
 * A claim is the record that lands on a dead writer's torn tail, so it starts
 * a line of its own rather than being spliced onto the half-written one.
 */
export async function claimRecovery(
  target: string,
  lockPath: string,
  expected: TransactionIdentity
): Promise<RecoveryClaim> {
  let handle: FileHandle;
  try {
    handle = await open(lockPath, constants.O_RDWR | constants.O_APPEND);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "gone";
    }
    throw error;
  }
  try {
    const before = await readWholeFile(handle);
    if (!isTransaction(readClaimedJournal(target, lockPath, before), expected)) {
      return "gone";
    }
    const token = randomUUID();
    const claim: JournalPhase = {
      record: "phase",
      phase: "recovering",
      at: new Date().toISOString(),
      pid: process.pid,
      hostname: hostname(),
      token,
    };
    if (before !== "" && !before.endsWith("\n")) {
      await writeWholly(handle, Buffer.from("\n", "utf8"));
    }
    await appendRecord(handle, claim);

    const journal = readClaimedJournal(target, lockPath, await readWholeFile(handle));
    if (!isTransaction(journal, expected) || !(await pathStillNames(handle, lockPath))) {
      return "gone";
    }
    const claims = journal.records.filter(
      (record): record is JournalPhase => record.record === "phase" && record.phase === "recovering"
    );
    const live = claims.filter(
      (record) =>
        record.token === token ||
        (record.hostname === hostname() &&
          record.pid !== undefined &&
          record.pid !== process.pid &&
          processIsAlive(record.pid))
    );
    return live[0]?.token === token ? "won" : "lost";
  } finally {
    await handle.close();
  }
}

/**
 * Whether `lockPath` still names the file behind `handle`.
 *
 * Everything a claim reads goes through the handle, which keeps it reading
 * one file rather than one name — but the winner then acts on the *name*: the
 * recovery that wins unlinks the lock by path when it finishes. A handle can
 * outlive its directory entry, so a claim that verified only through the
 * handle can win on an inode nothing points at any more, and go on to unlink
 * whatever a fresh writer has since created at that path. The verdict has to
 * be about the file the path names, so it is checked here before one is given.
 */
export async function pathStillNames(handle: FileHandle, lockPath: string): Promise<boolean> {
  let named;
  try {
    named = await lstat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const held = await handle.stat();
  return named.dev === held.dev && named.ino === held.ino;
}

/**
 * The journal an arbitration is reading. A file that is not one cannot be
 * claimed or acted on, so the claim becomes the same refusal the caller would
 * have raised had the read failed one step earlier.
 */
function readClaimedJournal(target: string, lockPath: string, text: string): Journal {
  try {
    return parseJournal(lockPath, text);
  } catch (error) {
    if (error instanceof JournalFormatError) {
      throw recoveryRequired(target, lockPath, error.message, undefined);
    }
    throw error;
  }
}

function isTransaction(journal: Journal, expected: TransactionIdentity): boolean {
  return (
    journal.header !== undefined &&
    journal.header.pid === expected.pid &&
    journal.header.startedAt === expected.startedAt
  );
}

/**
 * The whole file behind a handle, from offset zero. Reading by path instead
 * would read whatever inode holds that name now, which is the very thing the
 * claim is trying to detect; the explicit offset keeps the append position
 * untouched.
 */
async function readWholeFile(handle: FileHandle): Promise<string> {
  const { size } = await handle.stat();
  if (size === 0) {
    return "";
  }
  const buffer = Buffer.alloc(size);
  const { bytesRead } = await handle.read(buffer, 0, size, 0);
  return buffer.toString("utf8", 0, bytesRead);
}

async function closeAndUnlink(handle: FileHandle, lockPath: string): Promise<void> {
  // Closing first is not optional: Windows cannot unlink an open file.
  await handle.close();
  await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}
