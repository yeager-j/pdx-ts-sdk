/**
 * The transaction half of materialization: one exclusive lock per physical
 * target, a journal inside it, and a recovery operation that reads the journal
 * back.
 *
 * The failures this suite prevents are the two a build cannot survive on its
 * own. Two writers racing one target both stage, both swap, and one of them
 * deletes the other's output — so a second writer has to fail immediately
 * rather than wait or guess. And a build killed between the two activation
 * renames leaves a target that is neither the old output nor the new one — so
 * something has to be able to say which it was, from evidence rather than from
 * how the tree happens to look.
 *
 * Every mid-transaction state below is fabricated in process, with the same
 * primitives the sinks use: the staging tree is really staged, the renames are
 * really done, and the journal really describes them. No process is killed
 * here; that is the negative-control harness, which is a separate concern.
 */

import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMod, install, MaterializationError, render, write } from "../src/index.ts";
import {
  recoverInstallation,
  recoverMaterialization,
  type RecoveryReport,
} from "../src/internals.ts";
import {
  JournalFormatError,
  parseJournal,
  type MaterializationPhase,
} from "../src/output/journal.ts";
import {
  installPaths,
  isMintedSibling,
  lockPathFor,
  stagingPaths,
  type MaterializationPaths,
  type SiblingRole,
} from "../src/output/layout.ts";
import { assertRepresentableMaterialization } from "../src/output/preflight.ts";
import { renderLauncherDescriptor } from "../src/output/render.ts";
import { createRenderedMod, type RenderedMod } from "../src/output/rendered.ts";
import { claimRecovery, processIsAlive, readJournal } from "../src/output/transaction.ts";
import { pathStillNames } from "../src/output/tree.ts";
import {
  descriptorRecord,
  observeDescriptor,
  stageMaterialization,
  validateExistingMaterialization,
} from "../src/output/write.ts";

const capability = createMod({
  name: "Transaction Probe",
  prefix: "tx_probe",
  version: "0.1.0",
  supportedVersion: "v4.4.*",
  tags: ["Technologies"],
});

function technology(id: string, name: string) {
  return capability.technology(id, {
    name,
    cost: 1000,
    area: "physics",
    tier: 1,
    category: "particles",
  });
}

/** Generation one: what a recovery has to be able to put back. */
const genOne = render(
  capability.compile([capability.feature(undefined, [technology("marker", "Marker")])])
);

/** Generation two: one extra owned file, so the two are told apart on disk. */
const genTwo = render(
  capability.compile([
    capability.feature(undefined, [technology("marker", "Marker")]),
    capability.feature("extra", [technology("second", "Second")]),
  ])
);

const GEN_TWO_ONLY = "common/technology/tx_probe_extra.txt";
const MANIFEST = ".pdx-sdk-manifest.json";

/** An unreadable directory is not unreadable to root, which ignores the bits. */
const posix = process.platform !== "win32" && process.getuid?.() !== 0;

const temps: string[] = [];
/** Physical from the start, with Windows' 8.3 spelling removed as well. */
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "pdx-transaction-")));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The refusal itself, so a test can assert the reason and its evidence. */
async function refusal(operation: Promise<unknown>): Promise<MaterializationError> {
  const thrown = await operation.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(MaterializationError);
  return thrown as MaterializationError;
}

/**
 * A pid nothing can be running under. Searching down from the highest pid any
 * mainstream kernel hands out beats naming a constant that is legal somewhere.
 */
function deadPid(): number {
  for (let candidate = 4_194_303; candidate > 1; candidate--) {
    if (!processIsAlive(candidate)) {
      return candidate;
    }
  }
  throw new Error("every pid is in use");
}

interface JournalOptions {
  readonly target: string;
  readonly rendered: RenderedMod;
  readonly paths?: MaterializationPaths;
  readonly hadPrevious?: boolean;
  readonly previousManifestSha256?: string;
  readonly phases?: readonly MaterializationPhase[];
  readonly pid?: number;
  readonly hostname?: string;
  readonly descriptor?: {
    readonly path: string;
    readonly record: { readonly sha256: string; readonly byteLength: number };
    readonly staging: string;
    readonly previous: string;
    readonly observed: unknown;
  };
}

