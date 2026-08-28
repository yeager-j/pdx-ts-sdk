import { describe, expect, it } from "vitest";

import type { SolarSystemInitializerItem } from "../src/generated/content-definers.ts";
import type { SolarSystemInitializerDef } from "../src/generated/solar-system-initializer.ts";
import {
  createMod,
  inspectSolarSystem,
  type SolarSystemDiagnostic,
  type SolarSystemInspection,
} from "../src/index.ts";
import {
  angleRange,
  correlatedDistance,
  fixedAngle,
  FULL_SPAN,
  independentDistance,
  type AngleSpan,
  type Interval,
} from "../src/solar-system-inspect/interval.ts";

function define(
  name: string,
  def: Omit<SolarSystemInitializerDef, "id">
): SolarSystemInitializerItem {
  const mod = createMod({ name: "Inspect", prefix: "inspect", supportedVersion: "4.4.*" });
  return mod.solarSystemInitializer(name, def) as SolarSystemInitializerItem;
}

function inspect(name: string, def: Omit<SolarSystemInitializerDef, "id">): SolarSystemInspection {
  return inspectSolarSystem(define(name, def));
}

function warnings(diagnostics: readonly SolarSystemDiagnostic[]): SolarSystemDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
}

describe("inspectSolarSystem input contract", () => {
  it("rejects a value that is not a defined initializer item", () => {
    expect(() => inspectSolarSystem({} as never)).toThrow(TypeError);
    expect(() =>
      inspectSolarSystem({
        itemKind: "content",
        type: "technology",
        id: "x",
        def: { id: "x" },
      } as never)
    ).toThrow(TypeError);
  });

  it("rejects an invalid svgSize", () => {
    const item = define("size_option", { class: "sc_g" });
    expect(() => inspectSolarSystem(item, { svgSize: 0 })).toThrow(RangeError);
    expect(() => inspectSolarSystem(item, { svgSize: 1.5 })).toThrow(RangeError);
  });

  it("does not mutate the input definition", () => {
    const item = define("purity", {
      class: "sc_g",
      asteroidBelt: [{ type: "rocky_asteroid_belt", radius: 80 }],
      planet: [
        { class: "star", size: 25 },
        { class: "pc_continental", orbitDistance: { min: 40, max: 50 }, size: 18 },
      ],
    });
    const before = structuredClone(item.def);
    inspectSolarSystem(item);
    expect(item.def).toEqual(before);
  });
});

describe("fixed geometry overlap", () => {
  it("reports a definite overlap for two fixed bodies with touching discs", () => {
    const { diagnostics } = inspect("fixed_overlap", {
      class: "sc_g",
      planet: [
        { class: "star", size: 24, orbitDistance: 0, orbitAngle: 0 },
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: 0 },
      ],
    });
    const overlap = diagnostics.find((diagnostic) => diagnostic.code === "body-overlap");
    expect(overlap).toMatchObject({
      severity: "warning",
      certainty: "definite",
      paths: ["planet[1]", "planet[2]"],
    });
  });

  it("reports a definite overlap for close fixed angles on one ring", () => {
    const { diagnostics } = inspect("angle_overlap", {
      class: "sc_g",
      planet: [
        { class: "star", size: 24, orbitDistance: 0, orbitAngle: 0 },
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 0, orbitAngle: 2 },
      ],
    });
    expect(diagnostics.find((diagnostic) => diagnostic.code === "body-overlap")).toMatchObject({
      certainty: "definite",
    });
  });

  it.each([
    {
      title: "separated fixed radii",
      planets: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 30, orbitAngle: 0 },
      ],
    },
    {
      title: "same radius on opposite bearings",
      planets: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 0, orbitAngle: 180 },
      ],
    },
    {
      title: "ranged radii whose bands never meet",
      planets: [
        { class: "pc_continental", size: 20, orbitDistance: { min: 40, max: 50 }, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: { min: 30, max: 40 }, orbitAngle: 0 },
      ],
    },
    {
      title: "near miss outside the combined radii",
      planets: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 10.5, orbitAngle: 0 },
      ],
    },
  ])("stays silent for $title", ({ planets }) => {
    const { diagnostics } = inspect("negative_control", {
      class: "sc_g",
      planet: [{ class: "star", size: 24, orbitDistance: 0, orbitAngle: 0 }, ...planets],
    });
    expect(warnings(diagnostics)).toEqual([]);
  });
});

