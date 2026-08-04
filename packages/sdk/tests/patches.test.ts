/**
 * End-to-end, hermetic: synthetic vanilla → typed view → transform patch →
 * render. The emitted file set, the computed filename, and the full patch
 * file bytes are the acceptance goldens; the guard rails (duplicate patch,
 * mixed origins, stale game build, vanilla-path collision) each fail with
 * their named error.
 */

import { describe, expect, it } from "vitest";

import { StaleRuleTableError, VanillaPathCollisionError } from "../src/errors.ts";
import { createMod, render, type ModConfig, type TechnologyItem } from "../src/index.ts";
import { viewFromFiles } from "../src/stellaris/vanilla/view.ts";
import { TECH_FILE, VARS_FILE } from "./fixtures/vanilla-fixture.ts";

const FILES = {
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/scripted_variables/pp_vars.txt": VARS_FILE,
};

function makeConfig(config: Partial<ModConfig> = {}): ModConfig {
  return {
    name: "Patch Probe",
    prefix: "pp_mod",
    supportedVersion: "4.4.*",
    ...config,
  };
}

describe("patching end to end", () => {
  const vanilla = viewFromFiles(FILES, { gameVersion: "4.4.6" });

  function patchedTechnologies(mod: ReturnType<typeof createMod>): TechnologyItem[] {
    const myNewTech = mod.technology("chimeric_grafts", {
      name: "Chimeric Grafts",
      area: "society",
      tier: 3,
      category: "biology",
    });
    return [
      myNewTech,
      mod.patchTechnology(
        vanilla.technology("tech_gene_forging").require("cost", "prerequisites"),
        (t) => ({
          cost: t.cost.value * 2,
          prerequisites: [...t.prerequisites, myNewTech],
        })
      ),
    ];
  }

  function patchedMod() {
    const mod = createMod(makeConfig());
    return mod.compile([mod.feature(undefined, patchedTechnologies(mod))]);
  }

  it("emits the patch into a file computed to sort after the definer", async () => {
    const files = render(patchedMod());
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pp_mod_technology.txt",
      "localisation/english/pp_mod_l_english.yml",
      "common/technology/pp_soc_tech_pp_mod_patch.txt",
    ]);
    await expect(files.get("common/technology/pp_soc_tech_pp_mod_patch.txt")).toMatchFileSnapshot(
      "__snapshots__/patches/common__technology__pp_soc_tech_pp_mod_patch.txt"
    );
  });

  it("re-declares the source file's local variables, and only those", () => {
    // @tech_gene_forging_POINTS is file-local to vanilla's tech file — the
    // game scopes it there, so the patch file must re-declare it. @t3weight
    // and @pp_boost live in common/scripted_variables and resolve cross-file
    // (spike run r1), so they stay bare references.
    const content = patchedMod().patchPlan!.content;
    expect(content).toContain("\n@tech_gene_forging_POINTS = 2\n");
    expect(content).not.toContain("@t3weight =");
    expect(content).not.toContain("@pp_boost =");
    expect(content).toContain("weight = @t3weight");
  });

  it("asserts the win with the full beaten list and the build pin", () => {
    const plan = patchedMod().patchPlan;
    expect(plan?.assertions).toEqual([
      {
        registry: "technologies",
        key: "tech_gene_forging",
        rule: "last-wins",
        confidence: "verified",
        beats: ["common/technology/pp_soc_tech.txt"],
        verifiedAgainst: "4.4.6",
      },
    ]);
  });

  it("render is deterministic: same inputs, byte-identical files", () => {
    const first = render(patchedMod());
    const second = render(patchedMod());
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("rejects a second patch for the same key", () => {
    const mod = createMod(makeConfig());
    const technologies = mod.feature(undefined, [
      ...patchedTechnologies(mod),
      mod.patchTechnology(vanilla.technology("tech_gene_forging"), () => ({ tier: 4 })),
    ]);
    expect(() => mod.compile([technologies])).toThrow(
      /Duplicate patch for technology "tech_gene_forging"/
    );
  });

  it("rejects patches from two different vanilla loads", () => {
    const mod = createMod(makeConfig());
    const other = viewFromFiles({
      ...FILES,
      "common/technology/pp_soc_tech.txt":
        TECH_FILE + "\ntech_pp_drifted = {\n\tcost = 10\n\tarea = society\n}\n",
    });
    const technologies = mod.feature(undefined, [
      ...patchedTechnologies(mod),
      mod.patchTechnology(other.technology("tech_pp_drifted"), () => ({ tier: 4 })),
    ]);
    expect(() => mod.compile([technologies])).toThrow(/different vanilla load/);
  });

  it("refuses to build against a game build the table is not verified for", () => {
    const mod = createMod(makeConfig());
    const drifted = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const technologies = mod.feature(undefined, [
      mod.patchTechnology(drifted.technology("tech_gene_forging"), () => ({ tier: 4 })),
    ]);
    expect(() => mod.compile([technologies])).toThrow(StaleRuleTableError);
    expect(() => mod.compile([technologies])).toThrow(/acceptGameVersion: "4\.5\.0"/);
  });

  it("renders on a stale build only with the exact acceptGameVersion", () => {
    const mod = createMod(makeConfig({ acceptGameVersion: "4.5.0" }));
    const drifted = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const technologies = mod.feature(undefined, [
      mod.patchTechnology(drifted.technology("tech_gene_forging"), () => ({ tier: 4 })),
    ]);
    expect(render(mod.compile([technologies])).size).toBeGreaterThan(0);
  });

  it("a view without a game version renders without the staleness gate", () => {
    const mod = createMod(makeConfig());
    // Hermetic views (viewFromFiles without metadata) carry no version; the
    // gate exists for real installs, which always have launcher-settings.json.
    const versionless = viewFromFiles(FILES);
    const technologies = mod.feature(undefined, [
      mod.patchTechnology(versionless.technology("tech_gene_forging"), () => ({ tier: 4 })),
    ]);
    expect(render(mod.compile([technologies])).size).toBeGreaterThan(0);
  });

  it("refuses to emit at a path vanilla occupies", () => {
    const mod = createMod(makeConfig());
    const clashing = viewFromFiles({
      ...FILES,
      // Vanilla (or another source) already owns the mod's own filename.
      "common/technology/pp_mod_technology.txt": "tech_squatter = {\n\tarea = physics\n}\n",
    });
    const technologies = mod.feature(undefined, [
      mod.technology("new", {
        name: "New",
        area: "physics",
        tier: 1,
        category: "computing",
      }),
      mod.patchTechnology(clashing.technology("tech_gene_forging"), () => ({ tier: 4 })),
    ]);
    expect(() => render(mod.compile([technologies]))).toThrow(VanillaPathCollisionError);
  });

  it("the patch plan is undefined when nothing is patched", () => {
    expect(createMod(makeConfig()).compile([]).patchPlan).toBeUndefined();
  });
});