/** Write the journal an interrupted transaction would have left. */
function writeJournal(options: JournalOptions): string {
  const lockPath = lockPathFor(options.target);
  const at = new Date().toISOString();
  const records: Record<string, unknown>[] = [
    {
      record: "header",
      version: 1,
      phase: "inspecting",
      pid: options.pid ?? deadPid(),
      hostname: options.hostname ?? hostname(),
      startedAt: at,
      mode: options.descriptor === undefined ? "build" : "install",
      prefix: options.rendered.prefix,
      target: options.target,
      renderedSha256: options.rendered.sha256,
      ...(options.descriptor === undefined
        ? {}
        : {
            descriptorPath: options.descriptor.path,
            descriptorSha256: options.descriptor.record.sha256,
            descriptorByteLength: options.descriptor.record.byteLength,
            secondaryLockPath: lockPathFor(options.descriptor.path),
          }),
    },
  ];
  if (options.paths !== undefined) {
    records.push({
      record: "staging",
      phase: "staging",
      at,
      staging: options.paths.staging,
      previous: options.paths.previous,
      hadPrevious: options.hadPrevious ?? true,
      ...(options.previousManifestSha256 === undefined
        ? {}
        : { previousManifestSha256: options.previousManifestSha256 }),
      ...(options.descriptor === undefined
        ? {}
        : {
            descriptorStaging: options.descriptor.staging,
            descriptorPrevious: options.descriptor.previous,
            descriptorObserved: options.descriptor.observed,
          }),
    });
  }
  for (const phase of options.phases ?? []) {
    records.push({ record: "phase", phase, at });
  }
  writeFileSync(
    lockPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
  if (options.descriptor !== undefined) {
    writeFileSync(
      lockPathFor(options.descriptor.path),
      JSON.stringify({
        record: "marker",
        pid: options.pid ?? deadPid(),
        hostname: options.hostname ?? hostname(),
        primary: lockPath,
      }) + "\n",
      "utf8"
    );
  }
  return lockPath;
}

/**
 * One record of a journal, as the bytes on disk rather than as a typed value:
 * the decoder tests are about files a writer never wrote.
 */
type RawRecord = Record<string, unknown>;

function headerRecord(overrides: RawRecord = {}): RawRecord {
  return {
    record: "header",
    version: 1,
    phase: "inspecting",
    pid: 1,
    hostname: "h",
    startedAt: "t",
    mode: "build",
    prefix: "tx_probe",
    target: "/out",
    renderedSha256: "x",
    ...overrides,
  };
}

/** The install half of a header, which a build header must not carry. */
const INSTALL_HEADER_FIELDS: RawRecord = {
  mode: "install",
  descriptorPath: "/out.mod",
  descriptorSha256: "d",
  descriptorByteLength: 12,
  secondaryLockPath: "/.pdx-lock-out.mod",
};

function stagingRecord(overrides: RawRecord = {}): RawRecord {
  return {
    record: "staging",
    phase: "staging",
    at: "t",
    staging: "/s",
    previous: "/p",
    hadPrevious: true,
    ...overrides,
  };
}

/** The install half of a staging record. */
const INSTALL_STAGING_FIELDS: RawRecord = {
  descriptorStaging: "/ds",
  descriptorPrevious: "/dp",
  descriptorObserved: { state: "absent" },
};

function phaseRecord(phase: string, overrides: RawRecord = {}): RawRecord {
  return { record: "phase", phase, at: "t", ...overrides };
}

function markerRecord(overrides: RawRecord = {}): RawRecord {
  return { record: "marker", pid: 1, hostname: "h", primary: "/lock", ...overrides };
}

const BUILD_HEADER = JSON.stringify(headerRecord());

/** A journal's text. A string stands for a line no record serializes to. */
function journalText(...lines: readonly (RawRecord | string)[]): string {
  return `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`;
}

/** The journal a writer of `mode` that got exactly this far would leave. */
function historyText(mode: "build" | "install", phases: readonly string[]): string {
  const header = mode === "build" ? headerRecord() : headerRecord(INSTALL_HEADER_FIELDS);
  const staging = mode === "build" ? stagingRecord() : stagingRecord(INSTALL_STAGING_FIELDS);
  return journalText(header, staging, ...phases.map((phase) => phaseRecord(phase)));
}

/** Stage a build the way `materialize` does, without activating it. */
async function stageBuild(target: string, rendered: RenderedMod) {
  const inspection = await validateExistingMaterialization(target, rendered, "build");
  const paths = stagingPaths(target);
  const staged = await stageMaterialization(target, rendered, "build", inspection, { paths });
  return { paths, inspection, staged };
}

/** The manifest hash the SDK recorded in a materialized tree. */
function manifestSha(target: string): string {
  return (JSON.parse(readFileSync(join(target, MANIFEST), "utf8")) as { sha256: string }).sha256;
}

/** An absolute directory path of exactly `total` characters, in legal parts. */
function targetOfLength(total: number): string {
  const parts: string[] = [];
  let used = 0;
  while (used + 201 < total) {
    parts.push("d".repeat(200));
    used += 201;
  }
  parts.push("d".repeat(Math.max(1, total - used - 1)));
  return "/" + parts.join("/");
}

/** Generation two of an install, staged and journaled but not committed. */
async function stageInstall(root: string) {
  const contentDir = join(root, "tx_probe");
  const descriptorPath = join(root, "tx_probe.mod");
  const contents = renderLauncherDescriptor(genTwo, contentDir);
  const record = descriptorRecord(basename(descriptorPath), contents);
  const observed = await observeDescriptor(descriptorPath);
  const inspection = await validateExistingMaterialization(contentDir, genTwo, "install", {
    descriptor: observed,
  });
  const paths = stagingPaths(contentDir);
  const descriptor = {
    path: descriptorPath,
    record,
    staging: join(root, `.pdx-descriptor-staging-${randomUUID()}`),
    previous: join(root, `.pdx-descriptor-previous-${randomUUID()}`),
    observed: observed as unknown,
  };
  await stageMaterialization(contentDir, genTwo, "install", inspection, {
    launcherDescriptor: record,
    paths,
  });
  writeFileSync(descriptor.staging, contents, "utf8");
  return { contentDir, descriptorPath, paths, descriptor, contents };
}

/** An install crash with the content swapped and the descriptor not yet. */
async function halfSwappedInstall(root: string) {
  const first = await install(genOne, { modDir: root });
  const previousSha = manifestSha(first.contentDir);
  const staged = await stageInstall(root);
  writeJournal({
    target: staged.contentDir,
    rendered: genTwo,
    paths: staged.paths,
    previousManifestSha256: previousSha,
    descriptor: staged.descriptor,
    phases: ["staged", "content-deactivating", "content-activating"],
  });
  renameSync(staged.contentDir, staged.paths.previous);
  renameSync(staged.paths.staging, staged.contentDir);
  return { ...staged, previousSha };
}

function siblings(parent: string): string[] {
  return readdirSync(parent)
    .filter((name) => name.startsWith(".pdx-"))
    .sort();
}

describe("the lock is exclusive, and says who holds it", () => {
  it("leaves no lock behind after a materialization that succeeded", async () => {
    const parent = tempDir();
    const out = join(parent, "out");

    await write(out, genOne);

    expect(readdirSync(parent)).toEqual(["out"]);
    expect(existsSync(lockPathFor(out))).toBe(false);
  });

  it("releases the lock when it refuses an unowned target", async () => {
    // A refusal that kept the lock would turn one bad state into two: the
    // author fixes what was reported and the next build refuses for a reason
    // nobody caused.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    writeFileSync(join(out, "someone-elses.txt"), "not ours", "utf8");

    expect((await refusal(write(out, genOne))).reason).toBe("unowned");

    expect(existsSync(lockPathFor(out))).toBe(false);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("releases the lock when it refuses drifted owned output", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    writeFileSync(join(out, "common/technology/tx_probe_technology.txt"), "hand edited", "utf8");

    expect((await refusal(write(out, genOne))).reason).toBe("drift");

    expect(existsSync(lockPathFor(out))).toBe(false);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("releases the lock when the materialization changes nothing", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);

    expect((await write(out, genOne)).status).toBe("unchanged");

    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("refuses as busy while a live process holds the lock, and names it", async () => {
    // This process is alive by definition, so a journal claiming it is the
    // holder is the live case without any process to spawn.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      pid: process.pid,
      phases: ["staged"],
    });

    const error = await refusal(write(out, genOne));

    expect(error.reason).toBe("busy");
    if (error.failure.reason !== "busy") {
      throw new Error("unreachable");
    }
    expect(error.failure.holder).toEqual({
      pid: process.pid,
      startedAt: expect.any(String) as unknown as string,
      phase: "staged",
    });
    // The lock is another writer's, so nothing about it was touched.
    expect(existsSync(lockPathFor(out))).toBe(true);
  });

  it("refuses with recovery-required when the holder is gone", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    const lockPath = writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      phases: ["staged"],
    });

    const error = await refusal(write(out, genOne));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.journalPath).toBe(lockPath);
    expect(error.failure.phase).toBe("staged");
    expect(error.message).toContain("recoverMaterialization");
  });

  it.each([
    [
      "the journal cannot be read at all",
      (lockPath: string) => writeFileSync(lockPath, "not json\n", "utf8"),
    ],
    [
      "the journal was written by another machine",
      (lockPath: string, target: string) => {
        writeJournal({ target, rendered: genOne, hostname: "some-other-host", pid: process.pid });
        expect(existsSync(lockPath)).toBe(true);
      },
    ],
  ])("refuses with recovery-required when %s", async (_label, fabricate) => {
    // Neither state can be classified as live or dead, and a lock nobody can
    // classify is never broken automatically.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    fabricate(lockPathFor(out), out);

    expect((await refusal(write(out, genOne))).reason).toBe("recovery-required");
    expect(existsSync(lockPathFor(out))).toBe(true);
  });

  it("refuses with recovery-required when the last record is a failure", async () => {
    // A transaction that recorded its own failure left residue behind, and
    // says so — the pid may well still be alive and doing something else.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      pid: process.pid,
      phases: ["staged", "failed"],
    });

    expect((await refusal(write(out, genOne))).reason).toBe("recovery-required");
  });

  it("refuses with recovery-required when the held lock holds an illegal history", async () => {
    // The decoder's verdict is the writer's refusal: a lock nobody can read
    // as a transaction is not one to wait for, and not one to write over.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      pid: process.pid,
      phases: ["staged", "content-deactivating", "done"],
    });

    const error = await refusal(write(out, genTwo));

    expect(error.reason).toBe("recovery-required");
    expect(error.message).toContain('announces "done" after "content-deactivating"');
  });
});

describe("two locks, one journal", () => {
  it("takes the content and descriptor locks together, and releases both", async () => {
    const root = tempDir();
    const report = await install(genOne, { modDir: root });

    expect(siblings(root)).toEqual([]);
    expect(existsSync(lockPathFor(report.contentDir))).toBe(false);
    expect(existsSync(lockPathFor(report.descriptorPath))).toBe(false);
  });

  it("releases the content lock when the descriptor lock cannot be taken", async () => {
    // The second acquisition failing must not leave the first one held: the
    // install did nothing, so nothing may be left claiming it is doing
    // something.
    const root = tempDir();
    const contentDir = join(root, "tx_probe");
    const descriptorPath = join(root, "tx_probe.mod");
    mkdirSync(contentDir);
    writeJournal({ target: descriptorPath, rendered: genOne, pid: process.pid });

    expect((await refusal(install(genOne, { modDir: root }))).reason).toBe("busy");

    expect(existsSync(lockPathFor(contentDir))).toBe(false);
    expect(existsSync(lockPathFor(descriptorPath))).toBe(true);
  });

  it("serializes an install of A against an install of A.mod rather than deadlocking", async () => {
    // Their lock sets overlap on `.pdx-lock-A.mod`, and each wants two locks.
    // Taking them in one fixed order is what keeps the two from each holding
    // the lock the other is waiting for. They also genuinely collide — one
    // install's descriptor is the other's content folder — so exactly one of
    // them can succeed, and the loser has to refuse rather than hang.
    const root = tempDir();

    const settled = await Promise.allSettled([
      install(genOne, { modDir: root, dirName: "alpha" }),
      install(genOne, { modDir: root, dirName: "alpha.mod" }),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(MaterializationError);
    expect(siblings(root)).toEqual([]);
  });
});

describe("the journal survives being read back", () => {
  it("round-trips the records one materialization writes", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    const lockPath = writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      phases: ["staged", "content-activating", "committed"],
    });

    const journal = await readJournal(lockPath);

    expect(journal?.header?.target).toBe(out);
    expect(journal?.staging?.hadPrevious).toBe(true);
    expect(journal?.lastPhase).toBe("committed");
    expect(journal?.readable).toBe(true);
  });

  it("ignores a record a kill interrupted mid-append", async () => {
    // fsync happens per record, so the tail is the only thing a kill can tear.
    // Refusing to read a torn tail would make every killed build unrecoverable.
    const journal = parseJournal("/lock", `${BUILD_HEADER}\n{"record":"phase","phase":"stag`);

    expect(journal.readable).toBe(true);
    expect(journal.lastPhase).toBe("inspecting");
  });

  it("reads a recovery claim as arbitration rather than progress", async () => {
    // A recovery that died must not change which row the next one reads.
    const journal = parseJournal(
      "/lock",
      `${BUILD_HEADER}\n` +
        '{"record":"staging","phase":"staging","at":"t","staging":"/s","previous":"/p","hadPrevious":true}\n' +
        '{"record":"phase","phase":"recovering","at":"t","pid":1,"hostname":"h","token":"a"}\n'
    );

    expect(journal.lastPhase).toBe("staging");
  });
});

