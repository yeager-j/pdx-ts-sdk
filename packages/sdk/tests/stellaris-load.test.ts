/**
 * The install layer against a committed miniature install. Everything here
 * is hermetic: the fixture is copied into a temp directory when a test
 * needs to mutate it, and the cache always points at a temp directory so
 * runs cannot see each other.
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { InstallNotFoundError } from "../src/errors.ts";
import { load } from "../src/stellaris/load.ts";
import { locateInstall } from "../src/stellaris/locate.ts";

const FIXTURE = join(import.meta.dirname, "../../../fixtures/fake-install");

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pdx-sdk-test-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("locateInstall", () => {
  it("accepts an explicit path that passes the sentinel", () => {
    expect(locateInstall(FIXTURE)).toBe(FIXTURE);
  });

  it("rejects an explicit path without common/technology, naming it", () => {
    const empty = tempDir();
    expect(() => locateInstall(empty)).toThrow(InstallNotFoundError);
    expect(() => locateInstall(empty)).toThrow(empty);
  });

  it("rejects a bad STELLARIS_PATH loudly instead of falling through", () => {
    const empty = tempDir();
    const saved = process.env["STELLARIS_PATH"];
    process.env["STELLARIS_PATH"] = empty;
    try {
      expect(() => locateInstall()).toThrow(InstallNotFoundError);
      expect(() => locateInstall()).toThrow(/STELLARIS_PATH/);
    } finally {
      if (saved === undefined) {
        delete process.env["STELLARIS_PATH"];
      } else {
        process.env["STELLARIS_PATH"] = saved;
      }
    }
  });
});

describe("load", () => {
  it("parses the miniature install with version and provenance", () => {
    const view = load({ installPath: FIXTURE, cache: false });
    expect(view.installPath).toBe(FIXTURE);
    expect(view.gameVersion).toBe("4.4.6");
    expect(view.fromCache).toBe(false);
    expect(view.files.map((file) => file.path)).toEqual([
      "common/scripted_variables/00_fake_vars.txt",
      "common/technology/00_fake_soc_tech.txt",
    ]);
    const tech = view.technology("tech_fake_farming").require("cost", "startTech");
    expect(tech.cost.value).toBe(100);
    expect(tech.cost.ref).toBe("@fake_t1cost");
    expect(tech.startTech).toBe(true);
  });

  it("writes the cache on a miss and serves the identical view on a hit", () => {
    const cache = tempDir();
    const first = load({ installPath: FIXTURE, cache });
    expect(first.fromCache).toBe(false);
    expect(readdirSync(cache).filter((name) => name.startsWith("vanilla-"))).toHaveLength(1);

    const second = load({ installPath: FIXTURE, cache });
    expect(second.fromCache).toBe(true);
    expect(second.manifestKey).toBe(first.manifestKey);
    expect(second.gameVersion).toBe(first.gameVersion);
    expect(second.technology("tech_fake_farming").cost?.value).toBe(100);
  });

  it("a changed file changes the key: the cache can never serve stale content", () => {
    const cache = tempDir();
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });

    const first = load({ installPath: install, cache });
    writeFileSync(
      join(install, "common/technology/00_fake_soc_tech.txt"),
      "tech_fake_farming = {\n\tcost = 250\n\tarea = society\n}\n"
    );
    const second = load({ installPath: install, cache });
    expect(second.fromCache).toBe(false);
    expect(second.manifestKey).not.toBe(first.manifestKey);
    expect(second.technology("tech_fake_farming").cost?.value).toBe(250);
  });

  it("cache: false writes nothing", () => {
    const cache = tempDir();
    load({ installPath: FIXTURE, cache: false });
    expect(existsSync(join(cache, "vanilla"))).toBe(false);
    expect(readdirSync(cache)).toEqual([]);
  });

  it("refuses a subdirectory under a flat-parsed dir", () => {
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });
    cpSync(
      join(install, "common/technology/00_fake_soc_tech.txt"),
      join(install, "common/technology/nested/extra.txt")
    );
    expect(() => load({ installPath: install, cache: false })).toThrow(
      /directory this slice does not know/
    );
  });

  it("carries no game version when launcher-settings.json is absent", () => {
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });
    rmSync(join(install, "launcher-settings.json"));
    const view = load({ installPath: install, cache: false });
    expect(view.gameVersion).toBeUndefined();
  });
});
