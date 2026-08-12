/** The CLI's best-effort detection contract, exercised without the SDK. */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  detectInstall,
  isInstall,
  platformDefaults,
  readGameVersion,
  supportedVersionFor,
} from "../src/detect.ts";
import {
  VERIFIED_STELLARIS_BUILD,
  VERIFIED_SUPPORTED_VERSION,
} from "../src/generated/verified-build.ts";

const FIXTURE = path.resolve(import.meta.dirname, "../../../fixtures/fake-install");

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "csm-detect-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectInstall", () => {
  it("describes an explicitly given install", () => {
    expect(detectInstall(FIXTURE)).toEqual({ installPath: FIXTURE, gameVersion: "4.4.6" });
  });

  it("answers undefined for an explicit path that is not an install", () => {
    expect(detectInstall(tempDir())).toBeUndefined();
  });

  it("keeps an install with no launcher settings, but reports no version", () => {
    const install = tempDir();
    cpSync(FIXTURE, install, { recursive: true });
    rmSync(path.join(install, "launcher-settings.json"));

    expect(detectInstall(install)).toEqual({ installPath: install, gameVersion: undefined });
  });

  it.each(["{ not json", '{ "gameId": "stellaris" }', '{ "rawVersion": 446 }'])(
    "keeps an install with malformed or absent version data, but reports no version",
    (body) => {
      const install = tempDir();
      cpSync(FIXTURE, install, { recursive: true });
      writeFileSync(path.join(install, "launcher-settings.json"), body, "utf8");

      expect(detectInstall(install)).toEqual({ installPath: install, gameVersion: undefined });
      expect(readGameVersion(install)).toBeUndefined();
    }
  );
});

describe("detection protocol helpers", () => {
  it("recognizes the install sentinel and rejects a directory without it", () => {
    expect(isInstall(FIXTURE)).toBe(true);
    expect(isInstall(tempDir())).toBe(false);
  });

  it("derives launcher-compatible supported versions only from complete build lines", () => {
    expect(supportedVersionFor("4.4.6")).toBe("v4.4.*");
    expect(supportedVersionFor("v10.11.12")).toBe("v10.11.*");
    expect(supportedVersionFor("4.4")).toBeUndefined();
    expect(supportedVersionFor("not-a-version")).toBeUndefined();
    expect(supportedVersionFor("vv4.4.6")).toBeUndefined();
    expect(supportedVersionFor("4.4.6.1")).toBeUndefined();
  });

  it("interprets the generated verified-build projection without drift", () => {
    expect(supportedVersionFor(VERIFIED_STELLARIS_BUILD)).toBe(VERIFIED_SUPPORTED_VERSION);
  });

  it("keeps the platform search order stable", () => {
    expect(platformDefaults("darwin", "/home/u")).toEqual([
      "/home/u/Library/Application Support/Steam/steamapps/common/Stellaris",
    ]);
    expect(platformDefaults("linux", "/home/u")).toEqual([
      "/home/u/.local/share/Steam/steamapps/common/Stellaris",
      "/home/u/.steam/steam/steamapps/common/Stellaris",
    ]);
  });
});