describe("the journal decoder fails closed", () => {
  /** The refusal itself, so a case can assert which record and which rule. */
  function rejection(text: string): JournalFormatError {
    let thrown: unknown;
    try {
      parseJournal("/lock", text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JournalFormatError);
    return thrown as JournalFormatError;
  }

  const CLAIM = { pid: 1, hostname: "h", token: "a" };
  const SECOND_CLAIM = { pid: 2, hostname: "h", token: "b" };

  /** The records before a tail, and the write a kill cut in half. */
  const STAGED = [headerRecord(), stagingRecord(), phaseRecord("staged")];
  const TORN_APPEND = '{"record":"phase","phase":"content-deac';

  /** Each fabricated journal, the record it breaks on, and the rule broken. */
  const REJECTED: readonly [string, string, number, RegExp][] = [
    [
      "a record kind nothing writes",
      journalText(headerRecord(), { record: "note" }),
      2,
      /"record" kind/,
    ],
    [
      "a phase name nothing announces",
      journalText(headerRecord(), phaseRecord("tidying")),
      2,
      /"phase"/,
    ],
    [
      "inspecting as a phase record",
      journalText(headerRecord(), phaseRecord("inspecting")),
      2,
      /only the header and staging records/,
    ],
    [
      "staging as a phase record",
      journalText(headerRecord(), phaseRecord("staging")),
      2,
      /only the header and staging records/,
    ],
    ["a second header", journalText(headerRecord(), headerRecord()), 2, /second header record/],
    [
      "a journal that does not open with its header",
      journalText(phaseRecord("staged"), headerRecord()),
      1,
      /opens with a header/,
    ],
    [
      "a marker among a writer's own records",
      journalText(headerRecord(), markerRecord()),
      2,
      /second marker record/,
    ],
    [
      "a marker file carrying more than the marker",
      journalText(markerRecord(), phaseRecord("staged")),
      2,
      /descriptor marker/,
    ],
    [
      "a second staging record",
      journalText(headerRecord(), stagingRecord(), stagingRecord()),
      3,
      /directly after the header/,
    ],
    [
      "a staging record the header does not precede",
      journalText(headerRecord(), phaseRecord("staged"), stagingRecord()),
      3,
      /directly after the header/,
    ],
    [
      "a journal from a version this build cannot read",
      journalText(headerRecord({ version: 2 })),
      1,
      /version 1 header/,
    ],
    [
      "a build header carrying the install half",
      journalText(headerRecord({ descriptorPath: "/out.mod" })),
      1,
      /only an install writes/,
    ],
    [
      "an install header missing half of it",
      journalText(
        headerRecord({
          mode: "install",
          descriptorPath: "/out.mod",
          descriptorSha256: "d",
          descriptorByteLength: 12,
        })
      ),
      1,
      /"secondaryLockPath"/,
    ],
    [
      "a build staging record carrying the descriptor half",
      journalText(headerRecord(), stagingRecord(INSTALL_STAGING_FIELDS)),
      2,
      /only an install writes/,
    ],
    [
      "an install staging record with nothing observed",
      journalText(
        headerRecord(INSTALL_HEADER_FIELDS),
        stagingRecord({ descriptorStaging: "/ds", descriptorPrevious: "/dp" })
      ),
      2,
      /"descriptorObserved"/,
    ],
    [
      "a descriptor observation that is not one",
      journalText(
        headerRecord(INSTALL_HEADER_FIELDS),
        stagingRecord({
          ...INSTALL_STAGING_FIELDS,
          descriptorObserved: { state: "file", basename: "out.mod" },
        })
      ),
      2,
      /"descriptorObserved\.byteLength"/,
    ],
    [
      "a field no record of its kind has",
      journalText(headerRecord(), stagingRecord({ hurry: true })),
      2,
      /"hurry"/,
    ],
    [
      "a field of the wrong type",
      journalText(headerRecord(), stagingRecord({ hadPrevious: "yes" })),
      2,
      /boolean "hadPrevious"/,
    ],
    [
      "a record missing a field it must have",
      journalText(headerRecord(), stagingRecord(), { record: "phase", phase: "staged" }),
      3,
      /string "at"/,
    ],
    [
      "an empty line between records",
      `${BUILD_HEADER}\n\n${JSON.stringify(stagingRecord())}\n`,
      2,
      /empty line/,
    ],
    [
      "a phase going backwards",
      historyText("build", ["staged", "content-activating", "committed", "staged"]),
      6,
      /"staged" after "committed"/,
    ],
    [
      "a phase the writer could not have skipped to",
      historyText("build", ["staged", "committed"]),
      4,
      /"committed" after "staged"/,
    ],
    [
      "a journal claiming it finished from a state that had not activated",
      historyText("build", ["staged", "content-deactivating", "done"]),
      5,
      /"done" after "content-deactivating"/,
    ],
    [
      "a descriptor phase in a build",
      historyText("build", ["staged", "content-activating", "descriptor-activating"]),
      5,
      /only an install writes/,
    ],
    [
      "progress after a recorded failure",
      historyText("build", ["staged", "failed", "content-activating"]),
      5,
      /after "failed"/,
    ],
    [
      "progress after a recovery took over",
      journalText(
        headerRecord(),
        stagingRecord(),
        phaseRecord("staged"),
        phaseRecord("recovering", CLAIM),
        phaseRecord("content-activating")
      ),
      5,
      /after a recovery claim/,
    ],
    [
      "a phase announced twice",
      historyText("build", ["staged", "content-activating", "committed", "committed"]),
      6,
      /"committed" after "committed"/,
    ],
    [
      "a rollback announced twice",
      historyText("build", ["staged", "content-activating", "rolled-back", "rolled-back"]),
      6,
      /"rolled-back" after "rolled-back"/,
    ],
    [
      "a recovery claim with no token to arbitrate on",
      journalText(headerRecord(), phaseRecord("recovering", { pid: 1, hostname: "h" })),
      2,
      /"token"/,
    ],
    [
      "a writer's own record carrying a claim's token",
      journalText(headerRecord(), stagingRecord(), phaseRecord("staged", { token: "a" })),
      3,
      /only a "recovering" claim/,
    ],
    [
      "a torn record a whole one, rather than a claim, terminated",
      journalText(headerRecord(), '{"record":"phase","phase":"content-deac', phaseRecord("staged")),
      2,
      /not a whole JSON record/,
    ],
    [
      "a malformed last line the writer terminated itself",
      journalText(headerRecord(), stagingRecord(), "garbage"),
      3,
      /not a whole JSON record/,
    ],
    [
      "a null last line the writer terminated itself",
      journalText(headerRecord(), stagingRecord(), "null"),
      3,
      /not a whole JSON record/,
    ],
  ];

  it.each(REJECTED)("refuses %s", (_label, text, line, detail) => {
    const error = rejection(text);

    expect(error.line).toBe(line);
    expect(error.detail).toMatch(detail);
    expect(error.message).toBe(`/lock: record ${line} ${error.detail}`);
  });

  it("reads a torn tail followed only by recovery claims", () => {
    // The one malformation a kill produces: the writer died mid-append, and
    // the recoveries that came along afterwards appended their claims.
    const journal = parseJournal(
      "/lock",
      journalText(
        headerRecord(),
        stagingRecord(),
        phaseRecord("staged"),
        TORN_APPEND,
        phaseRecord("recovering", CLAIM),
        phaseRecord("recovering", SECOND_CLAIM)
      )
    );

    expect(journal.records).toHaveLength(5);
    expect(journal.lastPhase).toBe("staged");
  });

  /**
   * Each claim writes its own leading newline without reading what is
   * already there, so where the record before it was terminated the claim
   * leaves an empty line behind, and where it was torn the claim ends it.
   */
  const TAILS: readonly [string, string, number][] = [
    [
      "a claim separated from a terminated record",
      journalText(...STAGED, "", phaseRecord("recovering", CLAIM)),
      4,
    ],
    [
      "two claims, each with its own separator",
      journalText(
        ...STAGED,
        "",
        phaseRecord("recovering", CLAIM),
        "",
        phaseRecord("recovering", SECOND_CLAIM)
      ),
      5,
    ],
    [
      "a claim that terminated a torn record",
      journalText(...STAGED, TORN_APPEND, phaseRecord("recovering", CLAIM)),
      4,
    ],
    [
      "a claim separated from a torn record",
      journalText(...STAGED, TORN_APPEND, "", phaseRecord("recovering", CLAIM)),
      4,
    ],
    [
      "a claim a kill tore off after another claim",
      `${journalText(...STAGED, "", phaseRecord("recovering", CLAIM))}\n${TORN_APPEND}`,
      4,
    ],
  ];

  it.each(TAILS)("reads %s", (_label, text, records) => {
    const journal = parseJournal("/lock", text);

    expect(journal.records).toHaveLength(records);
    expect(journal.lastPhase).toBe("staged");
  });
});

describe("every history a writer can leave is accepted", () => {
  /** The full content-and-descriptor path an install takes to commit. */
  const INSTALL_COMMIT = [
    "staged",
    "content-deactivating",
    "content-activating",
    "descriptor-deactivating",
    "descriptor-activating",
    "committed",
    "done",
  ];

  const HISTORIES: readonly [string, "build" | "install", readonly string[], string][] = [
    [
      "a build that committed over a previous output",
      "build",
      ["staged", "content-deactivating", "content-activating", "committed", "done"],
      "done",
    ],
    [
      "a first build, with nothing to set aside",
      "build",
      ["staged", "content-activating", "committed", "done"],
      "done",
    ],
    [
      "a build that rolled its previous output back",
      "build",
      ["staged", "content-deactivating", "content-activating", "rolling-back", "rolled-back"],
      "rolled-back",
    ],
    [
      "a first build that rolled back",
      "build",
      ["staged", "content-activating", "rolled-back"],
      "rolled-back",
    ],
    [
      "a rollback whose own rename did not land",
      "build",
      ["staged", "content-deactivating", "content-activating", "rolling-back"],
      "rolling-back",
    ],
    ["an install that committed both halves", "install", INSTALL_COMMIT, "done"],
    [
      "an install with no descriptor to set aside",
      "install",
      ["staged", "content-activating", "descriptor-activating", "committed", "done"],
      "done",
    ],
    [
      "an install that rolled back from the descriptor set-aside",
      "install",
      [
        "staged",
        "content-deactivating",
        "content-activating",
        "descriptor-deactivating",
        "rolling-back",
        "rolled-back",
      ],
      "rolled-back",
    ],
    [
      "an install that rolled back from the descriptor rename",
      "install",
      [
        "staged",
        "content-deactivating",
        "content-activating",
        "descriptor-activating",
        "rolling-back",
        "rolled-back",
      ],
      "rolled-back",
    ],
    [
      "an install that rolled back in its content half",
      "install",
      ["staged", "content-deactivating", "content-activating", "rolling-back", "rolled-back"],
      "rolled-back",
    ],
  ];

  it.each(HISTORIES)("accepts %s", (_label, mode, phases, lastPhase) => {
    const journal = parseJournal("/lock", historyText(mode, phases));

    expect(journal.lastPhase).toBe(lastPhase);
    expect(journal.readable).toBe(true);
  });

  it("accepts a failure recorded wherever an install had got to", () => {
    for (let reached = 0; reached <= INSTALL_COMMIT.length; reached++) {
      const phases = [...INSTALL_COMMIT.slice(0, reached), "failed"];

      expect(parseJournal("/lock", historyText("install", phases)).lastPhase).toBe("failed");
    }
  });

  it("accepts the claims recoveries append after the writer stopped", () => {
    const text =
      historyText("build", ["staged", "content-deactivating", "failed"]) +
      journalText(
        phaseRecord("recovering", { pid: 1, hostname: "h", token: "a" }),
        phaseRecord("recovering", { pid: 2, hostname: "h", token: "b" })
      );

    expect(parseJournal("/lock", text).lastPhase).toBe("failed");
  });
});

describe("recovery reads the journal and nothing else", () => {
  it("reports no transaction when there is no lock file", async () => {
    const out = join(tempDir(), "out");
    await write(out, genOne);

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("no-transaction");
    expect(report.actions).toEqual([]);
    expect(existsSync(join(out, MANIFEST))).toBe(true);
  });

  it("refuses to recover a transaction whose writer is still running", async () => {
    const out = join(tempDir(), "out");
    await write(out, genOne);
    writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      pid: process.pid,
      phases: ["staged"],
    });

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("busy");
    expect(existsSync(lockPathFor(out))).toBe(true);
  });

  it("refuses to decide about a journal from another machine", async () => {
    const out = join(tempDir(), "out");
    await write(out, genOne);
    writeJournal({ target: out, rendered: genOne, hostname: "some-other-host" });

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    expect(existsSync(lockPathFor(out))).toBe(true);
  });

  it("removes a lock whose transaction never got past inspecting", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    writeJournal({ target: out, rendered: genTwo });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("cleaned");
    expect(report.phase).toBe("inspecting");
    expect(report.actions).toEqual([{ kind: "released-lock", path: lockPathFor(out) }]);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("removes a staging tree the journal named, and leaves the target alone", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: manifestSha(out),
      phases: ["staged"],
    });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("cleaned");
    expect(report.actions).toContainEqual({ kind: "removed", path: paths.staging });
    expect(readdirSync(parent)).toEqual(["out"]);
    expect(existsSync(join(out, GEN_TWO_ONLY))).toBe(false);
  });

  it("restores the previous output when the set-aside rename was the last thing to land", async () => {
    // Journaled at `content-deactivating` and found with the target moved: the
    // rename happened, the one that replaces it did not.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating"],
    });
    renameSync(out, paths.previous);

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("restored-previous");
    expect(report.actions).toContainEqual({
      kind: "renamed",
      path: paths.previous,
      to: out,
    });
    expect(manifestSha(out)).toBe(previousSha);
    expect(existsSync(join(out, GEN_TWO_ONLY))).toBe(false);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("cleans up when the set-aside rename had not happened yet", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating"],
    });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("cleaned");
    expect(manifestSha(out)).toBe(previousSha);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("completes a build whose activation rename landed", async () => {
    // For a build that rename is the commit: the new output is published, and
    // recovery finishes the cleanup rather than undoing a published state.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(out, paths.previous);
    renameSync(paths.staging, out);

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("completed-activation");
    expect(manifestSha(out)).toBe(genTwo.sha256);
    expect(existsSync(join(out, GEN_TWO_ONLY))).toBe(true);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("restores the previous output when the activation rename had not landed", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(out, paths.previous);

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("restored-previous");
    expect(manifestSha(out)).toBe(previousSha);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("finishes the cleanup a committed transaction did not get to", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: manifestSha(out),
      phases: ["staged", "content-deactivating", "content-activating", "committed"],
    });
    renameSync(out, paths.previous);
    renameSync(paths.staging, out);

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("completed-activation");
    expect(report.actions).toContainEqual({ kind: "removed", path: paths.previous });
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("refuses, touching nothing, when the target is a tree the journal cannot account for", async () => {
    // The one rule recovery cannot bend: it deletes what a journal named or
    // what it verified by hash, and this target is neither.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: manifestSha(out),
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(out, paths.previous);
    mkdirSync(out);
    writeFileSync(join(out, "someone-elses.txt"), "not ours", "utf8");

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.[0]?.path).toBe(out);
    expect(readFileSync(join(out, "someone-elses.txt"), "utf8")).toBe("not ours");
    expect(existsSync(paths.previous)).toBe(true);
    expect(existsSync(lockPathFor(out))).toBe(true);
  });

  it("can be retried after a refusal, once the reason for it is gone", async () => {
    // Recovery leaves an arbitration record in the journal. Its own record
    // must not be what makes the second attempt say somebody else is already
    // recovering — an author who fixes what the refusal reported has to be
    // able to run the same call again.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(out, paths.previous);
    mkdirSync(out);
    writeFileSync(join(out, "someone-elses.txt"), "not ours", "utf8");

    expect((await refusal(recoverMaterialization(out))).reason).toBe("recovery-required");
    rmSync(out, { recursive: true });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("restored-previous");
    expect(manifestSha(out)).toBe(previousSha);
  });

  it("does not conjure a lock for a transaction another recovery already finished", async () => {
    // Two recoveries of one dead transaction: both read the journal, the
    // first one wins and unlinks the lock. The second must not recreate the
    // file it is claiming — it would win an empty arbitration and then act on
    // a journal describing a state that has already been put right, deleting
    // and refusing against evidence that is no longer true.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const { paths } = await stageBuild(out, genTwo);
    const lockPath = writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: manifestSha(out),
      phases: ["staged", "content-deactivating"],
    });
    renameSync(out, paths.previous);
    // What the second recovery read before the first one ran.
    const stale = await readJournal(lockPath);
    const identity = {
      pid: stale!.header!.pid,
      startedAt: stale!.header!.startedAt,
    };

    expect((await recoverMaterialization(out)).outcome).toBe("restored-previous");

    expect(await claimRecovery(out, lockPath, identity)).toBe("gone");
    expect(existsSync(lockPath)).toBe(false);
    // And the ordinary entry point says the same thing, without touching the
    // target the first recovery restored.
    const second = await recoverMaterialization(out);
    expect(second.outcome).toBe("no-transaction");
    expect(second.actions).toEqual([]);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("does not append its claim to a journal belonging to a different transaction", async () => {
    // The other half of the same race: the lock was released and a fresh
    // writer took it. That journal is not the one the claimant read, and a
    // recovery record appended into it would be a stranger's arbitration
    // record in a live writer's account of itself.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    const lockPath = writeJournal({ target: out, rendered: genTwo, pid: process.pid });
    const successor = readFileSync(lockPath, "utf8");

    const claim = await claimRecovery(out, lockPath, {
      pid: deadPid(),
      startedAt: "1970-01-01T00:00:00.000Z",
    });

    expect(claim).toBe("gone");
    expect(readFileSync(lockPath, "utf8")).toBe(successor);
  });

  it("appends its claim on a fresh line after a torn tail", async () => {
    // The tail a kill leaves has no newline, so a claim written straight
    // after it would be spliced onto the half-written record and lost: every
    // recovery would then read its own claim as missing and report "lost".
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    const lockPath = writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      phases: ["staged"],
    });
    appendFileSync(lockPath, '{"record":"phase","phase":"content-deac', "utf8");
    const journal = await readJournal(lockPath);

    const claim = await claimRecovery(out, lockPath, {
      pid: journal!.header!.pid,
      startedAt: journal!.header!.startedAt,
    });

    expect(claim).toBe("won");
    const claims = parseJournal(lockPath, readFileSync(lockPath, "utf8")).records.filter(
      (record) => record.record === "phase" && record.phase === "recovering"
    );
    expect(claims).toHaveLength(1);
  });

  it("leaves the journal readable when a claim follows a claim", async () => {
    // Each claim writes its own separator without reading what is already
    // there, because two recoveries can both read before either appends. The
    // blank line that leaves behind is the shape the reader must accept.
    const parent = tempDir();
    const out = join(parent, "out");
    mkdirSync(out);
    const lockPath = writeJournal({
      target: out,
      rendered: genOne,
      paths: stagingPaths(out),
      phases: ["staged"],
    });
    const journal = await readJournal(lockPath);
    const identity = { pid: journal!.header!.pid, startedAt: journal!.header!.startedAt };

    expect(await claimRecovery(out, lockPath, identity)).toBe("won");
    expect(await claimRecovery(out, lockPath, identity)).toBe("won");

    const after = parseJournal(lockPath, readFileSync(lockPath, "utf8"));
    expect(
      after.records.filter((record) => record.record === "phase" && record.phase === "recovering")
    ).toHaveLength(2);
    expect(after.lastPhase).toBe("staged");
  });

  it.skipIf(process.platform === "win32")(
    "gives no verdict about a lock file the path has stopped naming",
    async () => {
      // A handle outlives its directory entry. The recovery that wins unlinks
      // the lock by path when it finishes, so a claim that verified only
      // through its own handle could win on an inode nothing points at any
      // more and then unlink whatever a fresh writer had created at that path.
      //
      // The swap has to happen inside one claim to be the real race, which
      // takes the fault-injection seam PR B adds. What the verdict rests on is
      // pinned here instead: the comparison itself, in all three states.
      const lockPath = join(tempDir(), ".pdx-lock-out");
      writeFileSync(lockPath, "one writer's lock\n", "utf8");
      const handle = await open(lockPath, "r");

      try {
        expect(await pathStillNames(handle, lockPath)).toBe(true);
        rmSync(lockPath);
        expect(await pathStillNames(handle, lockPath)).toBe(false);
        writeFileSync(lockPath, "a different writer's lock\n", "utf8");
        expect(await pathStillNames(handle, lockPath)).toBe(false);
      } finally {
        await handle.close();
      }
    }
  );

  it("reports residue no journal names, and never removes it", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const orphan = join(parent, `.pdx-staging-${randomUUID()}`);
    mkdirSync(orphan);

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("no-transaction");
    expect(report.warnings.map((warning) => warning.path)).toEqual([orphan]);
    expect(existsSync(orphan)).toBe(true);
  });

  it("lets an ordinary build run again once recovery has finished", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: manifestSha(out),
      phases: ["staged", "content-deactivating"],
    });
    renameSync(out, paths.previous);

    expect((await refusal(write(out, genTwo))).reason).toBe("recovery-required");
    expect((await recoverMaterialization(out)).outcome).toBe("restored-previous");

    expect((await write(out, genTwo)).status).toBe("written");
    expect(existsSync(join(out, GEN_TWO_ONLY))).toBe(true);
    expect(readdirSync(parent)).toEqual(["out"]);
  });
});

