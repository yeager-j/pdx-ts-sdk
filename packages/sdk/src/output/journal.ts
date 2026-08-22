/**
 * What a materialization journal is, and how one is read back.
 *
 * The journal is the only account of what an interrupted writer left on disk,
 * and recovery acts on it: it renames trees back and deletes the paths it
 * names. A reader that accepted whatever it found would let a hand-edited or
 * half-written file order those actions, so reading is a closed decode. Every
 * record's shape, the version, the phase vocabulary, which records may appear
 * once, their order, and which phase may follow which are checked here, and
 * anything else is a `JournalFormatError` naming the record and the rule.
 *
 * The one tolerated malformation is a torn write: a process killed mid-append
 * leaves a partial line, and refusing that would make every killed build
 * unrecoverable. It is tolerated only where a kill can produce it — as the
 * unterminated last line, or terminated by the leading newline of a claim a
 * recovery appended after it.
 */

import type { DescriptorSnapshot } from "./receipt.ts";
import type { MaterializationMode } from "./write.ts";

/** The journal format this build writes, and the only one it reads back. */
export const JOURNAL_VERSION = 1;

/**
 * How far a transaction had got. The rename phases are intents: each is
 * journaled immediately before a rename, and no completion record follows,
 * because a rename is atomic and its outcome is readable from disk — the
 * set-aside names are UUIDs, so "both the old and the new tree are at the
 * target" is not a state that can exist.
 *
 * Data rather than a bare union because the phase names are also the names of
 * the journal fault-injection points, and the crash matrix asserts its own
 * table against this list: a phase added here without a row there fails.
 */
export const MATERIALIZATION_PHASES = [
  "inspecting",
  "staging",
  "staged",
  "content-deactivating",
  "content-activating",
  "descriptor-deactivating",
  "descriptor-activating",
  "committed",
  "done",
  "rolling-back",
  "rolled-back",
  "failed",
  "recovering",
] as const;

export type MaterializationPhase = (typeof MATERIALIZATION_PHASES)[number];

/** Line 1 of a primary journal: who is writing, to where, and what. */
export interface JournalHeader {
  readonly record: "header";
  readonly version: number;
  readonly phase: "inspecting";
  readonly pid: number;
  readonly hostname: string;
  /** Diagnostics only; never an input to any decision. */
  readonly startedAt: string;
  readonly mode: MaterializationMode;
  readonly prefix: string;
  readonly target: string;
  readonly renderedSha256: string;
  /** Install mode only, from here down. */
  readonly descriptorPath?: string;
  readonly descriptorSha256?: string;
  readonly descriptorByteLength?: number;
  readonly secondaryLockPath?: string;
}

/**
 * The whole content of the descriptor lock. Two locks, one journal: the
 * descriptor side only points at the primary, so there is never a second
 * account of the same transaction to reconcile.
 */
export interface JournalMarker {
  readonly record: "marker";
  readonly pid: number;
  readonly hostname: string;
  readonly primary: string;
}

/**
 * The set-aside and staging paths, journaled before anything creates them.
 * Writing the UUID names down first is what entitles recovery to delete them
 * later: a directory the journal never named is somebody else's.
 */
export interface JournalStaging {
  readonly record: "staging";
  readonly phase: "staging";
  readonly at: string;
  readonly staging: string;
  readonly previous: string;
  readonly hadPrevious: boolean;
  readonly previousManifestSha256?: string;
  readonly descriptorStaging?: string;
  readonly descriptorPrevious?: string;
  readonly descriptorObserved?: DescriptorSnapshot;
}

export interface JournalPhase {
  readonly record: "phase";
  readonly phase: MaterializationPhase;
  readonly at: string;
  readonly detail?: string;
  /** `recovering` records only: the arbitration between two recoveries. */
  readonly pid?: number;
  readonly hostname?: string;
  readonly token?: string;
}

export type JournalRecord = JournalHeader | JournalMarker | JournalStaging | JournalPhase;

/** A journal as read back: whole records, plus what they add up to. */
export interface Journal {
  readonly path: string;
  readonly header?: JournalHeader;
  readonly marker?: JournalMarker;
  readonly staging?: JournalStaging;
  readonly records: readonly JournalRecord[];
  /**
   * The last phase the transaction itself announced. `recovering` records are
   * excluded: they are arbitration between recoveries, not progress by the
   * writer, and a recovery that died must not change which row applies.
   */
  readonly lastPhase?: MaterializationPhase;
  /** False when the file holds no usable record at all. */
  readonly readable: boolean;
}

