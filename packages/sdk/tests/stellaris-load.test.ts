/**
 * The install layer against a committed miniature install. Everything here
 * is hermetic: the fixture is copied into a temp directory when a test
 * needs to mutate it, and the cache always points at a temp directory so
 * runs cannot see each other.
 */

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GameVersionError, InstallNotFoundError } from "../src/errors.ts";
import {
  VERIFIED_STELLARIS_BUILD,
  VERIFIED_SUPPORTED_VERSION,
} from "../src/generated/verified-build.ts";
import { createMod } from "../src/index.ts";
import { describeInstall } from "../src/stellaris/installation/describe.ts";
import { locateInstall, platformDefaultsFor } from "../src/stellaris/installation/locate.ts";
import {
  readGameVersion,
  requireGameVersion,
  supportedVersionFor,
} from "../src/stellaris/installation/version.ts";
import { load } from "../src/stellaris/vanilla/load.ts";

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
  it("interprets the generated platform defaults without drift", () => {
    expect(platformDefaultsFor("darwin", "/home/u")).toEqual([
      "/home/u/Library/Application Support/Steam/steamapps/common/Stellaris",
    ]);
    expect(platformDefaultsFor("linux", "/home/u")).toEqual([
      "/home/u/.local/share/Steam/steamapps/common/Stellaris",
      "/home/u/.steam/steam/steamapps/common/Stellaris",
    ]);
  });

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
      "common/buildings/00_fake_buildings.txt",
      "common/megastructures/00_fake_megastructures.txt",
      "common/scripted_variables/00_fake_vars.txt",
      "common/technology/00_fake_soc_tech.txt",
    ]);
    expect(view.definitions("building").map((building) => building.id)).toEqual([
      "building_fake_hydroponics",
    ]);
    expect(view.definitions("megastructure").map((mega) => mega.id)).toEqual([
      "megastructure_fake_array_0",
      "megastructure_fake_array_1",
    ]);
    const tech = view.definition("technology", "tech_fake_farming").require("cost", "startTech");
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
    expect(second.definition("technology", "tech_fake_farming").cost?.value).toBe(100);
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
    expect(second.definition("technology", "tech_fake_farming").cost?.value).toBe(250);
  });

  it("cache: false writes nothing", () => {
    const cache = tempDir();
    load({ installPath: FIXTURE, cache: false });
    expect(existsSync(join(cache, "vanilla"))).toBe(false);
    expect(readdirSync(cache)).toEqual([]);
  });

  it("an unusable cache directory is a silent miss", () => {
    const parent = tempDir();
    const regularFile = join(parent, "not-a-directory");
    writeFileSync(regularFile, "");
    const cache = join(regularFile, "cache"); // mkdirSync(cache) fails with ENOTDIR

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const uncached = load({ installPath: FIXTURE, cache: false });
      const first = load({ installPath: FIXTURE, cache });
      const second = load({ installPath: FIXTURE, cache });

      for (const view of [first, second]) {
        expect(view.fromCache).toBe(false);
        expect(view.gameVersion).toBe(uncached.gameVersion);
        expect(view.files.map((file) => file.path)).toEqual(
          uncached.files.map((file) => file.path)
        );
      }
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("a corrupt cache entry is a silent miss that regenerates", () => {
    const cache = tempDir();
    load({ installPath: FIXTURE, cache });
    const [entryName] = readdirSync(cache).filter((name) => name.startsWith("vanilla-"));
    const entryPath = join(cache, entryName!);
    writeFileSync(entryPath, "not json");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = load({ installPath: FIXTURE, cache });
      expect(view.fromCache).toBe(false);
      expect(() => JSON.parse(readFileSync(entryPath, "utf8"))).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("a cache entry of the wrong shape is a silent miss that regenerates", () => {
    // Valid JSON, so nothing throws on the way in: the sources are checked
    // down to the members the view reads, or the entry is not used at all.
    const cache = tempDir();
    load({ installPath: FIXTURE, cache });
    const [entryName] = readdirSync(cache).filter((name) => name.startsWith("vanilla-"));
    const entryPath = join(cache, entryName!);
    writeFileSync(
      entryPath,
      JSON.stringify({ formatVersion: 1, sources: [{ path: "common/technology/x.txt" }] })
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = load({ installPath: FIXTURE, cache });
      expect(view.fromCache).toBe(false);
      expect(view.definition("technology", "tech_fake_farming").cost?.value).toBe(100);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
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

/** An install whose `launcher-settings.json` has been replaced with `body`. */
function installStating(body: string): string {
  const install = tempDir();
  cpSync(FIXTURE, install, { recursive: true });
  writeFileSync(join(install, "launcher-settings.json"), body, "utf8");
  return install;
}

describe("describeInstall", () => {
  it("reports the path and the build without parsing the install", () => {
    expect(describeInstall(FIXTURE)).toEqual({
      installPath: FIXTURE,
      gameVersion: "4.4.6",
    });
  });

  it("reports a path with no version rather than failing", () => {
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });
    rmSync(join(install, "launcher-settings.json"));
    expect(describeInstall(install)).toEqual({ installPath: install, gameVersion: undefined });
  });

  it("still refuses a path that is not an install", () => {
    expect(() => describeInstall(tempDir())).toThrow(InstallNotFoundError);
  });
});

describe("readGameVersion", () => {
  it("strips the leading v the launcher writes", () => {
    expect(readGameVersion(FIXTURE)).toBe("4.4.6");
  });

  it.each([
    ["no launcher-settings.json", undefined],
    ["malformed JSON", "{ not json"],
    ["no rawVersion key", '{ "gameId": "stellaris" }'],
    ["a non-string rawVersion", '{ "rawVersion": 446 }'],
  ])("returns undefined for %s", (_case, body) => {
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });
    if (body === undefined) {
      rmSync(join(install, "launcher-settings.json"));
    } else {
      writeFileSync(join(install, "launcher-settings.json"), body, "utf8");
    }
    expect(readGameVersion(install)).toBeUndefined();
  });

  it("passes a four-part version through rather than swallowing it", () => {
    // The staleness gate and the identifier-package pin both compare this
    // string and name it when they fail. Returning undefined here would turn
    // two loud failures into silent passes, which is the whole reason the
    // lenient reader does not validate the shape.
    expect(readGameVersion(installStating('{ "rawVersion": "v4.4.6.1" }'))).toBe("4.4.6.1");
  });
});

describe("requireGameVersion", () => {
  it("agrees with the lenient reader on a well-formed install", () => {
    expect(requireGameVersion(FIXTURE)).toBe(readGameVersion(FIXTURE));
  });

  it.each([
    ["is missing", undefined, /launcher-settings\.json is missing/],
    ["is malformed JSON", "{ not json", /is not valid JSON/],
    ["states no rawVersion", '{ "gameId": "stellaris" }', /has no rawVersion string/],
    ["states an empty rawVersion", '{ "rawVersion": "" }', /has no rawVersion string/],
    [
      "states a four-part version",
      '{ "rawVersion": "v4.4.6.1" }',
      /states rawVersion v4\.4\.6\.1, which is not major\.minor\.patch/,
    ],
  ])("throws when the file %s", (_case, body, message) => {
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });
    if (body === undefined) {
      rmSync(join(install, "launcher-settings.json"));
    } else {
      writeFileSync(join(install, "launcher-settings.json"), body, "utf8");
    }
    expect(() => requireGameVersion(install)).toThrow(GameVersionError);
    expect(() => requireGameVersion(install)).toThrow(message);
  });
});

describe("supportedVersionFor", () => {
  it.each([
    ["4.4.6", "v4.4.*"],
    ["v4.4.6", "v4.4.*"],
    ["4.0.12", "v4.0.*"],
    ["10.11.12", "v10.11.*"],
  ])("derives %s into %s", (gameVersion, expected) => {
    expect(supportedVersionFor(gameVersion)).toBe(expected);
  });

  it("interprets the generated verified-build projection without drift", () => {
    expect(supportedVersionFor(VERIFIED_STELLARIS_BUILD)).toBe(VERIFIED_SUPPORTED_VERSION);
  });

  it("produces something a capability accepts", () => {
    // The two halves of the same convention: what the SDK derives must be what
    // the SDK is willing to emit.
    expect(() =>
      createMod({
        name: "V",
        prefix: "vv",
        supportedVersion: supportedVersionFor("4.4.6"),
      }).compile([])
    ).not.toThrow();
  });

  it.each(["4.4", "", "sometime", "v4", "vv4.4.6", "4.4.6.1"])(
    "refuses %o rather than guessing",
    (input) => {
      expect(() => supportedVersionFor(input)).toThrow(GameVersionError);
    }
  );
});