describe("recovering an install recovers both halves", () => {
  it("restores the pair when the content moved and the descriptor did not", async () => {
    // The install is not committed until the descriptor follows the content,
    // so a half-swapped pair is put back rather than finished: the rename that
    // did not happen may have failed for a reason that is still true.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const previousSha = manifestSha(first.contentDir);
    const descriptorBefore = readFileSync(first.descriptorPath, "utf8");
    const staged = await stageInstall(root);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      previousManifestSha256: previousSha,
      descriptor: staged.descriptor,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(staged.contentDir, staged.paths.previous);
    renameSync(staged.paths.staging, staged.contentDir);

    const report = await recoverInstallation({ modDir: root, dirName: "tx_probe" });

    expect(report.outcome).toBe("restored-previous");
    expect(manifestSha(first.contentDir)).toBe(previousSha);
    expect(existsSync(join(first.contentDir, GEN_TWO_ONLY))).toBe(false);
    expect(readFileSync(first.descriptorPath, "utf8")).toBe(descriptorBefore);
    expect(readdirSync(root).sort()).toEqual(["tx_probe", "tx_probe.mod"]);
  });

  it("completes the pair when both renames landed", async () => {
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const staged = await stageInstall(root);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      previousManifestSha256: manifestSha(first.contentDir),
      descriptor: staged.descriptor,
      phases: [
        "staged",
        "content-deactivating",
        "content-activating",
        "descriptor-deactivating",
        "descriptor-activating",
      ],
    });
    renameSync(staged.contentDir, staged.paths.previous);
    renameSync(staged.paths.staging, staged.contentDir);
    renameSync(staged.descriptorPath, staged.descriptor.previous);
    renameSync(staged.descriptor.staging, staged.descriptorPath);

    const report = await recoverInstallation({ modDir: root, dirName: "tx_probe" });

    expect(report.outcome).toBe("completed-activation");
    expect(manifestSha(first.contentDir)).toBe(genTwo.sha256);
    expect(readFileSync(first.descriptorPath, "utf8")).toBe(staged.contents);
    expect(readdirSync(root).sort()).toEqual(["tx_probe", "tx_probe.mod"]);
  });

  it("puts the descriptor back when only it had moved aside", async () => {
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const previousSha = manifestSha(first.contentDir);
    const descriptorBefore = readFileSync(first.descriptorPath, "utf8");
    const staged = await stageInstall(root);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      previousManifestSha256: previousSha,
      descriptor: staged.descriptor,
      phases: ["staged", "content-deactivating", "content-activating", "descriptor-deactivating"],
    });
    renameSync(staged.contentDir, staged.paths.previous);
    renameSync(staged.paths.staging, staged.contentDir);
    renameSync(staged.descriptorPath, staged.descriptor.previous);

    const report = await recoverInstallation({ modDir: root, dirName: "tx_probe" });

    expect(report.outcome).toBe("restored-previous");
    expect(manifestSha(first.contentDir)).toBe(previousSha);
    expect(readFileSync(first.descriptorPath, "utf8")).toBe(descriptorBefore);
    expect(readdirSync(root).sort()).toEqual(["tx_probe", "tx_probe.mod"]);
  });

  it("reaches the transaction through the descriptor lock's marker", async () => {
    // Either lock is a way in, and only one of them is ever the account of
    // what happened.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const previousSha = manifestSha(first.contentDir);
    const staged = await stageInstall(root);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      previousManifestSha256: previousSha,
      descriptor: staged.descriptor,
      phases: ["staged", "content-deactivating"],
    });
    renameSync(staged.contentDir, staged.paths.previous);
    // Only the marker survives: recovery has to follow it to the journal.
    rmSync(lockPathFor(staged.contentDir));
    writeFileSync(
      lockPathFor(staged.descriptorPath),
      JSON.stringify({
        record: "marker",
        pid: deadPid(),
        hostname: hostname(),
        primary: lockPathFor(staged.contentDir),
      }) + "\n",
      "utf8"
    );

    const report = await recoverInstallation({ modDir: root, dirName: "tx_probe" });

    // The primary journal is gone, which only happens after the transaction
    // ended, so the marker is cleared and nothing else is touched.
    expect(report.outcome).toBe("cleaned");
    expect(existsSync(lockPathFor(staged.descriptorPath))).toBe(false);
    expect(existsSync(staged.paths.previous)).toBe(true);
  });

  it("lets an ordinary install run again once recovery has finished", async () => {
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const staged = await stageInstall(root);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      previousManifestSha256: manifestSha(first.contentDir),
      descriptor: staged.descriptor,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(staged.contentDir, staged.paths.previous);
    renameSync(staged.paths.staging, staged.contentDir);

    expect((await refusal(install(genTwo, { modDir: root }))).reason).toBe("recovery-required");
    const recovered: RecoveryReport = await recoverInstallation({
      modDir: root,
      dirName: "tx_probe",
    });
    expect(recovered.outcome).toBe("restored-previous");

    const report = await install(genTwo, { modDir: root });
    expect(report.status).toBe("written");
    expect(existsSync(join(report.contentDir, GEN_TWO_ONLY))).toBe(true);
    expect(readdirSync(root).sort()).toEqual(["tx_probe", "tx_probe.mod"]);
  });
});

