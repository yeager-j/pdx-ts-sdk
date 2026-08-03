/**
 * The one safeguard that has to be right: a scaffolder must never overwrite
 * somebody's work, and it cannot be talked into it by a directory that merely
 * looks empty.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { preflight } from "../src/fs.ts";

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
