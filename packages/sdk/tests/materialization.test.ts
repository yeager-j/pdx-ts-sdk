/**
 * The materialization contract: what the SDK owns, what it refuses, and what
 * it must carry across the swap untouched.
 *
 * The failure this suite prevents is the destructive one. An output folder is
 * a place a person also works — they drop a texture in, the OS drops a
 * `.DS_Store` in — and an earlier contract called every one of those files
 * "drift" and made the next build refuse. Narrowing drift to the manifest-owned
 * set is only safe if the entries the SDK does not own are provably preserved
 * instead of deleted, and if every kind it cannot preserve is refused rather
 * than guessed at. Each test below names the concrete way that can go wrong.
 *
 * The receipt tests are the other half: a refusal hands back evidence, and
 * evidence nobody can forge or silently alter is what makes reviewing one
 * safe.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMod,
  install,
  MaterializationError,
  render,
  renderLauncherDescriptor,
  replaceInstallation,
  replaceMaterialization,
  write,
  type MaterializationReceipt,
} from "../src/index.ts";
import { issueReceipt, openReceipt, type MaterializationSnapshot } from "../src/output/receipt.ts";
import { createRenderedMod, type RenderedMod } from "../src/output/rendered.ts";
import {
  activateMaterialization,
  stageMaterialization,
  validateExistingMaterialization,
} from "../src/output/write.ts";

/** Permission tests are meaningless as root, which ignores the bits. */
const asRoot = process.getuid?.() === 0;
const posix = process.platform !== "win32" && !asRoot;