describe("paths that cannot exist are refused before anything is created", () => {
  it("refuses a target whose lock name would exceed the filesystem limit", async () => {
    // The lock is a sibling named after the target, so a basename that is
    // legal on its own can still make the transaction unrepresentable.
    const parent = tempDir();
    const out = join(parent, "l".repeat(250));

    const error = await refusal(write(out, genOne));

    expect(error.reason).toBe("unrepresentable");
    if (error.failure.reason !== "unrepresentable") {
      throw new Error("unreachable");
    }
    expect(error.failure.paths).toHaveLength(1);
    expect(basename(error.failure.paths[0]!)).toContain(".pdx-lock-");
    // Nothing was created, including the target itself.
    expect(readdirSync(parent)).toEqual([]);
  });

  it("refuses a final path longer than the platform allows", () => {
    // Measured on the string rather than by trying it: the point is to refuse
    // before the lock file exists, which means before anything is opened.
    const target = join("/", ...Array.from({ length: 200 }, () => "a".repeat(200)), "out");

    let thrown: unknown;
    try {
      assertRepresentableMaterialization(target, genOne);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MaterializationError);
    expect((thrown as MaterializationError).reason).toBe("unrepresentable");
  });

  it.skipIf(process.platform === "win32")(
    "measures the longest rendered path in the unit the platform limit uses",
    () => {
      // POSIX counts bytes. Ninety CJK characters are 270 of them and only 90
      // UTF-16 units, so choosing the path to measure by `.length` picks the
      // hundred-character ASCII sibling and never measures the one that
      // actually overflows. Same target twice: the ASCII-only render fits, and
      // adding the shorter-looking multibyte path must refuse. The wide path
      // is split into components because one component may not exceed 255
      // bytes either — a limit logical paths already enforce on their own.
      const ascii = "a".repeat(100);
      const wide = Array.from({ length: 3 }, () => "漢".repeat(30)).join("/");
      const claim = (relPath: string) => ({ path: relPath, owner: "test", text: "x\n" });
      const ceiling = process.platform === "darwin" ? 1024 : 4096;
      const target = targetOfLength(ceiling - 200);

      expect(() =>
        assertRepresentableMaterialization(
          target,
          createRenderedMod("tx_probe", "", [claim(ascii)])
        )
      ).not.toThrow();

      const error = (() => {
        try {
          assertRepresentableMaterialization(
            target,
            createRenderedMod("tx_probe", "", [claim(ascii), claim(wide)])
          );
          return undefined;
        } catch (thrown) {
          return thrown;
        }
      })();
      expect(error).toBeInstanceOf(MaterializationError);
      expect((error as MaterializationError).reason).toBe("unrepresentable");
    }
  );

  it("accepts the paths an ordinary materialization actually uses", () => {
    expect(() =>
      assertRepresentableMaterialization("/tmp/mods/tx_probe", genOne, "/tmp/mods/tx_probe.mod")
    ).not.toThrow();
  });
});

