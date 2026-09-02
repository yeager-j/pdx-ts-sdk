import { describe, expectTypeOf, it } from "vitest";

import {
  createMod,
  inspectSolarSystem,
  type SolarSystemDiagnostic,
  type SolarSystemDiagnosticCode,
  type SolarSystemInspection,
} from "../src/index.ts";

describe("inspectSolarSystem types", () => {
  const mod = createMod({ name: "Types", prefix: "types", supportedVersion: "4.4.*" });
  const system = mod.solarSystemInitializer("typed", { class: "sc_g" });

  it("accepts a defined initializer and returns a readonly inspection", () => {
    const inspection = inspectSolarSystem(system);
    expectTypeOf(inspection).toEqualTypeOf<SolarSystemInspection>();
    expectTypeOf(inspection.svg).toEqualTypeOf<string>();
    expectTypeOf(inspection.diagnostics).toEqualTypeOf<readonly SolarSystemDiagnostic[]>();
  });

  it("rejects other content items and plain definitions", () => {
    const technology = mod.technology("typed_tech", {
      cost: 100,
      weight: 100,
      name: "Typed tech",
      area: "physics",
      tier: 1,
      category: ["computing"],
    });
    // @ts-expect-error — only solar-system initializer items are inspectable.
    inspectSolarSystem(technology);
    // @ts-expect-error — the defined item is required, not its raw definition.
    inspectSolarSystem({ class: "sc_g" });
  });

  it("keeps the diagnostic unions closed", () => {
    const diagnostic = inspectSolarSystem(system).diagnostics[0]!;
    expectTypeOf(diagnostic.code).toEqualTypeOf<SolarSystemDiagnosticCode>();
    expectTypeOf(diagnostic.severity).toEqualTypeOf<"warning" | "info">();
    expectTypeOf(diagnostic.certainty).toEqualTypeOf<"definite" | "possible" | "unresolved">();
    expectTypeOf(diagnostic.paths).toEqualTypeOf<readonly string[]>();
  });

  it("only accepts a positive integer svgSize option shape", () => {
    inspectSolarSystem(system, { svgSize: 400 });
    // @ts-expect-error — unknown options are rejected.
    inspectSolarSystem(system, { theme: "dark" });
  });
});
