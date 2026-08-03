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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  type ModConfig,
} from "../src/index.ts";

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
});
