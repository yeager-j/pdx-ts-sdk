/**
 * The one safeguard that has to be right: a scaffolder must never overwrite
 * somebody's work, and it cannot be talked into it by a directory that merely
 * looks empty.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { preflight, writeTree } from "../src/fs.ts";
import type { ProjectEntry } from "../src/plan.ts";

const temps: string[] = [];
const file = (contents: string): ProjectEntry => ({ kind: "file", contents });
const link = (target: string): ProjectEntry => ({ kind: "symlink", target });

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "csm-fs-")));
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
        ["README.md", file("hello")],
        ["src/mod.ts", file("export {}")],
      ])
    );

    expect(existsSync(path.join(target, "README.md"))).toBe(true);
    expect(existsSync(path.join(target, "src/mod.ts"))).toBe(true);
    expect(readdirSync(root)).toEqual(["new-mod"]);
  });

  it("publishes relative links with their exact targets and readable destinations", async () => {
    const root = tempRoot();
    const target = path.join(root, "new-mod");
    await writeTree(
      target,
      new Map([
        [".agents/skills/pdx-sdk-docs/SKILL.md", file("# docs\n")],
        [".claude/skills", link("../.agents/skills")],
        ["AGENTS.md", file("# agents\n")],
        ["CLAUDE.md", link("AGENTS.md")],
      ])
    );

    const claudeInstructions = path.join(target, "CLAUDE.md");
    const claudeInstructionsStat = lstatSync(claudeInstructions);
    if (claudeInstructionsStat.isSymbolicLink()) {
      expect(readlinkSync(claudeInstructions)).toBe("AGENTS.md");
    } else {
      expect(claudeInstructionsStat.isFile()).toBe(true);
    }
    expect(readFileSync(path.join(target, "CLAUDE.md"), "utf8")).toBe("# agents\n");
    const claudeSkills = path.join(target, ".claude/skills");
    const claudeSkillsStat = lstatSync(claudeSkills);
    if (claudeSkillsStat.isSymbolicLink()) {
      expect(readlinkSync(claudeSkills).split(path.sep).join("/")).toBe("../.agents/skills");
    } else {
      expect(claudeSkillsStat.isDirectory()).toBe(true);
    }
    expect(readFileSync(path.join(target, ".claude/skills/pdx-sdk-docs/SKILL.md"), "utf8")).toBe(
      "# docs\n"
    );
    expect(readdirSync(root)).toEqual(["new-mod"]);
  });

  it("does not follow a target swapped to an outside symlink after preflight", async () => {
    const root = tempRoot();
    const outside = path.join(root, "outside");
    const target = path.join(root, "new-mod");
    mkdirSync(outside);
    await preflight(target);
    symlinkSync(outside, target, "dir");

    await expect(writeTree(target, new Map([["README.md", file("escaped")]]))).rejects.toThrow(
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
          ["a", file("file")],
          ["a/b", file("impossible child")],
        ])
      )
    ).rejects.toThrow();

    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it.each([
    ["/tmp/outside", /absolute symlink target/],
    ["../../outside", /project-escaping symlink target/],
  ])("rejects unsafe link target %s and removes staging", async (linkTarget, message) => {
    const root = tempRoot();
    const target = path.join(root, "new-mod");

    await expect(writeTree(target, new Map([["unsafe", link(linkTarget)]]))).rejects.toThrow(
      message
    );

    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  it("removes staging after link creation itself fails", async () => {
    const root = tempRoot();
    const target = path.join(root, "new-mod");

    await expect(
      writeTree(
        target,
        new Map([
          ["b", file("valid link destination")],
          ["a/b", file("occupies a")],
          ["a", link("b")],
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
