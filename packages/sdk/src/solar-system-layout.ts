import type { MoonInitializerFields } from "./generated/moon-initializer.ts";
import type { PlanetInitializerFields } from "./generated/planet-initializer.ts";
import type { SolarSystemInitializerAsteroidBelt } from "./generated/solar-system-initializer.ts";

/**
 * A planet initializer expressed with absolute orbit-cursor coordinates.
 * `radius` is nonnegative and ordered among siblings; `angle` is measured in degrees.
 */
export type AbsolutePlanetOrbit = Omit<
  PlanetInitializerFields,
  "orbitDistance" | "orbitAngle" | "planet" | "moon"
> & {
  /** Absolute orbit-cursor radius. Must be finite, nonnegative, and ordered among siblings. */
  radius: number;
  /** Absolute bearing in degrees. Must be finite. */
  angle: number;
  /** Planet children expressed with their own absolute orbit cursor. */
  planet?: readonly AbsolutePlanetOrbit[];
  /** Moon children expressed with their own absolute orbit cursor. */
  moon?: readonly AbsoluteMoonOrbit[];
};

/**
 * A moon initializer expressed with absolute orbit-cursor coordinates.
 * Moons may contain moons, but never planet children.
 */
export type AbsoluteMoonOrbit = Omit<
  MoonInitializerFields,
  "orbitDistance" | "orbitAngle" | "moon"
> & {
  /** Absolute orbit-cursor radius. Must be finite, nonnegative, and ordered among siblings. */
  radius: number;
  /** Absolute bearing in degrees. Must be finite. */
  angle: number;
  /** Moon children expressed with their own absolute orbit cursor. */
  moon?: readonly AbsoluteMoonOrbit[];
};

/** An asteroid belt and the absolute planet inputs placed at its radius. */
export interface AsteroidBelt {
  /** The generated belt value for `SolarSystemInitializerFields.asteroidBelt`. */
  belt: SolarSystemInitializerAsteroidBelt;
  /** Mutable absolute planet inputs to include in the surrounding `absoluteOrbits` call. */
  orbits: AbsolutePlanetOrbit[];
}

/** Input for {@link asteroidBelt}. */
export interface AsteroidBeltInput {
  /** The asteroid-belt type emitted in the generated belt value. */
  type: SolarSystemInitializerAsteroidBelt["type"];
  /** Shared absolute orbit-cursor radius. Must be finite and nonnegative. */
  radius: number;
  /** Asteroid planet inputs that share `radius`; their angles must be finite. */
  asteroids: readonly Omit<AbsolutePlanetOrbit, "radius">[];
}

/**
 * Lowers absolute orbit-cursor coordinates to Stellaris's relative initializer fields.
 *
 * Each sibling list starts at radius and angle zero. Radii must be finite,
 * nonnegative, and nondecreasing. Angles are lowered to `(-180, 180]`: an
 * exact 180-degree difference becomes `+180`. `radius` is the initializer
 * orbit cursor, not a rendered center-to-center distance. Throws `RangeError`
 * for invalid coordinates and does not mutate `orbits`.
 */
export function absoluteOrbits(orbits: readonly AbsolutePlanetOrbit[]): PlanetInitializerFields[] {
  return lowerPlanets(orbits, "planet");
}

/**
 * Creates an asteroid belt and asteroid planet inputs that share one absolute radius.
 *
 * Pass the returned `orbits` into {@link absoluteOrbits} with the surrounding
 * planets so their shared radius is checked in that complete sibling list.
 * Throws `RangeError` for an invalid radius or asteroid angle and does not
 * mutate `asteroids`.
 */
export function asteroidBelt({ type, radius, asteroids }: AsteroidBeltInput): AsteroidBelt {
  assertRadius(radius, "asteroidBelt");
  const orbits = asteroids.map((asteroid, index) => {
    assertAngle(asteroid.angle, `asteroidBelt.asteroids[${index}]`);
    return { ...asteroid, radius };
  });

  return { belt: { type, radius }, orbits };
}

function lowerPlanets(
  orbits: readonly AbsolutePlanetOrbit[],
  listPath: string
): PlanetInitializerFields[] {
  const cursor = { radius: 0, angle: 0 };

  return orbits.map((orbit, index) => {
    const path = `${listPath}[${index}]`;
    const { orbitDistance, orbitAngle } = lowerCoordinates(orbit.radius, orbit.angle, cursor, path);

    const { radius: _radius, angle: _angle, planet, moon, ...fields } = orbit;
    const lowered: PlanetInitializerFields = { ...fields, orbitDistance, orbitAngle };
    if (planet !== undefined) {
      lowered.planet = lowerPlanets(planet, `${path}.planet`);
    }
    if (moon !== undefined) {
      lowered.moon = lowerMoons(moon, `${path}.moon`);
    }
    return lowered;
  });
}

function lowerMoons(
  orbits: readonly AbsoluteMoonOrbit[],
  listPath: string
): MoonInitializerFields[] {
  const cursor = { radius: 0, angle: 0 };

  return orbits.map((orbit, index) => {
    const path = `${listPath}[${index}]`;
    const { orbitDistance, orbitAngle } = lowerCoordinates(orbit.radius, orbit.angle, cursor, path);

    const { radius: _radius, angle: _angle, moon, ...fields } = orbit;
    const lowered: MoonInitializerFields = { ...fields, orbitDistance, orbitAngle };
    if (moon !== undefined) {
      lowered.moon = lowerMoons(moon, `${path}.moon`);
    }
    return lowered;
  });
}

function lowerCoordinates(
  radius: number,
  angle: number,
  cursor: { radius: number; angle: number },
  path: string
): { orbitDistance: number; orbitAngle: number } {
  assertRadius(radius, path);
  assertNondecreasingRadius(radius, cursor.radius, path);
  assertAngle(angle, path);

  const orbitDistance = radius - cursor.radius;
  const orbitAngle = normalizeAngle(angle - cursor.angle);
  cursor.radius = radius;
  cursor.angle = angle;
  return { orbitDistance, orbitAngle };
}

function assertRadius(radius: number, path: string): void {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError(`${path}.radius must be a finite nonnegative number`);
  }
}

function assertNondecreasingRadius(radius: number, previousRadius: number, path: string): void {
  if (radius < previousRadius) {
    throw new RangeError(`${path}.radius must not be less than the previous sibling radius`);
  }
}

function assertAngle(angle: number, path: string): void {
  if (!Number.isFinite(angle)) {
    throw new RangeError(`${path}.angle must be a finite number`);
  }
}

function normalizeAngle(angle: number): number {
  const normalized = ((((angle + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}
