/**
 * Non-gating contact with reality: the handoff's first probe, against the
 * local install. Patch the real `tech_gene_tailoring` (`cost.value * 2`, one
 * appended prerequisite) and assert the computed filename byte-sorts after
 * `00_soc_tech.txt` and every other file defining the key — with the win
 * assertion naming each one. Runs only where the install exists; the
 * committed gates are the hermetic suites.
 *
 * This retires the probe's five-file OR-prerequisites refusal: `load()` is
 * eager, so its mere success proves every vanilla technology file builds a
 * typed surface.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, type PdxEntry, type PdxItem, type PdxValue } from "@pdx-ts/pdxscript";
import { afterAll, describe, expect, it } from "vitest";

import {
  and,
  checkVariable,
  createMod,
  hasAscensionPerk,
  owner,
  planet,
  render,
  scriptedTrigger,
} from "../src/index.ts";
import { compareLogicalPaths } from "../src/ordering.ts";
import { locateInstall } from "../src/stellaris/installation/locate.ts";
import { load } from "../src/stellaris/vanilla/load.ts";
import { SUPPORTED_STELLARIS_BUILD } from "../src/stellaris/vanilla/override-rules.ts";

let installPath: string | undefined;
try {
  installPath = locateInstall();
} catch {
  installPath = undefined;
}

const cacheDir = mkdtempSync(join(tmpdir(), "pdx-sdk-real-cache-"));
afterAll(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe.skipIf(installPath === undefined)("real install (non-gating)", () => {
  it("every vanilla technology and building file builds a typed surface", () => {
    const started = performance.now();
    const vanilla = load({ installPath, cache: cacheDir });
    const elapsed = performance.now() - started;

    const techFiles = vanilla.files.filter((file) => file.path.startsWith("common/technology/"));
    expect(techFiles.length).toBeGreaterThan(30);
    const technologies = vanilla.definitions("technology");
    expect(technologies.length).toBeGreaterThan(100);
    // The construct the probe's parser had to refuse, now typed data.
    const withAnyOf = technologies.filter((tech) =>
      tech.prerequisites?.some((p) => "kind" in p && p.kind === "any-of")
    );
    expect(withAnyOf.length).toBeGreaterThan(0);

    // The second parsed registry against the same reality: `common/buildings`
    // is flat (no subdirectory pinning needed), every file builds a surface,
    // and every `@variable` any of them mentions resolved — `load()` is eager,
    // so reaching this line at all is that proof.
    const buildingFiles = vanilla.files.filter((file) => file.path.startsWith("common/buildings/"));
    expect(buildingFiles.length).toBeGreaterThan(20);
    const buildings = vanilla.definitions("building");
    expect(buildings.length).toBeGreaterThan(50);
    expect(buildings.every((building) => building.registry === "building")).toBe(true);

    // The escape-hatch clause: an install layer too slow to run every build.
    console.info(
      `load(): ${technologies.length} technologies from ${techFiles.length} files, ` +
        `${buildings.length} buildings from ${buildingFiles.length} files, ` +
        `in ${Math.round(elapsed)}ms (build ${vanilla.gameVersion ?? "unknown"})`
    );
  });

  it("a second load is a cache hit with the identical manifest", () => {
    const first = load({ installPath, cache: cacheDir });
    const started = performance.now();
    const second = load({ installPath, cache: cacheDir });
    const elapsed = performance.now() - started;
    expect(second.fromCache).toBe(true);
    expect(second.manifestKey).toBe(first.manifestKey);
    console.info(`cached load(): ${Math.round(elapsed)}ms`);
  });

  it("patches the real tech_gene_tailoring into a provably winning file", () => {
    const vanilla = load({ installPath, cache: cacheDir });
    const config = {
      name: "Real Patch Probe",
      prefix: "pp_real",
      supportedVersion: "4.4.*",
      // The hermetic suites gate the staleness check; here the point is the
      // filename computation against whatever build is installed.
      ...(vanilla.gameVersion !== SUPPORTED_STELLARIS_BUILD
        ? { acceptGameVersion: vanilla.gameVersion }
        : {}),
    };
    const mod = createMod(config);
    const myNewTech = mod.technology("marker", {
      name: "Probe Marker",
      area: "society",
      tier: 1,
      category: "biology",
    });
    const geneTailoringPatch = mod.patchTechnology(
      vanilla.definition("technology", "tech_gene_tailoring").require("cost", "prerequisites"),
      (t) => ({
        cost: t.cost.value * 2,
        prerequisites: [...t.prerequisites, myNewTech],
      })
    );
    const compiled = mod.compile([mod.feature(undefined, [myNewTech, geneTailoringPatch])], {
      vanilla,
    });

    const plan = compiled.patchPlans[0]!;
    const assertion = plan.assertions[0]!;
    expect(assertion.key).toBe("tech_gene_tailoring");
    expect(assertion.beats).toContain("common/technology/00_soc_tech.txt");
    for (const beaten of assertion.beats) {
      expect(compareLogicalPaths(plan.relPath, beaten)).toBe(1);
    }
    // The name must also beat every OTHER technology file, or the claim
    // "sorts after every definer" was tested against too small a set.
    const definers = vanilla.files.filter((file) => file.keys.includes("tech_gene_tailoring"));
    expect(definers.map((file) => file.path)).toEqual(assertion.beats);

    const files = render(compiled);
    expect(files.get(plan.relPath)).toBe(plan.content);
    console.info(`computed winning path: ${plan.relPath}`);
    console.info(`beats: ${assertion.beats.join(", ")}`);
  });
});

/** Every entry under `key` at this container level (there can be more than one). */
function findEntries(items: readonly PdxItem[], key: string): PdxEntry[] {
  return items.filter((item): item is PdxEntry => item.kind === "entry" && item.key === key);
}

