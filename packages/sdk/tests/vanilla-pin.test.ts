/**
 * The two guards over the `@pdx-ts/stellaris-ids` package (SDK-12): the
 * version-pin gate that refuses a mismatched package
 * (`checkVanillaPackagePin`), and the canary that reports one checking against
 * the wrong game build (`vanillaIdsCheckWarning`). A pure matrix over each,
 * the runtime resolver `installedVanillaPackagePin`, and a capability's
 * hooks for both. Hermetic throughout — no install is required.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyVanillaPackagePin } from "../src/compiler/compile-finalize.ts";
import {
  checkVanillaPackagePin,
  installedVanillaPackagePin,
  vanillaIdsCheckWarning,
  type VanillaPackagePin,
} from "../src/identifiers/package-pin.ts";
import { vanillaPackageGameVersion } from "../src/identifiers/version-scheme.ts";
import {
  createMod,
  render,
  StaleRuleTableError,
  VanillaPackageMismatchError,
  VanillaPackageUnreadableError,
  type ModConfig,
} from "../src/index.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
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

  it("strips a revision suffix before comparing (4.4.6-r.2 pins 4.4.6)", () => {
    expect(() => checkVanillaPackagePin("4.4.6-r.2", "4.4.6", undefined)).not.toThrow();
    expect(() => checkVanillaPackagePin("4.4.6-r.10", "4.4.6", undefined)).not.toThrow();
  });

  it("names an install range that can actually resolve a revision", () => {
    // Not `@4.5.0`. Every published version is a `-r.<n>` revision, which an
    // ordinary range matches none of — so the bare version resolves to nothing,
    // or to a pre-scheme build that is exactly what the range excludes. A
    // mismatch message that prints an uninstallable command is worse than none.
    try {
      checkVanillaPackagePin("4.4.6", "4.5.0", undefined);
      expect.unreachable("expected checkVanillaPackagePin to throw");
    } catch (error) {
      expect((error as Error).message).toContain(">=4.5.0-0 <4.5.0");
    }
  });

  it("passes on the unstamped sentinel 0.0.0 regardless of the install version", () => {
    expect(() => checkVanillaPackagePin("0.0.0", "4.5.0", undefined)).not.toThrow();
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
  it("warns when the package resolves but pins a different build than the install", () => {
    const warning = vanillaIdsCheckWarning("4.4.6", "4.5.0", "4.5.0");
    expect(warning).toContain("4.4.6");
    expect(warning).toContain("4.5.0");
    // The remedy is the range that resolves a revision of the right build.
    expect(warning).toContain(">=4.5.0-0 <4.5.0");
  });

  it("stays silent when the package pins the install's own version", () => {
    expect(vanillaIdsCheckWarning("4.4.6", "4.4.6", undefined)).toBeUndefined();
    expect(vanillaIdsCheckWarning("4.4.6-r.1", "4.4.6", undefined)).toBeUndefined();
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

describe("installedVanillaPackagePin", () => {
  it("resolves the workspace package's stamped version via the default specifier", () => {
    // The workspace package is generated and stamped (4.4.6-r.4 today), so this
    // asserts the shape rather than a literal — a regeneration against a newer
    // install is supposed to move it, and only `PROVENANCE.md`'s consistency
    // check and the install-gated conformance gate pin the exact value.
    //
    // The revision is part of the shape, not decoration: a bare `4.4.6` is a
    // version npm has already consumed and can never reissue, so a stamp
    // without one is a package that cannot be published (PROVENANCE.md,
    // "Revisions").
    const pin = installedVanillaPackagePin();
    if (pin.state !== "read") {
      throw new Error(`expected a readable workspace package pin, got ${pin.state}`);
    }
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(pin.version).not.toBe("0.0.0");
  });

  it("reports absent for a specifier that does not resolve", () => {
    const pin = installedVanillaPackagePin("@pdx-ts/does-not-exist/package.json");
    expect(pin).toMatchObject({ state: "absent" });
    expect(pin.state === "absent" ? pin.detail : "").toContain("does-not-exist");
  });

  it.each([
    ["malformed JSON", "vanilla-package-pin-malformed.json", "could not read"],
    ["missing version", "vanilla-package-pin-missing-version.json", "no version"],
    ["non-string version", "vanilla-package-pin-non-string-version.json", "not a string"],
  ])("reports unreadable for %s metadata", (_caseName, filename, detail) => {
    const specifier = fileURLToPath(new URL(`./fixtures/${filename}`, import.meta.url));
    const pin = installedVanillaPackagePin(specifier);
    expect(pin.state).toBe("unreadable");
    expect(pin.state === "unreadable" ? pin.detail : "").toContain(detail);
  });
});

describe("applyVanillaPackagePin", () => {
  const vanilla = { gameVersion: "4.5.0" } as const;

  it("throws VanillaPackageMismatchError for a read pin that mismatches", () => {
    expect(() =>
      applyVanillaPackagePin({ state: "read", version: "4.4.6" }, vanilla, undefined)
    ).toThrow(VanillaPackageMismatchError);
  });

  it("returns the mismatched-vanilla-ids warning for an accepted mismatch", () => {
    const warning = applyVanillaPackagePin({ state: "read", version: "4.4.6" }, vanilla, "4.5.0");
    expect(warning).toMatchObject({ code: "mismatched-vanilla-ids" });
  });

  it("throws VanillaPackageUnreadableError for unreadable metadata", () => {
    const pin: VanillaPackagePin = {
      state: "unreadable",
      detail: "metadata has no version field",
    };
    expect(() => applyVanillaPackagePin(pin, vanilla, undefined)).toThrow(
      VanillaPackageUnreadableError
    );
    expect(() => applyVanillaPackagePin(pin, vanilla, undefined)).toThrow(
      /metadata has no version field/
    );
    expect(() => applyVanillaPackagePin(pin, vanilla, undefined)).toThrow(
      /identifier compatibility gate cannot run/i
    );
  });

  it("returns a missing-stellaris-ids warning for an absent package", () => {
    const warning = applyVanillaPackagePin(
      { state: "absent", detail: "the package could not be resolved" },
      vanilla,
      undefined
    );
    expect(warning).toMatchObject({ code: "missing-stellaris-ids" });
    expect(warning?.message).toContain("not installed");
  });

  it("stays silent when no vanilla view is present", () => {
    expect(
      applyVanillaPackagePin(
        { state: "unreadable", detail: "metadata has no version field" },
        undefined,
        undefined
      )
    ).toBeUndefined();
    expect(
      applyVanillaPackagePin(
        { state: "absent", detail: "the package could not be resolved" },
        undefined,
        undefined
      )
    ).toBeUndefined();
  });
});

/**
 * The game build the installed package describes, which is its version minus
 * the `-r.<n>` revision counting publishes of that build. The two are not
 * interchangeable: `4.4.6-r.1` is a package version and never an install
 * version, so a view built from the raw string claims an install that cannot
 * exist and the gate below fires on it.
 */
