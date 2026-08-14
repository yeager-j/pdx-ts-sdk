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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMod,
  install,
  MaterializationError,
  recoverInstallation,
  recoverMaterialization,
  render,
  renderLauncherDescriptor,
  write,
  type RecoveryReport,
} from "../src/index.ts";
import { assertRepresentableMaterialization } from "../src/output/preflight.ts";
import type { RenderedMod } from "../src/output/rendered.ts";
import {
  lockPathFor,
  parseJournal,
  processIsAlive,
  readJournal,
  type MaterializationPhase,
} from "../src/output/transaction.ts";
import {
  descriptorRecord,
  observeDescriptor,
  stageMaterialization,
  stagingPaths,
  validateExistingMaterialization,
  type MaterializationPaths,
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

const temps: string[] = [];
/** Physical from the start; the system temp directory is a symlink on macOS. */
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pdx-transaction-")));
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
    writeJournal({ target: out, rendered: genOne, pid: process.pid, phases: ["staged"] });

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
    const lockPath = writeJournal({ target: out, rendered: genOne, phases: ["staged"] });

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
      pid: process.pid,
      phases: ["staged", "failed"],
    });

    expect((await refusal(write(out, genOne))).reason).toBe("recovery-required");
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
    const journal = parseJournal(
      "/lock",
      '{"record":"header","version":1,"phase":"inspecting","pid":1,"hostname":"h",' +
        '"startedAt":"t","mode":"build","prefix":"tx_probe","target":"/out","renderedSha256":"x"}\n' +
        '{"record":"phase","phase":"stag'
    );

    expect(journal.readable).toBe(true);
    expect(journal.lastPhase).toBe("inspecting");
  });

  it("reads a recovery claim as arbitration rather than progress", async () => {
    // A recovery that died must not change which row the next one reads.
    const journal = parseJournal(
      "/lock",
      '{"record":"staging","phase":"staging","at":"t","staging":"/s","previous":"/p","hadPrevious":true}\n' +
        '{"record":"phase","phase":"recovering","at":"t","pid":1,"token":"a"}\n'
    );

    expect(journal.lastPhase).toBe("staging");
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
    writeJournal({ target: out, rendered: genOne, pid: process.pid, phases: ["staged"] });

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
