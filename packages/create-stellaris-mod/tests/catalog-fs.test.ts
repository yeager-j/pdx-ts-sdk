/**
 * Containment and exclusive publication, on a real filesystem.
 *
 * Nothing here is mocked, because the guarantees being tested are guarantees
 * about a filesystem: that a symlink is not a directory, that `link()` fails
 * with `EEXIST` rather than replacing, that a dirent appearing between the look
 * and the write cannot become a silent overwrite. A substituted filesystem
 * would agree with whatever this code believes, which is the one thing worth
 * not assuming.
 *
 * The single exception is the injected `link`, which exists so a filesystem
 * that *cannot* publish safely can be simulated — there is no portable way to
 * mount one, and the behaviour it triggers (fail loudly, never fall back to
 * `rename`) is the most important refusal in the module.
 */

import { spawnSync } from "node:child_process";
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
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../src/cli.ts";
import {
  CollisionError,
  ContainmentError,
  preflightTarget,
  ProjectLayoutError,
  publishExclusive,
  UnsupportedPublicationError,
  validateContentDirectory,
} from "../src/publish.ts";
import { capture } from "./helpers/capture.ts";
import { createTempProject, type TempProject } from "./helpers/golden-project.ts";
import { CANCEL, fakeTerminal } from "./helpers/terminal.ts";

const CONTENTS = 'import { mod } from "#mod";\n';
const SEGMENTS = ["src", "content"] as const;
const BASENAME = "resonance_theory.ts";

let roots: string[] = [];
let projects: TempProject[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
  for (const project of projects) {
    project.dispose();
  }
  projects = [];
});

/** A real directory, disposed after the test, in the native canonical spelling. */
function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pdx-publish-"));
  roots.push(root);
  return realpathSync.native(root);
}

function openProject(): TempProject {
  const project = createTempProject();
  projects.push(project);
  return project;
}

async function preflight(root: string, segments: readonly string[] = SEGMENTS) {
  return preflightTarget(root, segments, BASENAME);
}

describe("validateContentDirectory", () => {
  it("takes an ordinary project-relative path", () => {
    expect(validateContentDirectory("src/content")).toEqual(["src", "content"]);
    expect(validateContentDirectory("src/features/content")).toEqual([
      "src",
      "features",
      "content",
    ]);
  });

  it.each([
    ["", "empty"],
    ["/etc", "absolute"],
    ["/", "the root"],
    ["C:/mods", "a drive letter"],
    ["src\\content", "a backslash"],
    ["src/con\0tent", "a NUL byte"],
    ["..", "the parent"],
    ["../outside", "traversal"],
    ["src/../../outside", "traversal through a segment"],
    [".", "the current directory"],
    ["./src/content", "a leading dot"],
    ["src//content", "an empty segment"],
    ["src/content/", "a trailing slash"],
    ["content", "outside the TypeScript source root"],
    ["src/content#fragment", "a URL fragment"],
    ["src/content?query", "a URL query"],
    ["src/%2e%2e/outside", "a percent-encoded dot segment"],
  ])("refuses %o, which is %s", (raw) => {
    expect(() => validateContentDirectory(raw)).toThrow(ProjectLayoutError);
  });
});