/**
 * A lock file that is not a journal a materialization could have written.
 *
 * The message names the record and the rule it broke, because whoever reads
 * it is looking at a target that is already wrong and needs to know which
 * line to look at.
 */
export class JournalFormatError extends Error {
  /** The lock file the record was read from. */
  readonly path: string;
  /** The record's 1-based line in that file. */
  readonly line: number;
  /** The rule the record broke, without the path and line in front of it. */
  readonly detail: string;

  constructor(path: string, line: number, detail: string) {
    super(`${path}: record ${line} ${detail}`);
    this.name = "JournalFormatError";
    this.path = path;
    this.line = line;
    this.detail = detail;
  }
}

/**
 * Read a lock file's text back as the transaction it describes.
 *
 * @param lockPath The file the text came from; it appears in error messages
 * and in the returned journal, and is not read.
 * @throws JournalFormatError when a record, or the history the records add up
 * to, is not one a materialization writes.
 */
export function parseJournal(lockPath: string, text: string): Journal {
  const placed = decodeLines(lockPath, text);
  const records = placed.map((entry) => entry.record);
  if (placed.length > 0) {
    assertHistory(lockPath, placed);
  }
  return {
    path: lockPath,
    header: records.find((record): record is JournalHeader => record.record === "header"),
    marker: records.find((record): record is JournalMarker => record.record === "marker"),
    staging: records.find((record): record is JournalStaging => record.record === "staging"),
    records,
    ...lastPhaseOf(records),
    readable: records.length > 0,
  };
}

/** A decoded record and the line it came from, so a rule can name it. */
interface PlacedRecord {
  readonly record: JournalRecord;
  readonly line: number;
}

function lastPhaseOf(records: readonly JournalRecord[]): { lastPhase?: MaterializationPhase } {
  let lastPhase: MaterializationPhase | undefined;
  for (const record of records) {
    if (record.record === "header" || record.record === "staging") {
      lastPhase = record.phase;
    } else if (record.record === "phase" && record.phase !== "recovering") {
      lastPhase = record.phase;
    }
  }
  return lastPhase === undefined ? {} : { lastPhase };
}

/**
 * One record per line, plus the rules for the two lines a record does not
 * account for.
 *
 * A line that is not a whole JSON object is a write a kill interrupted. The
 * newline goes on after the object, so an unparseable line can only be one if
 * nothing terminated it — the last line of the file — or if what terminated it
 * is the leading newline of a claim a recovery appended afterwards. That
 * leading newline is also why a claim can be preceded by an empty line: it is
 * written unconditionally, so a file whose last record was already terminated
 * gets a blank line between the two. Everything after either kind of line is
 * therefore the tail recoveries append, and nothing else.
 */
function decodeLines(lockPath: string, text: string): PlacedRecord[] {
  const { lines, terminated } = readLines(text);
  const placed: PlacedRecord[] = [];
  let mode: MaterializationMode | undefined;
  for (const line of lines) {
    const site: RecordSite = { path: lockPath, line: line.number, within: "" };
    if (line.text === "") {
      if (!opensClaimTail(lines, line.number, terminated)) {
        fail(site, "is an empty line, and only the separator before a claim is one.");
      }
      continue;
    }
    if (line.fields === undefined) {
      const interruptedMidAppend = line.number === lines.length && !terminated;
      if (!interruptedMidAppend && !opensClaimTail(lines, line.number, terminated)) {
        fail(site, "is not a whole JSON record, and only an interrupted write is not.");
      }
      continue;
    }
    const record = decodeRecord(site, line.fields, mode);
    if (record.record === "header") {
      mode = record.mode;
    }
    placed.push({ record, line: line.number });
  }
  return placed;
}

/** One line of a lock file, with the number a refusal names it by. */
interface JournalLine {
  /** 1-based, as a person counts lines in the file. */
  readonly number: number;
  readonly text: string;
  /** The line's JSON object, or undefined when the line is not one. */
  readonly fields: Fields | undefined;
}

/**
 * The file's lines, and whether its last one was terminated. An unterminated
 * last line is the only line a kill can have left half written, so the two
 * facts are read together.
 */