describe("the vanilla path guard without any patch", () => {
  // The guard used to be a side effect of patching: `vanillaPaths` was
  // populated from the patches, so a mod that passed a vanilla view and
  // patched nothing emitted straight over a vanilla file — a whole-file
  // replacement of vanilla content — with no error at all.
  const squattedPath = "common/technology/pp_mod_technology.txt";

  function techs(mod: ReturnType<typeof createMod>) {
    return mod.feature(undefined, [
      mod.technology("new", {
        name: "New",
        area: "physics",
        tier: 1,
        category: "computing",
      }),
    ]);
  }

  it("refuses to emit at a vanilla path when only a view is supplied", () => {
    const mod = createMod(makeConfig());
    const clashing = viewFromFiles({
      ...FILES,
      [squattedPath]: "tech_squatter = {\n\tarea = physics\n}\n",
    });
    expect(() => render(mod.compile([techs(mod)], { vanilla: clashing }))).toThrow(
      VanillaPathCollisionError
    );
  });

  it("names the colliding path", () => {
    const mod = createMod(makeConfig());
    const clashing = viewFromFiles({
      ...FILES,
      [squattedPath]: "tech_squatter = {\n\tarea = physics\n}\n",
    });
    expect(() => render(mod.compile([techs(mod)], { vanilla: clashing }))).toThrow(
      new RegExp(squattedPath.replace(/[.]/g, "\\."))
    );
  });

  it("still renders when the view occupies no path this mod emits", () => {
    const mod = createMod(makeConfig());
    const vanilla = viewFromFiles(FILES);
    expect(render(mod.compile([techs(mod)], { vanilla })).size).toBeGreaterThan(0);
  });

  it("does not check at all without a vanilla view", () => {
    const mod = createMod(makeConfig());
    // Unchanged behavior: nothing was loaded, so nothing is known to collide.
    expect(mod.compile([techs(mod)]).vanillaPaths).toBeUndefined();
    expect(render(mod.compile([techs(mod)])).size).toBeGreaterThan(0);
  });
});
