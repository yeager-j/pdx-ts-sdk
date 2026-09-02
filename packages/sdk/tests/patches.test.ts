/**
 * End-to-end, hermetic: synthetic vanilla → typed view → transform patch →
 * render. The emitted file set, the computed filename, and the full patch
 * file bytes are the acceptance goldens; the guard rails (duplicate patch,
 * mixed origins, stale game build, vanilla-path collision) each fail with
 * their named error.
 */

import { describe, expect, it } from "vitest";

import { PathOwnershipError, StaleRuleTableError } from "../src/errors.ts";
import { createMod, external, render, type ModConfig } from "../src/index.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
import { always, type EconomicResourceOperation, type TechnologyItem } from "../src/stellaris.ts";
import {
  ASCENSION_PERK_CATEGORY_FILE,
  BUILDING_FILE,
  MEGASTRUCTURE_FILE,
  TECH_FILE,
  VARS_FILE,
} from "./fixtures/vanilla-fixture.ts";

const FILES = {
  "common/ascension_perk_categories/pp_ascension_perk_categories.txt": ASCENSION_PERK_CATEGORY_FILE,
  "common/technology/pp_soc_tech.txt": TECH_FILE,
  "common/buildings/pp_buildings.txt": BUILDING_FILE,
  "common/megastructures/pp_megastructures.txt": MEGASTRUCTURE_FILE,
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
    cost: 100,
    weight: 100,
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
    expect([...files.keys()]).toEqual(
      [
        "descriptor.mod",
        "common/technology/pp_mod_technology.txt",
        "localisation/english/pp_mod_l_english.yml",
        "common/technology/pp_soc_tech_pp_mod_patch.txt",
      ].sort()
    );
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

  it("keeps a mutated swap object out of both the emitted body and the registered ids", () => {
    // The patch lowers its replacement entries when it is built, but the fold
    // rereads `def` later for the swap names the patch declares. A caller who
    // mutated a nested object they had returned used to make those two
    // disagree: another definition could then name the mutated id, pass the
    // dangling-reference guard, and ship a reference to content nobody emits
    // (SDK-325).
    const mod = createMod(makeConfig());
    const swap = { name: "pp_mod_swap_original", weight: { factor: 2 } };
    const patch = mod.patchTechnology(
      vanilla.definition("technology", "tech_gene_forging").require("cost"),
      () => ({ technologySwap: [swap] })
    );

    swap.name = "pp_mod_swap_mutated";

    const compiled = mod.compile([mod.feature(undefined, [patch])]);
    const emitted = render(compiled).get("common/technology/pp_soc_tech_pp_mod_patch.txt")!;
    expect(emitted).toContain("name = pp_mod_swap_original");
    expect(emitted).not.toContain("pp_mod_swap_mutated");

    const referencesMutated = mod.technology("dependent", {
      cost: 100,
      weight: 100,
      name: "Dependent",
      area: "society",
      tier: 3,
      category: "biology",
      prerequisites: ["pp_mod_swap_mutated"],
    });
    expect(() =>
      mod.compile([mod.feature(undefined, [patch]), mod.feature("dependent", [referencesMutated])])
    ).toThrow(/pp_mod_swap_mutated/);
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
        cost: 100,
        weight: 100,
        name: "New",
        area: "physics",
        tier: 1,
        category: "computing",
      }),
      mod.patchTechnology(clashing.definition("technology", "tech_gene_forging"), () => ({
        tier: 4,
      })),
    ]);
    expect(() => mod.compile([technologies])).toThrow(PathOwnershipError);
  });

  it("there are no patch plans when nothing is patched", () => {
    expect(createMod(makeConfig()).compile([]).patchPlans).toEqual([]);
  });

  /**
   * SDK-63's decisive hermetic check, and the reason the field mattered
   * beyond authoring: `tech_gene_forging`'s `modifier` block is the shape
   * `tech_gene_tailoring` really ships. Before the lowering it was
   * unmodelled — carried through a patch as an opaque `rest` entry, and
   * unwritable in a definition of the mod's own. Now it is a patchable
   * member that substitutes vanilla's own block at vanilla's own position,
   * rather than being appended after it.
   */
  it("replaces a vanilla technology's own modifier block in place (SDK-63)", () => {
    const mod = createMod(makeConfig());
    const patch = mod.patchTechnology(
      vanilla.definition("technology", "tech_gene_forging"),
      () => ({ modifier: (m) => m.raw("BIOLOGICAL_species_trait_points_add", 4) })
    );
    const content = mod.compile([mod.feature(undefined, [patch])]).patchPlans[0]!.content;

    expect(content).toContain("\tmodifier = {\n\t\tBIOLOGICAL_species_trait_points_add = 4\n\t}\n");
    // One `modifier` key, in vanilla's own slot: between `gateway` and
    // `feature_flags`, not appended at the end of the body.
    expect(content.match(/^\tmodifier = \{$/gm)).toHaveLength(1);
    expect(content.indexOf("\tmodifier = {")).toBeGreaterThan(content.indexOf("gateway ="));
    expect(content.indexOf("\tmodifier = {")).toBeLessThan(content.indexOf("feature_flags ="));
    // The trade the overlay row states, made visible rather than left to be
    // discovered: modifier_clause's ancillary fields are not modelled, so
    // replacing the block drops vanilla's own description keys with it. A
    // patch that wants them keeps them by not patching `modifier` at all —
    // the untouched passthrough the golden above still pins.
    expect(content).not.toContain("description = tech_gene_forging_modifier_desc");
    expect(content).not.toContain("description_parameters");
    // And the substitution is complete rather than partial: the file-local
    // `@tech_gene_forging_POINTS` the replaced block was the only reader of
    // is no longer re-declared, where the untouched golden above does declare
    // it.
    expect(content).not.toContain("@tech_gene_forging_POINTS");
  });

  it("serializes a technology weight-group map through patchTechnology (SDK-66)", () => {
    const mod = createMod(makeConfig());
    const patch = mod.patchTechnology(
      vanilla.definition("technology", "tech_gene_forging"),
      () => ({
        modWeightIfGroupPicked: {
          repeatable: 2,
          deposit_blockers: 0.5,
          third_party_group: 1.25,
        },
      })
    );
    const content = mod.compile([mod.feature(undefined, [patch])]).patchPlans[0]!.content;
    expect(content).toContain(
      "\tmod_weight_if_group_picked = {\n" +
        "\t\trepeatable = 2\n" +
        "\t\tdeposit_blockers = 0.5\n" +
        "\t\tthird_party_group = 1.25\n" +
        "\t}\n"
    );
    expect(content).not.toContain("mod_weight_if_group_picked = {\n\t\t{");
  });
});

