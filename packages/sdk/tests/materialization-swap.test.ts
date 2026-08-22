/**
 * A foreign entry swapped for a symlink while the target is being read.
 *
 * Classification takes a no-follow `lstat` of every entry and then descends by
 * path, and `preserveForeign` hardlinks by path as well. Between those two
 * uses of one name, the name can come to mean something else — which is not a
 * theoretical race but the way a symlink attack on a build directory is
 * written. The consequence is specific and bad: the walk leaves the target, and
 * somebody else's file is published inside the mod as a hardlink to itself.
 *
 * So the load-bearing assertion in every test here is `nlink`. A refusal that
 * still hardlinked the outside file first would leave it with two names, and
 * the file's own link count is the one witness that cannot be argued with.
 *
 * The swap is performed by the fault-injection seam at the exact instant the
 * attack needs, because a test that raced a timer would pass by luck.
 *
 * The last test here is about the same walk from the other side: hardening it
 * must not have made it cost a file descriptor per directory level, or a deep
 * enough tree would stop materializing at all.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MaterializationError, write } from "../src/index.ts";
import { lockPathFor } from "../src/output/layout.ts";
import { _setMaterializationTestHook } from "../src/output/test-hooks.ts";
import { renderGeneration } from "./helpers/crash-mod.ts";
import { preserveEntry, traversalDescend } from "./helpers/crash-points.ts";
import { symlinksAvailable } from "./helpers/fs-caps.ts";
import { runMaterializeChild } from "./helpers/spawn-materialize.ts";

const genOne = renderGeneration(1);
const genTwo = renderGeneration(2);
const SECRET = "the file that must never be linked\n";

const temps: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pdx-swap-")));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  _setMaterializationTestHook();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function refusal(operation: Promise<unknown>): Promise<MaterializationError> {
  const thrown = await operation.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(MaterializationError);
  return thrown as MaterializationError;
}

/**
 * A target with an owned materialization and one foreign directory in it, and
 * an outside tree holding a file with exactly one name.
 */
async function scene(): Promise<{
  root: string;
  out: string;
  foreignDir: string;
  outside: string;
  secret: string;
}> {
  const root = tempDir();
  const out = join(root, "out");
  await write(out, genOne);
  const foreignDir = join(out, "stuff");
  mkdirSync(foreignDir);
  writeFileSync(join(foreignDir, "note.txt"), "the author's own notes\n", "utf8");
  const outside = join(root, "outside");
  mkdirSync(outside);
  const secret = join(outside, "note.txt");
  writeFileSync(secret, SECRET, "utf8");
  return { root, out, foreignDir, outside, secret };
}

/**
 * The refusal came from the identity check and not from something else that
 * happens to say "busy" — a test that accepted any refusal would keep passing
 * with the hardening removed.
 *
 * Only used where the site cannot vary: a name that is a symlink when it is
 * examined, and a file whose classified inode is still allocated elsewhere, are
 * refused at the same place on every filesystem. Where inode reuse can move the
 * refusal to the commit-time backstop, the test asserts the outcome instead.
 */
function assertRefusedTheSwap(error: MaterializationError, path: string, because: string): void {
  expect(error.reason).toBe("busy");
  if (error.failure.reason !== "busy") {
    throw new Error("unreachable");
  }
  expect(error.failure.detail).toBe(`${path} changed while the target was being read: ${because}.`);
}

/** Nothing of the target's leaked out, and nothing of the build stayed behind. */
function assertUntouched(root: string, secret: string): void {
  expect(readFileSync(secret, "utf8")).toBe(SECRET);
  expect(lstatSync(secret).nlink).toBe(1);
  expect(readdirSync(root).filter((name) => name.startsWith(".pdx-"))).toEqual([]);
}