function readLines(text: string): { lines: JournalLine[]; terminated: boolean } {
  if (text === "") {
    return { lines: [], terminated: true };
  }
  const terminated = text.endsWith("\n");
  const texts = text.split("\n");
  if (terminated) {
    texts.pop();
  }
  const lines = texts.map((line, index) => ({
    number: index + 1,
    text: line,
    fields: asFields(line),
  }));
  return { lines, terminated };
}

/**
 * Whether everything after line `from` is the tail recoveries append: claims,
 * the empty separator each claim carries, and at most a final claim a kill
 * tore off. Nothing after the line at all is not a tail — there is then no
 * appended claim to have terminated it.
 */
function opensClaimTail(lines: readonly JournalLine[], from: number, terminated: boolean): boolean {
  const tail = lines.slice(from);
  return (
    tail.length > 0 &&
    tail.every((line, index) => {
      if (line.text === "" || isClaimFields(line.fields)) {
        return true;
      }
      return line.fields === undefined && index === tail.length - 1 && !terminated;
    })
  );
}

/**
 * Whether a line is shaped like a recovery claim. Only the shape: the claim
 * itself is decoded and validated with every other record.
 */
function isClaimFields(fields: Fields | undefined): boolean {
  return fields?.["record"] === "phase" && fields["phase"] === "recovering";
}

function isRecoveryClaim(record: JournalRecord): boolean {
  return record.record === "phase" && record.phase === "recovering";
}

/**
 * The records a journal is allowed to be made of, in the order a writer
 * writes them.
 *
 * A primary journal opens with its header and never repeats it; a descriptor
 * lock is one marker record and nothing else. No file is partly both, so a
 * marker among a writer's records — or a second header — is not a transaction
 * anything may act on.
 */
function assertHistory(lockPath: string, placed: readonly PlacedRecord[]): void {
  const first = placed[0]!;
  if (first.record.record === "marker") {
    const extra = placed[1];
    if (extra !== undefined) {
      fail(
        siteOf(lockPath, extra),
        "follows a descriptor marker, which is a lock's whole content."
      );
    }
    return;
  }
  if (first.record.record !== "header") {
    fail(
      siteOf(lockPath, first),
      `is a "${first.record.record}" record, and a journal opens with a header.`
    );
  }
  for (const [index, entry] of placed.entries()) {
    const kind = entry.record.record;
    if (index === 0) {
      continue;
    }
    if (kind === "header" || kind === "marker") {
      fail(siteOf(lockPath, entry), `is a second ${kind} record in one journal.`);
    }
    if (kind === "staging" && index !== 1) {
      fail(
        siteOf(lockPath, entry),
        "is a staging record, which a writer writes directly after the header."
      );
    }
  }
  assertTransitions(lockPath, first.record.mode, placed.slice(1));
}

/**
 * Phases a transaction moves through. `failed` and `recovering` are not
 * progress — either may follow anything, and neither advances the sequence —
 * so the table below neither leads to nor away from them.
 */
type ProgressPhase = Exclude<MaterializationPhase, "failed" | "recovering">;

/**
 * Which phase may follow which, per mode, read off the two writers:
 * `materialize` and `activateMaterialization` in write.ts for the content
 * half, and `installJournaled` in install.ts for the descriptor half.
 *
 * The rows are exhaustive over the phase list on purpose: a phase added
 * without a row here fails to compile rather than becoming quietly
 * unreachable. A build's `descriptor-*` rows are empty because a build has no
 * descriptor half, and `assertModeAllows` refuses those phases by name first,
 * so the emptiness is never the reason a reader is given.
 */
const NEXT_PHASES = {
  build: {
    inspecting: ["staging"],
    staging: ["staged"],
    staged: ["content-deactivating", "content-activating"],
    "content-deactivating": ["content-activating"],
    "content-activating": ["committed", "rolling-back", "rolled-back"],
    "descriptor-deactivating": [],
    "descriptor-activating": [],
    committed: ["done"],
    done: [],
    "rolling-back": ["rolled-back"],
    "rolled-back": [],
  },
  install: {
    inspecting: ["staging"],
    staging: ["staged"],
    staged: ["content-deactivating", "content-activating"],
    "content-deactivating": ["content-activating"],
    "content-activating": [
      "descriptor-deactivating",
      "descriptor-activating",
      "rolling-back",
      "rolled-back",
    ],
    "descriptor-deactivating": ["descriptor-activating", "rolling-back"],
    "descriptor-activating": ["committed", "rolling-back"],
    committed: ["done"],
    done: [],
    "rolling-back": ["rolled-back"],
    "rolled-back": [],
  },
} satisfies Record<MaterializationMode, Record<ProgressPhase, readonly ProgressPhase[]>>;