/**
 * Drops each entry's source `line` (the only field the parser sets that
 * hand-built trees omit), so `toEqual` compares PDXScript structure and
 * values only — never which file or render pass produced the AST. This is
 * the same "semantic, not byte-identical" round trip `packages/pdxscript`
 * itself promises.
 */
function normalize(value: PdxValue): unknown {
  return value.kind === "container"
    ? { header: value.header, items: value.items.map(normalizeItem) }
    : value;
}

function normalizeItem(item: PdxItem): unknown {
  if (item.kind === "entry") {
    return { key: item.key, op: item.op, value: normalize(item.value) };
  }
  if (item.kind === "param") {
    return { name: item.name, negated: item.negated, items: item.items.map(normalizeItem) };
  }
  return normalize(item);
}

describe.skipIf(installPath === undefined)(
  "SDK-56: building.triggered_country_modifier ported from the real install (buildingModifiers)",
  () => {
    // The decisive check for SDK-56: a green build proves nothing here — the
    // whole defect was that the build was already green while the writer
    // silently dropped triggered_country_modifier (114 shipped buildings)
    // and country_modifier (35 shipped buildings) in full. This ports the
    // real `building_league_offices` (common/buildings/08_unity_buildings.txt)
    // and diffs the SDK's own emission against the SDK's own parse of the
    // installed source for exactly those two fields — not a hand-transcribed
    // string, so a future formatting change to either side cannot silently
    // make this pass for the wrong reason.
    //
    // potential/allow/destroy_trigger/empire_limit/planet_modifier/
    // triggered_desc/prerequisites are real fields on this building too, but
    // are orthogonal to the two fields under test here and are left out of
    // the port; `resources` is a separate, already-flagged gap
    // (building.resources still reports "no declaration the emitter can
    // lower" and is unrelated to SDK-56's overlay rows).
    it("matches the installed building_league_offices's country_modifier and triggered_country_modifier", () => {
      const sourcePath = join(installPath!, "common", "buildings", "08_unity_buildings.txt");
      const sourceText = readFileSync(sourcePath, "utf8");
      const vanillaDoc = parse(sourceText, "08_unity_buildings.txt");

      const vanillaBuilding = findEntries(vanillaDoc.items, "building_league_offices")[0];
      if (vanillaBuilding === undefined || vanillaBuilding.value.kind !== "container") {
        throw new Error(
          "building_league_offices not found in the installed 08_unity_buildings.txt " +
            "— vanilla data may have moved to a different file or been renamed"
        );
      }
      const vanillaCountryModifier = findEntries(
        vanillaBuilding.value.items,
        "country_modifier"
      )[0];
      const vanillaTriggeredCountryModifier = findEntries(
        vanillaBuilding.value.items,
        "triggered_country_modifier"
      )[0];
      expect(
        vanillaCountryModifier,
        "installed building_league_offices lost its country_modifier"
      ).toBeDefined();
      expect(
        vanillaTriggeredCountryModifier,
        "installed building_league_offices lost its triggered_country_modifier"
      ).toBeDefined();

      // Same field, same values, ported into a mod-prefixed id (a defineX
      // id can never collide with a vanilla one).
      const mod = createMod({
        name: "SDK-56 vanilla port",
        prefix: "sdk56",
        supportedVersion: "4.4.*",
      });
      const ported = mod.building("league_offices_port", {
        name: "Sdk56 League Offices Port",
        countryModifier: (m) => m.raw("country_edict_fund_add", 50),
        triggeredCountryModifier: [
          {
            when: owner(hasAscensionPerk("ap_archaeoengineers")),
            modifiers: (m) => m.raw("country_edict_fund_add", 50),
          },
        ],
      });
      const renderedFile = render(mod.compile([mod.feature(undefined, [ported])])).get(
        "common/buildings/sdk56_buildings.txt"
      )!;
      const renderedDoc = parse(renderedFile, "sdk56_buildings.txt");
      const renderedBuilding = findEntries(
        renderedDoc.items,
        "sdk56_building_league_offices_port"
      )[0]!;
      if (renderedBuilding.value.kind !== "container") {
        throw new Error("expected the rendered building to be a container");
      }
      const renderedCountryModifier = findEntries(
        renderedBuilding.value.items,
        "country_modifier"
      )[0]!;
      const renderedTriggeredCountryModifier = findEntries(
        renderedBuilding.value.items,
        "triggered_country_modifier"
      )[0]!;

      expect(normalize(renderedCountryModifier.value)).toEqual(
        normalize(vanillaCountryModifier!.value)
      );
      expect(normalize(renderedTriggeredCountryModifier.value)).toEqual(
        normalize(vanillaTriggeredCountryModifier!.value)
      );
    });
  }
);

