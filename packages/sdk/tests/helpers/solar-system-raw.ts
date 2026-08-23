/**
 * Test-only adapter from installed `common/solar_system_initializers` files to
 * the generated field shapes, so the inspector can calibrate against every
 * shipped initializer. Geometry-relevant fields only.
 *
 * `change_orbit = X` is the game's shorthand for
 * `planet = { class = none orbit_distance = X }` (example.txt), and its
 * position among the sibling blocks is the geometry, so each occurrence is
 * rewritten to a `class: "none"` entry immediately before the next sibling
 * body block. A trailing `change_orbit` moves nothing visible and is dropped.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parse,
  tryNumberValue,
  type PdxContainer,
  type PdxItem,
  type PdxScalar,
  type PdxValue,
} from "@pdx-ts/pdxscript";

import type { MoonInitializerFields } from "../../src/generated/moon-initializer.ts";
import type { PlanetInitializerFields } from "../../src/generated/planet-initializer.ts";
import type {
  SolarSystemInitializerDef,
  SolarSystemInitializerFields,
} from "../../src/generated/solar-system-initializer.ts";

/** One shipped initializer with its source file. */
export interface VanillaInitializer {
  readonly file: string;
  readonly def: SolarSystemInitializerDef;
}

/** Reads every initializer from the install's solar_system_initializers files. */
export function readVanillaInitializers(installPath: string): VanillaInitializer[] {
  const dir = join(installPath, "common", "solar_system_initializers");
  const initializers: VanillaInitializer[] = [];
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .sort()) {
    const document = parse(readFileSync(join(dir, file), "utf8"), file);
    for (const item of document.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      initializers.push({ file, def: readSystem(item.key, item.value) });
    }
  }
  return initializers;
}

type Scalarish = number | string;
type Jump = Scalarish | { min: Scalarish; max: Scalarish };

function scalarValue(scalar: PdxScalar): Scalarish {
  switch (scalar.kind) {
    case "num":
      return tryNumberValue(scalar.lexeme) ?? scalar.lexeme;
    case "str":
      return scalar.value;
    case "var":
      return `@${scalar.name}`;
    case "math":
      return `@[${scalar.source}]`;
    case "bool":
      return scalar.value ? "yes" : "no";
  }
}

function scalarish(value: PdxValue): Scalarish | undefined {
  return value.kind === "container" ? undefined : scalarValue(value);
}

function rangeOrScalar(
  value: PdxValue
): Scalarish | { min: Scalarish; max: Scalarish } | undefined {
  if (value.kind !== "container") {
    return scalarValue(value);
  }
  let min: Scalarish | undefined;
  let max: Scalarish | undefined;
  for (const item of value.items) {
    if (item.kind !== "entry" || item.value.kind === "container") {
      continue;
    }
    if (item.key === "min") {
      min = scalarValue(item.value);
    }
    if (item.key === "max") {
      max = scalarValue(item.value);
    }
  }
  if (min === undefined || max === undefined) {
    return undefined;
  }
  return { min, max };
}

function entries(container: PdxContainer): readonly { key: string; value: PdxValue }[] {
  const result: { key: string; value: PdxValue }[] = [];
  for (const item of container.items as readonly PdxItem[]) {
    if (item.kind === "entry") {
      result.push({ key: item.key, value: item.value });
    }
  }
  return result;
}

function readSystem(id: string, container: PdxContainer): SolarSystemInitializerDef {
  const def: SolarSystemInitializerFields & { id: string } = { id, class: "" };
  const planets: PlanetInitializerFields[] = [];
  const pendingOrbits: Jump[] = [];

  for (const { key, value } of entries(container)) {
    switch (key) {
      case "name":
        def.name = String(scalarish(value) ?? "");
        break;
      case "class":
        def.class = String(scalarish(value) ?? "");
        break;
      case "orbit_distance":
        def.orbitDistance = rangeOrScalar(value) as SolarSystemInitializerFields["orbitDistance"];
        break;
      case "asteroid_belt": {
        if (value.kind !== "container") {
          break;
        }
        let type = "";
        let radius: number | { min: number; max: number } | undefined;
        for (const belt of entries(value)) {
          if (belt.key === "type") {
            type = String(scalarish(belt.value) ?? "");
          }
          if (belt.key === "radius") {
            radius = rangeOrScalar(belt.value) as typeof radius;
          }
        }
        if (radius !== undefined) {
          (def.asteroidBelt ??= []).push({ type, radius });
        }
        break;
      }
      case "orbital_line": {
        const line =
          value.kind === "container" ? scalarEntry(value, "orbit_distance_from_parent") : undefined;
        if (typeof line === "number") {
          (def.orbitalLine ??= []).push({ orbitDistanceFromParent: line });
        }
        break;
      }
      case "change_orbit": {
        const jump = rangeOrScalar(value);
        if (jump !== undefined) {
          pendingOrbits.push(jump);
        }
        break;
      }
      case "planet": {
        if (value.kind !== "container") {
          break;
        }
        flushPending(pendingOrbits, planets);
        planets.push(readBody(value));
        break;
      }
      default:
        break;
    }
  }
  if (planets.length > 0) {
    def.planet = planets;
  }
  return def;
}

