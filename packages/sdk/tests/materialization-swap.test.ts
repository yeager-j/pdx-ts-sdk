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
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MaterializationError, write } from "../src/index.ts";
import { _setMaterializationTestHook } from "../src/output/test-hooks.ts";
import { lockPathFor } from "../src/output/transaction.ts";
import { renderGeneration } from "./helpers/crash-mod.ts";
import { preserveEntry, traversalDescend } from "./helpers/crash-points.ts";
import { symlinksAvailable } from "./helpers/fs-caps.ts";

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

    assertRefusedTheSwap(
      error,
      foreignDir,
      "it is not the directory that was read a moment earlier"
    );
    assertUntouched(root, secret);
    expect(existsSync(lockPathFor(out))).toBe(false);
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