describe.skipIf(installPath === undefined)(
  "SDK-56: building.triggered_planet_pop_group_modifier_for_species ported from the real install (buildingModifiers)",
  () => {
    // The seventh field the ticket's own evidence sweep missed: it matched
    // the field name without checking the registry prefix, and the row it
    // credited to `building` (`job.triggered_planet_pop_group_modifier_for_species`,
    // overlay.ts:1056/SDK-39) is a different registry. Confirmed missing the
    // same way as the other six: no CONTENT_FIELD_OVERRIDES row, absent from
    // generated building.ts, "no declaration the emitter can lower" in the
    // codegen report, 2 real vanilla uses (both in `building_clone_army_clone_vat`,
    // common/buildings/01_pop_assembly_buildings.txt).
    //
    // Its clause is different from the other six: this field splices
    // `triggered_modifier_by_pop_group_clause` (buildings.cwt:221), not
    // `triggered_modifier_by_planet_clause`. That clause is the plain
    // `triggered_modifier_clause` template plus one extra field,
    // `divide_over_pop_groups`, that `TriggeredModifier` does not model —
    // the same trade `job.triggered_planet_pop_group_modifier_for_species`
    // (SDK-39) already accepted, reusing `triggeredModifierBlock` and
    // documenting the drop. Neither of the two real vanilla uses below
    // writes `divide_over_pop_groups` (verified by hand against the
    // installed file), so the drop costs nothing against real content here —
    // still stated in the overlay reason, since an author writing the field
    // gets silence otherwise, the exact defect class this ticket removes.
    it("matches the installed building_clone_army_clone_vat's triggered_planet_pop_group_modifier_for_species", () => {
      const sourcePath = join(installPath!, "common", "buildings", "01_pop_assembly_buildings.txt");
      const sourceText = readFileSync(sourcePath, "utf8");
      const vanillaDoc = parse(sourceText, "01_pop_assembly_buildings.txt");

      const vanillaBuilding = findEntries(vanillaDoc.items, "building_clone_army_clone_vat")[0];
      if (vanillaBuilding === undefined || vanillaBuilding.value.kind !== "container") {
        throw new Error(
          "building_clone_army_clone_vat not found in the installed " +
            "01_pop_assembly_buildings.txt — vanilla data may have moved"
        );
      }
      const vanillaTriggeredForSpecies = findEntries(
        vanillaBuilding.value.items,
        "triggered_planet_pop_group_modifier_for_species"
      );
      expect(
        vanillaTriggeredForSpecies.length,
        "installed building_clone_army_clone_vat's triggered_planet_pop_group_modifier_for_species count changed"
      ).toBe(2);
      // Confirms the field this test ports is not lossy against real
      // content: divide_over_pop_groups is the one field
      // triggeredModifierBlock does not model, and neither shipped use
      // writes it.
      for (const entry of vanillaTriggeredForSpecies) {
        expect(
          entry.value.kind,
          "expected a triggered_planet_pop_group_modifier_for_species block"
        ).toBe("container");
        const writesDivideOverPopGroups =
          entry.value.kind === "container" &&
          findEntries(entry.value.items, "divide_over_pop_groups").length > 0;
        expect(writesDivideOverPopGroups).toBe(false);
      }
      // The first block: potential = { has_infertile_clone_soldier_trait = yes
      // planet = { check_variable = { which = clone_pops_missing_per_vat value > 2200 } } }
      // bonus_pop_growth = 20
      const vanillaFirst = vanillaTriggeredForSpecies[0]!;

      // Same field, same values, ported into a mod-prefixed id.
      // has_infertile_clone_soldier_trait is a scripted trigger
      // (common/scripted_triggers/05_scripted_triggers_traits.txt), bound
      // the same way any mod author would: scriptedTrigger(name, scope) —
      // not a pre-bound @pdx-ts/stellaris-ids/triggers import, which this
      // program's tsconfig excludes the same way every other sdk test does
      // (tsconfig.json's package-absent world).
      const hasInfertileCloneSoldierTrait = scriptedTrigger(
        "has_infertile_clone_soldier_trait",
        "pop_group"
      );
      const mod = createMod({
        name: "SDK-56 vanilla port",
        prefix: "sdk56",
        supportedVersion: "4.4.*",
      });
      const ported = mod.building("clone_army_clone_vat_port", {
        name: "Sdk56 Clone Army Clone Vat Port",
        triggeredPlanetPopGroupModifierForSpecies: [
          {
            when: and(
              hasInfertileCloneSoldierTrait(),
              planet(checkVariable({ which: "clone_pops_missing_per_vat", value: [">", 2200] }))
            ),
            modifiers: (m) => m.raw("bonus_pop_growth", 20),
          },
        ],
      });
      const renderedFile = render(mod.compile([mod.feature(undefined, [ported])])).get(
        "common/buildings/sdk56_buildings.txt"
      )!;
      const renderedDoc = parse(renderedFile, "sdk56_buildings.txt");
      const renderedBuilding = findEntries(
        renderedDoc.items,
        "sdk56_building_clone_army_clone_vat_port"
      )[0]!;
      if (renderedBuilding.value.kind !== "container") {
        throw new Error("expected the rendered building to be a container");
      }
      const renderedForSpecies = findEntries(
        renderedBuilding.value.items,
        "triggered_planet_pop_group_modifier_for_species"
      )[0]!;

      expect(normalize(renderedForSpecies.value)).toEqual(normalize(vanillaFirst.value));
    });
  }
);