describe("cursor-only entries", () => {
  it("advances following siblings without creating a body", () => {
    const clear = inspect("cursor_gap", {
      class: "sc_g",
      planet: [
        { class: "star", size: 24, orbitDistance: 0, orbitAngle: 0 },
        { class: "none", orbitDistance: 50 },
        { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: 0 },
      ],
    });
    expect(warnings(clear.diagnostics)).toEqual([]);
    expect(clear.svg).not.toContain(">none");
  });

  it("keeps the accumulated position for overlap checks after the gap", () => {
    const { diagnostics } = inspect("cursor_then_overlap", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "none", orbitDistance: 1, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 1, orbitAngle: 0 },
      ],
    });
    expect(diagnostics.find((diagnostic) => diagnostic.code === "body-overlap")).toMatchObject({
      certainty: "definite",
      paths: ["planet[0]", "planet[2]"],
    });
  });

  it("caps certainty at possible when the gap entry has no authored angle", () => {
    const { diagnostics } = inspect("cursor_gap_no_angle", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "none", orbitDistance: 1 },
        { class: "pc_barren", size: 20, orbitDistance: 1, orbitAngle: 0 },
      ],
    });
    expect(diagnostics.find((diagnostic) => diagnostic.code === "body-overlap")).toMatchObject({
      certainty: "possible",
    });
  });
});

describe("nested frames", () => {
  it("reports a parent-bound intersection for a moon inside its planet's disc", () => {
    const { diagnostics } = inspect("moon_in_parent", {
      class: "sc_g",
      planet: [
        {
          class: "pc_continental",
          size: 40,
          orbitDistance: 60,
          orbitAngle: 0,
          moon: [{ class: "pc_barren", size: 4, orbitDistance: 3, orbitAngle: 0 }],
        },
      ],
    });
    expect(diagnostics.find((d) => d.code === "parent-bound-intersection")).toMatchObject({
      severity: "warning",
      certainty: "possible",
      paths: ["planet[0].moon[0]", "planet[0]"],
    });
  });

  it("stays silent for a moon orbiting outside the parent's disc", () => {
    const clear = inspect("moon_clear", {
      class: "sc_g",
      planet: [
        {
          class: "pc_continental",
          size: 20,
          orbitDistance: 60,
          orbitAngle: 0,
          moon: [{ class: "pc_barren", size: 4, orbitDistance: 10, orbitAngle: 0 }],
        },
      ],
    });
    expect(warnings(clear.diagnostics)).toEqual([]);
  });

  it("checks fixed cross-frame pairs at possible certainty only", () => {
    const { diagnostics } = inspect("binary_cross", {
      class: "sc_binary_1",
      planet: [
        { class: "star", size: 24, orbitDistance: 0, orbitAngle: 0 },
        {
          class: "star",
          size: 20,
          orbitDistance: 200,
          orbitAngle: 0,
          planet: [{ class: "pc_barren", size: 10, orbitDistance: 40, orbitAngle: 0 }],
        },
        { class: "pc_desert", size: 10, orbitDistance: 40, orbitAngle: 0 },
      ],
    });
    const cross = diagnostics.find(
      (d) => d.code === "body-overlap" && d.paths.includes("planet[1].planet[0]")
    );
    expect(cross).toMatchObject({
      certainty: "possible",
      paths: ["planet[1].planet[0]", "planet[2]"],
    });
  });

  it("accumulates moon cursors independently from the planet list", () => {
    const clear = inspect("moon_cursor_reset", {
      class: "sc_g",
      planet: [
        { class: "star", size: 24, orbitDistance: 0, orbitAngle: 0 },
        {
          class: "pc_continental",
          size: 20,
          orbitDistance: 100,
          orbitAngle: 90,
          moon: [
            { class: "pc_barren", size: 2, orbitDistance: 12, orbitAngle: 0 },
            { class: "pc_barren", size: 2, orbitDistance: 8, orbitAngle: 180 },
          ],
        },
      ],
    });
    expect(warnings(clear.diagnostics)).toEqual([]);
  });
});