describe("patching the Ambitions ascension perk category", () => {
  const ambitions = vanilla.definition("ascension_perk_category", "ap_category_ambitions");

  function ambitionMod() {
    const mod = createMod(makeConfig());
    const archiveAmbition = mod.ascensionPerk("archive_ambition", {
      name: "Archive Ambition",
    });
    return mod.compile([
      mod.feature(undefined, [
        archiveAmbition,
        mod.patchAscensionPerkCategory(ambitions, (category) => ({
          ascensionPerks: [...category.ascensionPerks, archiveAmbition],
        })),
      ]),
    ]);
  }

  it("retains every shipped Ambition and appends the authored perk", async () => {
    const files = render(ambitionMod());
    expect([...files.keys()]).toEqual(
      [
        "descriptor.mod",
        "common/ascension_perks/pp_mod_ascension_perks.txt",
        "localisation/english/pp_mod_l_english.yml",
        "common/ascension_perk_categories/pp_ascension_perk_categories_pp_mod_patch.txt",
      ].sort()
    );
    await expect(
      files.get("common/ascension_perk_categories/pp_ascension_perk_categories_pp_mod_patch.txt")
    ).toMatchFileSnapshot(
      "__snapshots__/patches/common__ascension_perk_categories__pp_ascension_perk_categories_pp_mod_patch.txt"
    );
  });

  it("reports both category rules as assumed and keeps the judgment visible", () => {
    const compiled = ambitionMod();
    expect(compiled.patchPlans[0]?.assertions).toEqual([
      {
        registry: "ascension_perk_category",
        key: "ap_category_ambitions",
        rule: "last-wins",
        confidence: "assumed",
        beats: ["common/ascension_perk_categories/pp_ascension_perk_categories.txt"],
        verifiedAgainst: "4.4.6",
      },
    ]);
    expect(compiled.patchPlans[0]?.content).toContain(
      "# ASSUMED duplicate-winner rule: Jackson, 2026-08-24 (SDK-289)"
    );
    expect(compiled.patchPlans[0]?.content).toContain(
      "Registry `ascension_perk_category` uses an ASSUMED last-wins rule"
    );
    expect(compiled.patchPlans[0]?.content).not.toContain("Overrides verified against");
    expect(compiled.patchPlans[0]?.content).toContain(
      "# ASSUMED field-replacement rule: Jackson, 2026-08-24 (SDK-289)"
    );
    expect(compiled.warnings).toContainEqual({
      code: "assumed-patch-rule",
      message: expect.stringContaining('for "ap_category_ambitions"'),
    });
  });

  it("rejects a second patch for the same category", () => {
    const mod = createMod(makeConfig());
    const feature = mod.feature(undefined, [
      mod.patchAscensionPerkCategory(ambitions, () => ({ ascensionPerks: [] })),
      mod.patchAscensionPerkCategory(ambitions, () => ({ ascensionPerks: [] })),
    ]);
    expect(() => mod.compile([feature])).toThrow(
      /Duplicate patch for ascension_perk_category "ap_category_ambitions"/
    );
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
        cost: 100,
        weight: 100,
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
    expect(() => mod.compile([techs(mod)], { vanilla: clashing })).toThrow(PathOwnershipError);
  });

  it("names the colliding path and the producer that claimed it", () => {
    const mod = createMod(makeConfig());
    const clashing = viewFromFiles({
      ...FILES,
      [squattedPath]: "tech_squatter = {\n\tarea = physics\n}\n",
    });

    let thrown: unknown;
    try {
      mod.compile([techs(mod)], { vanilla: clashing });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PathOwnershipError);
    const conflicts = (thrown as PathOwnershipError).conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.path).toBe(squattedPath);
    expect(conflicts[0]!.reason).toBe("vanilla");
    expect(conflicts[0]!.claimants.map((claimant) => claimant.kind)).toEqual([
      "content",
      "vanilla",
    ]);
  });

  it("still renders when the view occupies no path this mod emits", () => {
    const mod = createMod(makeConfig());
    const vanilla = viewFromFiles(FILES);
    expect(render(mod.compile([techs(mod)], { vanilla })).size).toBeGreaterThan(0);
  });

  it("still checks the packaged inventory without a loaded vanilla view (SDK-173)", () => {
    const mod = createMod(makeConfig());
    // The Fold checks every claim against the packaged vanilla path inventory
    // unconditionally (ADR-0006), whether or not a `VanillaView` was loaded —
    // but that inventory is real game filenames, never a mod-prefixed path
    // like `pp_mod_technology.txt` above, which only the *loaded view* above
    // squats on. So this build is unaffected by the packaged check.
    expect(mod.compile([techs(mod)]).paths.map((claim) => claim.path)).toContain(squattedPath);
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
    const aiResourceProduction: readonly EconomicResourceOperation<"colony">[] = [
      { amounts: { energy: 2 }, when: always(), mult: [1, 2] },
      { amounts: { unity: 1 }, multiplier: 0.5 },
    ];
    return mod.compile([
      mod.feature(undefined, [
        ...patchedTechnologies(mod),
        mod.patchBuilding(refinery, () => ({
          potential: always(),
          planetLimit: { base: 2, modifiers: [{ add: 1, when: always() }] },
          aiResourceProduction,
          triggeredPlanetModifier: [
            ...carried,
            { when: always(), modifier: (m) => m.raw("planet_jobs_produces_mult", 0.3) },
          ],
        })),
      ]),
    ]);
  }

  it("plans one emission per patched registry, ordered by emitted path", () => {
    expect(twoRegistryMod().patchPlans.map((plan) => plan.relPath)).toEqual(
      [
        "common/buildings/pp_buildings_pp_mod_patch.txt",
        "common/technology/pp_soc_tech_pp_mod_patch.txt",
      ].sort()
    );
  });

  it("emits both patch files beside the mod's own content", async () => {
    const files = render(twoRegistryMod());
    expect([...files.keys()]).toEqual(
      [
        "descriptor.mod",
        "common/technology/pp_mod_technology.txt",
        "localisation/english/pp_mod_l_english.yml",
        "common/buildings/pp_buildings_pp_mod_patch.txt",
        "common/technology/pp_soc_tech_pp_mod_patch.txt",
      ].sort()
    );
    await expect(files.get("common/buildings/pp_buildings_pp_mod_patch.txt")).toMatchFileSnapshot(
      "__snapshots__/patches/common__buildings__pp_buildings_pp_mod_patch.txt"
    );
    expect(files.get("common/buildings/pp_buildings_pp_mod_patch.txt")).toContain(
      "\tai_resource_production = {\n\t\ttrigger = {\n\t\t\talways = yes\n\t\t}\n" +
        "\t\tenergy = 2\n\t\tmult = 1\n\t\tmult = 2\n\t}\n" +
        "\tai_resource_production = {\n\t\tunity = 1\n\t\tmultiplier = 0.5\n\t}"
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

  it("carries an unauthorable nested inline_script through a patch untouched (SDK-62)", () => {
    // The counterpart to the SDK-62 residue the overlay row states: 332 of 458
    // shipped buildings nest an `inline_script` inside `resources`, and
    // `EconomicResourceBlock` has no member for it, so a definer cannot write
    // that block. A patch does not have to — emission walks the parsed body
    // and substitutes only the members the patch named, so a block nobody
    // touched survives byte-for-byte, in its own slot. Passthrough is what
    // covers the gap authoring cannot, and it is only worth anything if the
    // unmodelled interior survives too, not just the key.
    const content = twoRegistryMod().patchPlans[0]!.content;
    expect(content).toContain(
      "\tresources = {\n" +
        "\t\tcategory = planet_buildings\n" +
        "\t\tinline_script = {\n" +
        "\t\t\tscript = jobs/building_jobs\n" +
        "\t\t\tBUILDING = pp_refinery\n" +
        "\t\t}\n" +
        "\t\tcost = {\n\t\t\tminerals = 300\n\t\t}\n" +
        "\t\tupkeep = {\n\t\t\tenergy = 5\n\t\t}\n" +
        "\t}\n"
    );
    // Its slot is the source's, not an append: the patched `planet_limit`
    // that followed it in vanilla still follows it here.
    expect(content.indexOf("\tresources = {")).toBeLessThan(content.indexOf("\tplanet_limit = {"));
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

/**
 * The registry whose rule-table replacement cell is a judgment rather than a
 * finding. Everything about the emission is the same machinery the two verified
 * registries use — that is the point of the row being the only permission — and
 * the one thing that differs is the thing that should: the assertion reports
 * `confidence: "assumed"` and the emitted file states the judgment in its own
 * header, where a reader of the mod can see it.
 */
describe("patching a registry whose replacement rule is assumed", () => {
  const array0 = vanilla.definition("megastructure", "megastructure_pp_array_0");

  function megastructureMod() {
    const mod = createMod(makeConfig());
    return mod.compile([
      mod.feature(undefined, [
        mod.patchMegastructure(array0, () => ({
          buildTime: 2400,
          resources: [
            {
              category: "megastructures",
              cost: { amounts: { unity: 7500 } },
              upkeep: { amounts: { energy: 8 } },
            },
          ],
          prerequisites: ["pp_tech_resonance"],
          triggeredCountryModifier: [
            { when: always(), modifier: (m) => m.raw("country_naval_cap_add", 25) },
          ],
        })),
      ]),
    ]);
  }

  it("emits the patch into a file computed to sort after the definer", async () => {
    const files = render(megastructureMod());
    expect([...files.keys()]).toEqual(
      ["descriptor.mod", "common/megastructures/pp_megastructures_pp_mod_patch.txt"].sort()
    );
    await expect(
      files.get("common/megastructures/pp_megastructures_pp_mod_patch.txt")
    ).toMatchFileSnapshot(
      "__snapshots__/patches/common__megastructures__pp_megastructures_pp_mod_patch.txt"
    );
  });

  it("asserts the win at assumed confidence, with the full beaten list", () => {
    expect(megastructureMod().patchPlans[0]?.assertions).toEqual([
      {
        registry: "megastructure",
        key: "megastructure_pp_array_0",
        rule: "last-wins",
        confidence: "assumed",
        beats: ["common/megastructures/pp_megastructures.txt"],
        verifiedAgainst: "4.4.6",
      },
    ]);
  });

  it("states the judgment in the emitted header rather than laundering it", () => {
    const compiled = megastructureMod();
    const content = compiled.patchPlans[0]!.content;
    expect(content).toContain("# ASSUMED field-replacement rule: Jackson, 2026-07-31");
    // The duplicate-winner cell *is* verified (r8), so only one header line.
    expect(content).not.toContain("# ASSUMED duplicate-winner rule");
    expect(compiled.warnings).toContainEqual({
      code: "assumed-patch-rule",
      message: expect.stringContaining('"megastructure_pp_array_0"'),
    });
    expect(Object.isFrozen(compiled.warnings[0])).toBe(true);
  });

  it("re-declares the file-local variable the patched body still references", () => {
    // `@pp_array_buildtime` is replaced by the patch, so the emitted body no
    // longer names it; `@pp_array_offset_y` rides through inside entity_offset
    // and must be re-declared. `@pp_boost` is a cross-file constant.
    const content = megastructureMod().patchPlans[0]!.content;
    expect(content).toContain("\n@pp_array_offset_y = -20\n");
    expect(content).not.toContain("@pp_array_buildtime =");
    expect(content).not.toContain("@pp_boost =");
    expect(content).toContain("weight = @pp_boost");
  });

  it("rejects a second patch for the same megastructure, naming the registry", () => {
    const mod = createMod(makeConfig());
    const feature = mod.feature(undefined, [
      mod.patchMegastructure(array0, () => ({ buildTime: 60 })),
      mod.patchMegastructure(array0, () => ({ buildTime: 90 })),
    ]);
    expect(() => mod.compile([feature])).toThrow(
      /Duplicate patch for megastructure "megastructure_pp_array_0"/
    );
  });

  it("plans three registries side by side, each ordered by its emitted path", () => {
    const mod = createMod(makeConfig());
    const compiled = mod.compile([
      mod.feature(undefined, [
        ...patchedTechnologies(mod),
        mod.patchBuilding(vanilla.definition("building", "building_pp_refinery"), () => ({
          planetLimit: 2,
        })),
        mod.patchMegastructure(array0, () => ({ buildTime: 2400 })),
      ]),
    ]);
    expect(compiled.patchPlans.map((plan) => plan.relPath)).toEqual([
      "common/buildings/pp_buildings_pp_mod_patch.txt",
      "common/megastructures/pp_megastructures_pp_mod_patch.txt",
      "common/technology/pp_soc_tech_pp_mod_patch.txt",
    ]);
    // Each registry answers to its own row: two verified, one assumed.
    expect(compiled.patchPlans.flatMap((plan) => plan.assertions).map((a) => a.confidence)).toEqual(
      ["verified", "assumed", "verified"]
    );
  });
});

/**
 * Display text through both doors at once, in one mod: a technology renamed
 * (vanilla's own slot keys, rewritten in the `replace/` layer) and a building
 * given new text on a patched member (a key minted from the mod prefix, in the
 * ordinary layer). The two are different mechanisms and land in different
 * files, which is the whole reason there are two.
 */
describe("patched localization end to end", () => {
  const refinery = vanilla.definition("building", "building_pp_refinery");

  function localizedMod() {
    const mod = createMod(makeConfig());
    return mod.compile([
      mod.feature("localized", [
        mod.technology("chimeric_grafts", {
          cost: 100,
          weight: 100,
          name: "Chimeric Grafts",
          area: "society",
          tier: 3,
          category: "biology",
        }),
        mod.patchTechnology(vanilla.definition("technology", "tech_gene_forging"), () => ({
          name: "Chimeric Forging",
          desc: "Now with grafts.",
        })),
        mod.patchBuilding(refinery, () => ({
          planetLimit: {
            base: 2,
            modifiers: [
              {
                add: 1,
                when: always(),
                desc: { english: "Crowded world", key: "crowded" },
              },
            ],
          },
        })),
      ]),
    ]);
  }

  it("emits the replace layer beside the ordinary one", async () => {
    const files = render(localizedMod());
    expect([...files.keys()]).toEqual(
      [
        "descriptor.mod",
        "common/technology/pp_mod_localized.txt",
        "localisation/english/pp_mod_localized_l_english.yml",
        "localisation/replace/english/pp_mod_localized_l_english.yml",
        "common/buildings/pp_buildings_pp_mod_patch.txt",
        "common/technology/pp_soc_tech_pp_mod_patch.txt",
      ].sort()
    );
    // Full file: the BOM, the `l_english:` header, and vanilla's own keys in
    // sorted order — nothing about it depends on which patch was authored first.
    await expect(
      files.get("localisation/replace/english/pp_mod_localized_l_english.yml")
    ).toMatchFileSnapshot(
      "__snapshots__/patches/localisation__replace__english__pp_mod_l_english.yml"
    );
  });

  it("mints the patched member's key into the ordinary layer, and emits it", () => {
    const files = render(localizedMod());
    // Prefixed by construction, so it cannot be a key vanilla already defines.
    expect(files.get("localisation/english/pp_mod_localized_l_english.yml")).toContain(
      ' pp_mod_building_pp_refinery_planet_limit_crowded:0 "Crowded world"'
    );
    // And the patched body points at exactly that key.
    expect(files.get("common/buildings/pp_buildings_pp_mod_patch.txt")).toContain(
      "\t\t\tdesc = pp_mod_building_pp_refinery_planet_limit_crowded\n"
    );
  });

  it("emits an existing key from a patched modifier description", () => {
    const mod = createMod(makeConfig());
    const files = render(
      mod.compile([
        mod.feature("referenced_desc", [
          mod.patchTechnology(vanilla.definition("technology", "tech_gene_forging"), () => ({
            weightModifier: {
              modifiers: [{ factor: 2, desc: external.localization("EXISTING_MODIFIER_DESC") }],
            },
          })),
        ]),
      ])
    );

    expect(files.get("common/technology/pp_soc_tech_pp_mod_patch.txt")).toContain(
      "desc = EXISTING_MODIFIER_DESC"
    );
    expect([...files.keys()].filter((path) => path.startsWith("localisation/english/"))).toEqual(
      []
    );
  });

  it("renames without touching the emitted body or the win assertions", () => {
    const mod = localizedMod();
    // A rename is localisation, not script: the technology patch file is the
    // one a rename-free build emits, and no assertion is made about it — the
    // replace layer wins by layer order, never by filename.
    expect(mod.patchPlans.flatMap((plan) => plan.assertions).map((a) => a.registry)).toEqual([
      "building",
      "technology",
    ]);
    expect(mod.warnings).toEqual([]);
  });

  it("refuses an authored key that collides with a minted patch key", () => {
    // A minted key lands in the ordinary layer beside every authored one, so
    // it faces the same duplicate check — and the two spellings really can
    // meet: the patch mints `<prefix>_tech_gene_forging_weight_modifier_x`,
    // and a technology named `gene_forging_weight_modifier_x` has exactly that
    // id, whose `name` slot writes exactly that key.
    const mod = createMod(makeConfig());
    const feature = mod.feature(undefined, [
      mod.patchTechnology(vanilla.definition("technology", "tech_gene_forging"), () => ({
        weightModifier: {
          modifiers: [{ factor: 2, desc: { english: "Because reasons", key: "x" } }],
        },
      })),
      mod.technology("gene_forging_weight_modifier_x", {
        cost: 100,
        weight: 100,
        name: "Something else entirely",
        area: "society",
        tier: 1,
        category: "biology",
      }),
    ]);
    expect(() => mod.compile([feature])).toThrow(
      'Duplicate localization key "pp_mod_tech_gene_forging_weight_modifier_x"'
    );
  });

  it("fans a rename and a minted key out to every language they supply", () => {
    const mod = createMod(makeConfig());
    const files = render(
      mod.compile([
        mod.feature("translated", [
          mod.patchTechnology(vanilla.definition("technology", "tech_gene_forging"), () => ({
            name: { english: "Chimeric Forging", french: "Forge chimérique" },
          })),
          mod.patchBuilding(refinery, () => ({
            planetLimit: {
              base: 2,
              modifiers: [
                {
                  add: 1,
                  when: always(),
                  desc: { english: "Crowded world", french: "Monde surpeuplé", key: "crowded" },
                },
              ],
            },
          })),
        ]),
      ])
    );

    // A rename keeps vanilla's key in both layers' languages; a minted key
    // keeps the prefixed one.
    expect(files.get("localisation/replace/french/pp_mod_translated_l_french.yml")).toBe(
      '﻿l_french:\n tech_gene_forging:0 "Forge chimérique"\n'
    );
    expect(files.get("localisation/french/pp_mod_translated_l_french.yml")).toBe(
      '﻿l_french:\n pp_mod_building_pp_refinery_planet_limit_crowded:0 "Monde surpeuplé"\n'
    );
  });

  it("refuses a key pin on a rename, whose key is vanilla's own", () => {
    const mod = createMod(makeConfig());
    expect(() =>
      mod.patchTechnology(vanilla.definition("technology", "tech_gene_forging"), () => ({
        name: { english: "Chimeric Forging", key: "chimeric" },
      }))
    ).toThrow(
      'The patched "name" of technology "tech_gene_forging" sets "key", but its localization ' +
        'key is always "tech_gene_forging"'
    );
  });
});
