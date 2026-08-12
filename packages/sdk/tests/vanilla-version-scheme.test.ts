/**
 * The `@pdx-ts/stellaris-ids` version scheme, and the one property that used to
 * have no owner: **what the generator stamps is what the install range
 * resolves**.
 *
 * Before SDK-137 the stamp, the parse, and the range were three hand-written
 * copies in three packages, each pinned only by its own literal test. Every
 * suite stayed green while the system broke, because nothing ever composed
 * them. So the cases below are written as compositions rather than as literals
 * wherever a literal would only restate the implementation: stamp a build, then
 * ask npm's own resolver whether that range finds it, and ask the runtime gate
 * whether it accepts it.
 */

import fc from "fast-check";
import semver from "semver";
import { describe, expect, it } from "vitest";

import { checkVanillaPackagePin } from "../src/identifiers/package-pin.ts";
import {
  stampedVanillaPackageVersion,
  vanillaPackageGameVersion,
  vanillaPackageInstallRange,
} from "../src/identifiers/version-scheme.ts";

describe("stampedVanillaPackageVersion", () => {
  it("starts a new game build at revision 1", () => {
    expect(stampedVanillaPackageVersion("4.5.0", "4.4.6-r.3")).toBe("4.5.0-r.1");
  });

  it("leaves the revision alone when regenerating the build already stamped", () => {
    // `codegen:vanilla:check` regenerates and then diffs package.json, so a
    // version that moved on every run would fail that gate unconditionally.
    // The revision is a release decision, bumped by hand when publishing.
    expect(stampedVanillaPackageVersion("4.4.6", "4.4.6-r.1")).toBe("4.4.6-r.1");
    expect(stampedVanillaPackageVersion("4.4.6", "4.4.6-r.11")).toBe("4.4.6-r.11");
  });

  it("takes over from a bare or unstamped version without reusing it", () => {
    // npm can never reissue a version it has already consumed, so a package
    // sitting on a bare game version has to move off it to publish at all.
    expect(stampedVanillaPackageVersion("4.4.6", "4.4.6")).toBe("4.4.6-r.1");
    expect(stampedVanillaPackageVersion("4.4.6", "0.0.0")).toBe("4.4.6-r.1");
  });

  it("orders revisions monotonically past nine", () => {
    // `r.10` rather than `r10`: run together they are one alphanumeric
    // identifier compared lexically, and the tenth revision would sort below
    // the ninth — so npm would hand every install a stale one.
    const versions = ["4.4.6-r.1", "4.4.6-r.2", "4.4.6-r.9", "4.4.6-r.10", "4.4.6-r.11"];
    expect([...versions].sort(semver.compare)).toEqual(versions);
  });
});

describe("vanillaPackageInstallRange", () => {
  it("resolves the newest revision, and never the bare build", () => {
    // Checked against the resolver npm itself uses rather than by reading the
    // string. A bare `4.4.6` on the registry predates the revision scheme — it
    // is the one version that must not win, and highest-wins would otherwise
    // hand it every install.
    const range = vanillaPackageInstallRange("4.4.6");
    expect(semver.maxSatisfying(["4.4.6", "4.4.6-r.1", "4.4.6-r.2"], range)).toBe("4.4.6-r.2");
    expect(semver.maxSatisfying(["4.4.6-r.9", "4.4.6-r.10"], range)).toBe("4.4.6-r.10");
    expect(semver.satisfies("4.4.6", range)).toBe(false);
    expect(semver.satisfies("4.4.7-r.1", range)).toBe(false);
  });
});

describe("vanillaPackageGameVersion", () => {
  it("reads a package version back to the build it pins", () => {
    expect(vanillaPackageGameVersion("4.4.6-r.2")).toBe("4.4.6");
    expect(vanillaPackageGameVersion("4.4.6-r.10")).toBe("4.4.6");
    expect(vanillaPackageGameVersion("4.4.6+build")).toBe("4.4.6");
    expect(vanillaPackageGameVersion("4.4.6")).toBe("4.4.6");
  });
});

describe("the scheme composes: stamp, resolve, gate", () => {
  const BUILDS = ["4.4.6", "4.5.0", "5.0.0", "3.12.5"];
  const CARRIED = ["0.0.0", "4.4.6", "4.4.6-r.1", "4.4.6-r.10", "4.5.0-r.2"];

  it("stamps versions the matching install range resolves", () => {
    // The property the three copies never had between them: an author told to
    // install `vanillaPackageInstallRange(v)` gets what the generator wrote.
    for (const build of BUILDS) {
      for (const carried of CARRIED) {
        const stamped = stampedVanillaPackageVersion(build, carried);
        expect(semver.valid(stamped), stamped).not.toBeNull();
        expect(semver.satisfies(stamped, vanillaPackageInstallRange(build)), stamped).toBe(true);
      }
    }
  });

  it("stamps versions that read back to the build they were stamped for", () => {
    for (const build of BUILDS) {
      for (const carried of CARRIED) {
        expect(vanillaPackageGameVersion(stampedVanillaPackageVersion(build, carried))).toBe(build);
      }
    }
  });

  it("stamps versions the runtime pin gate accepts for that install", () => {
    // The stamp reaches this gate as the installed package's version, so a
    // scheme change that the gate could not parse would refuse every ordinary
    // build — the failure this composition exists to catch.
    for (const build of BUILDS) {
      for (const carried of CARRIED) {
        const stamped = stampedVanillaPackageVersion(build, carried);
        expect(() => checkVanillaPackagePin(stamped, build, undefined)).not.toThrow();
      }
    }
  });

  it("holds for any build and any carried version", () => {
    const version = fc
      .tuple(fc.nat({ max: 30 }), fc.nat({ max: 30 }), fc.nat({ max: 30 }))
      .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);
    fc.assert(
      fc.property(
        version,
        fc.oneof(
          version,
          version.chain((base) =>
            fc.nat({ max: 40 }).map((revision) => `${base}-r.${revision + 1}`)
          )
        ),
        (build, carried) => {
          const stamped = stampedVanillaPackageVersion(build, carried);
          expect(semver.satisfies(stamped, vanillaPackageInstallRange(build))).toBe(true);
          expect(vanillaPackageGameVersion(stamped)).toBe(build);
          expect(() => checkVanillaPackagePin(stamped, build, undefined)).not.toThrow();
        }
      )
    );
  });
});