const capability = createMod({
  name: "Materialization Probe",
  prefix: "mz_probe",
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

/** The baseline snapshot: one technology, its localization, its descriptor. */
const renderedMod = render(
  capability.compile([capability.feature(undefined, [technology("marker", "Marker")])])
);

/** The same mod plus a second feature, so a rebuild has something to remove. */
const renderedWithExtra = render(
  capability.compile([
    capability.feature(undefined, [technology("marker", "Marker")]),
    capability.feature("extra", [technology("second", "Second")]),
  ])
);

/** A mod that owns nothing but its descriptor, so every other path is foreign. */
const renderedBare = render(capability.compile([capability.feature(undefined, [])]));

const OWNED_FILE = "common/technology/mz_probe_technology.txt";
const EXTRA_FILE = "common/technology/mz_probe_extra.txt";
const MANIFEST = ".pdx-sdk-manifest.json";

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pdx-materialize-"));
  temps.push(dir);
  return dir;
}

/** Directories a test made unwritable on purpose, so cleanup can undo it. */
const unwritable: string[] = [];

afterEach(() => {
  for (const dir of unwritable.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Already gone, or never created; the removal below is the point.
    }
  }
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

/** A target already materialized once, ready for the second build to refuse. */
async function materialized(): Promise<string> {
  const out = join(tempDir(), "out");
  await write(out, renderedMod);
  return out;
}

/** The receipt a drift refusal hands back. */
async function driftReceipt(operation: Promise<unknown>): Promise<MaterializationReceipt> {
  const error = await refusal(operation);
  if (error.failure.reason !== "drift") {
    throw new Error(`expected a drift refusal, got ${error.reason}`);
  }
  return error.failure.receipt;
}

/** The digest of the receipt a drift refusal hands back. */
async function driftDigest(operation: Promise<unknown>): Promise<string> {
  return openReceipt(await driftReceipt(operation)).digest;
}

/** Stage without activating, the way the two sinks do it internally. */
async function stageBuild(out: string, rendered: RenderedMod) {
  const inspection = await validateExistingMaterialization(out, rendered, "build");
  return stageMaterialization(out, rendered, "build", inspection);
}

/** Every rendered path present with exactly the rendered bytes, and no more. */
function expectExactly(out: string, rendered: RenderedMod, extras: readonly string[]): void {
  for (const file of rendered.values()) {
    expect(readFileSync(join(out, ...file.path.split("/")))).toEqual(Buffer.from(file.bytes()));
  }
  const top = [...rendered.keys()].map((relPath) => relPath.split("/")[0]!);
  expect(readdirSync(out).sort()).toEqual(
    [...new Set([...top, MANIFEST, ...extras])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  );
}

describe("drift is the owned set and nothing else", () => {
  it("refuses a modified owned file and hands back a receipt", async () => {
    // Rebuilding over a hand-edited owned file destroys the edit. The receipt
    // is what a later reviewed replacement is checked against, so a drift
    // refusal without one cannot be resolved except by deleting the tree.
    const out = await materialized();
    writeFileSync(join(out, OWNED_FILE), "hand edited", "utf8");
    const before = readdirSync(out).sort();

    const error = await refusal(write(out, renderedMod));

    expect(error.reason).toBe("drift");
    if (error.failure.reason !== "drift") {
      throw new Error("unreachable");
    }
    expect(error.failure.drift).toEqual([{ path: OWNED_FILE, kind: "modified" }]);
    expect(error.failure.receipt).toBeDefined();
    // Nothing was staged over or removed before the refusal.
    expect(readFileSync(join(out, OWNED_FILE), "utf8")).toBe("hand edited");
    expect(readdirSync(out).sort()).toEqual(before);
    expect(readdirSync(dirname(out))).toEqual(["out"]);
  });

  it.each([
    [
      "deleted",
      "missing" as const,
      (out: string) => {
        rmSync(join(out, OWNED_FILE));
      },
    ],
    [
      "replaced by a directory",
      "type-changed" as const,
      (out: string) => {
        rmSync(join(out, OWNED_FILE));
        mkdirSync(join(out, OWNED_FILE));
      },
    ],
    [
      "swapped for a symlink",
      "symlink" as const,
      (out: string) => {
        rmSync(join(out, OWNED_FILE));
        symlinkSync(join(out, "descriptor.mod"), join(out, OWNED_FILE));
      },
    ],
  ])("refuses an owned file %s", async (_label, kind, damage) => {
    // Each of these is a way the author's tree stopped matching what the SDK
    // last wrote. Rebuilding regardless would paper over a state they may have
    // arrived at deliberately.
    const out = await materialized();
    damage(out);

    const error = await refusal(write(out, renderedMod));

    expect(error.reason).toBe("drift");
    if (error.failure.reason !== "drift") {
      throw new Error("unreachable");
    }
    expect(error.failure.drift).toEqual([{ path: OWNED_FILE, kind }]);
  });

  it("puts the contents of a type-changed directory in the receipt", async () => {
    // "This owned file is now a directory" is the same sentence whatever is
    // inside it. Replaying a receipt that stopped at the type change would
    // accept a subtree nobody reviewed, so the subtree has to be digested.
    const out = await materialized();
    const child = join(out, OWNED_FILE, "child.txt");
    rmSync(join(out, OWNED_FILE));
    mkdirSync(join(out, OWNED_FILE));
    writeFileSync(child, "one", "utf8");

    const first = await driftDigest(write(out, renderedMod));
    writeFileSync(child, "a considerably longer body", "utf8");
    const second = await driftDigest(write(out, renderedMod));

    expect(second).not.toBe(first);
  });
});

describe("foreign entries survive the swap", () => {
  it("preserves an added file while still removing stale owned output", async () => {
    // The swap replaces the whole directory, so anything not carried into
    // staging is destroyed by it. The added file must survive exactly the
    // rebuild that removes the owned file the new render dropped.
    const out = join(tempDir(), "out");
    await write(out, renderedWithExtra);
    writeFileSync(join(out, "notes.txt"), "mine\n", "utf8");

    await write(out, renderedMod);

    expect(readFileSync(join(out, "notes.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(join(out, EXTRA_FILE))).toBe(false);
    expect(existsSync(join(out, OWNED_FILE))).toBe(true);
  });

  it("preserves a nested foreign directory through write, by link not copy", async () => {
    // Copying would work but would duplicate whatever an author parks in the
    // output — asset folders are large. The inode identity is the proof the
    // preserved file is the same file, not a second one.
    const out = await materialized();
    mkdirSync(join(out, "extras/deep"), { recursive: true });
    writeFileSync(join(out, "extras/deep/keep.bin"), "payload", "utf8");
    const before = statSync(join(out, "extras/deep/keep.bin")).ino;

    await write(out, renderedMod);

    expect(readFileSync(join(out, "extras/deep/keep.bin"), "utf8")).toBe("payload");
    expect(statSync(join(out, "extras/deep/keep.bin")).ino).toBe(before);
  });

  it("preserves a nested foreign directory through install too", async () => {
    // `install` stages through the same seam but commits two renames; a
    // preservation step that only ran on the `write` path would lose the
    // author's files exactly when the mod goes into the launcher.
    const root = tempDir();
    const { contentDir } = await install(renderedMod, { modDir: root });
    mkdirSync(join(contentDir, "extras/deep"), { recursive: true });
    writeFileSync(join(contentDir, "extras/deep/keep.bin"), "payload", "utf8");
    const before = statSync(join(contentDir, "extras/deep/keep.bin")).ino;

    await install(renderedMod, { modDir: root });

    expect(readFileSync(join(contentDir, "extras/deep/keep.bin"), "utf8")).toBe("payload");
    expect(statSync(join(contentDir, "extras/deep/keep.bin")).ino).toBe(before);
    expect(readdirSync(root).sort()).toEqual(["mz_probe", "mz_probe.mod"]);
  });

  it.skipIf(!posix)("keeps a preserved directory's permissions", async () => {
    // A directory is recreated in staging rather than moved, so its mode has
    // to be reapplied: an author's 0700 folder silently becoming world-readable
    // is a build changing something it was asked only to carry.
    const out = await materialized();
    mkdirSync(join(out, "private"));
    writeFileSync(join(out, "private/secret.txt"), "hidden", "utf8");
    chmodSync(join(out, "private"), 0o700);

    await write(out, renderedMod);

    expect(statSync(join(out, "private")).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(out, "private/secret.txt"), "utf8")).toBe("hidden");
  });
});

describe("foreign kinds materialization cannot carry", () => {
  it("refuses a foreign symlink without following or touching it", async () => {
    // A symlink cannot be preserved without deciding whether to copy the link
    // or its referent, and either choice can write outside the tree. The
    // referent assertion is the one that matters: the refusal must happen
    // before anything walks through it.
    const root = tempDir();
    const out = join(root, "out");
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "untouched.txt"), "outside", "utf8");
    await write(out, renderedMod);
    symlinkSync(outside, join(out, "linked"), "dir");
    const before = readdirSync(out).sort();

    const error = await refusal(write(out, renderedMod));

    expect(error.reason).toBe("foreign-unpreservable");
    if (error.failure.reason !== "foreign-unpreservable") {
      throw new Error("unreachable");
    }
    expect(error.failure.entries).toEqual([{ path: "linked", kind: "symlink" }]);
    expect(readdirSync(out).sort()).toEqual(before);
    expect(readdirSync(outside)).toEqual(["untouched.txt"]);
  });

  it.skipIf(process.platform === "win32")("refuses a foreign FIFO by its own kind", async () => {
    // A FIFO cannot be hardlinked into staging and blocks anything that opens
    // it, so a preservation pass that treated "not a directory" as "file"
    // would hang the build instead of refusing it.
    const out = await materialized();
    execFileSync("mkfifo", [join(out, "pipe")]);

    const error = await refusal(write(out, renderedMod));

    expect(error.reason).toBe("foreign-unpreservable");
    if (error.failure.reason !== "foreign-unpreservable") {
      throw new Error("unreachable");
    }
    expect(error.failure.entries).toEqual([{ path: "pipe", kind: "fifo" }]);
  });
});

describe("a rendered claim never lands on a foreign entry", () => {
  /** A target owning only its descriptor, so any other path is foreign. */
  async function bare(): Promise<string> {
    const out = join(tempDir(), "out");
    await write(out, renderedBare);
    return out;
  }

  async function conflicts(out: string) {
    const error = await refusal(write(out, renderedMod));
    expect(error.reason).toBe("foreign-conflict");
    if (error.failure.reason !== "foreign-conflict") {
      throw new Error("unreachable");
    }
    return error.failure.conflicts;
  }

  it("refuses a foreign file sitting on a path the render claims", async () => {
    // Writing the render over it would destroy the author's file silently,
    // which is the exact loss the whole foreign-entry contract exists to stop.
    const out = await bare();
    mkdirSync(join(out, "common/technology"), { recursive: true });
    writeFileSync(join(out, OWNED_FILE), "author's own", "utf8");

    expect(await conflicts(out)).toEqual([
      { claimPath: OWNED_FILE, foreignPath: OWNED_FILE, kind: "occupied" },
    ]);
    expect(readFileSync(join(out, OWNED_FILE), "utf8")).toBe("author's own");
  });

  it("refuses a foreign directory where the render claims a file", async () => {
    // The staging write would fail with EISDIR halfway through instead, after
    // the tree was already half built.
    const out = await bare();
    mkdirSync(join(out, OWNED_FILE), { recursive: true });

    expect(await conflicts(out)).toEqual([
      { claimPath: OWNED_FILE, foreignPath: OWNED_FILE, kind: "file-directory" },
    ]);
  });

  it("refuses a foreign file the render would have to descend through", async () => {
    // `common` as a regular file makes `common/technology/...` unwritable, and
    // preserving the file while creating the directory is not possible at all.
    const out = await bare();
    writeFileSync(join(out, "common"), "not a directory", "utf8");

    expect(await conflicts(out)).toEqual([
      { claimPath: OWNED_FILE, foreignPath: "common", kind: "file-directory" },
    ]);
  });

  it("refuses a foreign path that differs from a claim only by Unicode form", async () => {
    // macOS hands back decomposed names for files stored under a composed one,
    // and logical paths are always composed. Folding case alone would let the
    // two names look distinct right up until the filesystem collapsed them.
    const out = await bare();
    // Written as escapes: the two literals are the same name in the two
    // Unicode forms, and an editor that normalized the file would erase the case.
    const composed = "assets/caf\u00e9.txt";
    const decomposed = "assets/cafe\u0301.txt";
    mkdirSync(join(out, "assets"));
    writeFileSync(join(out, decomposed), "author's own", "utf8");
    const claiming = createRenderedMod("mz_probe", "", [
      { path: composed, owner: "test", text: "rendered\n" },
    ]);

    const error = await refusal(write(out, claiming));

    expect(error.reason).toBe("foreign-conflict");
    if (error.failure.reason !== "foreign-conflict") {
      throw new Error("unreachable");
    }
    expect(error.failure.conflicts).toHaveLength(1);
    const conflict = error.failure.conflicts[0]!;
    expect(conflict.claimPath).toBe(composed);
    expect(conflict.kind).toBe("occupied");
    // Which form comes back is the filesystem's choice; both name one file.
    expect(conflict.foreignPath.normalize("NFC")).toBe(composed);
    expect(readFileSync(join(out, decomposed), "utf8")).toBe("author's own");
  });

  it("refuses a foreign path that differs from a claim only by case", async () => {
    // A case-insensitive filesystem collapses the two, so the swap would
    // overwrite the author's file even though the names are not equal.
    const out = await bare();
    mkdirSync(join(out, "Common/Technology"), { recursive: true });
    writeFileSync(join(out, "Common/Technology/MZ_PROBE_TECHNOLOGY.TXT"), "aliased", "utf8");

    expect(await conflicts(out)).toEqual([
      {
        claimPath: OWNED_FILE,
        foreignPath: "Common/Technology/MZ_PROBE_TECHNOLOGY.TXT",
        kind: "occupied",
      },
    ]);
  });
});

describe("OS metadata is an ordinary foreign entry", () => {
  it("preserves a .DS_Store in an owned target", async () => {
    const out = await materialized();
    writeFileSync(join(out, ".DS_Store"), "finder", "utf8");

    await write(out, renderedMod);

    expect(readFileSync(join(out, ".DS_Store"), "utf8")).toBe("finder");
  });

  it("treats a directory holding only OS metadata as a first materialization", async () => {
    // A Finder visit to an empty output folder must not be what makes the
    // first build refuse, and the metadata file must still survive it.
    const out = join(tempDir(), "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, ".DS_Store"), "finder", "utf8");

    await write(out, renderedMod);

    expect(readFileSync(join(out, ".DS_Store"), "utf8")).toBe("finder");
    expect(existsSync(join(out, OWNED_FILE))).toBe(true);
  });
});

describe("an unowned target is never replaced", () => {
  it("refuses a nonempty directory with no ownership manifest", async () => {
    const out = join(tempDir(), "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "someone-elses.txt"), "not ours", "utf8");

    const error = await refusal(write(out, renderedMod));

    expect(error.reason).toBe("unowned");
    expect(readFileSync(join(out, "someone-elses.txt"), "utf8")).toBe("not ours");
  });

  it.each([
    ["another mod's prefix", { prefix: "other_prefix" }],
    ["another materialization mode", { mode: "install" }],
  ])("refuses a manifest belonging to %s", async (_label, patch) => {
    // The manifest is the ownership claim. A manifest for a different mod, or
    // for the launcher-install half of the contract, does not authorize this
    // build to delete anything.
    const out = await materialized();
    const manifestPath = join(out, ".pdx-sdk-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...patch }, null, 2), "utf8");

    expect((await refusal(write(out, renderedMod))).reason).toBe("unowned");
  });
});

describe("the target is rechecked at the commit point", () => {
  it("refuses to activate when a preserved file changed while staging", async () => {
    // Staging links the foreign file, then the activation rename publishes it.
    // A file rewritten in between would be published as whatever staging
    // happened to capture, so the swap is refused instead.
    const out = await materialized();
    const notes = join(out, "notes.txt");
    writeFileSync(notes, "mine", "utf8");
    const staged = await stageBuild(out, renderedMod);

    writeFileSync(notes, "changed during staging", "utf8");

    const error = await refusal(activateMaterialization(staged));
    expect(error.reason).toBe("busy");
    if (error.failure.reason !== "busy") {
      throw new Error("unreachable");
    }
    expect(error.failure.detail).toContain("notes.txt");
    // The staged tree was cleaned up, and the target was never renamed aside.
    expect(readdirSync(dirname(out))).toEqual(["out"]);
    expect(existsSync(join(out, OWNED_FILE))).toBe(true);
  });

  it("refuses to activate when a new entry appeared while staging", async () => {
    // A file saved into the output after the scan — by the author, or by the
    // OS writing metadata — is in no preserved list, so the swap would carry
    // it into the set-aside tree and delete it with that tree. Nothing the
    // scan never saw may be destroyed on the strength of the scan.
    const out = await materialized();
    const staged = await stageBuild(out, renderedMod);

    writeFileSync(join(out, "dropped-in.txt"), "saved mid-build", "utf8");

    const error = await refusal(activateMaterialization(staged));
    expect(error.reason).toBe("busy");
    if (error.failure.reason !== "busy") {
      throw new Error("unreachable");
    }
    expect(error.failure.detail).toContain("dropped-in.txt");
    expect(readFileSync(join(out, "dropped-in.txt"), "utf8")).toBe("saved mid-build");
    expect(readdirSync(dirname(out))).toEqual(["out"]);
  });

  it.skipIf(!posix)("reports a failed set-aside rename as an activation failure", async () => {
    // The rename that moves the old output aside used to sit outside the
    // error contract: a parent that turned unwritable surfaced a raw errno and
    // left the staging directory behind, with no statement about what happened
    // to the author's output.
    const parent = tempDir();
    const out = join(parent, "out");
    await write(out, renderedMod);
    const staged = await stageBuild(out, renderedMod);

    chmodSync(parent, 0o500);
    const error = await refusal(activateMaterialization(staged));
    chmodSync(parent, 0o700);

    expect(error.reason).toBe("activation");
    if (error.failure.reason !== "activation") {
      throw new Error("unreachable");
    }
    // Nothing moved, so the previous output is intact — and it says so.
    expect(error.failure.rolledBack).toBe(true);
    expect(error.cause).toBeDefined();
    expect(existsSync(join(out, OWNED_FILE))).toBe(true);
  });
});

describe("receipts", () => {
  const snapshot: MaterializationSnapshot = {
    owned: [{ path: OWNED_FILE, kind: "file", byteLength: 3, sha256: "abc" }],
    foreign: [{ path: "notes.txt", kind: "file", dev: 1, ino: 2, size: 3, mtimeMs: 4.5 }],
    descriptor: { state: "file", basename: "mz_probe.mod", byteLength: 10, sha256: "def" },
  };

  function digestOf(next: MaterializationSnapshot): string {
    return openReceipt(issueReceipt("/target", "install", "mz_probe", next)).digest;
  }

  it("covers the launcher descriptor when content drifts on an install", async () => {
    // Both halves of an install are one materialization. A content-drift
    // receipt issued before anything looked at the sibling `.mod` would digest
    // two different install states identically, and replaying it would
    // overwrite a descriptor nobody reviewed. Same content state twice, only
    // the descriptor differing, must give two digests.
    const root = tempDir();
    const { contentDir, descriptorPath } = await install(renderedMod, { modDir: root });
    writeFileSync(join(contentDir, OWNED_FILE), "hand edited", "utf8");

    const first = await driftDigest(install(renderedMod, { modDir: root }));
    writeFileSync(descriptorPath, 'name="Edited By Hand"\n', "utf8");
    const second = await driftDigest(install(renderedMod, { modDir: root }));

    expect(second).not.toBe(first);
  });

  it("refuses to open anything it did not issue", () => {
    // A receipt is a review of a state someone actually looked at. A plain
    // object would let a caller assert a review that never happened.
    expect(() => openReceipt({} as never)).toThrow(TypeError);
  });

  it("digests one snapshot to one value", () => {
    expect(digestOf(snapshot)).toBe(digestOf(snapshot));
  });

  it.each([
    ["an owned hash", { ...snapshot, owned: [{ ...snapshot.owned[0]!, sha256: "abd" }] }] as const,
    [
      "a foreign mtime",
      { ...snapshot, foreign: [{ ...snapshot.foreign[0]!, mtimeMs: 4.6 }] },
    ] as const,
    ["the descriptor state", { ...snapshot, descriptor: { state: "absent" } }] as const,
  ])("digests a change to %s differently", (_label, changed) => {
    // Replay compares digests. A field the digest ignores is a change a
    // reviewed replacement would silently accept.
    expect(digestOf(changed)).not.toBe(digestOf(snapshot));
  });
});

describe("a materialization that would change nothing does nothing", () => {
  it("reports a second identical write as unchanged, untouched", async () => {
    // Rewriting identical bytes is not free: it changes every mtime in the
    // tree, which is what an editor, a file watcher and the launcher all key
    // off. A build that produced the same render must be a no-op on disk.
    const parent = tempDir();
    const out = join(parent, "out");
    expect((await write(out, renderedMod)).status).toBe("written");
    const before = statSync(join(out, OWNED_FILE));

    const report = await write(out, renderedMod);

    expect(report.status).toBe("unchanged");
    expect(report.outDir).toBe(out);
    expect(report.manifestPath).toBe(join(out, MANIFEST));
    expect(report.warnings).toEqual([]);
    const after = statSync(join(out, OWNED_FILE));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    // Nothing was staged: no sibling was created, used and renamed away.
    expect(readdirSync(parent)).toEqual(["out"]);
  });

  it("reports a second identical install as unchanged, descriptor included", async () => {
    // The descriptor is the other half of the same materialization, so
    // "unchanged" has to cover it too — and rewriting it is what the launcher
    // notices.
    const root = tempDir();
    const first = await install(renderedMod, { modDir: root });
    expect(first.status).toBe("written");
    const before = statSync(first.descriptorPath);

    const report = await install(renderedMod, { modDir: root });

    expect(report.status).toBe("unchanged");
    expect(report.contentDir).toBe(first.contentDir);
    expect(report.descriptorPath).toBe(first.descriptorPath);
    expect(report.manifestPath).toBe(join(first.contentDir, MANIFEST));
    expect(statSync(first.descriptorPath).mtimeMs).toBe(before.mtimeMs);
    expect(readdirSync(root).sort()).toEqual(["mz_probe", "mz_probe.mod"]);
  });
});

describe("the report says what was carried and what was left behind", () => {
  it("lists foreign entries in order, and never OS metadata", async () => {
    // The author's own files are the report's subject: they are what a build
    // silently kept. OS metadata is noise nobody put there on purpose, so
    // reporting it would train a reader to skip the list.
    const out = await materialized();
    mkdirSync(join(out, "extras"));
    writeFileSync(join(out, "extras/keep.bin"), "payload", "utf8");
    writeFileSync(join(out, "extras/.DS_Store"), "finder", "utf8");
    writeFileSync(join(out, ".DS_Store"), "finder", "utf8");
    writeFileSync(join(out, "notes.txt"), "mine", "utf8");

    const written = await write(out, renderedWithExtra);

    expect(written.status).toBe("written");
    expect(written.foreignEntries).toEqual([
      { path: "extras", kind: "directory" },
      { path: "extras/keep.bin", kind: "file" },
      { path: "notes.txt", kind: "file" },
    ]);
    // Exempt from the report, still carried across the swap.
    expect(readFileSync(join(out, ".DS_Store"), "utf8")).toBe("finder");
    expect(readFileSync(join(out, "extras/.DS_Store"), "utf8")).toBe("finder");

    const unchanged = await write(out, renderedWithExtra);
    expect(unchanged.status).toBe("unchanged");
    expect(unchanged.foreignEntries).toEqual(written.foreignEntries);
  });

  it.skipIf(!posix)("warns about a leftover it could not remove after committing", async () => {
    // The set-aside tree is removed after the swap has already published the
    // new output. Failing there would report a build that succeeded as a
    // failure, and hide the one thing the author has to clean up by hand.
    const out = await materialized();
    const locked = join(out, "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "held.txt"), "held", "utf8");
    // Readable and traversable but not writable: the SDK can carry the entry
    // into staging, and `rm -r` of the set-aside copy cannot unlink the child.
    chmodSync(locked, 0o500);
    unwritable.push(locked);

    const report = await write(out, renderedWithExtra);

    expect(report.status).toBe("written");
    expect(report.warnings).toHaveLength(1);
    const warning = report.warnings[0]!;
    unwritable.push(join(warning.path, "locked"));
    expect(warning.path).toContain(".pdx-previous-");
    expect(warning.message).not.toBe("");
    // The new output is published, and the author's directory came with it.
    expect(existsSync(join(out, EXTRA_FILE))).toBe(true);
    expect(readFileSync(join(locked, "held.txt"), "utf8")).toBe("held");
  });
});

describe("a receipt replaces exactly the state it reviewed", () => {
  it("replaces the drifted owned set and leaves foreign entries alone", async () => {
    const out = await materialized();
    writeFileSync(join(out, "notes.txt"), "mine\n", "utf8");
    writeFileSync(join(out, OWNED_FILE), "hand edited", "utf8");
    const receipt = await driftReceipt(write(out, renderedWithExtra));

    const report = await replaceMaterialization(out, renderedWithExtra, receipt);

    expect(report.status).toBe("written");
    expectExactly(out, renderedWithExtra, ["notes.txt"]);
    expect(readFileSync(join(out, "notes.txt"), "utf8")).toBe("mine\n");
    expect(report.foreignEntries).toEqual([{ path: "notes.txt", kind: "file" }]);
  });

  it("refuses a stale receipt with a fresh one that then works", async () => {
    // A receipt is evidence about one moment. If the tree moved on after it was
    // issued, replaying it would accept a second change nobody reviewed — so
    // the refusal repeats, with evidence for the state that exists now.
    const out = join(tempDir(), "out");
    await write(out, renderedWithExtra);
    writeFileSync(join(out, OWNED_FILE), "hand edited", "utf8");
    const stale = await driftReceipt(write(out, renderedWithExtra));

    writeFileSync(join(out, EXTRA_FILE), "also edited", "utf8");
    const error = await refusal(replaceMaterialization(out, renderedWithExtra, stale));

    expect(error.reason).toBe("drift");
    if (error.failure.reason !== "drift") {
      throw new Error("unreachable");
    }
    expect(error.failure.drift.map((entry) => entry.path).sort()).toEqual(
      [EXTRA_FILE, OWNED_FILE].sort()
    );
    const fresh = error.failure.receipt;
    expect(openReceipt(fresh).digest).not.toBe(openReceipt(stale).digest);
    expect(readFileSync(join(out, OWNED_FILE), "utf8")).toBe("hand edited");

    expect((await replaceMaterialization(out, renderedWithExtra, fresh)).status).toBe("written");
    expectExactly(out, renderedWithExtra, []);
  });

  it("never replaces a target that stopped being owned", async () => {
    // There is no adoption mode. A receipt converts a drift refusal; it is not
    // a claim of ownership over a tree the SDK no longer has a manifest for.
    const out = await materialized();
    writeFileSync(join(out, OWNED_FILE), "hand edited", "utf8");
    const receipt = await driftReceipt(write(out, renderedMod));
    rmSync(join(out, MANIFEST));

    const error = await refusal(replaceMaterialization(out, renderedMod, receipt));

    expect(error.reason).toBe("unowned");
    expect(readFileSync(join(out, OWNED_FILE), "utf8")).toBe("hand edited");
  });

  it("refuses a forged receipt before touching the target", async () => {
    const out = await materialized();
    writeFileSync(join(out, OWNED_FILE), "hand edited", "utf8");

    await expect(replaceMaterialization(out, renderedMod, {} as never)).rejects.toThrow(TypeError);

    expect(readFileSync(join(out, OWNED_FILE), "utf8")).toBe("hand edited");
  });

  it("refuses a receipt issued for another target", async () => {
    // Two outputs of the same mod drift identically often — the same edit, the
    // same bytes. Only the target keeps one review from authorizing the other.
    const first = await materialized();
    const second = await materialized();
    writeFileSync(join(first, OWNED_FILE), "hand edited", "utf8");
    writeFileSync(join(second, OWNED_FILE), "hand edited", "utf8");
    const receipt = await driftReceipt(write(first, renderedMod));

    const error = await refusal(replaceMaterialization(second, renderedMod, receipt));

    expect(error.reason).toBe("drift");
    expect(readFileSync(join(second, OWNED_FILE), "utf8")).toBe("hand edited");
  });

  it("replays an install over a hand-edited launcher descriptor", async () => {
    // The descriptor drifts on the content directory's receipt, so replaying
    // it has to rewrite both halves back into agreement.
    const root = tempDir();
    const { contentDir, descriptorPath } = await install(renderedMod, { modDir: root });
    writeFileSync(descriptorPath, 'name="Edited By Hand"\n', "utf8");
    const receipt = await driftReceipt(install(renderedWithExtra, { modDir: root }));

    const report = await replaceInstallation(renderedWithExtra, receipt, { modDir: root });

    expect(report.status).toBe("written");
    expect(report.contentDir).toBe(contentDir);
    expect(readFileSync(descriptorPath, "utf8")).toBe(
      renderLauncherDescriptor(renderedWithExtra, contentDir)
    );
    expectExactly(contentDir, renderedWithExtra, []);
    expect(readdirSync(root).sort()).toEqual(["mz_probe", "mz_probe.mod"]);
  });
});