describe("counts and ranges", () => {
  it("marks copies beyond the count minimum as possible", () => {
    const { diagnostics } = inspect("count_range_overlap", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        {
          class: "pc_barren",
          size: 20,
          count: { min: 1, max: 3 },
          orbitDistance: 2,
          orbitAngle: 0,
        },
      ],
    });
    const overlaps = diagnostics.filter((d) => d.code === "body-overlap");
    expect(overlaps.find((d) => d.message.includes("copy 1 of 3"))).toMatchObject({
      certainty: "definite",
    });
    expect(overlaps.find((d) => d.message.includes("copy 2 of 3"))).toMatchObject({
      certainty: "possible",
    });
  });

  it("reports template self-overlap for an advance range that includes zero", () => {
    const { diagnostics } = inspect("self_overlap", {
      class: "sc_g",
      planet: [
        {
          class: "pc_barren",
          size: 20,
          count: 3,
          orbitDistance: { min: -4, max: 4 },
          orbitAngle: 0,
        },
      ],
    });
    expect(diagnostics.find((d) => d.code === "template-self-overlap")).toMatchObject({
      severity: "warning",
      certainty: "possible",
      paths: ["planet[0]"],
    });
  });

  it("widens every following sibling by a ranged advance", () => {
    const { diagnostics } = inspect("range_widening", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: { min: 40, max: 60 }, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 5, orbitAngle: 0 },
      ],
    });
    const overlap = diagnostics.find((d) => d.code === "body-overlap");
    expect(overlap).toMatchObject({ certainty: "definite" });
  });

  it("treats an open-ended count as unresolvable after the template", () => {
    const { diagnostics } = inspect("open_count", {
      class: "sc_g",
      planet: [
        { class: "pc_barren", size: 10, count: { min: 2 }, orbitDistance: 30, orbitAngle: 0 },
        { class: "pc_desert", size: 10, orbitDistance: 30, orbitAngle: 0 },
      ],
    });
    expect(diagnostics.find((d) => d.code === "unresolved-geometry")).toMatchObject({
      certainty: "unresolved",
      paths: ["planet[0]"],
    });
  });

  it("places optional copies at their exact prefix-conditioned positions", () => {
    const clear = inspect("exact_copies", {
      class: "sc_g",
      planet: [
        {
          class: "pc_continental",
          size: 20,
          orbitDistance: 60,
          orbitAngle: 0,
          planet: [
            {
              class: "pc_barren",
              size: 20,
              count: { min: 0, max: 2 },
              orbitDistance: 100,
              orbitAngle: 0,
            },
          ],
          moon: [{ class: "pc_molten", size: 20, orbitDistance: 150, orbitAngle: 0 }],
        },
      ],
    });
    expect(warnings(clear.diagnostics)).toEqual([]);
  });

  it("resolves nested layouts for every counted copy", () => {
    const { diagnostics } = inspect("copies_with_moons", {
      class: "sc_g",
      planet: [
        {
          class: "pc_continental",
          size: 40,
          count: 2,
          orbitDistance: 60,
          orbitAngle: 0,
          moon: [{ class: "pc_barren", size: 4, orbitDistance: 3, orbitAngle: 0 }],
        },
      ],
    });
    const bounds = diagnostics.filter((d) => d.code === "parent-bound-intersection");
    expect(bounds).toHaveLength(2);
  });

  it("invalidates positions after a truncated finite count", () => {
    const { diagnostics, svg } = inspect("truncated_count", {
      class: "sc_g",
      planet: [
        { class: "pc_barren", size: 10, count: 100, orbitDistance: 2, orbitAngle: 0 },
        { class: "pc_desert", size: 10, orbitDistance: 1, orbitAngle: 0 },
      ],
    });
    expect(diagnostics.find((d) => d.code === "unresolved-geometry")).toMatchObject({
      paths: ["planet[0]"],
    });
    expect(svg).toContain(">?<");
  });

  it("caps descendant certainty under an optional parent", () => {
    const { diagnostics } = inspect("optional_parent", {
      class: "sc_g",
      planet: [
        {
          class: "pc_continental",
          size: 20,
          count: { min: 0, max: 1 },
          orbitDistance: 60,
          orbitAngle: 0,
          moon: [
            { class: "pc_barren", size: 20, orbitDistance: 5, orbitAngle: 0 },
            { class: "pc_molten", size: 20, orbitDistance: 1, orbitAngle: 0 },
          ],
        },
      ],
    });
    const overlap = diagnostics.find(
      (d) => d.code === "body-overlap" && d.paths.includes("planet[0].moon[0]")
    );
    expect(overlap).toMatchObject({ certainty: "possible" });
  });

  it("reports the vanilla stacking idiom as info only", () => {
    const inspection = inspect("stack_idiom", {
      class: "sc_g",
      planet: [{ class: "pc_barren", size: 10, count: 5 }],
    });
    expect(warnings(inspection.diagnostics)).toEqual([]);
    expect(inspection.diagnostics.find((d) => d.code === "zero-advance-stack")).toMatchObject({
      severity: "info",
      certainty: "possible",
      paths: ["planet[0]"],
    });
  });
});