function readBody(container: PdxContainer): PlanetInitializerFields {
  const body: PlanetInitializerFields = {};
  const planets: PlanetInitializerFields[] = [];
  const moons: MoonInitializerFields[] = [];
  const pendingOrbits: Jump[] = [];

  for (const { key, value } of entries(container)) {
    switch (key) {
      case "name":
        body.name = String(scalarish(value) ?? "");
        break;
      case "class":
        body.class = String(scalarish(value) ?? "");
        break;
      case "entity":
        body.entity = String(scalarish(value) ?? "");
        break;
      case "count":
        body.count = countValue(value) as PlanetInitializerFields["count"];
        break;
      case "orbit_distance":
        body.orbitDistance = rangeOrScalar(value) as PlanetInitializerFields["orbitDistance"];
        break;
      case "orbit_angle":
        body.orbitAngle = rangeOrScalar(value) as PlanetInitializerFields["orbitAngle"];
        break;
      case "size":
        body.size = rangeOrScalar(value) as PlanetInitializerFields["size"];
        break;
      case "has_ring":
        body.hasRing = scalarish(value) === "yes";
        break;
      case "orbital_line": {
        const line =
          value.kind === "container" ? scalarEntry(value, "orbit_distance_from_parent") : undefined;
        if (typeof line === "number") {
          (body.orbitalLine ??= []).push({ orbitDistanceFromParent: line });
        }
        break;
      }
      case "change_orbit": {
        const jump = rangeOrScalar(value);
        if (jump !== undefined) {
          pendingOrbits.push(jump);
        }
        break;
      }
      case "planet": {
        if (value.kind !== "container") {
          break;
        }
        flushPending(pendingOrbits, planets);
        planets.push(readBody(value));
        break;
      }
      case "moon": {
        if (value.kind !== "container") {
          break;
        }
        flushPending(pendingOrbits, moons);
        moons.push(readBody(value) as MoonInitializerFields);
        break;
      }
      default:
        break;
    }
  }
  if (planets.length > 0) {
    body.planet = planets;
  }
  if (moons.length > 0) {
    body.moon = moons;
  }
  return body;
}

function flushPending(
  pendingOrbits: Jump[],
  list: PlanetInitializerFields[] | MoonInitializerFields[]
): void {
  for (const jump of pendingOrbits.splice(0)) {
    (list as PlanetInitializerFields[]).push({
      class: "none",
      orbitDistance: jump as PlanetInitializerFields["orbitDistance"],
    });
  }
}

// The generated count block allows either bound to be omitted, and vanilla
// ships min-only counts, so this keeps one-sided blocks intact.
function countValue(value: PdxValue): number | { min?: number; max?: number } | undefined {
  if (value.kind !== "container") {
    const scalar = scalarValue(value);
    return typeof scalar === "number" ? scalar : undefined;
  }
  const range: { min?: number; max?: number } = {};
  for (const entry of entries(value)) {
    const scalar = scalarish(entry.value);
    if (typeof scalar !== "number") {
      continue;
    }
    if (entry.key === "min") {
      range.min = scalar;
    }
    if (entry.key === "max") {
      range.max = scalar;
    }
  }
  return range.min !== undefined || range.max !== undefined ? range : undefined;
}

function scalarEntry(container: PdxContainer, key: string): Scalarish | undefined {
  for (const entry of entries(container)) {
    if (entry.key === key) {
      return scalarish(entry.value);
    }
  }
  return undefined;
}
