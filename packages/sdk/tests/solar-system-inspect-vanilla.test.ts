/**
 * Non-gating calibration against the installed game: every shipped
 * initializer must inspect cleanly, and none may produce a definite-certainty
 * warning — shipped systems render fine in the game, so a definite claim
 * against one is a false positive in the visual model. Runs only where the
 * install exists; the committed gates are the hermetic suites.
 */

import { describe, expect, it } from "vitest";

import {
  defineSolarSystemInitializer,
  type SolarSystemInitializerItem,
} from "../src/generated/content-definers.ts";
import { inspectSolarSystem, type SolarSystemDiagnostic } from "../src/index.ts";
import { locateInstall } from "../src/installation/installation/locate.ts";
import {
  CLASS_ENTITY_SCALES,
  FIXED_SCALE_CLASSES,
  MOON_RENDER_SCALE,
  STANDARD_ENTITY_SCALE,
  STAR_CLASS_PLANET_CLASSES,
  SYSTEM_VIEW_PLANET_SCALE,
} from "../src/solar-system-inspect/class-scales.ts";
import {
  readVanillaClassScales,
  readVanillaRenderDefines,
  readVanillaStarClassKeys,
} from "./helpers/planet-class-scales.ts";
import { readVanillaInitializers, type VanillaInitializer } from "./helpers/solar-system-raw.ts";

let installPath: string | undefined;
try {
  installPath = locateInstall();
} catch {
  installPath = undefined;
}

function item(initializer: VanillaInitializer): SolarSystemInitializerItem {
  return defineSolarSystemInitializer(initializer.def);
}

describe.skipIf(installPath === undefined)("vanilla solar-system calibration (non-gating)", () => {
  // Collection still runs when the suite is skipped, so guard the read.
  const initializers = installPath === undefined ? [] : readVanillaInitializers(installPath);

  it("reads the full shipped corpus", () => {
    expect(initializers.length).toBeGreaterThan(300);
    const files = new Set(initializers.map((initializer) => initializer.file));
    expect(files.size).toBeGreaterThanOrEqual(35);
  });

  it("inspects every shipped initializer without throwing", () => {
    for (const initializer of initializers) {
      const inspection = inspectSolarSystem(item(initializer));
      expect(inspection.svg.startsWith("<svg ")).toBe(true);
      expect(inspection.svg).not.toContain("NaN");
    }
  });

  // True positives the game silently tolerates: two shipped initializers
  // write an inverted size range (`size = { min = 15 max = 10 }`).
  const KNOWN_VANILLA_DEFECTS = [
    "distant_stars_initializers.txt living_planet_system unusable-range planet[1]",
    "fallen_empire_initializers.txt fallen_hive_war_3 unusable-range planet[1]",
  ];

  it("reports no definite-certainty warnings on shipped systems beyond known defects", () => {
    const definite: string[] = [];
    for (const initializer of initializers) {
      for (const diagnostic of inspectSolarSystem(item(initializer)).diagnostics) {
        if (diagnostic.severity === "warning" && diagnostic.certainty === "definite") {
          definite.push(
            `${initializer.file} ${initializer.def.id} ${diagnostic.code} ${diagnostic.paths.join(",")}`
          );
        }
      }
    }
    expect(definite.filter((entry) => !KNOWN_VANILLA_DEFECTS.includes(entry))).toEqual([]);
    for (const known of KNOWN_VANILLA_DEFECTS) {
      expect(definite).toContain(known);
    }
  });

  it("resolves a documented multi-star initializer with nested planet frames", () => {
    const nested = initializers.find((initializer) =>
      initializer.def.planet?.some((planet) => (planet.planet?.length ?? 0) > 0)
    );
    expect(nested).toBeDefined();
    const inspection = inspectSolarSystem(item(nested!));
    expect(inspection.svg).toContain("body-star");
  });

  it("resolves shipped asteroid-belt systems", () => {
    const belted = initializers.filter(
      (initializer) => (initializer.def.asteroidBelt?.length ?? 0) > 0
    );
    expect(belted.length).toBeGreaterThan(50);
    for (const initializer of belted.slice(0, 5)) {
      expect(inspectSolarSystem(item(initializer)).svg).toContain('class="belt"');
    }
  });

  it("keeps the baked class scale table in sync with the install", () => {
    const vanilla = readVanillaClassScales(installPath!);
    expect(vanilla.scales.size).toBeGreaterThan(50);
    for (const [className, scale] of vanilla.scales) {
      const baked = CLASS_ENTITY_SCALES[className] ?? STANDARD_ENTITY_SCALE;
      expect({ className, scale: baked }).toEqual({ className, scale });
    }
    for (const className of Object.keys(CLASS_ENTITY_SCALES)) {
      expect(vanilla.scales.get(className)).toBeDefined();
    }
    expect([...FIXED_SCALE_CLASSES].sort()).toEqual([...vanilla.fixed].sort());
  });

  it("keeps the star-class planet keys in sync with the install", () => {
    const vanilla = readVanillaStarClassKeys(installPath!);
    for (const [starClass, keys] of Object.entries(STAR_CLASS_PLANET_CLASSES)) {
      expect({ starClass, keys: vanilla.get(starClass) }).toEqual({ starClass, keys });
    }
    for (const [starClass, keys] of vanilla) {
      if (STAR_CLASS_PLANET_CLASSES[starClass] === undefined) {
        expect({ starClass, missing: keys }).toEqual({ starClass, missing: undefined });
      }
    }
  });

  it("keeps the pinned render defines in sync with the install", () => {
    const defines = readVanillaRenderDefines(installPath!);
    expect(defines.moonScale).toBe(MOON_RENDER_SCALE);
    expect(defines.zoomedOutPlanetScale).toBe(SYSTEM_VIEW_PLANET_SCALE);
  });

  it("renders deterministic SVG for shipped systems", () => {
    for (const initializer of initializers.slice(0, 10)) {
      const first = inspectSolarSystem(item(initializer));
      const second = inspectSolarSystem(item(initializer));
      expect(second.svg).toBe(first.svg);
      expect(second.diagnostics).toEqual(first.diagnostics);
    }
  });
});