describe("uncertainty categories", () => {
  it("reports script values as unresolvable and never guesses", () => {
    const { diagnostics } = inspect("script_value", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: "@belt_radius", orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: 0 },
      ],
    });
    expect(diagnostics.find((d) => d.code === "unresolved-geometry")).toMatchObject({
      certainty: "unresolved",
      paths: ["planet[0]"],
    });
    expect(diagnostics.filter((d) => d.certainty === "definite")).toEqual([]);
  });

  it("still checks relative geometry after an unresolvable advance", () => {
    const { diagnostics } = inspect("script_value_relative", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: "@offset", orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: 0 },
      ],
    });
    const overlap = diagnostics.find((d) => d.code === "body-overlap");
    expect(overlap).toMatchObject({ certainty: "possible", paths: ["planet[0]", "planet[1]"] });
  });

  it("caps overlap certainty at possible for a random angle", () => {
    const { diagnostics } = inspect("random_angle", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 20, orbitDistance: 50, orbitAngle: 0 },
        { class: "pc_barren", size: 20, orbitDistance: 2, orbitAngle: "random" },
      ],
    });
    const overlap = diagnostics.find((d) => d.code === "body-overlap");
    expect(overlap).toMatchObject({ certainty: "possible" });
  });

  it("marks random classes with an assumed visual radius", () => {
    const { diagnostics } = inspect("random_class", {
      class: "sc_g",
      planet: [{ class: "random", orbitDistance: 40, orbitAngle: 0 }],
    });
    expect(diagnostics.find((d) => d.code === "unresolved-visual")).toMatchObject({
      severity: "info",
      certainty: "unresolved",
      paths: ["planet[0]"],
    });
  });
});

describe("belts", () => {
  it("reports a body crossing a belt annulus at possible certainty", () => {
    const { diagnostics } = inspect("belt_crossing", {
      class: "sc_g",
      asteroidBelt: [{ type: "rocky_asteroid_belt", radius: 80 }],
      planet: [{ class: "pc_continental", size: 20, orbitDistance: 80, orbitAngle: 0 }],
    });
    expect(diagnostics.find((d) => d.code === "belt-body-crossing")).toMatchObject({
      severity: "warning",
      certainty: "possible",
      paths: ["planet[0]", "asteroidBelt[0]"],
    });
  });

  it("stays silent for asteroids sharing the belt radius", () => {
    const clear = inspect("belt_asteroids", {
      class: "sc_g",
      asteroidBelt: [{ type: "rocky_asteroid_belt", radius: 80 }],
      planet: [
        { class: "pc_asteroid", size: 3, orbitDistance: 80, orbitAngle: 0 },
        { class: "pc_asteroid", size: 4, orbitDistance: 0, orbitAngle: 120 },
      ],
    });
    expect(warnings(clear.diagnostics)).toEqual([]);
  });

  it("stays silent for bodies well away from the belt", () => {
    const clear = inspect("belt_clear", {
      class: "sc_g",
      asteroidBelt: [{ type: "icy_asteroid_belt", radius: 80 }],
      planet: [{ class: "pc_continental", size: 20, orbitDistance: 40, orbitAngle: 0 }],
    });
    expect(warnings(clear.diagnostics)).toEqual([]);
  });
});