describe("dirname is not part of the contract", () => {
  it("reports the physical target when the caller names a symlinked parent", async () => {
    // Two spellings of one directory have to be one materialization, or the
    // lock protecting one of them protects nothing.
    const parent = tempDir();
    const report = await write(join(parent, "out"), genOne);

    expect(report.outDir).toBe(join(parent, "out"));
    expect(dirname(report.outDir)).toBe(realpathSync(parent));
  });
});

describe("an illegal history refuses before recovery touches anything", () => {
  it("refuses a journal claiming it finished from a state that had not activated", async () => {
    // The reproduction. The tree is a real pre-commit state: the previous
    // output set aside, the staged tree not yet renamed into its place. The
    // journal has one record too many. Read as progress, "done" says the
    // transaction committed and cleaned up, so everything the journal names
    // is residue — including the set-aside copy, which is the only output
    // there is.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    const lockPath = writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating", "done"],
    });
    renameSync(out, paths.previous);
    const lockBefore = readFileSync(lockPath, "utf8");

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.journalPath).toBe(lockPath);
    expect(error.message).toContain('announces "done" after "content-deactivating"');
    expect(existsSync(out)).toBe(false);
    expect(manifestSha(paths.previous)).toBe(previousSha);
    expect(existsSync(join(paths.staging, MANIFEST))).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe(lockBefore);

    // The same tree, with a journal that describes it: only the extra record
    // stood between this state and its recovery.
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating"],
    });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("restored-previous");
    expect(manifestSha(out)).toBe(previousSha);
    expect(existsSync(join(out, GEN_TWO_ONLY))).toBe(false);
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("refuses a done journal over a target that never took the new tree", async () => {
    // The suffix the phase table cannot see through. Append
    // "content-activating", "committed" and "done" to the same pre-commit
    // state and every transition is one a writer makes — but the target is
    // still absent, so nothing was published and the set-aside copy is not
    // residue. "done" is checked against the tree rather than believed.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    const lockPath = writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating", "content-activating", "committed", "done"],
    });
    renameSync(out, paths.previous);

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.map((row) => row.path)).toContain(out);
    expect(existsSync(out)).toBe(false);
    expect(manifestSha(paths.previous)).toBe(previousSha);
    expect(existsSync(join(paths.staging, MANIFEST))).toBe(true);
    // The claim this recovery appended is the only mark it left, and the
    // journal still reads as the transaction it was.
    const after = parseJournal(lockPath, readFileSync(lockPath, "utf8"));
    expect(after.header?.target).toBe(out);
    expect(after.lastPhase).toBe("done");
  });
});

