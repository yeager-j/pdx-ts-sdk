import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  createMod,
  inspectSolarSystem,
  inspectSolarSystems,
  writeSystemPreviews,
} from "../src/index.ts";

const tempDir = mkdtempSync(join(tmpdir(), "pdx-sdk-previews-"));
afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function compiledMod() {
  const mod = createMod({ name: "Previews", prefix: "previews", supportedVersion: "4.4.*" });
  const haven = mod.solarSystemInitializer("haven", {
    class: "sc_g",
    planet: [
      { class: "star", size: 25, orbitDistance: 0, orbitAngle: 0 },
      { class: "pc_continental", size: 18, orbitDistance: 60, orbitAngle: 90 },
    ],
  });
  const crowded = mod.solarSystemInitializer("crowded", {
    class: "sc_g",
    planet: [
      { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
      { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: 0 },
    ],
  });
  const technology = mod.technology("filler", {
    cost: 100,
    weight: 100,
    name: "Filler",
    area: "physics",
    tier: 1,
    category: ["computing"],
  });
  return { mod: mod.compile([mod.feature(undefined, [haven, crowded, technology])]), haven };
}

describe("inspectSolarSystems", () => {
  it("inspects every solar-system initializer in a compiled mod", () => {
    const { mod, haven } = compiledMod();
    const inspections = inspectSolarSystems(mod);
    expect([...inspections.keys()].sort()).toEqual([
      "previews_solar_system_initializer_crowded",
      "previews_solar_system_initializer_haven",
    ]);
    const direct = inspectSolarSystem(haven);
    expect(inspections.get("previews_solar_system_initializer_haven")!.svg).toBe(direct.svg);
  });

  it("returns an empty map for a mod with no solar systems", () => {
    const mod = createMod({ name: "Empty", prefix: "emptymod", supportedVersion: "4.4.*" });
    const compiled = mod.compile([mod.feature(undefined, [])]);
    expect(inspectSolarSystems(compiled).size).toBe(0);
  });
});

describe("writeSystemPreviews", () => {
  it("writes one SVG per system plus a gallery and reports the findings", async () => {
    const { mod } = compiledMod();
    const dir = join(tempDir, "full");
    const report = await writeSystemPreviews(dir, mod);

    expect(report.previews.map((preview) => preview.id)).toEqual([
      "previews_solar_system_initializer_crowded",
      "previews_solar_system_initializer_haven",
    ]);
    for (const preview of report.previews) {
      expect(existsSync(join(dir, preview.relPath))).toBe(true);
    }
    const crowded = report.previews.find((preview) => preview.id.endsWith("crowded"))!;
    expect(crowded.diagnostics.some((d) => d.code === "body-overlap")).toBe(true);

    const gallery = readFileSync(join(dir, report.indexRelPath), "utf8");
    expect(gallery).toContain("previews_solar_system_initializer_haven.svg");
    expect(gallery).toContain("Previews solar systems");
  });

  it("writes nothing for a mod with no solar systems", async () => {
    const mod = createMod({ name: "Empty", prefix: "emptymod", supportedVersion: "4.4.*" });
    const compiled = mod.compile([mod.feature(undefined, [])]);
    const dir = join(tempDir, "empty");
    const report = await writeSystemPreviews(dir, compiled);
    expect(report.previews).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