function installedGameVersion(): string {
  const pin = installedVanillaPackagePin();
  if (pin.state !== "read") {
    throw new Error(`The workspace identifier package is ${pin.state}: ${pin.detail}`);
  }
  return vanillaPackageGameVersion(pin.version);
}

describe("the mod capability's version-pin hook", () => {
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

  function technologyFeature(config: ModConfig = makeConfig()) {
    const mod = createMod(config);
    const technology = mod.technology("new", {
      name: "New",
      area: "physics",
      tier: 1,
      category: "computing",
    });
    return { mod, technologies: mod.feature(undefined, [technology]) };
  }

  it("throws when the workspace package's version disagrees with the view's install", () => {
    // End to end, through the real resolved package: @pdx-ts/stellaris-ids
    // is stamped 4.4.6, this view claims a 4.5.0 install, and no patch is
    // involved — identifiers influence everything authored, so the gate fires
    // on `options.vanilla` alone rather than on the presence of patches.
    const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const { mod, technologies } = technologyFeature();
    try {
      mod.compile([technologies], { vanilla });
      expect.unreachable("expected compile to throw VanillaPackageMismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(VanillaPackageMismatchError);
      const message = (error as Error).message;
      expect(message).toContain("4.5.0");
      expect(message).toContain(installedGameVersion());
    }
  });

  it("passes when acceptGameVersion names the install version", () => {
    const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const { mod, technologies } = technologyFeature(makeConfig({ acceptGameVersion: "4.5.0" }));
    expect(() => render(mod.compile([technologies], { vanilla }))).not.toThrow();
  });

  it("passes when the view's install matches the package", () => {
    const vanilla = viewFromFiles(FILES, {
      gameVersion: installedGameVersion(),
    });
    const { mod, technologies } = technologyFeature();
    expect(() => render(mod.compile([technologies], { vanilla }))).not.toThrow();
  });

  /**
   * The other half of the same subject: the gate above refuses a mismatched
   * package outright, and this reports the one an author let through. Reaching
   * it end to end takes `acceptGameVersion`, which is the only way past the
   * gate and into exactly the state worth warning about — ids that typecheck
   * against a build the mod is not being shipped for.
   */
  describe("the vanilla-ids canary", () => {
    const mismatchWarnings = (mod: { warnings: readonly { code: string; message: string }[] }) =>
      mod.warnings.filter((warning) => warning.code === "mismatched-vanilla-ids");

    it("warns when ids are checked against a build the author accepted a mismatch on", () => {
      const vanilla = viewFromFiles(FILES, { gameVersion: "4.5.0" });
      const { mod, technologies } = technologyFeature(makeConfig({ acceptGameVersion: "4.5.0" }));
      const warnings = mismatchWarnings(mod.compile([technologies], { vanilla }));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.message).toContain("4.5.0");
      expect(warnings[0]!.message).toContain(installedGameVersion());
    });

    it("stays quiet when the installed package matches the install", () => {
      // The healthy world, through the real resolver: the canary must not be
      // a warning every ordinary build carries.
      const vanilla = viewFromFiles(FILES, { gameVersion: installedGameVersion() });
      const { mod, technologies } = technologyFeature();
      expect(mismatchWarnings(mod.compile([technologies], { vanilla }))).toEqual([]);
    });

    it("stays quiet on a build with no vanilla view at all", () => {
      const { mod, technologies } = technologyFeature();
      expect(mismatchWarnings(mod.compile([technologies]))).toEqual([]);
    });
  });

  it("yields to StaleRuleTableError when the build is both stale-ruled and pin-mismatched", () => {
    // The compile path calls this gate after its rule-table check: rule-table
    // staleness outranks identifier-package staleness, because patch emission
    // is the more dangerous operation. A 4.5.0 view against a table verified
    // for 4.4.6 and a package pinned to 4.4.6 is stale on both counts at once,
    // and this is the world no test constructed.
    const drifted = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const { mod, technologies } = technologyFeature();
    const patched = mod.feature(undefined, [
      mod.patchTechnology(drifted.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
    ]);

    // Each half alone, so the combination below is provably both-stale rather
    // than a world where only one gate could ever have fired.
    expect(() => mod.compile([patched])).toThrow(StaleRuleTableError);
    expect(() => mod.compile([technologies], { vanilla: drifted })).toThrow(
      VanillaPackageMismatchError
    );

    try {
      mod.compile([patched], { vanilla: drifted });
      expect.unreachable("expected compile to throw StaleRuleTableError");
    } catch (error) {
      expect(error).toBeInstanceOf(StaleRuleTableError);
      expect(error).not.toBeInstanceOf(VanillaPackageMismatchError);
    }
  });
});