describe("a journal only has authority over its own siblings", () => {
  it("refuses a journal naming a staging path somewhere else entirely", async () => {
    // The journal lives in the directory it protects, so anyone who can write
    // there can write one. What keeps that from being a delete-anything
    // primitive is that recovery only acts on names a materialization of this
    // target could have minted.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const victim = join(tempDir(), "someone-elses-work");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "not ours", "utf8");
    writeJournal({
      target: out,
      rendered: genTwo,
      paths: { staging: victim, previous: join(parent, `.pdx-previous-${randomUUID()}`) },
      previousManifestSha256: manifestSha(out),
      phases: ["staged"],
    });

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.map((row) => row.path)).toContain(victim);
    expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("not ours");
    expect(existsSync(victim)).toBe(true);
  });

  it("refuses a sibling name that is not one materialization mints", async () => {
    // Right directory, wrong shape: without the UUID check, "any name in the
    // parent" would be deletable by planting a journal that claims it.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const neighbour = join(parent, ".pdx-staging-not-a-uuid");
    mkdirSync(neighbour);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths: { staging: neighbour, previous: join(parent, `.pdx-previous-${randomUUID()}`) },
      phases: ["staged"],
    });

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    expect(existsSync(neighbour)).toBe(true);
  });

  it("refuses a journal written against a different target", async () => {
    const parent = tempDir();
    const out = join(parent, "out");
    const other = join(parent, "other");
    await write(out, genOne);
    const lockPath = lockPathFor(out);
    const stray = writeJournal({ target: other, rendered: genTwo });
    renameSync(stray, lockPath);

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.[0]?.path).toBe(other);
  });
});

