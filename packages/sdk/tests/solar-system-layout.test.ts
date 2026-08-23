import { describe, expect, it } from "vitest";

import { absoluteOrbits, asteroidBelt, createMod, render } from "../src/index.ts";

describe("absoluteOrbits", () => {
  it("lowers an absolute planet tree to the reviewed initializer PDXScript", () => {
    const mod = createMod({
      name: "Absolute orbits",
      prefix: "absolute",
      supportedVersion: "4.4.*",
    });
    const system = mod.solarSystemInitializer("layout", {
      class: "sc_g",
      planet: absoluteOrbits([
        { class: "star", radius: 0, angle: 0, size: 20 },
        {
          class: "pc_continental",
          radius: 60,
          angle: 90,
          moon: [{ class: "pc_barren", radius: 8, angle: 180, size: 4 }],
        },
      ]),
    });

    const rendered = render(mod.compile([mod.feature(undefined, [system])])).get(
      "common/solar_system_initializers/absolute_solar_system_initializers.txt"
    );

    expect(rendered).toBe(`absolute_solar_system_initializer_layout = {
	class = sc_g
	planet = {
		class = star
		orbit_distance = 0
		orbit_angle = 0
		size = 20
	}
	planet = {
		class = pc_continental
		orbit_distance = 60
		orbit_angle = 90
		moon = {
			class = pc_barren
			orbit_distance = 8
			orbit_angle = 180
			size = 4
		}
	}
}
`);
  });

  it("resets cursors for each nested planet and moon list", () => {
    const lowered = absoluteOrbits([
      { class: "star", radius: 0, angle: 0 },
      {
        class: "pc_continental",
        radius: 100,
        angle: 350,
        planet: [
          { class: "star", radius: 4, angle: 10 },
          { class: "pc_barren", radius: 10, angle: 350 },
        ],
        moon: [
          {
            class: "pc_moon",
            radius: 3,
            angle: 10,
            moon: [{ class: "pc_moon", radius: 1, angle: 0 }],
          },
          { class: "pc_moon", radius: 7, angle: 350 },
        ],
      },
    ]);

    expect(lowered[1]).toMatchObject({ orbitDistance: 100, orbitAngle: -10 });
    expect(lowered[1]?.planet).toMatchObject([
      { orbitDistance: 4, orbitAngle: 10 },
      { orbitDistance: 6, orbitAngle: -20 },
    ]);
    expect(lowered[1]?.moon).toMatchObject([
      { orbitDistance: 3, orbitAngle: 10, moon: [{ orbitDistance: 1, orbitAngle: 0 }] },
      { orbitDistance: 4, orbitAngle: -20 },
    ]);
  });

  it("uses signed shortest angle deltas across the wrap boundary", () => {
    expect(
      absoluteOrbits([
        { radius: 0, angle: 350 },
        { radius: 0, angle: 10 },
      ]).map((orbit) => orbit.orbitAngle)
    ).toEqual([-10, 20]);
    expect(
      absoluteOrbits([
        { radius: 0, angle: 10 },
        { radius: 0, angle: 350 },
      ]).map((orbit) => orbit.orbitAngle)
    ).toEqual([10, -20]);
    expect(absoluteOrbits([{ radius: 0, angle: 180 }])[0]?.orbitAngle).toBe(180);
  });

  it("preserves ordinary fields without mutating its input", () => {
    const input = [
      {
        name: "NAME_Absolute",
        class: "pc_continental",
        size: 20,
        hasRing: true,
        radius: 40,
        angle: 30,
        moon: [{ class: "pc_moon", radius: 4, angle: 180, size: 3 }],
      },
    ] as const;
    const before = structuredClone(input);

    const lowered = absoluteOrbits(input);

    expect(input).toEqual(before);
    expect(lowered[0]).toMatchObject({
      name: "NAME_Absolute",
      class: "pc_continental",
      size: 20,
      hasRing: true,
      orbitDistance: 40,
      orbitAngle: 30,
    });
    expect(lowered[0]).not.toBe(input[0]);
  });

  it.each([
    {
      input: [{ radius: -1, angle: 0 }],
      path: "planet[0].radius",
    },
    {
      input: [
        { radius: 2, angle: 0 },
        { radius: 1, angle: 0 },
      ],
      path: "planet[1].radius",
    },
    {
      input: [{ radius: 0, angle: Number.NaN }],
      path: "planet[0].angle",
    },
    {
      input: [{ radius: Number.POSITIVE_INFINITY, angle: 0 }],
      path: "planet[0].radius",
    },
    {
      input: [
        {
          radius: 0,
          angle: 0,
          moon: [
            { radius: 2, angle: 0 },
            { radius: 1, angle: 0 },
          ],
        },
      ],
      path: "planet[0].moon[1].radius",
    },
  ])("rejects invalid orbit coordinates at $path", ({ input, path }) => {
    expect(() => absoluteOrbits(input)).toThrow(RangeError);
    expect(() => absoluteOrbits(input)).toThrow(path);
  });
});

describe("asteroidBelt", () => {
  it("links a belt and asteroid inputs at one radius without inferring a class", () => {
    const layout = asteroidBelt({
      type: "rocky_asteroid_belt",
      radius: 80,
      asteroids: [
        { angle: 0, size: 3 },
        { angle: 120, size: 4 },
      ],
    });

    expect(layout.belt).toEqual({ type: "rocky_asteroid_belt", radius: 80 });
    expect(layout.orbits).toEqual([
      { angle: 0, size: 3, radius: 80 },
      { angle: 120, size: 4, radius: 80 },
    ]);
    expect(layout.orbits[0]?.class).toBeUndefined();
    expect(absoluteOrbits(layout.orbits)).toMatchObject([
      { orbitDistance: 80, orbitAngle: 0 },
      { orbitDistance: 0, orbitAngle: 120 },
    ]);
  });

  it("allows an empty belt and rejects invalid shared coordinates", () => {
    expect(asteroidBelt({ type: "rocky_asteroid_belt", radius: 0, asteroids: [] })).toEqual({
      belt: { type: "rocky_asteroid_belt", radius: 0 },
      orbits: [],
    });
    expect(() => asteroidBelt({ type: "rocky_asteroid_belt", radius: -1, asteroids: [] })).toThrow(
      "asteroidBelt.radius"
    );
    expect(() =>
      asteroidBelt({
        type: "rocky_asteroid_belt",
        radius: 1,
        asteroids: [{ angle: Number.POSITIVE_INFINITY }],
      })
    ).toThrow("asteroidBelt.asteroids[0].angle");
  });

  it("leaves surrounding radius ordering to absoluteOrbits composition", () => {
    const belt = asteroidBelt({
      type: "rocky_asteroid_belt",
      radius: 20,
      asteroids: [{ angle: 0 }],
    });

    expect(() => absoluteOrbits([{ radius: 30, angle: 0 }, ...belt.orbits])).toThrow(
      "planet[1].radius"
    );
  });
});
