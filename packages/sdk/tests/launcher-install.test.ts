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
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMod,
  install,
  MaterializationError,
  PathOwnershipError,
  render,
  write,
  type ModConfig,
  type PureMod,
} from "../src/index.ts";
import * as stellaris from "../src/installation/index.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
import { renderLauncherDescriptor } from "../src/output/render.ts";

const config: ModConfig = {
  name: "Launcher Probe",
  prefix: "lp_probe",
  version: "0.2.0",
  supportedVersion: "v4.4.*",
  tags: ["Technologies"],
};

const capability = createMod(config);
const mod = capability.compile([
  capability.feature(undefined, [
    capability.technology("marker", {
      name: "Marker",
      cost: 1000,
      area: "physics",
      tier: 1,
      category: "particles",
    }),
  ]),
]);
const renderedMod = render(mod);

function renderedWithOldFeature() {
  const old = capability.technology("old_marker", {
    name: "Old Marker",
    cost: 1000,
    area: "physics",
    tier: 1,
    category: "particles",
  });
  return render(
    capability.compile([
      capability.feature(undefined, [
        capability.technology("marker", {
          name: "Marker",
          cost: 1000,
          area: "physics",
          tier: 1,
          category: "particles",
        }),
      ]),
      capability.feature("old_feature", [old]),
    ])
  );
}

function renderedVariant(name: string) {
  const variant = createMod({ ...config, name });
  return render(
    variant.compile([
      variant.feature(undefined, [
        variant.technology("marker", {
          name: "Marker",
          cost: 1000,
          area: "physics",
          tier: 1,
          category: "particles",
        }),
      ]),
    ])
  );
}

/** The refusal itself, so a test can assert which reason it carries. */
async function refusal(operation: Promise<unknown>): Promise<MaterializationError> {
  const thrown = await operation.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(MaterializationError);
  return thrown as MaterializationError;
}

const temps: string[] = [];
/**
 * Physical from the start: `install` resolves the mod directory through every
 * symlink before it reports one, and the system temp directory is a symlink on
 * macOS, so a raw `mkdtemp` path would differ from every reported path.
 */
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pdx-launcher-")));
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
    expect(renderLauncherDescriptor(renderedMod, "/some/where/lp_probe")).toBe(
      `${inner.trimEnd()}\npath="/some/where/lp_probe"`
    );
  });
});

describe("install", () => {
  it("writes the content and the sibling descriptor the launcher reads", async () => {
    const root = tempDir();
    const result = await install(renderedMod, { modDir: root });

    expect(result.contentDir).toBe(join(root, "lp_probe"));
    expect(result.descriptorPath).toBe(join(root, "lp_probe.mod"));
    expect(readFileSync(join(result.contentDir, "descriptor.mod"), "utf8")).toContain(
      'name="Launcher Probe"'
    );
    expect(
      readFileSync(join(result.contentDir, "common/technology/lp_probe_technology.txt"), "utf8")
    ).toContain("lp_probe_tech_marker");
    expect(readFileSync(result.descriptorPath, "utf8")).toBe(
      renderLauncherDescriptor(renderedMod, result.contentDir)
    );
  });

  it("names the content folder after the prefix, so two mods cannot collide", async () => {
    const root = tempDir();
    const { contentDir } = await install(renderedMod, { modDir: root });
    expect(contentDir.endsWith(mod.config.prefix)).toBe(true);
  });

  it("takes an explicit folder name for an author who wants one", async () => {
    const root = tempDir();
    const result = await install(renderedMod, { modDir: root, dirName: "custom_name" });
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
    const { contentDir } = await install(renderedWithOldFeature(), { modDir: root });
    const stale = join(contentDir, "common/technology/lp_probe_old_feature.txt");

    await install(renderedMod, { modDir: root });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(contentDir, "common/technology/lp_probe_technology.txt"))).toBe(true);
  });

  it("creates a mod directory that does not exist yet", async () => {
    // A fresh install legitimately has no mod directory — the launcher makes it
    // on first use — so this must not be the failure case.
    const root = join(tempDir(), "not", "yet");
    const result = await install(renderedMod, { modDir: root });
    expect(readFileSync(result.descriptorPath, "utf8")).toContain('name="Launcher Probe"');
  });

  it("leaves nothing behind but the content directory and its descriptor", async () => {
    // The swap stages into siblings; a completed install must not leave one.
    const root = tempDir();
    await install(renderedMod, { modDir: root });
    await install(renderedMod, { modDir: root });
    expect(readdirSync(root).sort()).toEqual(["lp_probe", "lp_probe.mod"]);
  });

  it("serializes concurrent installs targeting the same content directory", async () => {
    const root = tempDir();
    await install(renderedMod, { modDir: root });
    const candidates = Array.from({ length: 6 }, (_, index) =>
      renderedVariant(`Concurrent Probe ${index}`)
    );

    const results = await Promise.all(
      candidates.map((candidate) => install(candidate, { modDir: root }))
    );

    const contentDir = results[0]!.contentDir;
    const innerDescriptor = readFileSync(join(contentDir, "descriptor.mod"), "utf8");
    const launcherDescriptor = readFileSync(results[0]!.descriptorPath, "utf8");
    expect(
      candidates.some(
        (candidate) =>
          candidate.get("descriptor.mod") === innerDescriptor &&
          renderLauncherDescriptor(candidate, contentDir) === launcherDescriptor
      )
    ).toBe(true);
    expect(readdirSync(root).sort()).toEqual(["lp_probe", "lp_probe.mod"]);
  });

  it("refuses a launcher descriptor symlink without touching its target", async () => {
    const root = tempDir();
    const outside = join(tempDir(), "outside.mod");
    writeFileSync(outside, "outside", "utf8");
    await install(renderedMod, { modDir: root });
    rmSync(join(root, "lp_probe.mod"));
    symlinkSync(outside, join(root, "lp_probe.mod"));

    // The descriptor is owned output, so a symlink in its place is drift on
    // the owned set — not a foreign entry the install may preserve.
    expect((await refusal(install(renderedMod, { modDir: root }))).reason).toBe("drift");

    expect(readFileSync(outside, "utf8")).toBe("outside");
  });

  it.each(['quoted"root', "line\nbreak"])(
    "refuses a mod directory path the launcher format cannot encode: %o",
    async (basename) => {
      const root = join(tempDir(), basename);
      await expect(install(renderedMod, { modDir: root })).rejects.toThrow(
        /descriptor format has no escaping/
      );
      expect(existsSync(root)).toBe(false);
    }
  );
});