/** Phases only an install writes; a build journal naming one is not one. */
const INSTALL_ONLY_PHASES: readonly MaterializationPhase[] = [
  "descriptor-deactivating",
  "descriptor-activating",
];

/**
 * The phase sequence, walked once against the table for the header's mode.
 *
 * `failed` says the writer gave up where it stood, and `recovering` says
 * somebody else has taken over. Neither advances the walk, and both close it:
 * nothing a writer announces can come after either, because by then there is
 * no writer.
 */
function assertTransitions(
  lockPath: string,
  mode: MaterializationMode,
  afterHeader: readonly PlacedRecord[]
): void {
  let reached: ProgressPhase = "inspecting";
  let closedBy: string | undefined;
  for (const entry of afterHeader) {
    const record = entry.record;
    if (record.record !== "staging" && record.record !== "phase") {
      continue;
    }
    const site = siteOf(lockPath, entry);
    if (isRecoveryClaim(record)) {
      closedBy = "a recovery claim";
      continue;
    }
    if (closedBy !== undefined) {
      fail(site, `announces "${record.phase}" after ${closedBy}, when no writer was left to.`);
    }
    if (record.phase === "failed") {
      closedBy = '"failed"';
      continue;
    }
    assertModeAllows(site, mode, record.phase);
    const allowed: readonly ProgressPhase[] = NEXT_PHASES[mode][reached];
    const next = allowed.find((candidate) => candidate === record.phase);
    if (next === undefined) {
      fail(site, `announces "${record.phase}" after "${reached}", which no ${mode} writes.`);
    }
    reached = next;
  }
}

function assertModeAllows(
  site: RecordSite,
  mode: MaterializationMode,
  phase: MaterializationPhase
): void {
  if (mode === "build" && INSTALL_ONLY_PHASES.includes(phase)) {
    fail(site, `announces "${phase}", which only an install writes.`);
  }
}

/** Where a record was read from, and which object inside it is being read. */
interface RecordSite {
  readonly path: string;
  readonly line: number;
  /** Field-name prefix for a nested object, such as `descriptorObserved.`. */
  readonly within: string;
}

type Fields = Record<string, unknown>;

function siteOf(lockPath: string, entry: PlacedRecord): RecordSite {
  return { path: lockPath, line: entry.line, within: "" };
}

function fail(site: RecordSite, detail: string): never {
  throw new JournalFormatError(site.path, site.line, detail);
}

/** The line as a JSON object, or undefined when it is neither. */
function asFields(line: string): Fields | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Fields;
}

/**
 * `mode` is the header's, and is undefined until one has been read: a staging
 * record carries the descriptor half only when the transaction has one, and
 * that is the header's word rather than the record's own shape.
 */
function decodeRecord(
  site: RecordSite,
  fields: Fields,
  mode: MaterializationMode | undefined
): JournalRecord {
  switch (fields["record"]) {
    case "header":
      return decodeHeader(site, fields);
    case "marker":
      return decodeMarker(site, fields);
    case "staging":
      return decodeStaging(site, fields, mode);
    case "phase":
      return decodePhase(site, fields);
    default:
      return fail(site, `has no known "record" kind (${describe(fields["record"])}).`);
  }
}

const HEADER_DESCRIPTOR_FIELDS = [
  "descriptorPath",
  "descriptorSha256",
  "descriptorByteLength",
  "secondaryLockPath",
] as const;

const HEADER_FIELDS = [
  "record",
  "version",
  "phase",
  "pid",
  "hostname",
  "startedAt",
  "mode",
  "prefix",
  "target",
  "renderedSha256",
  ...HEADER_DESCRIPTOR_FIELDS,
];

