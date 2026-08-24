/**
 * The compatibility preflight, as algebra.
 *
 * The rule that needs the most evidence is subset-not-overlap. `>=0.3.0`
 * overlaps the exact verified version and is refused, because a project asking
 * for it can resolve an SDK nobody proved these recipes against on any later
 * install — including the one the author runs a minute after generating. Every
 * case below is written against `VERIFIED_SDK_RANGE` rather than a literal, so
 * moving the verified range moves the test with it.
 */

import semver from "semver";
import { describe, expect, it } from "vitest";

import type { ReleaseCompatibilityPolicy } from "../src/release-manifest.ts";
import { checkSdkCompatibility, VERIFIED_SDK_RANGE } from "../src/sdk-range.ts";

function check(declaredSpecifier: string | undefined, installedVersion?: string) {
  return checkSdkCompatibility({ declaredSpecifier, installedVersion });
}

describe("checkSdkCompatibility", () => {
  const compatiblePolicy: ReleaseCompatibilityPolicy = {
    packageName: "@pdx-ts/sdk",
    verifiedRange: "^0.2.0",
  };
  const incompatiblePolicy: ReleaseCompatibilityPolicy = {
    packageName: "@pdx-ts/sdk",
    verifiedRange: "0.3.0",
  };

  it("accepts a custom release policy that proves the declared coordinate", () => {
    expect(
      checkSdkCompatibility(
        { declaredSpecifier: "0.2.1", installedVersion: undefined },
        compatiblePolicy
      ).supported
    ).toBe(true);
  });

  it("refuses a custom release policy that cannot prove the declared coordinate", () => {
    const result = checkSdkCompatibility(
      { declaredSpecifier: "0.2.1", installedVersion: undefined },
      incompatiblePolicy
    );
    expect(result.supported).toBe(false);
    expect(result.supported === false && result.reason).toBe("range-not-subset");
  });

  it("takes a declared range inside the verified one, with nothing installed", () => {
    // Not an oversight: an absent install proves nothing either way, and a
    // range that is provably inside the verified one is evidence on its own.
    // Authors generate before installing all the time.
    expect(check(VERIFIED_SDK_RANGE).supported).toBe(true);
    expect(check("0.3.0").supported).toBe(true);
  });

  it("refuses a range that merely overlaps the verified one", () => {
    for (const declared of ["^0.3.0", ">=0.3.0", "*", "^0.2.0 || ^0.3.0", ">=0.2.0 <0.4.0"]) {
      const result = check(declared);
      expect(result.supported, declared).toBe(false);
      expect(result.supported === false && result.reason).toBe("range-not-subset");
      // The thing that makes it refusable: some version inside the declared
      // range is outside the verified one.
      expect(semver.subset(declared, VERIFIED_SDK_RANGE), declared).toBe(false);
    }
  });

  it("refuses a specifier no version can be proved against", () => {
    for (const declared of [
      "file:../pdx-sdk/packages/sdk",
      "link:../sdk",
      "workspace:*",
      "git+https://github.com/yeager-j/pdx-ts-sdk.git",
      "latest",
      "npm:@pdx-ts/sdk@0.3.0",
    ]) {
      const result = check(declared);
      expect(result.supported, declared).toBe(false);
      expect(result.supported === false && result.reason, declared).toBe("unprovable-specifier");
    }
  });

  it("refuses a project that does not depend on the SDK at all", () => {
    for (const declared of [undefined, "", "   "]) {
      const result = check(declared);
      expect(result.supported).toBe(false);
      expect(result.supported === false && result.reason).toBe("missing-dependency");
    }
  });

  it("checks an installed version against both ranges", () => {
    expect(check("0.3.0", "0.3.0").supported).toBe(true);

    // Installed, but not what the project declares.
    const stale = check("0.3.0", "0.3.1");
    expect(stale.supported).toBe(false);
    expect(stale.supported === false && stale.reason).toBe("installed-version-unsupported");
    expect(stale.detail).toContain("0.3.1");
  });

  it("refuses an installed version that is not a version", () => {
    const result = check("0.3.0", "not-a-version");
    expect(result.supported).toBe(false);
    expect(result.supported === false && result.reason).toBe("installed-version-unsupported");
  });

  it("says which check failed, in words an author can act on", () => {
    // Every failure names the package and the verified range, because the
    // author reading it is deciding whether to change their dependency or pass
    // --allow-unsupported-sdk.
    for (const declared of [undefined, "file:../sdk", ">=0.3.0"]) {
      const { detail } = check(declared);
      expect(detail, String(declared)).toContain("@pdx-ts/sdk");
      expect(detail, String(declared)).toContain(VERIFIED_SDK_RANGE);
    }
  });
});
