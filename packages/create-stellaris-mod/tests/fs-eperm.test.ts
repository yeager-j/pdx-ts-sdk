import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeTree } from "../src/fs.ts";
import type { ProjectEntry } from "../src/plan.ts";

const mocked = vi.hoisted(() => ({ symlink: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, symlink: mocked.symlink };
});

const temps: string[] = [];
const file = (contents: string): ProjectEntry => ({ kind: "file", contents });
const link = (target: string): ProjectEntry => ({ kind: "symlink", target });

beforeEach(() => {
  mocked.symlink.mockReset();
  mocked.symlink.mockRejectedValue(
    Object.assign(new Error("symbolic links require a Windows privilege"), { code: "EPERM" })
  );
});

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the no-symlink-privilege fallback", () => {
  it("publishes regular file and directory copies when symlink returns EPERM", async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "csm-fs-eperm-")));
    temps.push(root);
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

    expect(mocked.symlink).toHaveBeenCalledTimes(2);
    expect(lstatSync(path.join(target, "CLAUDE.md")).isFile()).toBe(true);
    expect(readFileSync(path.join(target, "CLAUDE.md"), "utf8")).toBe("# agents\n");
    expect(lstatSync(path.join(target, ".claude/skills")).isDirectory()).toBe(true);
    expect(readFileSync(path.join(target, ".claude/skills/pdx-sdk-docs/SKILL.md"), "utf8")).toBe(
      "# docs\n"
    );
  });
});