describe("preflight", () => {
  it("records the missing suffix and creates nothing", async () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "src"));

    const result = await preflight(root);
    expect(result.missingSegments).toEqual(["content"]);
    expect(result.existingDir).toBe(path.join(root, "src"));
    expect(result.target).toBe("absent");
    expect(existsSync(path.join(root, "src/content"))).toBe(false);
  });

  it("stops at the first missing segment rather than stating past it", async () => {
    const root = makeRoot();
    const result = await preflight(root, ["a", "b", "c"]);
    expect(result.missingSegments).toEqual(["a", "b", "c"]);
    expect(result.existingDir).toBe(root);
    expect(readdirSync(root)).toEqual([]);
  });

  it.each([
    ["resolving back inside the project", true],
    ["escaping the project entirely", false],
  ])("refuses a symlinked segment %s", async (_case, inside) => {
    const root = makeRoot();
    const elsewhere = inside ? path.join(root, "real-content") : makeRoot();
    mkdirSync(path.join(root, "src"));
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, path.join(root, "src/content"));

    await expect(preflight(root)).rejects.toThrow(ContainmentError);
  });

  it("refuses a symlinked ancestor", async () => {
    const root = makeRoot();
    const elsewhere = makeRoot();
    mkdirSync(path.join(elsewhere, "content"));
    symlinkSync(elsewhere, path.join(root, "src"));

    await expect(preflight(root)).rejects.toThrow(ContainmentError);
  });

  it("refuses a segment that exists but is not a directory", async () => {
    const root = makeRoot();
    writeFileSync(path.join(root, "src"), "not a directory\n");
    await expect(preflight(root)).rejects.toThrow(ContainmentError);
  });

  it("takes a directory whose name merely starts with dots", async () => {
    // `..generated` is a legal directory name, and containment is a question
    // about where a path resolves rather than about how it is spelled. A prefix
    // test on ".." would refuse this one and be wrong about it.
    const root = makeRoot();
    const result = await preflightTarget(root, ["..generated"], BASENAME);

    expect(result.missingSegments).toEqual(["..generated"]);
    const written = await publishExclusive(result, CONTENTS);
    expect(written).toBe(path.join(root, "..generated", BASENAME));
    expect(readFileSync(written, "utf8")).toBe(CONTENTS);
  });

  it("works through a project root that is itself reached by a symlink", async () => {
    // The rule is about real paths, not about the spelling used to get there.
    const real = makeRoot();
    const links = makeRoot();
    const alias = path.join(links, "project");
    symlinkSync(real, alias);
    mkdirSync(path.join(real, "src/content"), { recursive: true });

    const result = await preflight(realpathSync.native(alias));
    expect(result.existingDir).toBe(path.join(real, "src/content"));

    const written = await publishExclusive(result, CONTENTS);
    expect(written).toBe(path.join(real, "src/content", BASENAME));
    expect(readFileSync(written, "utf8")).toBe(CONTENTS);
  });

  const KINDS = ["file", "dir", "symlink", "dangling symlink", "fifo"] as const;

  it.each(KINDS)("classifies a %s target, and the publisher refuses it", async (kind) => {
    if (kind === "fifo" && process.platform !== "darwin" && process.platform !== "linux") {
      return;
    }
    const root = makeRoot();
    const dir = path.join(root, ...SEGMENTS);
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, BASENAME);

    let expected: string;
    switch (kind) {
      case "file":
        writeFileSync(target, "// mine\n");
        expected = "file";
        break;
      case "dir":
        mkdirSync(target);
        expected = "dir";
        break;
      case "symlink":
        writeFileSync(path.join(dir, "other.ts"), "// other\n");
        symlinkSync(path.join(dir, "other.ts"), target);
        expected = "symlink";
        break;
      case "dangling symlink":
        symlinkSync(path.join(dir, "nowhere.ts"), target);
        expected = "symlink";
        break;
      case "fifo":
        expect(spawnSync("mkfifo", [target]).status).toBe(0);
        expected = "other";
        break;
    }

    const result = await preflight(root);
    expect(result.target).toBe(expected);
    // The classification is advice; this is the guarantee. `link()` refuses
    // every one of these kinds, so even a target the preflight never saw
    // cannot be replaced.
    await expect(publishExclusive(result, CONTENTS)).rejects.toThrow(CollisionError);
    expect(onlyEntries(dir)).not.toContain("temporary");
  });
});