function decodeHeader(site: RecordSite, fields: Fields): JournalHeader {
  rejectUnknownFields(site, fields, HEADER_FIELDS);
  if (fields["version"] !== JOURNAL_VERSION) {
    fail(site, `is not a version ${JOURNAL_VERSION} header (${describe(fields["version"])}).`);
  }
  requireLiteralPhase(site, fields, "inspecting");
  const mode = requireMode(site, fields);
  const common: JournalHeader = {
    record: "header",
    version: JOURNAL_VERSION,
    phase: "inspecting",
    pid: requireInteger(site, fields, "pid", 1),
    hostname: requireNonEmptyString(site, fields, "hostname"),
    startedAt: requireString(site, fields, "startedAt"),
    mode,
    prefix: requireNonEmptyString(site, fields, "prefix"),
    target: requireNonEmptyString(site, fields, "target"),
    renderedSha256: requireNonEmptyString(site, fields, "renderedSha256"),
  };
  if (mode === "build") {
    rejectInstallOnlyFields(site, fields, HEADER_DESCRIPTOR_FIELDS);
    return common;
  }
  return {
    ...common,
    descriptorPath: requireNonEmptyString(site, fields, "descriptorPath"),
    descriptorSha256: requireNonEmptyString(site, fields, "descriptorSha256"),
    descriptorByteLength: requireInteger(site, fields, "descriptorByteLength", 0),
    secondaryLockPath: requireNonEmptyString(site, fields, "secondaryLockPath"),
  };
}

const MARKER_FIELDS = ["record", "pid", "hostname", "primary"];

function decodeMarker(site: RecordSite, fields: Fields): JournalMarker {
  rejectUnknownFields(site, fields, MARKER_FIELDS);
  return {
    record: "marker",
    pid: requireInteger(site, fields, "pid", 1),
    hostname: requireNonEmptyString(site, fields, "hostname"),
    primary: requireNonEmptyString(site, fields, "primary"),
  };
}

const STAGING_DESCRIPTOR_FIELDS = [
  "descriptorStaging",
  "descriptorPrevious",
  "descriptorObserved",
] as const;

const STAGING_FIELDS = [
  "record",
  "phase",
  "at",
  "staging",
  "previous",
  "hadPrevious",
  "previousManifestSha256",
  ...STAGING_DESCRIPTOR_FIELDS,
];

function decodeStaging(
  site: RecordSite,
  fields: Fields,
  mode: MaterializationMode | undefined
): JournalStaging {
  if (mode === undefined) {
    fail(site, "is a staging record with no header before it to say what it is staging.");
  }
  rejectUnknownFields(site, fields, STAGING_FIELDS);
  requireLiteralPhase(site, fields, "staging");
  const previousManifestSha256 = optionalString(site, fields, "previousManifestSha256");
  const common: JournalStaging = {
    record: "staging",
    phase: "staging",
    at: requireString(site, fields, "at"),
    staging: requireNonEmptyString(site, fields, "staging"),
    previous: requireNonEmptyString(site, fields, "previous"),
    hadPrevious: requireBoolean(site, fields, "hadPrevious"),
    ...(previousManifestSha256 === undefined ? {} : { previousManifestSha256 }),
  };
  if (mode === "build") {
    rejectInstallOnlyFields(site, fields, STAGING_DESCRIPTOR_FIELDS);
    return common;
  }
  return {
    ...common,
    descriptorStaging: requireNonEmptyString(site, fields, "descriptorStaging"),
    descriptorPrevious: requireNonEmptyString(site, fields, "descriptorPrevious"),
    descriptorObserved: decodeDescriptorSnapshot(site, fields["descriptorObserved"]),
  };
}

const DESCRIPTOR_FILE_FIELDS = ["state", "basename", "byteLength", "sha256"];

function decodeDescriptorSnapshot(record: RecordSite, value: unknown): DescriptorSnapshot {
  const site: RecordSite = { ...record, within: "descriptorObserved." };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(record, `has no object "descriptorObserved" (${describe(value)}).`);
  }
  const fields = value as Fields;
  const state = fields["state"];
  if (state === "absent" || state === "symlink" || state === "other") {
    rejectUnknownFields(site, fields, ["state"]);
    return { state };
  }
  if (state !== "file") {
    fail(record, `has no known "descriptorObserved.state" (${describe(state)}).`);
  }
  rejectUnknownFields(site, fields, DESCRIPTOR_FILE_FIELDS);
  return {
    state: "file",
    basename: requireString(site, fields, "basename"),
    byteLength: requireInteger(site, fields, "byteLength", 0),
    sha256: requireString(site, fields, "sha256"),
  };
}

