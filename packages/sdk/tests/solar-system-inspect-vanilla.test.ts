/**
 * Non-gating calibration against the installed game: every shipped
 * initializer must inspect cleanly, and none may produce a definite-certainty
 * warning — shipped systems render fine in the game, so a definite claim
 * against one is a false positive in the visual model. Runs only where the
 * install exists; the committed gates are the hermetic suites.
 */

import { describe, expect, it } from "vitest";

import type { SolarSystemInitializerItem } from "../src/generated/content-definers.ts";
import { inspectSolarSystem, type SolarSystemDiagnostic } from "../src/index.ts";
import { locateInstall } from "../src/stellaris/installation/locate.ts";
import { readVanillaInitializers, type VanillaInitializer } from "./helpers/solar-system-raw.ts";

let installPath: string | undefined;
try {
  installPath = locateInstall();
} catch {
  installPath = undefined;
}

function item(initializer: VanillaInitializer): SolarSystemInitializerItem {
  return {
    itemKind: "content",
    type: "solar_system_initializer",
    id: initializer.def.id,
    def: initializer.def,
  };
}

describe.skipIf(installPath === undefined)("vanilla solar-system calibration (non-gating)", () => {
  const initializers = readVanillaInitializers(installPath!);

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

  it("renders deterministic SVG for shipped systems", () => {
    for (const initializer of initializers.slice(0, 10)) {
      const first = inspectSolarSystem(item(initializer));
      const second = inspectSolarSystem(item(initializer));
      expect(second.svg).toBe(first.svg);
      expect(second.diagnostics).toEqual(first.diagnostics);
    }
  });
});
