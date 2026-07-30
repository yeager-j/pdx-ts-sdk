/**
 * The fixture's state model — the probe's answer to the handoff's open
 * question 1. Only countries and planets exist, because nothing the
 * whitelisted semantics touch needs more; ownership is expressed by nesting
 * in the spec and by index in the state. Everything is plain data (sets,
 * maps, arrays) so `run()` can clone the world cheaply.
 *
 * The handles (`Country`, `Planet`) are the public face of the fixture and
 * double as scope witnesses: they are branded by scope name, so passing a
 * planet handle where a country-scoped trigger is evaluated is a compile
 * error via `Trigger`'s contravariant scope parameter.
 */

import { refId, type TypedRef } from "../../src/generated/refs.ts";
import type { CountryFlag, GlobalFlag, PlanetFlag } from "../../src/generated/value-sets.ts";

/** The scopes the fixture models. The interpreter refuses everything else. */
export type SimScopeName = "country" | "planet";

export interface PlanetSpec {
  /** For messages and the fired log; defaults to `planet<n>`. */
  readonly name?: string;
  readonly flags?: readonly PlanetFlag[];
  readonly deposits?: readonly string[];
}

export interface CountrySpec {
  /** For messages and the fired log; defaults to `country<n>`. */
  readonly name?: string;
  readonly flags?: readonly CountryFlag[];
  readonly technologies?: ReadonlyArray<TypedRef<"technology"> | string>;
  readonly resources?: Readonly<Record<string, number>>;
  /** Ownership is nesting: these planets belong to this country. */
  readonly planets?: readonly PlanetSpec[];
}

export interface FixtureSpec {
  readonly countries?: readonly CountrySpec[];
  readonly globalFlags?: readonly GlobalFlag[];
}

export type EntityId =
  | { readonly kind: "country"; readonly country: number }
  | { readonly kind: "planet"; readonly country: number; readonly planet: number };

export interface CountryState {
  name: string;
  readonly flags: Set<string>;
  readonly technologies: Set<string>;
  readonly resources: Map<string, number>;
}

export interface PlanetState {
  name: string;
  readonly flags: Set<string>;
  readonly deposits: string[];
}

export interface PendingFire {
  readonly id: string;
  readonly dueDay: number;
  readonly scope: EntityId;
  readonly from: EntityId | undefined;
  /** Enqueue order; ties on dueDay deliver first-queued-first. */
  readonly seq: number;
}

export interface FiredRecord {
  readonly id: string;
  /** Delivery day (for harness fires: the current day). */
  readonly day: number;
  readonly scope: EntityId;
  readonly from: EntityId | undefined;
  readonly via: "harness" | "effect";
  /** Rendered at delivery time so the log needs no state to print. */
  readonly scopeLabel: string;
  readonly fromLabel: string | undefined;
}

export interface WorldState {
  day: number;
  seq: number;
  readonly globalFlags: Set<string>;
  readonly countries: CountryState[];
  /** `planets[c][p]` is planet p of country c — the ownership relation. */
  readonly planets: PlanetState[][];
  /** Saved event targets. World-lifetime in this probe. */
  readonly targets: Map<string, EntityId>;
  readonly queue: PendingFire[];
  readonly fired: FiredRecord[];
  readonly log: string[];
}

export function buildState(spec: FixtureSpec): WorldState {
  const countries: CountryState[] = [];
  const planets: PlanetState[][] = [];
  (spec.countries ?? []).forEach((countrySpec, c) => {
    countries.push({
      name: countrySpec.name ?? `country${c}`,
      flags: new Set(countrySpec.flags ?? []),
      technologies: new Set((countrySpec.technologies ?? []).map((t) => String(refId(t)))),
      resources: new Map(Object.entries(countrySpec.resources ?? {})),
    });
    planets.push(
      (countrySpec.planets ?? []).map((planetSpec, p) => ({
        name: planetSpec.name ?? `planet${p}`,
        flags: new Set(planetSpec.flags ?? []),
        deposits: [...(planetSpec.deposits ?? [])],
      }))
    );
  });
  return {
    day: 0,
    seq: 0,
    globalFlags: new Set(spec.globalFlags ?? []),
    countries,
    planets,
    targets: new Map(),
    queue: [],
    fired: [],
    log: [],
  };
}

