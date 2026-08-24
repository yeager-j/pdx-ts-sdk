import { describe, expectTypeOf, it } from "vitest";

import {
  absoluteOrbits,
  asteroidBelt,
  type AbsoluteMoonOrbit,
  type AbsolutePlanetOrbit,
  type PlanetInitializerFields,
} from "../src/stellaris.ts";

describe("solar-system layout public types", () => {
  it("accepts readonly absolute trees and returns generated planet fields", () => {
    const moons: readonly AbsoluteMoonOrbit[] = [{ radius: 2, angle: 45 }];
    const planets: readonly AbsolutePlanetOrbit[] = [
      { radius: 0, angle: 0, moon: moons },
      { radius: 10, angle: 90, planet: [{ radius: 1, angle: 0 }] },
    ];

    expectTypeOf(absoluteOrbits(planets)).toEqualTypeOf<PlanetInitializerFields[]>();
  });

  it("does not widen moon children to planets", () => {
    const moon: AbsoluteMoonOrbit = {
      radius: 2,
      angle: 0,
      // @ts-expect-error — only planets can have planet children.
      planet: [],
    };
    void moon;
  });

  it("does not accept repeated absolute orbit templates", () => {
    const orbit: AbsolutePlanetOrbit = {
      radius: 10,
      angle: 0,
      // @ts-expect-error — one absolute coordinate cannot describe repeated copies.
      count: 2,
    };
    void orbit;
  });

  it("returns generated belt data and mutable absolute planet inputs", () => {
    const layout = asteroidBelt({
      type: "rocky_asteroid_belt",
      radius: 20,
      asteroids: [{ angle: 0 }],
    });

    expectTypeOf(layout.belt.radius).toEqualTypeOf<number | { min: number; max: number }>();
    expectTypeOf(layout.orbits).toEqualTypeOf<AbsolutePlanetOrbit[]>();
  });
});
