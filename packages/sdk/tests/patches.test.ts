/**
 * End-to-end, hermetic: synthetic vanilla → typed view → transform patch →
 * render. The emitted file set, the computed filename, and the full patch
 * file bytes are the acceptance goldens; the guard rails (duplicate patch,
 * mixed origins, stale game build, vanilla-path collision) each fail with
 * their named error.
 */

import { describe, expect, it } from "vitest";

import { StaleRuleTableError, VanillaPathCollisionError } from "../src/errors.ts";
import { always, createMod, render, type ModConfig, type TechnologyItem } from "../src/index.ts";
import { viewFromFiles } from "../src/stellaris/vanilla/view.ts";
import { BUILDING_FILE, TECH_FILE, VARS_FILE } from "./fixtures/vanilla-fixture.ts";

const FILES = {
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/buildings/pp_buildings.txt": BUILDING_FILE,
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
      vanilla.definition("technology", "tech_gene_forging").require("cost", "prerequisites"),
      (t) => ({
        cost: t.cost.value * 2,
        prerequisites: [...t.prerequisites, myNewTech],
      })
    ),
  ];
}

describe("patching end to end", () => {
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
    const content = patchedMod().patchPlans[0]!.content;
    expect(content).toContain("\n@tech_gene_forging_POINTS = 2\n");
    expect(content).not.toContain("@t3weight =");
    expect(content).not.toContain("@pp_boost =");
    expect(content).toContain("weight = @t3weight");
  });

  it("asserts the win with the full beaten list and the build pin", () => {
    const plan = patchedMod().patchPlans[0];
    expect(plan?.assertions).toEqual([
      {
        registry: "technology",
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
      mod.patchTechnology(vanilla.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
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
      mod.patchTechnology(other.definition("technology", "tech_pp_drifted"), () => ({ tier: 4 })),
    ]);
    expect(() => mod.compile([technologies])).toThrow(/different vanilla load/);
  });

  it("refuses to build against a game build the table is not verified for", () => {
    const mod = createMod(makeConfig());
    const drifted = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const technologies = mod.feature(undefined, [
      mod.patchTechnology(drifted.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
    ]);
    expect(() => mod.compile([technologies])).toThrow(StaleRuleTableError);
    expect(() => mod.compile([technologies])).toThrow(/acceptGameVersion: "4\.5\.0"/);
  });

  it("renders on a stale build only with the exact acceptGameVersion", () => {
    const mod = createMod(makeConfig({ acceptGameVersion: "4.5.0" }));
    const drifted = viewFromFiles(FILES, { gameVersion: "4.5.0" });
    const technologies = mod.feature(undefined, [
      mod.patchTechnology(drifted.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
    ]);
    expect(render(mod.compile([technologies])).size).toBeGreaterThan(0);
  });

  it("a view without a game version renders without the staleness gate", () => {
    const mod = createMod(makeConfig());
    // Hermetic views (viewFromFiles without metadata) carry no version; the
    // gate exists for real installs, which always have launcher-settings.json.
    const versionless = viewFromFiles(FILES);
    const technologies = mod.feature(undefined, [
      mod.patchTechnology(versionless.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
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
      mod.patchTechnology(clashing.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
    ]);
    expect(() => render(mod.compile([technologies]))).toThrow(VanillaPathCollisionError);
  });

  it("there are no patch plans when nothing is patched", () => {
    expect(createMod(makeConfig()).compile([]).patchPlans).toEqual([]);
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

/**
 * The second registry, end to end, and the property the whole seam exists for:
 * adding it changed no emission code, so the technology emission is unmoved.
 * Each registry is resolved on its own — its own enumeration, its own winning
 * filename, its own rule-table row — and the plans are ordered by the path they
 * emit to rather than by the order the patches were authored in (ADR-0005).
 */
describe("patching two registries in one mod", () => {
  const refinery = vanilla.definition("building", "building_pp_refinery");

  function twoRegistryMod() {
    const mod = createMod(makeConfig());
    const carried = refinery.body.filter((entry) => entry.key === "triggered_planet_modifier");
    return mod.compile([
      mod.feature(undefined, [
        ...patchedTechnologies(mod),
        mod.patchBuilding(refinery, () => ({
          potential: always(),
          planetLimit: { base: 2, modifiers: [{ add: 1, when: always() }] },
          triggeredPlanetModifier: [
            ...carried,
            { when: always(), modifier: (m) => m.raw("planet_jobs_produces_mult", 0.3) },
          ],
        })),
      ]),
    ]);
  }

  it("plans one emission per patched registry, ordered by emitted path", () => {
    expect(twoRegistryMod().patchPlans.map((plan) => plan.relPath)).toEqual([
      "common/buildings/pp_buildings_pp_mod_patch.txt",
      "common/technology/pp_soc_tech_pp_mod_patch.txt",
    ]);
  });

  it("emits both patch files beside the mod's own content", async () => {
    const files = render(twoRegistryMod());
    expect([...files.keys()]).toEqual([
      "descriptor.mod",
      "common/technology/pp_mod_technology.txt",
      "localisation/english/pp_mod_l_english.yml",
      "common/buildings/pp_buildings_pp_mod_patch.txt",
      "common/technology/pp_soc_tech_pp_mod_patch.txt",
    ]);
    await expect(files.get("common/buildings/pp_buildings_pp_mod_patch.txt")).toMatchFileSnapshot(
      "__snapshots__/patches/common__buildings__pp_buildings_pp_mod_patch.txt"
    );
    // The same golden the technology-only mod above is pinned against: adding a
    // building patch must not move a byte of the technology emission.
    await expect(files.get("common/technology/pp_soc_tech_pp_mod_patch.txt")).toMatchFileSnapshot(
      "__snapshots__/patches/common__technology__pp_soc_tech_pp_mod_patch.txt"
    );
  });

  it("asserts each win against its own registry's rule row", () => {
    const [buildings, technology] = twoRegistryMod().patchPlans;
    expect(buildings!.assertions).toEqual([
      {
        registry: "building",
        key: "building_pp_refinery",
        rule: "last-wins",
        confidence: "verified",
        beats: ["common/buildings/pp_buildings.txt"],
        verifiedAgainst: "4.4.6",
      },
    ]);
    expect(technology!.assertions).toEqual([
      {
        registry: "technology",
        key: "tech_gene_forging",
        rule: "last-wins",
        confidence: "verified",
        beats: ["common/technology/pp_soc_tech.txt"],
        verifiedAgainst: "4.4.6",
      },
    ]);
  });

  it("re-declares the building file's own local variable, and only that", () => {
    const content = twoRegistryMod().patchPlans[0]!.content;
    expect(content).toContain("\n@pp_refinery_buildtime = 480\n");
    expect(content).not.toContain("@t3cost =");
  });

  it("rejects a second patch for the same building, naming the registry", () => {
    const mod = createMod(makeConfig());
    const feature = mod.feature(undefined, [
      mod.patchBuilding(refinery, () => ({ planetLimit: 2 })),
      mod.patchBuilding(refinery, () => ({ planetLimit: 3 })),
    ]);
    expect(() => mod.compile([feature])).toThrow(
      /Duplicate patch for building "building_pp_refinery"/
    );
  });

  it("keeps ids of different registries apart when they collide", () => {
    // Same id in two registries is legal in the game and must stay legal here:
    // the duplicate check is per registry, not per view.
    const collide = viewFromFiles({
      "common/technology/pp_collide_tech.txt": "shared_id = {\n\tarea = physics\n}\n",
      "common/buildings/pp_collide_buildings.txt": "shared_id = {\n\tcategory = resource\n}\n",
    });
    const mod = createMod(makeConfig());
    const feature = mod.feature(undefined, [
      mod.patchTechnology(collide.definition("technology", "shared_id"), () => ({ tier: 2 })),
      mod.patchBuilding(collide.definition("building", "shared_id"), () => ({ planetLimit: 1 })),
    ]);
    expect(mod.compile([feature]).patchPlans).toHaveLength(2);
  });
});