export function cloneState(state: WorldState): WorldState {
  return {
    day: state.day,
    seq: state.seq,
    globalFlags: new Set(state.globalFlags),
    countries: state.countries.map((country) => ({
      name: country.name,
      flags: new Set(country.flags),
      technologies: new Set(country.technologies),
      resources: new Map(country.resources),
    })),
    planets: state.planets.map((row) =>
      row.map((planet) => ({
        name: planet.name,
        flags: new Set(planet.flags),
        deposits: [...planet.deposits],
      }))
    ),
    targets: new Map(state.targets),
    queue: [...state.queue],
    fired: [...state.fired],
    log: [...state.log],
  };
}

export function countryState(state: WorldState, id: EntityId): CountryState {
  if (id.kind !== "country") {
    throw new Error(`Expected a country scope, got ${describeEntity(state, id)}`);
  }
  const country = state.countries[id.country];
  if (country === undefined) {
    throw new Error(`No country at index ${id.country}`);
  }
  return country;
}

export function planetState(state: WorldState, id: EntityId): PlanetState {
  if (id.kind !== "planet") {
    throw new Error(`Expected a planet scope, got ${describeEntity(state, id)}`);
  }
  const planet = state.planets[id.country]?.[id.planet];
  if (planet === undefined) {
    throw new Error(`No planet at index ${id.country}.${id.planet}`);
  }
  return planet;
}

/** `country "player"` — for explain details and error messages. */
export function describeEntity(state: WorldState, id: EntityId): string {
  if (id.kind === "country") {
    return `country "${state.countries[id.country]?.name ?? id.country}"`;
  }
  return `planet "${state.planets[id.country]?.[id.planet]?.name ?? `${id.country}.${id.planet}`}"`;
}

/** `country(0) "player"` / `planet(0.1) "beta"` — for the fired log. */
export function renderEntity(state: WorldState, id: EntityId): string {
  if (id.kind === "country") {
    return `country(${id.country}) "${state.countries[id.country]?.name ?? "?"}"`;
  }
  return `planet(${id.country}.${id.planet}) "${state.planets[id.country]?.[id.planet]?.name ?? "?"}"`;
}

export function sameEntity(a: EntityId | undefined, b: EntityId | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.kind === "country" && b.kind === "country") {
    return a.country === b.country;
  }
  if (a.kind === "planet" && b.kind === "planet") {
    return a.country === b.country && a.planet === b.planet;
  }
  return false;
}

/**
 * A fixture entity handle usable as a scope witness. `Trigger<S>` is
 * contravariant in S, so `evaluate(hasCountryFlag(...), somePlanet)` fails to
 * compile — the scope-safety pillar extended to tests.
 */
export interface SimScope<S extends SimScopeName> {
  readonly simScope: S;
  readonly id: EntityId;
  readonly state: WorldState;
}

export class Country implements SimScope<"country"> {
  readonly simScope: "country" = "country";
  readonly id: EntityId;
  readonly state: WorldState;
  private readonly index: number;

  constructor(state: WorldState, index: number) {
    this.state = state;
    this.index = index;
    this.id = { kind: "country", country: index };
  }

  get name(): string {
    return countryState(this.state, this.id).name;
  }

  hasFlag(flag: CountryFlag): boolean {
    return countryState(this.state, this.id).flags.has(flag);
  }

  /** Object-taking assertion surface: `player.has(someTech)`. */
  has(tech: TypedRef<"technology"> | string): boolean {
    return countryState(this.state, this.id).technologies.has(String(refId(tech)));
  }

  /** Missing stockpiles read 0 — that is the game's own behavior. */
  resource(name: string): number {
    return countryState(this.state, this.id).resources.get(name) ?? 0;
  }

  planet(index: number): Planet {
    planetState(this.state, { kind: "planet", country: this.index, planet: index });
    return new Planet(this.state, this.index, index);
  }

  get planets(): readonly Planet[] {
    return (this.state.planets[this.index] ?? []).map(
      (_planet, p) => new Planet(this.state, this.index, p)
    );
  }
}

export class Planet implements SimScope<"planet"> {
  readonly simScope: "planet" = "planet";
  readonly id: EntityId;
  readonly state: WorldState;

  constructor(state: WorldState, country: number, planet: number) {
    this.state = state;
    this.id = { kind: "planet", country, planet };
  }

  get name(): string {
    return planetState(this.state, this.id).name;
  }

  get owner(): Country {
    if (this.id.kind !== "planet") {
      throw new Error("unreachable");
    }
    return new Country(this.state, this.id.country);
  }

  hasFlag(flag: PlanetFlag): boolean {
    return planetState(this.state, this.id).flags.has(flag);
  }

  get deposits(): readonly string[] {
    return planetState(this.state, this.id).deposits;
  }
}

export type HandleOf<S extends SimScopeName> = S extends "country" ? Country : Planet;
