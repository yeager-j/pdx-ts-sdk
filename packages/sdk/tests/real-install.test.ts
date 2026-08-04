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
  buildMod,
  collection,
  defineBuilding,
  defineTechnology,
  hasAscensionPerk,
  owner,
  patchTechnology,
  render,
} from "../src/index.ts";
import { compareLogicalPaths } from "../src/resolver/path-order.ts";
import { SUPPORTED_STELLARIS_BUILD } from "../src/resolver/rules.ts";
import { load } from "../src/stellaris/load.ts";
import { locateInstall } from "../src/stellaris/locate.ts";

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
  it("every vanilla technology file builds a typed surface, OR groups included", () => {
    const started = performance.now();
    const vanilla = load({ installPath, cache: cacheDir });
    const elapsed = performance.now() - started;

    const techFiles = vanilla.files.filter((file) => file.path.startsWith("common/technology/"));
    expect(techFiles.length).toBeGreaterThan(30);
    const technologies = vanilla.allTechnologies();
    expect(technologies.length).toBeGreaterThan(100);
    // The construct the probe's parser had to refuse, now typed data.
    const withAnyOf = technologies.filter((tech) =>
      tech.prerequisites?.some((p) => "kind" in p && p.kind === "any-of")
    );
    expect(withAnyOf.length).toBeGreaterThan(0);
    // The escape-hatch clause: an install layer too slow to run every build.
    console.info(
      `load(): ${technologies.length} technologies from ${techFiles.length} files ` +
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
    const myNewTech = defineTechnology({
      id: "pp_real_tech_marker",
      name: "Probe Marker",
      area: "society",
      tier: 1,
      category: "biology",
    });
    const geneTailoringPatch = patchTechnology(
      vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
      (t) => ({
        cost: t.cost.value * 2,
        prerequisites: [...t.prerequisites, myNewTech],
      })
    );
    const technologies = collection(undefined, [myNewTech, geneTailoringPatch]);
    const mod = buildMod(config, [technologies], { vanilla });

    const plan = mod.patchPlan!;
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

    const files = render(mod);
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
      const ported = defineBuilding({
        id: "sdk56_building_league_offices_port",
        name: "Sdk56 League Offices Port",
        countryModifier: (m) => m.raw("country_edict_fund_add", 50),
        triggeredCountryModifier: [
          {
            when: owner(hasAscensionPerk("ap_archaeoengineers")),
            modifiers: (m) => m.raw("country_edict_fund_add", 50),
          },
        ],
      });
      const renderedFile = render(
        buildMod({ name: "SDK-56 vanilla port", prefix: "sdk56", supportedVersion: "4.4.*" }, [
          collection(undefined, [ported]),
        ])
      ).get("common/buildings/sdk56_buildings.txt")!;
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
