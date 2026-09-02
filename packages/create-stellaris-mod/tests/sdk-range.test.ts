/**
 * The compatibility preflight, as algebra.
 *
 * The rule that needs the most evidence is subset-not-overlap. A `>=` range on
 * the verified version overlaps it and is refused, because a project asking
 * for it can resolve an SDK nobody proved these recipes against on any later
 * install — including the one the author runs a minute after generating. Every
 * case below is written against `VERIFIED_SDK_RANGE` rather than a literal, so
 * moving the verified range moves the test with it.
 */

import semver from "semver";
import { describe, expect, it } from "vitest";

import type { ReleaseCompatibilityPolicy } from "../src/release-manifest.ts";
import { checkSdkCompatibility, VERIFIED_SDK_RANGE, type InstalledSdk } from "../src/sdk-range.ts";
import {
  NEXT_SDK_MINOR,
  STALE_SDK_VERSION,
  VERIFIED_SDK_VERSION,
} from "./helpers/release-coordinate.ts";

function check(declaredSpecifier: string | undefined, installedVersion?: string) {
  const installed: InstalledSdk =
    installedVersion === undefined
      ? { kind: "absent" }
      : { kind: "installed", version: installedVersion };
  return checkSdkCompatibility({ declaredSpecifier, installed });
}

describe("checkSdkCompatibility", () => {
  // Both policies below are fixtures for the caller-supplied-policy argument.
  // Their versions are arbitrary and deliberately not this release's coordinate.
  const compatiblePolicy: ReleaseCompatibilityPolicy = {
    packageName: "@pdx-ts/sdk",
    verifiedRange: "^0.2.0",
  };
  const incompatiblePolicy: ReleaseCompatibilityPolicy = {
    packageName: "@pdx-ts/sdk",
    verifiedRange: "0.6.0",
  };

  it("accepts a custom release policy that proves the declared coordinate", () => {
    expect(
      checkSdkCompatibility(
        { declaredSpecifier: "0.2.1", installed: { kind: "absent" } },
        compatiblePolicy
      ).supported
    ).toBe(true);
  });

  it("refuses a custom release policy that cannot prove the declared coordinate", () => {
    const result = checkSdkCompatibility(
      { declaredSpecifier: "0.2.1", installed: { kind: "absent" } },
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
    expect(check(VERIFIED_SDK_VERSION).supported).toBe(true);
  });

  it("refuses a range that merely overlaps the verified one", () => {
    for (const declared of [
      `^${VERIFIED_SDK_VERSION}`,
      `>=${VERIFIED_SDK_VERSION}`,
      "*",
      `^0.2.0 || ^${VERIFIED_SDK_VERSION}`,
      `>=0.2.0 <${NEXT_SDK_MINOR}`,
    ]) {
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
      `npm:@pdx-ts/sdk@${VERIFIED_SDK_VERSION}`,
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
    expect(check(VERIFIED_SDK_RANGE, VERIFIED_SDK_VERSION).supported).toBe(true);

    // Installed, but not what the project declares.
    const stale = check(VERIFIED_SDK_RANGE, STALE_SDK_VERSION);
    expect(stale.supported).toBe(false);
    expect(stale.supported === false && stale.reason).toBe("installed-version-unsupported");
    expect(stale.detail).toContain(STALE_SDK_VERSION);
  });

  it("refuses an installed version that is not a version", () => {
    const result = check(VERIFIED_SDK_RANGE, "not-a-version");
    expect(result.supported).toBe(false);
    expect(result.supported === false && result.reason).toBe("installed-version-unsupported");
  });

  /**
   * SDK-387. An absent install and an unreadable one are different facts and
   * have to stay different. The first is ordinary — authors generate before
   * installing, and a range provably inside the verified one is evidence on its
   * own. The second is an installation that is there, that the project would
   * resolve, and that supports no claim at all; treating it as an absence lets
   * the declared range stand as evidence for a version nobody could read.
   */
  it("refuses an installation whose metadata cannot be read", () => {
    const result = checkSdkCompatibility({
      declaredSpecifier: VERIFIED_SDK_RANGE,
      installed: {
        kind: "unreadable",
        file: "/project/node_modules/@pdx-ts/sdk/package.json",
        detail: "it declares no version",
      },
    });
    expect(result.supported).toBe(false);
    expect(result.supported === false && result.reason).toBe("installed-metadata-unreadable");
    // The message has to name the file, because the author's next move is to
    // look at it.
    expect(result.detail).toContain("/project/node_modules/@pdx-ts/sdk/package.json");
    expect(result.detail).toContain("it declares no version");
  });

  it("does not let a provable declared range excuse an unreadable installation", () => {
    // The same declared range that is sufficient on its own with nothing
    // installed is not sufficient once something is.
    expect(check(VERIFIED_SDK_RANGE).supported).toBe(true);
    expect(
      checkSdkCompatibility({
        declaredSpecifier: VERIFIED_SDK_RANGE,
        installed: { kind: "unreadable", file: "/x/package.json", detail: "EACCES" },
      }).supported
    ).toBe(false);
  });

  it("says which check failed, in words an author can act on", () => {
    // Every failure names the package and the verified range, because the
    // author reading it is deciding whether to change their dependency or pass
    // --allow-unsupported-sdk.
    for (const declared of [undefined, "file:../sdk", `>=${VERIFIED_SDK_VERSION}`]) {
      const { detail } = check(declared);
      expect(detail, String(declared)).toContain("@pdx-ts/sdk");
      expect(detail, String(declared)).toContain(VERIFIED_SDK_RANGE);
    }
  });
});
