import { describe, expect, it } from "vitest";

import {
  assertVerifiedBuildIdentifierEvidence,
  supportedVersionForVerifiedBuild,
  VERIFIED_BUILD_PROJECTION,
} from "../src/verified-build.ts";

describe("verified build projection", () => {
  it("anchors the build to the install-stamped package version and checks its prose", () => {
    const build = VERIFIED_BUILD_PROJECTION.gameVersion;
    const provenance = `Generated from Stellaris **${build}**.`;

    expect(() => assertVerifiedBuildIdentifierEvidence(`${build}-r.1`, provenance)).not.toThrow();
    expect(() => assertVerifiedBuildIdentifierEvidence("4.4.7-r.1", provenance)).toThrow(
      "does not describe verified build"
    );
    expect(() =>
      assertVerifiedBuildIdentifierEvidence(`${build}-r.1`, "No build recorded.")
    ).toThrow("PROVENANCE.md describes");
  });
});

describe("verified supported-version policy", () => {
  it("rejects an internally inconsistent projection before consumer files are generated", () => {
    expect(() =>
      supportedVersionForVerifiedBuild({
        gameVersion: "4.4.6",
        installProtocol: {
          launcherVersionPrefix: "v",
          coreGameVersionPattern: "^\\d+\\.\\d+\\.\\d+$",
          supportedVersionFromGamePattern: "^v?(\\d+)\\.(\\d+)\\.",
          supportedVersionPattern: "^4\\.4\\.\\d+$",
        },
      })
    ).toThrow("verified supported_version");
  });

  it.each([
    ["empty", ""],
    ["invalid", "["],
  ])("rejects an %s regular-expression source before emission", (_case, pattern) => {
    expect(() =>
      supportedVersionForVerifiedBuild({
        gameVersion: "4.4.6",
        installProtocol: {
          launcherVersionPrefix: "v",
          coreGameVersionPattern: pattern,
          supportedVersionFromGamePattern: "^v?(\\d+)\\.(\\d+)\\.",
          supportedVersionPattern: "^v?(\\d+|\\*)(\\.(\\d+|\\*)){0,2}$",
        },
      })
    ).toThrow(/coreGameVersionPattern/);
  });

  it("rejects a verified build outside the exact core-version grammar", () => {
    expect(() =>
      supportedVersionForVerifiedBuild({
        gameVersion: "4.4.6.1",
        installProtocol: {
          launcherVersionPrefix: "v",
          coreGameVersionPattern: "^\\d+\\.\\d+\\.\\d+$",
          supportedVersionFromGamePattern: "^v?(\\d+)\\.(\\d+)\\.",
          supportedVersionPattern: "^v?(\\d+|\\*)(\\.(\\d+|\\*)){0,2}$",
        },
      })
    ).toThrow("is not major.minor.patch");
  });
});
