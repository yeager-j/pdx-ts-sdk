/**
 * The two guards over the optional `@pdx-ts/stellaris-ids` package (SDK-12):
 * the version-pin gate that refuses a mismatched package
 * (`checkVanillaPackagePin`), and the canary that reports one which is not
 * checking anything at all (`vanillaIdsCheckWarning`). A pure matrix over
 * each, the runtime resolver `installedVanillaPackageVersion`, and `buildMod`'s
 * hooks for both. Hermetic throughout — no install is required.
 */

import { describe, expect, it } from "vitest";

import {
  buildMod,
  collection,
  defineTechnology,
  patchTechnology,
  render,
  StaleRuleTableError,
  VanillaPackageMismatchError,
  type ModConfig,
} from "../src/index.ts";
import {
  checkVanillaPackagePin,
  installedVanillaPackageVersion,
  vanillaIdsCheckWarning,
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

describe("vanillaIdsCheckWarning", () => {
  it("warns when the package does not resolve at all", () => {
    // The package-absent world, which no test in this workspace can reach
    // through `buildMod` (the package is a workspace sibling and always
    // resolves), but every consumer that has not installed it lives in.
    const warning = vanillaIdsCheckWarning(undefined, "4.4.6", undefined);
    expect(warning).toBeDefined();
    expect(warning).toContain("@pdx-ts/stellaris-ids is not installed");
    expect(warning).toContain("uncheckedVanillaIds: true");
  });

  it("tells the reader installing is not the whole remedy", () => {
    // The state this canary provably cannot detect — installed but never
    // imported, so the declaration merge never joins the consumer's program —
    // is at least named in the remedy of both messages, rather than left to
    // read "installed" as "checked".
    expect(vanillaIdsCheckWarning(undefined, "4.4.6", undefined)).toContain("import it");
    expect(vanillaIdsCheckWarning("4.4.6", "4.5.0", "4.5.0")).toContain("import it");
  });

  it("warns when the package resolves but pins a different build than the install", () => {
    const warning = vanillaIdsCheckWarning("4.4.6", "4.5.0", "4.5.0");
    expect(warning).toContain("4.4.6");
    expect(warning).toContain("4.5.0");
  });

  it("stays silent when the package pins the install's own version", () => {
    expect(vanillaIdsCheckWarning("4.4.6", "4.4.6", undefined)).toBeUndefined();
    expect(vanillaIdsCheckWarning("4.4.6-r1", "4.4.6", undefined)).toBeUndefined();
  });

  it("stays silent when there is no install version to compare against", () => {
    // A hermetic view, or no view at all: the package is installed and doing
    // its job, and nothing here knows of a build to disagree with.
    expect(vanillaIdsCheckWarning("4.4.6", undefined, undefined)).toBeUndefined();
  });

  it("stays silent on the unstamped sentinel, like the pin gate", () => {
    expect(vanillaIdsCheckWarning("0.0.0", "4.5.0", undefined)).toBeUndefined();
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
    // End to end, through the real resolved package: @pdx-ts/stellaris-ids
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

  /**
   * The other half of the same subject: the gate above refuses a *mismatched*
   * package, and this reports an *inactive* one. Nothing else would — vanilla
   * id checking degrades to plain `string` silently and by design, so a build
   * with no identifier protection is indistinguishable from one with it.
   *
   * The unresolvable world is covered by the pure matrix rather than here:
   * the workspace installs `@pdx-ts/stellaris-ids` as a sibling, so no test
   * running in this repo can make `buildMod` fail to resolve it. What is
   * reachable end to end is the mismatch arm, since `acceptGameVersion` lets
   * a mismatched build past the gate and into exactly the state worth warning
   * about.
   */
  describe("the vanilla-ids canary", () => {
    const uncheckedWarnings = (mod: { warnings: readonly { code: string; message: string }[] }) =>
      mod.warnings.filter((warning) => warning.code === "unchecked-vanilla-ids");

    it("warns when ids are checked against a build the author accepted a mismatch on", () => {
      const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
      const mod = buildMod(makeConfig({ acceptGameVersion: "4.5.0" }), [technologies], {
        vanilla,
      });
      const warnings = uncheckedWarnings(mod);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.message).toContain("4.5.0");
      expect(warnings[0]!.message).toContain(installedVanillaPackageVersion()!);
      // Warnings are data, and the message says how to get the protection back.
      expect(warnings[0]!.message).toContain("uncheckedVanillaIds: true");
    });

    it("stays quiet when the mod acknowledges authoring without checked ids", () => {
      const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
      const mod = buildMod(
        makeConfig({ acceptGameVersion: "4.5.0", uncheckedVanillaIds: true }),
        [technologies],
        { vanilla }
      );
      expect(uncheckedWarnings(mod)).toEqual([]);
    });

    it("stays quiet when the installed package matches the install", () => {
      // The healthy world, through the real resolver: the canary must not be
      // a warning every ordinary build carries.
      const vanilla = viewFromFiles(FILES, { gameVersion: installedVanillaPackageVersion() });
      expect(uncheckedWarnings(buildMod(makeConfig(), [technologies], { vanilla }))).toEqual([]);
    });

    it("stays quiet on a build with no vanilla view at all", () => {
      expect(uncheckedWarnings(buildMod(makeConfig(), [technologies]))).toEqual([]);
    });
  });

  it("yields to StaleRuleTableError when the build is both stale-ruled and pin-mismatched", () => {
    // The precedence `buildMod` documents where it calls this gate: rule-table
    // staleness outranks identifier-package staleness, because patch emission
    // is the more dangerous operation. A 4.5.0 view against a table verified
    // for 4.4.6 and a package pinned to 4.4.6 is stale on both counts at once,
    // and this is the world no test constructed.
    const drifted = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const patched = collection(undefined, [
      patchTechnology(drifted.technology("tech_gene_forging"), () => ({ tier: 4 })),
    ]);

    // Each half alone, so the combination below is provably both-stale rather
    // than a world where only one gate could ever have fired.
    expect(() => buildMod(makeConfig(), [patched])).toThrow(StaleRuleTableError);
    expect(() => buildMod(makeConfig(), [technologies], { vanilla: drifted })).toThrow(
      VanillaPackageMismatchError
    );

    try {
      buildMod(makeConfig(), [patched], { vanilla: drifted });
      expect.unreachable("expected buildMod to throw StaleRuleTableError");
    } catch (error) {
      expect(error).toBeInstanceOf(StaleRuleTableError);
      expect(error).not.toBeInstanceOf(VanillaPackageMismatchError);
    }
  });
});