describe("publishing", () => {
  it("creates the missing directories, writes the bytes, and leaves no temporary", async () => {
    const root = makeRoot();
    const written = await publishExclusive(await preflight(root), CONTENTS);

    expect(written).toBe(path.join(root, ...SEGMENTS, BASENAME));
    expect(readFileSync(written, "utf8")).toBe(CONTENTS);
    expect(onlyEntries(path.dirname(written))).toEqual([BASENAME]);
    expect(lstatSync(written).isFile()).toBe(true);
  });

  it("refuses the second publication of the same name", async () => {
    const root = makeRoot();
    await publishExclusive(await preflight(root), CONTENTS);

    // A fresh preflight would see the file; this one deliberately does not,
    // which is the same position a racing run is in.
    const stale = await preflight(root);
    await expect(publishExclusive(stale, "// second\n")).rejects.toThrow(CollisionError);
    expect(readFileSync(path.join(root, ...SEGMENTS, BASENAME), "utf8")).toBe(CONTENTS);
  });

  it.each(["file", "dir", "symlink"] as const)(
    "refuses a %s that appears between the preflight and the write",
    async (kind) => {
      const root = makeRoot();
      const result = await preflight(root);
      expect(result.target).toBe("absent");

      // The publication boundary, for real: the preflight saw nothing, and by
      // the time the bytes are ready the name is taken.
      const dir = path.join(root, ...SEGMENTS);
      mkdirSync(dir, { recursive: true });
      const target = path.join(dir, BASENAME);
      const before = raceIn(kind, dir, target);

      await expect(publishExclusive(result, CONTENTS)).rejects.toThrow(CollisionError);
      expect(after(kind, target)).toBe(before);
      expect(onlyEntries(dir).filter((name) => name.startsWith(`.${BASENAME}`))).toEqual([]);
    }
  );

  it("refuses a segment that races in as a symlink", async () => {
    const root = makeRoot();
    const result = await preflight(root);
    const elsewhere = makeRoot();
    mkdirSync(path.join(root, "src"));
    symlinkSync(elsewhere, path.join(root, "src/content"));

    await expect(publishExclusive(result, CONTENTS)).rejects.toThrow(ContainmentError);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("leaves no temporary file behind when the write itself fails", async () => {
    // A full disk is the ordinary way this happens, and it is the one failure
    // that used to litter: the bytes never arrive, the dotfile does.
    const root = makeRoot();
    const result = await preflight(root);

    await expect(
      publishExclusive(result, CONTENTS, {
        // The real exclusive create, so there is a real file to clean up; only
        // the write fails.
        open: async (target, flags, mode) => {
          const handle = await open(target, flags, mode);
          return {
            writeFile: () =>
              Promise.reject(Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" })),
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      })
    ).rejects.toThrow(/ENOSPC/);

    const dir = path.join(root, ...SEGMENTS);
    expect(existsSync(path.join(dir, BASENAME))).toBe(false);
    expect(onlyEntries(dir)).toEqual([]);
  });

  it.each(["EPERM", "ENOTSUP"])(
    "fails loudly when the filesystem cannot link (%s), and never falls back to rename",
    async (code) => {
      const root = makeRoot();
      const result = await preflight(root);

      await expect(
        publishExclusive(result, CONTENTS, {
          link: () => Promise.reject(Object.assign(new Error(`${code}: nope`), { code })),
        })
      ).rejects.toThrow(UnsupportedPublicationError);

      const dir = path.join(root, ...SEGMENTS);
      // No target, and no temporary file left behind pretending to be one.
      expect(existsSync(path.join(dir, BASENAME))).toBe(false);
      expect(onlyEntries(dir)).toEqual([]);
    }
  );
});

describe("what generate leaves behind", () => {
  it("creates no directory during a dry run", async () => {
    const project = openProject();
    rmSync(path.join(project.dir, "src/content"), { recursive: true, force: true });

    const { io } = capture(project.dir);
    expect(
      await main(["generate", "technology", "Resonance Theory", "--yes", "--dry-run"], io)
    ).toBe(0);
    expect(existsSync(path.join(project.dir, "src/content"))).toBe(false);
  });

  it("creates no directory when the confirmation is declined", async () => {
    const project = openProject();
    rmSync(path.join(project.dir, "src/content"), { recursive: true, force: true });

    const { io } = capture(project.dir, true);
    const terminal = fakeTerminal(io, [CANCEL]);
    expect(await main(["generate", "technology", "Resonance Theory"], io, terminal)).toBe(130);
    expect(existsSync(path.join(project.dir, "src/content"))).toBe(false);
  });
});

/** What raced in, as bytes, so the refusal can be shown to have touched nothing. */
function raceIn(kind: "file" | "dir" | "symlink", dir: string, target: string): string {
  switch (kind) {
    case "file":
      writeFileSync(target, "// mine\n");
      return "// mine\n";
    case "dir":
      mkdirSync(target);
      writeFileSync(path.join(target, "inside.txt"), "still here\n");
      return "still here\n";
    case "symlink":
      writeFileSync(path.join(dir, "other.ts"), "// other\n");
      symlinkSync(path.join(dir, "other.ts"), target);
      return "// other\n";
  }
}

function after(kind: "file" | "dir" | "symlink", target: string): string {
  if (kind === "dir") {
    expect(lstatSync(target).isDirectory()).toBe(true);
    return readFileSync(path.join(target, "inside.txt"), "utf8");
  }
  if (kind === "symlink") {
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
  }
  return readFileSync(target, "utf8");
}

function onlyEntries(dir: string): string[] {
  return readdirSync(dir).sort();
}