describe("recovery never deletes what it cannot account for", () => {
  it("refuses to delete a new target somebody edited after the crash", async () => {
    // The manifest's own hash says which render was staged; it says nothing
    // about what happened to the tree afterwards. An edit made to the
    // half-published output exists nowhere else, so it is not ours to delete.
    const root = tempDir();
    const staged = await halfSwappedInstall(root);
    const edited = join(staged.contentDir, "common/technology/tx_probe_technology.txt");
    writeFileSync(edited, "hand edited after the crash", "utf8");

    const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.map((row) => row.path)).toContain(edited);
    expect(readFileSync(edited, "utf8")).toBe("hand edited after the crash");
    expect(existsSync(staged.paths.previous)).toBe(true);
  });

  it("refuses to delete a new target somebody added a file to after the crash", async () => {
    const root = tempDir();
    const staged = await halfSwappedInstall(root);
    const added = join(staged.contentDir, "notes-written-after-the-crash.txt");
    writeFileSync(added, "mine", "utf8");

    const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

    expect(error.reason).toBe("recovery-required");
    expect(readFileSync(added, "utf8")).toBe("mine");
  });

  it("still restores when the target carries entries preserved from the previous output", async () => {
    // The mirror of the two above: an author's file that was already there is
    // carried into the new tree as the same inode, so removing this link
    // loses nothing — and refusing here would make an ordinary install
    // unrecoverable.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    writeFileSync(join(first.contentDir, "notes.txt"), "mine\n", "utf8");
    const staged = await halfSwappedInstall(root);

    const report = await recoverInstallation({ modDir: root, dirName: "tx_probe" });

    expect(report.outcome).toBe("restored-previous");
    expect(readFileSync(join(first.contentDir, "notes.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(join(first.contentDir, GEN_TWO_ONLY))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(["tx_probe", "tx_probe.mod"]);
  });
});

describe("recovery refuses evidence it cannot read in full", () => {
  /** Rewrite a materialized tree's ownership manifest through `patch`. */
  function patchManifest(target: string, patch: (manifest: Record<string, unknown>) => void): void {
    const manifestPath = join(target, MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    patch(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  /** A build whose activation rename landed, which recovery would complete. */
  async function swappedBuild(parent: string) {
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    const { paths } = await stageBuild(out, genTwo);
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(out, paths.previous);
    renameSync(paths.staging, out);
    return { out, paths, previousSha };
  }

  it.each([
    ["a version this build does not write", (m: Record<string, unknown>) => (m["version"] = 2)],
    [
      "a file record with no byteLength",
      (m: Record<string, unknown>) => {
        delete (m["files"] as Record<string, unknown>[])[0]!["byteLength"];
      },
    ],
    ["no prefix at all", (m: Record<string, unknown>) => delete m["prefix"]],
  ])("refuses a target whose ownership manifest has %s", async (_label, patch) => {
    // The manifest is what says the tree in front of recovery is the one the
    // transaction staged. Reading a manifest it cannot decode as "no manifest
    // here" would let a hand-edited file decide a delete.
    const parent = tempDir();
    const { out, paths, previousSha } = await swappedBuild(parent);
    patchManifest(out, patch);

    const error = await refusal(recoverMaterialization(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.map((row) => row.path)).toContain(join(out, MANIFEST));
    expect(existsSync(join(out, GEN_TWO_ONLY))).toBe(true);
    expect(manifestSha(paths.previous)).toBe(previousSha);
  });

  it("leaves a target alone when the transaction never named a sibling", async () => {
    // A writer killed while inspecting had no authority over anything: it
    // created nothing, so there is nothing to undo, and whatever state the
    // target's own manifest is in is not this recovery's to have an opinion
    // about. Reading it here would turn a lock somebody has to clear into a
    // refusal they cannot.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    patchManifest(out, (manifest) => (manifest["version"] = 2));
    const manifestBefore = readFileSync(join(out, MANIFEST), "utf8");
    const lockPath = writeJournal({ target: out, rendered: genTwo });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("cleaned");
    expect(report.actions).toEqual([{ kind: "released-lock", path: lockPath }]);
    expect(readFileSync(join(out, MANIFEST), "utf8")).toBe(manifestBefore);
    expect(readdirSync(parent)).toEqual(["out"]);
  });
});

describe.skipIf(!posix)("recovery refuses a tree it cannot walk", () => {
  /** Modes to put back, or the temp directory cannot be removed afterwards. */
  const unreadable: string[] = [];

  afterEach(() => {
    for (const dir of unreadable.splice(0)) {
      chmodSync(dir, 0o755);
    }
  });

  it("refuses when a directory in the target will not open", async () => {
    // The tree is about to be deleted to put the previous output back, and a
    // directory that will not open may hold the only copy of something. An
    // unreadable directory is therefore missing evidence, not an empty one.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const notes = join(first.contentDir, "notes");
    mkdirSync(notes);
    writeFileSync(join(notes, "kept.txt"), "mine\n", "utf8");
    const staged = await halfSwappedInstall(root);
    writeFileSync(join(staged.contentDir, "notes/after-the-crash.txt"), "written after\n", "utf8");
    chmodSync(join(staged.contentDir, "notes"), 0);
    unreadable.push(join(staged.contentDir, "notes"));

    const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.map((row) => row.path)).toContain(
      join(staged.contentDir, "notes")
    );
    expect(manifestSha(staged.contentDir)).toBe(genTwo.sha256);
    expect(manifestSha(staged.paths.previous)).toBe(staged.previousSha);
  });
});

describe("a preserved entry is only preserved while it is the same file", () => {
  it("refuses when a preserved file was replaced by a symlink after the crash", async () => {
    // A symlink where the carried file was is not that file: removing it
    // removes the only record of where it pointed, and following it would
    // decide a delete from somebody else's inode.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    writeFileSync(join(first.contentDir, "notes.txt"), "mine\n", "utf8");
    const staged = await halfSwappedInstall(root);
    const carried = join(staged.contentDir, "notes.txt");
    rmSync(carried);
    symlinkSync(join(staged.paths.previous, "notes.txt"), carried);

    const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.evidence?.map((row) => row.path)).toContain(carried);
    expect(existsSync(carried)).toBe(true);
  });

  it("refuses when a preserved file is no longer the inode it was carried as", async () => {
    // Same name, same place, different file: the link to the previous
    // generation is what makes deleting this one lossless, and it is gone.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    writeFileSync(join(first.contentDir, "notes.txt"), "mine\n", "utf8");
    const staged = await halfSwappedInstall(root);
    const carried = join(staged.contentDir, "notes.txt");
    rmSync(carried);
    writeFileSync(carried, "written after the crash\n", "utf8");

    const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

    expect(error.reason).toBe("recovery-required");
    expect(readFileSync(carried, "utf8")).toBe("written after the crash\n");
  });
});

describe("the siblings a materialization mints are the ones a journal may name", () => {
  it("mints all four install siblings beside the target", () => {
    const parent = tempDir();
    const paths = installPaths(join(parent, "out"));

    for (const [role, candidate] of Object.entries(paths)) {
      expect(dirname(candidate)).toBe(parent);
      expect(isMintedSibling(candidate, parent, role as SiblingRole)).toBe(true);
    }
    expect(new Set(Object.values(paths)).size).toBe(4);
  });

  it.each([
    ["another directory", (parent: string) => join(dirname(parent), ".pdx-staging-", randomUUID())],
    ["another role's prefix", (parent: string) => join(parent, `.pdx-previous-${randomUUID()}`)],
    ["a suffix that is not a UUID", (parent: string) => join(parent, ".pdx-staging-not-a-uuid")],
  ])("rejects a staging name in %s", (_label, mint) => {
    const parent = tempDir();

    expect(isMintedSibling(mint(parent), parent, "staging")).toBe(false);
  });
});

describe("both halves of an install are decided before either is touched", () => {
  it("leaves the content half untouched when the descriptor half is unaccountable", async () => {
    // A refusal that had already acted on the content half would report a
    // state it created itself, and leave a pair that is neither generation.
    const root = tempDir();
    const first = await install(genOne, { modDir: root });
    const previousSha = manifestSha(first.contentDir);
    const staged = await stageInstall(root);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      previousManifestSha256: previousSha,
      descriptor: staged.descriptor,
      phases: ["staged", "content-deactivating", "content-activating"],
    });
    renameSync(staged.contentDir, staged.paths.previous);
    renameSync(staged.paths.staging, staged.contentDir);
    // Neither the descriptor this install observed nor the one it wrote.
    writeFileSync(staged.descriptorPath, "something else entirely\n", "utf8");
    const contentBefore = manifestSha(staged.contentDir);
    const previousBefore = manifestSha(staged.paths.previous);

    const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

    expect(error.reason).toBe("recovery-required");
    // The content half is exactly as the refusal found it: still swapped.
    expect(manifestSha(staged.contentDir)).toBe(contentBefore);
    expect(manifestSha(staged.paths.previous)).toBe(previousBefore);
    expect(existsSync(join(staged.contentDir, GEN_TWO_ONLY))).toBe(true);
    expect(readFileSync(staged.descriptorPath, "utf8")).toBe("something else entirely\n");
  });
});

describe("a finished transaction's residue is still its own", () => {
  it("removes journal-named leftovers at the done phase", async () => {
    // "done" means the commit and the cleanup both happened, so anything the
    // journal names that is still here is residue a cleanup could not remove.
    // It is journal-named, and the target holds what the journal published, so
    // recovery has the authority to finish the job.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    const previousSha = manifestSha(out);
    await write(out, genTwo);
    const paths = stagingPaths(out);
    mkdirSync(paths.previous);
    writeFileSync(join(paths.previous, "leftover.txt"), "old", "utf8");
    writeJournal({
      target: out,
      rendered: genTwo,
      paths,
      previousManifestSha256: previousSha,
      phases: ["staged", "content-activating", "committed", "done"],
    });

    const report = await recoverMaterialization(out);

    expect(report.outcome).toBe("cleaned");
    expect(report.actions).toContainEqual({ kind: "removed", path: paths.previous });
    expect(readdirSync(parent)).toEqual(["out"]);
  });
});

describe("a lock that cannot be read is a refusal with a path in it", () => {
  it.each([
    ["a build", async (out: string) => write(out, genOne)],
    ["a recovery", async (out: string) => recoverMaterialization(out)],
  ])("reports an unreadable lock to %s as recovery-required", async (_label, operation) => {
    // A directory where the lock goes is exactly the kind of thing somebody
    // has to look at, and a bare EISDIR says neither which file nor why.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, genOne);
    mkdirSync(lockPathFor(out));

    const error = await refusal(operation(out));

    expect(error.reason).toBe("recovery-required");
    if (error.failure.reason !== "recovery-required") {
      throw new Error("unreachable");
    }
    expect(error.failure.journalPath).toBe(lockPathFor(out));
    expect(error.message).toContain("EISDIR");
  });
});

describe("a descriptor symlink is compared by what it points at", () => {
  /** An install stopped with its descriptor set aside, both sides symlinks. */
  async function symlinkedDescriptor(root: string, previousTo: string, currentTo: string) {
    await install(genOne, { modDir: root });
    const staged = await stageInstall(root);
    rmSync(staged.descriptorPath);
    symlinkSync(previousTo, staged.descriptor.previous);
    symlinkSync(currentTo, staged.descriptorPath);
    writeJournal({
      target: staged.contentDir,
      rendered: genTwo,
      paths: staged.paths,
      descriptor: { ...staged.descriptor, observed: { state: "symlink" } },
      phases: ["staged", "content-deactivating", "content-activating", "descriptor-deactivating"],
    });
    return staged;
  }

  it.skipIf(process.platform === "win32")(
    "refuses to discard a set-aside copy that points somewhere else",
    async () => {
      // Two symlinks are both "a symlink". Discarding the set-aside one on
      // that basis would destroy the only record of where the author's link
      // pointed, which is the whole content of a symlink.
      const root = tempDir();
      const here = join(root, "here.mod");
      const there = join(root, "there.mod");
      writeFileSync(here, "here", "utf8");
      writeFileSync(there, "there", "utf8");
      const staged = await symlinkedDescriptor(root, here, there);

      const error = await refusal(recoverInstallation({ modDir: root, dirName: "tx_probe" }));

      expect(error.reason).toBe("recovery-required");
      expect(existsSync(staged.descriptor.previous)).toBe(true);
      expect(readFileSync(staged.descriptorPath, "utf8")).toBe("there");
    }
  );

  it.skipIf(process.platform === "win32")(
    "discards a set-aside copy that points at the same file",
    async () => {
      const root = tempDir();
      const here = join(root, "here.mod");
      writeFileSync(here, "here", "utf8");
      const staged = await symlinkedDescriptor(root, here, here);

      const report = await recoverInstallation({ modDir: root, dirName: "tx_probe" });

      expect(report.outcome).toBe("restored-previous");
      expect(existsSync(staged.descriptor.previous)).toBe(false);
      expect(readFileSync(staged.descriptorPath, "utf8")).toBe("here");
    }
  );
});

describe("a refusal creates nothing on the way to refusing", () => {
  it("refuses an unrepresentable target before making its parent directories", async () => {
    // The representability check used to run after the parent chain had been
    // created, so a build that refused still left directories behind that the
    // author never asked for and nothing would clean up.
    const parent = tempDir();
    const out = join(parent, "not", "yet", "made", "l".repeat(250));

    const error = await refusal(write(out, genOne));

    expect(error.reason).toBe("unrepresentable");
    expect(readdirSync(parent)).toEqual([]);
  });

  it("refuses an unrepresentable install before making the mod directory", async () => {
    const parent = tempDir();
    const root = join(parent, "not", "yet");

    const error = await refusal(install(genOne, { modDir: root, dirName: "l".repeat(250) }));

    expect(error.reason).toBe("unrepresentable");
    expect(readdirSync(parent)).toEqual([]);
  });
});
