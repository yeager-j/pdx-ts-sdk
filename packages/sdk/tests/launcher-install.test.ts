/**
 * The launcher install path: the mod directory per platform, the descriptor the
 * launcher reads, and `install()` putting both where they belong.
 *
 * The load-bearing test here is the anti-drift one. Two descriptors describe
 * one mod and differ by a single line, and before this they were three
 * hand-rolled copies in `examples/` that had already diverged. Asserting the
 * relationship rather than the bytes is what keeps them from diverging again.
 *
 * Verified in game 2026-08-03, Stellaris Pegasus 4.4.6. A project scaffolded by
 * `create-stellaris-mod` was installed with `npm run install-mod` — so through
 * `install()`, not a hand-written descriptor — and Jackson confirmed the
 * launcher listed it, the `on_game_start_country` event fired, and the mod's
 * technology was present. That is the one claim no test here can make: these
 * assertions prove the bytes are what we intended, and only the running game
 * proves the launcher agrees they are a mod.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildMod,
  collection,
  defineTechnology,
  install,
  render,
  renderLauncherDescriptor,
  stellaris,
  VanillaPathCollisionError,
  write,
  type ModConfig,
  type PureMod,
} from "../src/index.ts";
import { viewFromFiles } from "../src/vanilla/surface.ts";

const config: ModConfig = {
  name: "Launcher Probe",
  prefix: "lp_probe",
  version: "0.2.0",
  supportedVersion: "v4.4.*",
  tags: ["Technologies"],
};

const mod = buildMod(config, [
  collection(undefined, [
    defineTechnology({
      id: "lp_probe_tech_marker",
      name: "Marker",
      cost: 1000,
      area: "physics",
      tier: 1,
      category: "particles",
    }),
  ]),
]);

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pdx-launcher-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env["STELLARIS_MOD_DIR"];
});

describe("modDirFor", () => {
  it.each([
    ["darwin", "/home/u", "/home/u/Documents/Paradox Interactive/Stellaris/mod"],
    ["linux", "/home/u", "/home/u/.local/share/Paradox Interactive/Stellaris/mod"],
    ["freebsd", "/home/u", "/home/u/.local/share/Paradox Interactive/Stellaris/mod"],
  ])("puts %s's mod directory under %s", (platform, home, expected) => {
    expect(stellaris.modDirFor(platform as NodeJS.Platform, home)).toBe(expected);
  });

  it("puts win32's under the user's Documents", () => {
    // Asserted by segments rather than a literal, since `join` uses the
    // separator of whatever platform is running the test, not of win32.
    expect(stellaris.modDirFor("win32", "C:\\Users\\u").split(/[\\/]/)).toEqual([
      "C:",
      "Users",
      "u",
      "Documents",
      "Paradox Interactive",
      "Stellaris",
      "mod",
    ]);
  });
});

describe("modDir precedence", () => {
  it("prefers an explicit path over everything", () => {
    process.env["STELLARIS_MOD_DIR"] = "/from/env";
    expect(stellaris.modDir("/explicit")).toBe("/explicit");
  });

  it("prefers STELLARIS_MOD_DIR over the platform default", () => {
    process.env["STELLARIS_MOD_DIR"] = "/from/env";
    expect(stellaris.modDir()).toBe("/from/env");
  });

  it("falls back to the platform default", () => {
    expect(stellaris.modDir()).toBe(stellaris.modDirFor(process.platform, homedir()));
  });

  it("ignores an empty override rather than resolving to nothing", () => {
    process.env["STELLARIS_MOD_DIR"] = "";
    expect(stellaris.modDir("")).toBe(stellaris.modDirFor(process.platform, homedir()));
  });
});

describe("renderLauncherDescriptor", () => {
  it("is the mod's own descriptor plus a path line, and nothing else", () => {
    // The whole anti-drift claim, as one assertion: the two descriptors cannot
    // disagree about name, version, tags or supported_version, because only one
    // of them decides those.
    const inner = render(mod).get("descriptor.mod")!;
    expect(renderLauncherDescriptor(mod, "/some/where/lp_probe")).toBe(
      `${inner.trimEnd()}\npath="/some/where/lp_probe"\n`
    );
  });
});

describe("install", () => {
  it("writes the content and the sibling descriptor the launcher reads", async () => {
    const root = tempDir();
    const result = await install(mod, { modDir: root });

    expect(result.contentDir).toBe(join(root, "lp_probe"));
    expect(result.descriptorPath).toBe(join(root, "lp_probe.mod"));
    expect(readFileSync(join(result.contentDir, "descriptor.mod"), "utf8")).toContain(
      'name="Launcher Probe"'
    );
    expect(
      readFileSync(join(result.contentDir, "common/technology/lp_probe_technology.txt"), "utf8")
    ).toContain("lp_probe_tech_marker");
    expect(readFileSync(result.descriptorPath, "utf8")).toBe(
      renderLauncherDescriptor(mod, result.contentDir)
    );
  });

  it("names the content folder after the prefix, so two mods cannot collide", async () => {
    const root = tempDir();
    const { contentDir } = await install(mod, { modDir: root });
    expect(contentDir.endsWith(mod.config.prefix)).toBe(true);
  });

  it("takes an explicit folder name for an author who wants one", async () => {
    const root = tempDir();
    const result = await install(mod, { modDir: root, dirName: "custom_name" });
    expect(result.contentDir).toBe(join(root, "custom_name"));
    expect(result.descriptorPath).toBe(join(root, "custom_name.mod"));
    expect(readFileSync(result.descriptorPath, "utf8")).toContain(
      `path="${join(root, "custom_name")}"`
    );
  });

  it("replaces the content directory rather than merging into it", async () => {
    // The failure this prevents: rename a feature module, reinstall, and the
    // previous file is still there — so the game loads both and sees the same
    // ids twice. `write` only overwrites the paths it is handed, so the stale
    // one survives unless the directory is cleared.
    const root = tempDir();
    const { contentDir } = await install(mod, { modDir: root });
    const stale = join(contentDir, "common/technology/lp_probe_old_feature.txt");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "lp_probe_tech_marker = { }\n", "utf8");

    await install(mod, { modDir: root });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(contentDir, "common/technology/lp_probe_technology.txt"))).toBe(true);
  });

  it("creates a mod directory that does not exist yet", async () => {
    // A fresh install legitimately has no mod directory — the launcher makes it
    // on first use — so this must not be the failure case.
    const root = join(tempDir(), "not", "yet");
    const result = await install(mod, { modDir: root });
    expect(readFileSync(result.descriptorPath, "utf8")).toContain('name="Launcher Probe"');
  });

  it("leaves nothing behind but the content directory and its descriptor", async () => {
    // The swap stages into siblings; a completed install must not leave one.
    const root = tempDir();
    await install(mod, { modDir: root });
    await install(mod, { modDir: root });
    expect(readdirSync(root).sort()).toEqual(["lp_probe", "lp_probe.mod"]);
  });
});

describe("install refuses a folder name that is not a folder name", () => {
  // Two hazards behind one gate. A name that escapes the directory decides
  // what gets *deleted*: "" is the launcher's whole mod directory, ".." its
  // parent, "a/b" somewhere sideways. A name carrying a quote or a line break
  // decides what the launcher descriptor *says*, since `install` writes it
  // into `path="..."` — the same unescaped format the config gate gaurds, one
  // door over.
  it.each([
    ["empty", "", /not a single folder name/],
    ["this directory", ".", /not a single folder name/],
    ["the parent directory", "..", /not a single folder name/],
    ["a nested path", "custom/nested", /not a single folder name/],
    ["a backslash path", "custom\\nested", /not a single folder name/],
    ["an absolute path", "/tmp/pdx-escape-probe", /not a single folder name/],
    ["a NUL byte", "custom\0name", /cannot contain a control character/],
    ["a double quote", 'quoted"name', /cannot contain a double quote/],
    ["a forged descriptor field", 'safe"\narchive="x', /cannot contain a double quote/],
    ["a line break", "line\nbreak", /cannot contain a line break/],
    ["a carriage return", "carriage\rreturn", /cannot contain a line break/],
  ])("rejects %s", async (_label, dirName, expected) => {
    const root = tempDir();
    await expect(install(mod, { modDir: root, dirName })).rejects.toThrow(expected);
    // Nothing was created, and nothing was deleted, before the refusal.
    expect(readdirSync(root)).toEqual([]);
  });

  it("keeps the refusal message itself free of the characters it is reporting", () => {
    // The message quotes the name back; printing a raw line break inside it
    // would let the reported name forge lines in a build log the same way it
    // would in the descriptor.
    expect.assertions(1);
    return install(mod, { modDir: tempDir(), dirName: 'a"\nb' }).catch((error: Error) => {
      expect(error.message).not.toMatch(/[\r\n]\s*archive|path="[^"]*"[^"]*"/);
    });
  });

  it("checks the prefix default through the same gate, naming it as the default", async () => {
    // `buildMod` validates its own prefix, so this is reachable only through a
    // hand-built `PureMod` — but `install` takes a `PureMod`, not a build, and
    // the value that decides a recursive delete is not one to take on trust.
    const root = tempDir();
    const forged = { ...mod, config: { ...mod.config, prefix: ".." } } as PureMod;
    await expect(install(forged, { modDir: root })).rejects.toThrow(
      /The mod prefix "\.\." is the default folder name/
    );
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("install is atomic in the ways that matter", () => {
  /** A mod whose `render` throws: it emits at a path the vanilla view occupies. */
  function collidingMod(): PureMod {
    const vanilla = viewFromFiles({
      "common/technology/lp_probe_technology.txt": "tech_squatter = {\n\tarea = physics\n}\n",
    });
    return buildMod(
      config,
      [
        collection(undefined, [
          defineTechnology({
            id: "lp_probe_tech_marker",
            name: "Marker",
            cost: 1000,
            area: "physics",
            tier: 1,
            category: "particles",
          }),
        ]),
      ],
      { vanilla }
    );
  }

  it("leaves an existing install untouched when render throws", async () => {
    // The install used to delete the content directory *before* calling
    // render, so a build that refused to render — a vanilla path collision, a
    // malformed definition — took the user's working mod with it and left
    // nothing in its place.
    const root = tempDir();
    const { contentDir } = await install(mod, { modDir: root });
    const before = readdirSync(contentDir).sort();
    const marker = readFileSync(
      join(contentDir, "common/technology/lp_probe_technology.txt"),
      "utf8"
    );
    const descriptorBefore = readFileSync(join(root, "lp_probe.mod"), "utf8");

    await expect(install(collidingMod(), { modDir: root })).rejects.toThrow(
      VanillaPathCollisionError
    );

    expect(readdirSync(contentDir).sort()).toEqual(before);
    expect(
      readFileSync(join(contentDir, "common/technology/lp_probe_technology.txt"), "utf8")
    ).toBe(marker);
    expect(readFileSync(join(root, "lp_probe.mod"), "utf8")).toBe(descriptorBefore);
    // And no staging or set-aside directory survived the failure.
    expect(readdirSync(root).sort()).toEqual(["lp_probe", "lp_probe.mod"]);
  });

  it("installs under a long but legal folder name", async () => {
    // The staging and set-aside directories used to be named by decorating
    // `dirName`, which overflows the filesystem's 255-byte component limit
    // while `dirName` itself is still perfectly legal — so a long folder name
    // failed with ENAMETOOLONG before the install had done anything. 240
    // characters leaves room for the ".mod" descriptor beside it.
    const root = tempDir();
    const dirName = "l".repeat(240);
    const result = await install(mod, { modDir: root, dirName });
    expect(result.contentDir).toBe(join(root, dirName));
    expect(readFileSync(join(result.contentDir, "descriptor.mod"), "utf8")).toContain(
      'name="Launcher Probe"'
    );
    // Re-installing exercises the set-aside rename as well as the staging one.
    await install(mod, { modDir: root, dirName });
    expect(readdirSync(root).sort()).toEqual([dirName, `${dirName}.mod`]);
  });

  it("replaces an existing install with exactly the new render", async () => {
    const root = tempDir();
    const { contentDir } = await install(mod, { modDir: root });
    const stale = join(contentDir, "common/technology/lp_probe_old_feature.txt");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "lp_probe_tech_marker = { }\n", "utf8");

    await install(mod, { modDir: root });

    const rendered = render(mod);
    const written = new Map(
      [...rendered.keys()].map((relPath) => [
        relPath,
        readFileSync(join(contentDir, relPath), "utf8"),
      ])
    );
    expect([...written.entries()]).toEqual([...rendered.entries()]);
    expect(existsSync(stale)).toBe(false);
  });
});

