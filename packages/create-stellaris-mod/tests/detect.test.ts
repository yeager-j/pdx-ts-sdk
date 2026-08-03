/**
 * `detect.ts` copies a little of `@pdx-ts/sdk/stellaris` rather than importing
 * it, so that this CLI can be published before the SDK can be. A copy is only
 * defensible if something keeps it honest — this is that something.
 *
 * The SDK is a devDependency, so the two implementations can be run against the
 * same inputs here even though the shipped CLI never loads it.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  describeInstall,
  platformDefaultsFor,
  readGameVersion as sdkReadGameVersion,
  supportedVersionFor as sdkSupportedVersionFor,
} from "../../sdk/src/stellaris/index.ts";
import {
  detectInstall,
  isInstall,
  platformDefaults,
  readGameVersion,
  supportedVersionFor,
} from "../src/detect.ts";

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

describe("the copy agrees with the SDK", () => {
  it("searches the same platform candidates, in the same order", () => {
    for (const platform of ["darwin", "win32", "linux", "freebsd"] as NodeJS.Platform[]) {
      expect(platformDefaults(platform, "/home/u"), platform).toEqual(
        platformDefaultsFor(platform, "/home/u")
      );
    }
  });

  it("reads the same version out of the same install", () => {
    expect(readGameVersion(FIXTURE)).toBe(sdkReadGameVersion(FIXTURE));
    expect(readGameVersion(FIXTURE)).toBe("4.4.6");
  });

  it("agrees about an install that states no usable version", () => {
    for (const body of ["{ not json", '{ "gameId": "stellaris" }', '{ "rawVersion": 446 }']) {
      const install = tempDir();
      cpSync(FIXTURE, install, { recursive: true });
      writeFileSync(path.join(install, "launcher-settings.json"), body, "utf8");
      expect(readGameVersion(install), body).toBe(sdkReadGameVersion(install));
    }
  });

  it("derives the same supported_version", () => {
    for (const version of ["4.4.6", "v4.4.6", "4.0.12", "10.11.12"]) {
      expect(supportedVersionFor(version), version).toBe(sdkSupportedVersionFor(version));
    }
  });

  it("recognizes the same directory as an install", () => {
    expect(isInstall(FIXTURE)).toBe(true);
    expect(describeInstall(FIXTURE).installPath).toBe(FIXTURE);
    expect(isInstall(tempDir())).toBe(false);
  });
});

describe("detectInstall", () => {
  it("describes an explicitly given install", () => {
    expect(detectInstall(FIXTURE)).toEqual({ installPath: FIXTURE, gameVersion: "4.4.6" });
  });

  it("answers undefined rather than throwing, unlike the SDK's locateInstall", () => {
    // A mod that neither patches vanilla nor uses the identifier package builds
    // fine without an install, so a missing one degrades the scaffold instead
    // of blocking it.
    expect(detectInstall(tempDir())).toBeUndefined();
  });
});
