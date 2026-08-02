/**
 * The version-pin gate for the optional `@pdx-ts/stellaris-vanilla` package
 * (SDK-12): the pure matrix over `checkVanillaPackagePin`, the runtime
 * resolver `installedVanillaPackageVersion`, and `buildMod`'s hook. Hermetic
 * throughout — no install is required.
 */

import { describe, expect, it } from "vitest";

import {
  buildMod,
  collection,
  defineTechnology,
  render,
  VanillaPackageMismatchError,
  type ModConfig,
} from "../src/index.ts";
import {
  checkVanillaPackagePin,
  installedVanillaPackageVersion,
} from "../src/vanilla/package-pin.ts";
import { viewFromFiles } from "../src/vanilla/surface.ts";
import { TECH_FILE, VARS_FILE } from "./fixtures/vanilla-fixture.ts";

describe("checkVanillaPackagePin", () => {
  it("passes when the package's pinned version matches the install", () => {
    expect(() => checkVanillaPackagePin("4.4.6", "4.4.6", undefined)).not.toThrow();
  });

  it("throws VanillaPackageMismatchError naming both versions on a mismatch", () => {
    expect(() => checkVanillaPackagePin("4.4.6", "4.5.0", undefined)).toThrow(
      VanillaPackageMismatchError
    );
    try {
      checkVanillaPackagePin("4.4.6", "4.5.0", undefined);
      expect.unreachable("expected checkVanillaPackagePin to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VanillaPackageMismatchError);
      const message = (error as Error).message;
      expect(message).toContain("4.5.0");
      expect(message).toContain("4.4.6");
    }
  });

  it("strips a prerelease suffix before comparing (4.4.6-r1 pins 4.4.6)", () => {
    expect(() => checkVanillaPackagePin("4.4.6-r1", "4.4.6", undefined)).not.toThrow();
  });

  it("passes on the unstamped sentinel 0.0.0 regardless of the install version", () => {
    expect(() => checkVanillaPackagePin("0.0.0", "4.5.0", undefined)).not.toThrow();
  });

  it("passes when no package is installed", () => {
    expect(() => checkVanillaPackagePin(undefined, "4.5.0", undefined)).not.toThrow();
  });

  it("passes when the install carries no game version", () => {
    expect(() => checkVanillaPackagePin("4.4.6", undefined, undefined)).not.toThrow();
  });

  it("passes when acceptGameVersion names the exact install version", () => {
    expect(() => checkVanillaPackagePin("4.4.6", "4.5.0", "4.5.0")).not.toThrow();
  });

  it("still throws when acceptGameVersion names a different version than the install", () => {
    expect(() => checkVanillaPackagePin("4.4.6", "4.5.0", "4.4.6")).toThrow(
      VanillaPackageMismatchError
    );
  });
});

describe("installedVanillaPackageVersion", () => {
  it("resolves the workspace package's stamped version via the default specifier", () => {
    // The workspace package is generated and stamped (4.4.6 today), so this
    // asserts the shape rather than a literal — a regeneration against a newer
    // install is supposed to move it, and only `PROVENANCE.md`'s consistency
    // check and the install-gated conformance gate pin the exact value.
    expect(installedVanillaPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(installedVanillaPackageVersion()).not.toBe("0.0.0");
  });

  it("returns undefined for a specifier that does not resolve", () => {
    expect(installedVanillaPackageVersion("@pdx-ts/does-not-exist/package.json")).toBeUndefined();
  });
});

describe("buildMod's version-pin hook", () => {
  const FILES = {
    "common/technology/pp_soc_tech.txt": TECH_FILE,
    "common/scripted_variables/pp_vars.txt": VARS_FILE,
  };

  function makeConfig(config: Partial<ModConfig> = {}): ModConfig {
    return {
      name: "Pin Probe",
      prefix: "pp_mod",
      supportedVersion: "4.4.*",
      ...config,
    };
  }

  const technologies = collection(undefined, [
    defineTechnology({
      id: "pp_mod_tech_new",
      name: "New",
      area: "physics",
      tier: 1,
      category: "computing",
    }),
  ]);

  it("throws when the workspace package's version disagrees with the view's install", () => {
    // End to end, through the real resolved package: @pdx-ts/stellaris-vanilla
    // is stamped 4.4.6, this view claims a 4.5.0 install, and no patch is
    // involved — identifiers influence everything authored, so the gate fires
    // on `options.vanilla` alone rather than on the presence of patches.
    const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    try {
      buildMod(makeConfig(), [technologies], { vanilla });
      expect.unreachable("expected buildMod to throw VanillaPackageMismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(VanillaPackageMismatchError);
      const message = (error as Error).message;
      expect(message).toContain("4.5.0");
      expect(message).toContain(installedVanillaPackageVersion()!);
    }
  });

  it("passes when acceptGameVersion names the install version", () => {
    const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    expect(() =>
      render(
        buildMod(makeConfig({ acceptGameVersion: "4.5.0" }), [technologies], {
          vanilla,
        })
      )
    ).not.toThrow();
  });

  it("passes when the view's install matches the package", () => {
    const vanilla = viewFromFiles(FILES, {
      gameVersion: installedVanillaPackageVersion(),
    });
    expect(() => render(buildMod(makeConfig(), [technologies], { vanilla }))).not.toThrow();
  });
});