describe("write stays inside the directory it was given", () => {
  it.each([
    ["a traversing relPath", "../escaped.txt"],
    ["a deep traversal", "a/../../escaped.txt"],
    ["an absolute relPath", "/tmp/pdx-write-escape-probe.txt"],
    ["the output directory itself", "."],
    ["the output directory, spelled empty", ""],
  ])("rejects %s", async (_label, relPath) => {
    const root = tempDir();
    await expect(write(root, new Map([[relPath, "escaped"]]))).rejects.toThrow(
      /not a file inside the output directory/
    );
    expect(readdirSync(root)).toEqual([]);
  });

  it("still writes ordinary nested paths", async () => {
    const root = tempDir();
    await write(root, new Map([["common/technology/x.txt", "ok"]]));
    expect(readFileSync(join(root, "common/technology/x.txt"), "utf8")).toBe("ok");
  });

  it.skipIf(process.platform === "win32")(
    "does not mistake a child of a filesystem root for an escape",
    async () => {
      // `/` already ends in a separator, so a `root + sep` prefix test compares
      // against `"//"` and rejects every legitimate child of it. The real
      // function is driven here rather than a copy of its rule, and aimed at
      // `/dev/null`: it exists everywhere POSIX, it is not a directory, so the
      // `mkdir` behind the write fails immediately with ENOTDIR — no
      // privileges, no waiting, and nothing created. Reaching that error at
      // all is the assertion: containment let the path through.
      await expect(
        write("/", new Map([["dev/null/pdx-containment-probe.txt", "unwritable"]]))
      ).rejects.toThrow(/ENOTDIR|EEXIST|EACCES|EPERM|EROFS/);
      await expect(
        write("/", new Map([["dev/null/pdx-containment-probe.txt", "unwritable"]]))
      ).rejects.not.toThrow(/not a file inside the output directory/);
    }
  );

  it("still refuses an escape from a filesystem root", async () => {
    // The other half: `/` has no parent, so `..` normalizes back to `/` and is
    // the root itself rather than an escape — while an absolute key pointing
    // somewhere else entirely is still refused.
    await expect(write("/", new Map([["..", "x"]]))).rejects.toThrow(
      /not a file inside the output directory/
    );
  });
});