const PHASE_CLAIM_FIELDS = ["pid", "hostname", "token"] as const;

const PHASE_FIELDS = ["record", "phase", "at", "detail", ...PHASE_CLAIM_FIELDS];

function decodePhase(site: RecordSite, fields: Fields): JournalPhase {
  rejectUnknownFields(site, fields, PHASE_FIELDS);
  const phase = requirePhase(site, fields);
  if (phase === "inspecting" || phase === "staging") {
    fail(site, `announces "${phase}", which only the header and staging records announce.`);
  }
  const detail = optionalString(site, fields, "detail");
  const common: JournalPhase = {
    record: "phase",
    phase,
    at: requireString(site, fields, "at"),
    ...(detail === undefined ? {} : { detail }),
  };
  if (phase !== "recovering") {
    for (const key of PHASE_CLAIM_FIELDS) {
      if (fields[key] !== undefined) {
        fail(site, `carries "${key}", which only a "recovering" claim carries.`);
      }
    }
    return common;
  }
  return {
    ...common,
    pid: requireInteger(site, fields, "pid", 1),
    hostname: requireNonEmptyString(site, fields, "hostname"),
    token: requireNonEmptyString(site, fields, "token"),
  };
}

function requireMode(site: RecordSite, fields: Fields): MaterializationMode {
  const mode = fields["mode"];
  if (mode !== "build" && mode !== "install") {
    fail(site, `has no "mode" of "build" or "install" (${describe(mode)}).`);
  }
  return mode;
}

function requirePhase(site: RecordSite, fields: Fields): MaterializationPhase {
  const known = MATERIALIZATION_PHASES.find((candidate) => candidate === fields["phase"]);
  if (known === undefined) {
    fail(site, `has no known "phase" (${describe(fields["phase"])}).`);
  }
  return known;
}

function requireLiteralPhase(site: RecordSite, fields: Fields, expected: string): void {
  if (fields["phase"] !== expected) {
    fail(site, `has a "phase" other than "${expected}" (${describe(fields["phase"])}).`);
  }
}

function requireString(site: RecordSite, fields: Fields, key: string): string {
  const value = fields[key];
  if (typeof value !== "string") {
    fail(site, `has no string "${site.within}${key}" (${describe(value)}).`);
  }
  return value;
}

function requireNonEmptyString(site: RecordSite, fields: Fields, key: string): string {
  const value = requireString(site, fields, key);
  if (value === "") {
    fail(site, `has an empty "${site.within}${key}".`);
  }
  return value;
}

function optionalString(site: RecordSite, fields: Fields, key: string): string | undefined {
  return fields[key] === undefined ? undefined : requireString(site, fields, key);
}

function requireBoolean(site: RecordSite, fields: Fields, key: string): boolean {
  const value = fields[key];
  if (typeof value !== "boolean") {
    fail(site, `has no boolean "${site.within}${key}" (${describe(value)}).`);
  }
  return value;
}

/** An integer field, refused when it is below `least`. */
function requireInteger(site: RecordSite, fields: Fields, key: string, least: number): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) {
    fail(site, `has no integer "${site.within}${key}" of at least ${least} (${describe(value)}).`);
  }
  return value;
}

function rejectUnknownFields(site: RecordSite, fields: Fields, known: readonly string[]): void {
  const unknown = Object.keys(fields).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    fail(site, `carries ${quoteFields(site, unknown)}, which no record of its kind has.`);
  }
}

function rejectInstallOnlyFields(
  site: RecordSite,
  fields: Fields,
  installOnly: readonly string[]
): void {
  const present = installOnly.filter((key) => fields[key] !== undefined);
  if (present.length > 0) {
    fail(site, `carries ${quoteFields(site, present)}, which only an install writes.`);
  }
}

function quoteFields(site: RecordSite, keys: readonly string[]): string {
  return keys.map((key) => `"${site.within}${key}"`).join(", ");
}

/** A rejected value, short enough to sit inside a one-line message. */
function describe(value: unknown): string {
  const rendered = value === undefined ? "undefined" : JSON.stringify(value);
  return rendered.length > 40 ? `${rendered.slice(0, 39)}…` : rendered;
}