describe("unusable values", () => {
  it.each([
    {
      title: "an inverted orbitDistance range",
      def: {
        class: "sc_g",
        planet: [{ class: "pc_barren", orbitDistance: { min: 50, max: 40 } }],
      },
    },
    {
      title: "a non-finite orbitAngle",
      def: {
        class: "sc_g",
        planet: [{ class: "pc_barren", orbitDistance: 40, orbitAngle: Number.NaN }],
      },
    },
    {
      title: "a fractional count",
      def: { class: "sc_g", planet: [{ class: "pc_barren", count: 1.5, orbitDistance: 40 }] },
    },
    {
      title: "an inverted belt radius range",
      def: {
        class: "sc_g",
        asteroidBelt: [{ type: "rocky_asteroid_belt", radius: { min: 90, max: 80 } }],
      },
    },
  ])("reports $title as an unusable range", ({ def }) => {
    const { diagnostics } = inspectSolarSystem(
      define("unusable", def as Omit<SolarSystemInitializerDef, "id">)
    );
    expect(diagnostics.find((d) => d.code === "unusable-range")).toMatchObject({
      severity: "warning",
      certainty: "definite",
    });
  });

  it("reports a definite negative cumulative orbit radius as info", () => {
    const { diagnostics } = inspect("negative_radius", {
      class: "sc_g",
      planet: [
        { class: "pc_continental", size: 10, orbitDistance: 20, orbitAngle: 0 },
        { class: "pc_barren", size: 10, orbitDistance: -50, orbitAngle: 0 },
      ],
    });
    expect(diagnostics.find((d) => d.code === "negative-orbit-radius")).toMatchObject({
      severity: "info",
      certainty: "definite",
      paths: ["planet[1]"],
    });
  });
});

