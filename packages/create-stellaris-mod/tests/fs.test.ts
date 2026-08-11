/**
 * The one safeguard that has to be right: a scaffolder must never overwrite
 * somebody's work, and it cannot be talked into it by a directory that merely
 * looks empty.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { preflight, writeTree } from "../src/fs.ts";

const temps: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "csm-fs-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeTree", () => {
  it("publishes a complete staged tree and leaves no staging directory", async () => {
    const root = tempRoot();
    const target = path.join(root, "new-mod");
    await writeTree(
      target,
      new Map([
        ["README.md", "hello"],
        ["src/mod.ts", "export {}"],
      ])
    );

    expect(existsSync(path.join(target, "README.md"))).toBe(true);
    expect(existsSync(path.join(target, "src/mod.ts"))).toBe(true);
    expect(readdirSync(root)).toEqual(["new-mod"]);
  });

  it("does not follow a target swapped to an outside symlink after preflight", async () => {
    const root = tempRoot();
    const outside = path.join(root, "outside");
    const target = path.join(root, "new-mod");
    mkdirSync(outside);
    await preflight(target);
    symlinkSync(outside, target, "dir");

    await expect(writeTree(target, new Map([["README.md", "escaped"]]))).rejects.toThrow(
      /appeared while the project was staged/
    );

    expect(readdirSync(outside)).toEqual([]);
  });

  it("removes a partial staging tree when a write fails", async () => {
    const root = tempRoot();
    const target = path.join(root, "new-mod");

    await expect(
      writeTree(
        target,
        new Map([
          ["a", "file"],
          ["a/b", "impossible child"],
        ])
      )
    ).rejects.toThrow();

    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("preflight", () => {
  it("accepts a path that does not exist", async () => {
    await expect(preflight(path.join(tempRoot(), "new-mod"))).resolves.toBeUndefined();
  });

  it("refuses a directory that already exists, even an empty one", async () => {
    const dir = path.join(tempRoot(), "existing");
    mkdirSync(dir);
    await expect(preflight(dir)).rejects.toThrow(/already exists/);
  });

  it("refuses a freshly initialized repository", async () => {
    // The case the old "harmless leftovers" list waved through, and the reason
    // it is gone: the scaffold writes a README and a .gitignore, so the files
    // it tolerated were exactly the ones it would then destroy.
    const dir = path.join(tempRoot(), "repo");
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    writeFileSync(path.join(dir, "README.md"), "# mine\n", "utf8");
    writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n", "utf8");

    await expect(preflight(dir)).rejects.toThrow(/already exists and holds 3 entries/);
    // And the author's file is still theirs.
    await expect(preflight(dir)).rejects.toThrow();
  });
});