describe.skipIf(!symlinksAvailable)("a target that changes under the walk is refused", () => {
  it("refuses when a classified directory becomes a symlink before the descent", async () => {
    const { root, out, foreignDir, outside, secret } = await scene();
    _setMaterializationTestHook((point) => {
      if (point !== traversalDescend("stuff")) {
        return;
      }
      rmSync(foreignDir, { recursive: true, force: true });
      symlinkSync(outside, foreignDir);
    });

    const error = await refusal(write(out, genTwo));

    assertRefusedTheSwap(
      error,
      foreignDir,
      "it is now a symlink, which a materialization never follows"
    );
    assertUntouched(root, secret);
    expect(existsSync(lockPathFor(out))).toBe(false);
  });

  it("refuses when the swap is put back as a different directory", async () => {
    // The escape the identity check exists for. Refusing symlinks alone is not
    // enough: an attacker who puts a directory back where the symlink was
    // leaves a name that passes every kind test and is not the tree that was
    // classified, and its contents would be carried across the activation as
    // though the author had written them.
    //
    // The original is renamed aside rather than removed, which keeps its inode
    // allocated and so guarantees the substitute a different one on every
    // filesystem. That makes the descent the site that catches this, here and
    // everywhere; the variant below is the one where it cannot be.
    const { root, out, foreignDir, outside, secret } = await scene();
    _setMaterializationTestHook((point) => {
      if (point !== traversalDescend("stuff")) {
        return;
      }
      renameSync(foreignDir, join(root, "aside"));
      symlinkSync(outside, foreignDir);
      unlinkSync(foreignDir);
      mkdirSync(foreignDir);
      writeFileSync(join(foreignDir, "note.txt"), "a substitute\n", "utf8");
    });

    const error = await refusal(write(out, genTwo));

    assertRefusedTheSwap(
      error,
      foreignDir,
      "it is not the directory that was read a moment earlier"
    );
    assertUntouched(root, secret);
    expect(existsSync(lockPathFor(out))).toBe(false);
  });

  it("refuses when the substitute directory reuses the freed inode", async () => {
    // The documented residual window, under test rather than merely described.
    // Removing the original frees its inode number, and a filesystem that hands
    // that number straight back to the next `mkdir` — ext4 readily does, APFS
    // allocates onward and does not — gives the substitute the same device and
    // inode the descent check compares. So on some filesystems the walk
    // proceeds, and `revalidateTarget` refuses at the commit point instead, on
    // the full identity including a modification time a fresh directory cannot
    // fake.
    //
    // Two sites, one outcome, and the outcome is the contract: refused, with
    // nothing published and nothing escaped. Pinning the site here would make
    // the test a claim about the filesystem's inode allocation policy, which is
    // what it was before ext4 disagreed with APFS about it.
    const { root, out, foreignDir, outside, secret } = await scene();
    _setMaterializationTestHook((point) => {
      if (point !== traversalDescend("stuff")) {
        return;
      }
      rmSync(foreignDir, { recursive: true, force: true });
      symlinkSync(outside, foreignDir);
      unlinkSync(foreignDir);
      mkdirSync(foreignDir);
      writeFileSync(join(foreignDir, "note.txt"), "a substitute\n", "utf8");
    });

    const error = await refusal(write(out, genTwo));

    expect(error.reason).toBe("busy");
    assertUntouched(root, secret);
    expect(existsSync(lockPathFor(out))).toBe(false);
    // The target is left in an ordinary state — a foreign directory somebody
    // put there — so an honest build afterwards carries it rather than
    // inheriting the refusal.
    _setMaterializationTestHook();
    expect((await write(out, genTwo)).status).toBe("written");
    expect(readFileSync(join(foreignDir, "note.txt"), "utf8")).toBe("a substitute\n");
    assertUntouched(root, secret);
  });

  it("refuses when the path to a preserved file changes before it is carried", async () => {
    // The same swap one step later, where the damage would be done rather than
    // merely read: `link` takes a path, so the parent directory becoming a
    // symlink is enough to publish the outside file inside the staged tree.
    const { root, out, foreignDir, outside, secret } = await scene();
    _setMaterializationTestHook((point) => {
      if (point !== preserveEntry("stuff/note.txt")) {
        return;
      }
      rmSync(foreignDir, { recursive: true, force: true });
      symlinkSync(outside, foreignDir);
    });

    const error = await refusal(write(out, genTwo));

    assertRefusedTheSwap(
      error,
      join(foreignDir, "note.txt"),
      "it is not the file that was classified"
    );
    assertUntouched(root, secret);
    expect(existsSync(lockPathFor(out))).toBe(false);
  });
});

describe.skipIf(process.platform === "win32")(
  "the pinned walk costs no descriptor per level",
  () => {
    /**
     * Deeper than any descriptor limit the child will be given, and short enough
     * that the deepest path stays well inside the platform's path ceiling — about
     * 470 characters, against 1024 on darwin.
     */
    const DEPTH = 200;
    const DESCRIPTOR_LIMIT = 96;

    it(
      "materializes a deep foreign tree under a small descriptor limit",
      { timeout: 30_000 },
      async () => {
        // Verifying identity means opening the directory, and a walk that held
        // each handle while it recursed would hold one per level. That is not a
        // refusal, a race, or anything the author could act on: it is an EMFILE
        // in the middle of a build. The handle is therefore drained and closed
        // before the descent, and this is what says so — the limit has to be
        // lowered in a child, because a process cannot lower its own.
        const root = tempDir();
        const out = join(root, "out");
        await write(out, genOne);
        let deep = join(out, "deep");
        mkdirSync(deep);
        for (let level = 0; level < DEPTH; level++) {
          deep = join(deep, "d");
          mkdirSync(deep);
        }
        const bottom = join(deep, "note.txt");
        writeFileSync(bottom, "the deepest file the author has\n", "utf8");

        const built = await runMaterializeChild({
          command: "attempt",
          mode: "build",
          root,
          dirName: "out",
          generation: 2,
          descriptorLimit: DESCRIPTOR_LIMIT,
        });

        expect(built.report).toEqual({ ok: true, status: "written" });
        // And the tree came across the activation, rather than being skipped by
        // whatever gave up on it.
        expect(readFileSync(bottom, "utf8")).toBe("the deepest file the author has\n");
      }
    );
  }
);