describe("determinism", () => {
  const def: Omit<SolarSystemInitializerDef, "id"> = {
    class: "sc_g",
    asteroidBelt: [{ type: "rocky_asteroid_belt", radius: { min: 75, max: 85 } }],
    planet: [
      { class: "star", size: 30, orbitDistance: 0, orbitAngle: 0 },
      {
        class: "pc_continental",
        size: 18,
        orbitDistance: { min: 40, max: 50 },
        orbitAngle: "random",
        moon: [{ class: "pc_barren", size: 3, orbitDistance: 8 }],
      },
      {
        class: "pc_gas_giant",
        size: 30,
        count: { min: 1, max: 2 },
        orbitDistance: 60,
        orbitAngle: 45,
      },
    ],
  };

  it("returns identical output for identical input", () => {
    const first = inspectSolarSystem(define("deterministic", def));
    const second = inspectSolarSystem(define("deterministic", def));
    expect(second.svg).toBe(first.svg);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  it("changes only the outer dimensions with svgSize", () => {
    const small = inspectSolarSystem(define("deterministic", def), { svgSize: 200 });
    const large = inspectSolarSystem(define("deterministic", def), { svgSize: 1600 });
    expect(small.diagnostics).toEqual(large.diagnostics);
    expect(small.svg.replace('width="200" height="200"', 'width="1600" height="1600"')).toBe(
      large.svg
    );
  });

  it("emits well-formed standalone SVG", () => {
    const { svg } = inspectSolarSystem(define("deterministic", def));
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });

  it("embeds pan and zoom without external dependencies", () => {
    const { svg } = inspectSolarSystem(define("deterministic", def));
    expect(svg).toContain("<script><![CDATA[");
    expect(svg).toContain('addEventListener("wheel"');
    expect(svg).toContain('addEventListener("dblclick"');
    const external = svg.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
    expect(external).not.toContain("http://");
    expect(external).not.toContain("https://");
  });

  it("reveals labels on hover only", () => {
    const { svg } = inspectSolarSystem(define("deterministic", def));
    expect(svg).toContain('class="hover-target"');
    expect(svg).toContain(".label:hover .label-body { opacity: 1; }");
  });

  it("shades bodies with gradients keyed to the initializer id", () => {
    const { svg } = inspectSolarSystem(define("deterministic", def));
    expect(svg).toContain(
      '<radialGradient id="inspect_solar_system_initializer_deterministic-star"'
    );
    expect(svg).toContain("url(#inspect_solar_system_initializer_deterministic-planet)");
  });
});

describe("SVG snapshots", () => {
  const systems: readonly (readonly [string, Omit<SolarSystemInitializerDef, "id">])[] = [
    [
      "sol_like",
      {
        class: "sc_g",
        planet: [
          { class: "star", name: "Sun", size: 30, orbitDistance: 0, orbitAngle: 0 },
          { class: "pc_molten", name: "Inner", size: 10, orbitDistance: 40, orbitAngle: 70 },
          {
            class: "pc_continental",
            name: "Home",
            size: 20,
            orbitDistance: 25,
            orbitAngle: 160,
            moon: [{ class: "pc_barren", name: "Luna", size: 4, orbitDistance: 10, orbitAngle: 0 }],
          },
          { class: "pc_gas_giant", name: "Giant", size: 32, orbitDistance: 55, orbitAngle: -100 },
        ],
      },
    ],
    [
      "uncertain",
      {
        class: "sc_g",
        planet: [
          { class: "star", size: 25, orbitDistance: 0, orbitAngle: 0 },
          { class: "random", orbitDistance: { min: 35, max: 55 }, orbitAngle: "random" },
          { class: "pc_barren", size: 12, orbitDistance: "@shift", orbitAngle: 0 },
          { class: "pc_desert", size: 14, count: { min: 2 }, orbitDistance: 30, orbitAngle: 90 },
        ],
      },
    ],
    [
      "belted",
      {
        class: "sc_g",
        asteroidBelt: [{ type: "rocky_asteroid_belt", radius: 80 }],
        orbitalLine: [{ orbitDistanceFromParent: 120 }],
        planet: [
          { class: "star", size: 28, orbitDistance: 0, orbitAngle: 0 },
          { class: "pc_asteroid", size: 3, orbitDistance: 80, orbitAngle: 0 },
          { class: "pc_asteroid", size: 4, orbitDistance: 0, orbitAngle: 130 },
          { class: "pc_continental", size: 18, orbitDistance: 2, orbitAngle: -120 },
        ],
      },
    ],
    [
      "binary_nested",
      {
        class: "sc_binary_1",
        planet: [
          { class: "star", name: "Primary", size: 30, orbitDistance: 0, orbitAngle: 0 },
          {
            class: "star",
            name: "Companion",
            size: 22,
            orbitDistance: 220,
            orbitAngle: 40,
            planet: [
              {
                class: "pc_tundra",
                size: 16,
                orbitDistance: 45,
                orbitAngle: -60,
                moon: [
                  {
                    class: "pc_barren",
                    size: 3,
                    orbitDistance: 9,
                    orbitAngle: 10,
                    moon: [{ class: "pc_asteroid", size: 1, orbitDistance: 3, orbitAngle: 0 }],
                  },
                ],
              },
            ],
          },
          { class: "pc_frozen", size: 14, orbitDistance: -100, orbitAngle: 200 },
        ],
      },
    ],
    [
      "overlap_showcase",
      {
        class: "sc_g",
        asteroidBelt: [{ type: "rocky_asteroid_belt", radius: 80 }],
        planet: [
          { class: "star", name: "Sun", size: 30, orbitDistance: 0, orbitAngle: 0 },
          { class: "pc_molten", name: "Inner", size: 10, orbitDistance: 40, orbitAngle: 70 },
          {
            class: "pc_continental",
            name: "Home",
            size: 20,
            orbitDistance: 25,
            orbitAngle: 160,
            moon: [{ class: "pc_barren", name: "Luna", size: 4, orbitDistance: 10, orbitAngle: 0 }],
          },
          { class: "pc_asteroid", size: 3, orbitDistance: 15, orbitAngle: 0 },
          { class: "pc_asteroid", size: 4, orbitDistance: 0, orbitAngle: 120 },
          { class: "pc_asteroid", size: 4, orbitDistance: 0, orbitAngle: 135 },
          { class: "pc_gas_giant", name: "Giant", size: 32, orbitDistance: 55, orbitAngle: -100 },
          { class: "pc_gas_giant", name: "Sky God", size: 25, orbitDistance: 5, orbitAngle: 5 },
        ],
      },
    ],
  ];

  it.each(systems.map(([name, def]) => ({ name, def })))(
    "renders $name deterministically",
    async ({ name, def }) => {
      const { svg } = inspectSolarSystem(define(name, def));
      await expect(svg).toMatchFileSnapshot(`__snapshots__/solar-system-inspect/${name}.svg`);
    }
  );
});

describe("sector distance bounds", () => {
  const STEPS = 24;

  function samples(min: number, max: number): number[] {
    if (min === max) {
      return [min];
    }
    const values: number[] = [];
    for (let i = 0; i <= STEPS; i += 1) {
      values.push(min + ((max - min) * i) / STEPS);
    }
    return values;
  }

  function angleSamples(span: AngleSpan): number[] {
    if (span.kind === "full") {
      return samples(0, 360).slice(0, -1);
    }
    if (span.kind === "fixed") {
      return [span.deg];
    }
    return samples(span.min, span.max);
  }

  function pointDistance(r1: number, r2: number, deg: number): number {
    const rad = (deg * Math.PI) / 180;
    return Math.hypot(r1 - r2 * Math.cos(rad), r2 * Math.sin(rad));
  }

  interface Case {
    title: string;
    r1: Interval;
    delta: Interval;
    angle: AngleSpan;
  }

  const cases: Case[] = [
    {
      title: "fixed geometry",
      r1: { min: 50, max: 50 },
      delta: { min: 10, max: 10 },
      angle: fixedAngle(30),
    },
    {
      title: "correlated ranged base with fixed advance",
      r1: { min: 40, max: 50 },
      delta: { min: 10, max: 10 },
      angle: fixedAngle(0),
    },
    {
      title: "advance range through zero",
      r1: { min: 30, max: 60 },
      delta: { min: -5, max: 5 },
      angle: angleRange(-20, 20),
    },
    {
      title: "wrap-around bearing arc",
      r1: { min: 20, max: 20 },
      delta: { min: 0, max: 0 },
      angle: angleRange(350, 370),
    },
    {
      title: "unknown bearing",
      r1: { min: 45, max: 55 },
      delta: { min: 3, max: 8 },
      angle: FULL_SPAN,
    },
    {
      title: "negative reach",
      r1: { min: -10, max: 20 },
      delta: { min: 5, max: 15 },
      angle: fixedAngle(90),
    },
    {
      title: "opposed signed radii coinciding at half turn",
      r1: { min: -10, max: -10 },
      delta: { min: 20, max: 20 },
      angle: angleRange(0, 180),
    },
  ];

  it.each(cases)("bounds match dense sampling for $title", ({ r1, delta, angle }) => {
    const bounds = correlatedDistance(r1, delta, angle);
    let sampledMin = Infinity;
    let sampledMax = 0;
    for (const base of samples(r1.min, r1.max)) {
      for (const advance of samples(delta.min, delta.max)) {
        for (const deg of angleSamples(angle)) {
          const distance = pointDistance(base, base + advance, deg);
          sampledMin = Math.min(sampledMin, distance);
          sampledMax = Math.max(sampledMax, distance);
        }
      }
    }
    expect(bounds.min).toBeLessThanOrEqual(sampledMin + 1e-9);
    expect(sampledMin - bounds.min).toBeLessThanOrEqual(2);
    if (r1.min >= 0 && r1.min + delta.min >= 0) {
      expect(bounds.max).toBeDefined();
      expect(bounds.max!).toBeGreaterThanOrEqual(sampledMax - 1e-9);
      expect(bounds.max! - sampledMax).toBeLessThanOrEqual(2);
    } else {
      expect(bounds.max).toBeUndefined();
    }
  });

  it.each([
    {
      title: "overlapping rings, apart bearings",
      r1: { min: 40, max: 50 },
      r2: { min: 45, max: 55 },
      angle: angleRange(90, 120),
    },
    {
      title: "disjoint rings, shared bearing",
      r1: { min: 10, max: 20 },
      r2: { min: 40, max: 45 },
      angle: fixedAngle(0),
    },
    { title: "free bearing", r1: { min: 30, max: 35 }, r2: { min: 30, max: 35 }, angle: FULL_SPAN },
  ])("independent bounds match dense sampling for $title", ({ r1, r2, angle }) => {
    const bounds = independentDistance(r1, r2, angle);
    let sampledMin = Infinity;
    let sampledMax = 0;
    for (const a of samples(r1.min, r1.max)) {
      for (const b of samples(r2.min, r2.max)) {
        for (const deg of angleSamples(angle)) {
          const distance = pointDistance(a, b, deg);
          sampledMin = Math.min(sampledMin, distance);
          sampledMax = Math.max(sampledMax, distance);
        }
      }
    }
    expect(bounds.min).toBeLessThanOrEqual(sampledMin + 1e-9);
    expect(sampledMin - bounds.min).toBeLessThanOrEqual(2);
    expect(bounds.max).toBeDefined();
    expect(bounds.max!).toBeGreaterThanOrEqual(sampledMax - 1e-9);
    expect(bounds.max! - sampledMax).toBeLessThanOrEqual(2);
  });
});