describe("install refuses a folder name that is not a folder name", () => {
  // Two hazards behind one gate. A name that escapes the directory decides
  // what gets *deleted*: "" is the launcher's whole mod directory, ".." its
  // parent, "a/b" somewhere sideways. A name carrying a quote or a line break
  // decides what the launcher descriptor *says*, since `install` writes it
  // into `path="..."` — the same unescaped format the config gate gaurds, one
  // door over.
  const notOneSegment = /must be one plain path segment/;
  const notEncodable = /cannot contain a quote or control character/;
  it.each([
    ["empty", "", notOneSegment],
    ["this directory", ".", notOneSegment],
    ["the parent directory", "..", notOneSegment],
    ["a nested path", "custom/nested", notOneSegment],
    ["a backslash path", "custom\\nested", notOneSegment],
    ["an absolute path", "/tmp/pdx-escape-probe", notOneSegment],
    ["a NUL byte", "custom\0name", notEncodable],
    ["a double quote", 'quoted"name', notEncodable],
    ["a forged descriptor field", 'safe"\narchive="x', notEncodable],
    ["a line break", "line\nbreak", notEncodable],
    ["a carriage return", "carriage\rreturn", notEncodable],
  ])("rejects %s", async (_label, dirName, expected) => {
    const root = tempDir();
    await expect(install(renderedMod, { modDir: root, dirName })).rejects.toThrow(expected);
    // Nothing was created, and nothing was deleted, before the refusal.
    expect(readdirSync(root)).toEqual([]);
  });

  it("keeps the refusal message itself free of the characters it is reporting", () => {
    // The message quotes the name back; printing a raw line break inside it
    // would let the reported name forge lines in a build log the same way it
    // would in the descriptor.
    expect.assertions(1);
    return install(renderedMod, { modDir: tempDir(), dirName: 'a"\nb' }).catch((error: Error) => {
      expect(error.message).not.toMatch(/[\r\n]\s*archive|path="[^"]*"[^"]*"/);
    });
  });

  it("checks the prefix default through the same gate, naming it as the default", async () => {
    // The compile validates its own prefix, so this is reachable only through a
    // hand-built `PureMod` rendered into a snapshot. `install` rechecks the
    // folder name because that value still decides which directory is replaced.
    const root = tempDir();
    const forged = { ...mod, config: { ...mod.config, prefix: ".." } } as PureMod;
    await expect(install(render(forged), { modDir: root })).rejects.toThrow(/Install folder/);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("install is atomic in the ways that matter", () => {
  /** A build that refuses: it would emit at a path the vanilla view occupies. */
  function collidingMod(): PureMod {
    const vanilla = viewFromFiles({
      "common/technology/lp_probe_technology.txt": "tech_squatter = {\n\tarea = physics\n}\n",
    });
    const capability = createMod(config);
    return capability.compile(
      [
        capability.feature(undefined, [
          capability.technology("marker", {
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

  it("leaves an existing install untouched when the build refuses", async () => {
    // The install used to delete the content directory *before* calling
    // render, so a build that refused — a vanilla path collision, a malformed
    // definition — took the user's working mod with it and left nothing in its
    // place. The refusal now happens earlier still, in the fold, which only
    // widens the margin this test protects.
    const root = tempDir();
    const { contentDir } = await install(renderedMod, { modDir: root });
    const before = readdirSync(contentDir).sort();
    const marker = readFileSync(
      join(contentDir, "common/technology/lp_probe_technology.txt"),
      "utf8"
    );
    const descriptorBefore = readFileSync(join(root, "lp_probe.mod"), "utf8");

    expect(() => render(collidingMod())).toThrow(PathOwnershipError);

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
    const result = await install(renderedMod, { modDir: root, dirName });
    expect(result.contentDir).toBe(join(root, dirName));
    expect(readFileSync(join(result.contentDir, "descriptor.mod"), "utf8")).toContain(
      'name="Launcher Probe"'
    );
    // Re-installing exercises the set-aside rename as well as the staging one.
    await install(renderedMod, { modDir: root, dirName });
    expect(readdirSync(root).sort()).toEqual([dirName, `${dirName}.mod`]);
  });

  it("replaces an existing install with exactly the new render", async () => {
    const root = tempDir();
    const { contentDir } = await install(renderedWithOldFeature(), { modDir: root });
    const stale = join(contentDir, "common/technology/lp_probe_old_feature.txt");

    await install(renderedMod, { modDir: root });

    const rendered = render(mod);
    const written = new Map(
      [...rendered.keys()].map((relPath) => [
        relPath,
        readFileSync(join(contentDir, relPath), "utf8"),
      ])
    );
    expect([...written.entries()]).toEqual(
      [...rendered.entries()].map(([relPath, file]) => [relPath, file.text])
    );
    expect(existsSync(stale)).toBe(false);
  });
});

describe("write materializes one exact rendered snapshot", () => {
  it("removes a generated file that the next render no longer owns", async () => {
    const out = join(tempDir(), "out");
    await write(out, renderedWithOldFeature());
    const stale = join(out, "common/technology/lp_probe_old_feature.txt");
    expect(existsSync(stale)).toBe(true);

    await write(out, renderedMod);

    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(join(out, "descriptor.mod"), "utf8")).toContain("Launcher Probe");
    expect(existsSync(join(out, ".pdx-sdk-manifest.json"))).toBe(true);
  });

  it("keeps a file the author added and the manifest never owned", async () => {
    // The game loads whatever is in the folder, so an added file is the
    // author's, not drift: a rebuild must carry it across the swap untouched.
    const out = join(tempDir(), "out");
    await write(out, renderedMod);
    writeFileSync(join(out, "notes.txt"), "mine", "utf8");

    await write(out, renderedMod);

    expect(readFileSync(join(out, "notes.txt"), "utf8")).toBe("mine");
  });

  it("refuses to erase a modified owned path", async () => {
    // The mirror case: an owned file the author edited is drift, and rebuilding
    // over it would destroy the edit without ever showing it to them.
    const out = join(tempDir(), "out");
    await write(out, renderedMod);
    const owned = join(out, "common/technology/lp_probe_technology.txt");
    writeFileSync(owned, "hand edited", "utf8");

    const error = await refusal(write(out, renderedMod));

    expect(error.reason).toBe("drift");
    expect(readFileSync(owned, "utf8")).toBe("hand edited");
  });

  it("never follows a symlink already inside the old output tree", async () => {
    const root = tempDir();
    const out = join(root, "out");
    const outside = join(root, "outside");
    mkdirSync(outside);
    await write(out, renderedMod);
    rmSync(join(out, "common"), { recursive: true });
    symlinkSync(outside, join(out, "common"), "dir");

    // `common/` is a directory the manifest's own paths imply, so swapping it
    // for a symlink is drift on an owned path, not a foreign entry.
    expect((await refusal(write(out, renderedMod))).reason).toBe("drift");

    expect(readdirSync(outside)).toEqual([]);
  });
});
