/**
 * The fixture's state model — the validated answer to the handoff's open
 * question 1. Countries, planets, fleets, situations and archaeological
 * sites exist because the whitelisted semantics touch them; ownership is
 * expressed by nesting in the spec and by index in the state where the game
 * models ownership (country -> planet), and by an explicit link where the
 * game models a link instead (situation -> its declared target). Everything
 * is plain data (sets, maps, arrays) so `run()` can clone the world cheaply.
 *
 * The handles (`Country`, `Planet`, `Fleet`, `Situation`,
 * `ArchaeologicalSite`) are the public face of the fixture and double as
 * scope witnesses: they are branded by scope name, so passing a planet
 * handle where a country-scoped trigger is evaluated is a compile error via
 * `Trigger`'s contravariant scope parameter.
 */

import {
  refId,
  type CountryFlag,
  type GlobalFlag,
  type PlanetFlag,
  type TypedRef,
} from "@pdx-ts/sdk";

/**
 * The scopes the fixture models. The interpreter refuses everything else.
 *
 * This is a small, deliberately curated slice of the roughly 40 scopes the
 * generated `ScopeName` union carries (`packages/sdk/src/generated/scopes.ts`
 * has 41 members as of this writing) — only what somebody actually built
 * real state and real transitions for. `SIM_SCOPE_NAMES` below is the single
 * source of truth this type is derived from, so a diagnostic can always list
 * exactly what is modeled rather than repeating the list by hand.
 *
 * Widening this is SDK-49's first half: add a scope only once its state and
 * legal transitions are modeled, on the terms `packages/sdk-testing/CONTEXT.md`
 * sets out for this context — a scope that is present but wrong is worse than
 * one that is absent.
 */
export type SimScopeName = (typeof SIM_SCOPE_NAMES)[number];

export const SIM_SCOPE_NAMES = [
  "country",
  "planet",
  "fleet",
  "situation",
  "archaeological_site",
] as const;

/**
 * The generated `ScopeName` union's approximate size, for the diagnostic
 * below — see the comment on {@link SimScopeName}. Update if `scopes.ts`
 * drifts meaningfully; it is descriptive, not a correctness-critical count.
 */
const TOTAL_STELLARIS_SCOPE_COUNT = 41;

/**
 * The message behind SDK-49's second half: a scope outside {@link
 * SimScopeName} used to surface only as a bare TypeScript assignability
 * failure ("Type '\"leader\"' is not assignable to type 'SimScopeName'") —
 * it names the type but never says how many scopes that type covers or what
 * to do next, so a developer cannot tell an unsupported scope from a typo.
 * This is the shared wording behind every runtime guard that catches a scope
 * name outside the union (`fixture`/`World.fire` registration, events built
 * dynamically rather than through the typed definers) so the answer is
 * always the same one, worded in one place.
 */
export function describeUnsupportedSimScope(scope: string): string {
  return (
    `The testing harness models ${SIM_SCOPE_NAMES.length} of Stellaris's ` +
    `~${TOTAL_STELLARIS_SCOPE_COUNT} scopes today: ${SIM_SCOPE_NAMES.join(", ")}. "${scope}" is ` +
    `not one of them. If it genuinely needs modeling, widen SimScopeName in ` +
    `packages/sdk-testing/src/state.ts with real state and real transitions — never a guess; ` +
    `packages/sdk-testing/CONTEXT.md states the bar. If this was a typo, check the scope name ` +
    `against the SDK's generated ScopeName union.`
  );
}

/**
 * Throws {@link describeUnsupportedSimScope}'s message, prefixed with where
 * the bad scope was found, unless `scope` is one of {@link SIM_SCOPE_NAMES}.
 * The static types already forbid this everywhere a scope flows through
 * `SimScope<S>`; this is the runtime backstop for the paths that build or
 * register events from data rather than through the typed definers.
 */
export function assertSupportedSimScope(scope: string, where: string): void {
  if ((SIM_SCOPE_NAMES as readonly string[]).includes(scope)) {
    return;
  }
  throw new Error(`${where}: ${describeUnsupportedSimScope(scope)}`);
}

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
  /**
   * Storage capacity per resource — what the country can actually hold.
   * `add_resource` is bounded by it, because the game's own resource
   * definitions call `max` the resource's maximum storage capacity, and a test
   * that asserts a stockpile past that bound is green for a reward no
   * unmodified game ever held. Where the excess goes is not modeled.
   *
   * Declared rather than defaulted, and per resource: capacity is a base plus
   * techs, buildings, modifiers and whatever the mod itself changes, so there
   * is no number this harness could invent that would be true of a real
   * playthrough. An undeclared resource is uncapped — the gap is disclosed
   * (see `add_resource`'s whitelist note) rather than guessed at.
   */
  readonly storage?: Readonly<Record<string, number>>;
  /** Ownership is nesting: these planets belong to this country. */
  readonly planets?: readonly PlanetSpec[];
}

/**
 * A fleet the fixture models. Fleets are not owned by nesting — nothing
 * whitelisted here needs a fleet's owner — so a fleet is just enough
 * identity to be a scope: a fire target and a `from:` witness for the
 * archaeological-site excavation events that run in fleet scope.
 */
export interface FleetSpec {
  /** For messages and the fired log; defaults to `fleet<n>`. */
  readonly name?: string;
}

/**
 * An archaeological site the fixture models: identity plus the one piece of
 * mutable state the whitelisted effect (`set_site_progress_locked`) touches.
 * Not owned by nesting for the same reason a fleet is not — a site is
 * reached as a fleet event's FROM, never navigated to from a country or
 * planet in the semantics this harness implements.
 */
export interface ArchaeologicalSiteSpec {
  /** For messages and the fired log; defaults to `site<n>`. */
  readonly name?: string;
  readonly progressLocked?: boolean;
}

/**
 * A situation the fixture models. Unlike a planet's ownership-by-nesting, a
 * situation's relationship to its target is a link (`target = { ... }`), not
 * ownership — `links.cwt` gives it `output_scope = any` and the SDK's own
 * `defineSituationType({ targetScope })` treats it the same way (see
 * `packages/sdk/src/script/effects/situations.ts`). The fixture only models country
 * targets today (`targetCountry` indexes `FixtureSpec.countries`), matching
 * every situation this harness's probes needed; a situation targeting
 * anything else would need that scope modeled first.
 */
export interface SituationSpec {
  /** For messages and the fired log; defaults to `situation<n>`. */
  readonly name?: string;
  /** Index into `FixtureSpec.countries` — the situation's declared target. */
  readonly targetCountry: number;
  readonly initialProgress?: number;
  /** The id of the currently-picked approach, if any. */
  readonly approach?: string;
  readonly variables?: Readonly<Record<string, number>>;
  /**
   * Says this situation's progress standing still is fine for the chain under
   * test, which lets `advance` cross a month boundary while it exists.
   *
   * The harness ticks no situation clock at all (see `World`'s
   * `assertSituationClock`), so without this an advance across a month is
   * refused rather than silently freezing a mechanic that is monthly by
   * definition. Declared rather than defaulted, and per situation, for the
   * same reason `CountrySpec.storage` is: the harness has no honest number to
   * invent, and the author does know whether the test's assertions depend on
   * progress moving. It is an acknowledgement, never an implementation — a
   * situation declared static still never progresses.
   */
  readonly staticProgress?: boolean;
}

export interface FixtureSpec {
  readonly countries?: readonly CountrySpec[];
  readonly globalFlags?: readonly GlobalFlag[];
  readonly fleets?: readonly FleetSpec[];
  readonly archaeologicalSites?: readonly ArchaeologicalSiteSpec[];
  readonly situations?: readonly SituationSpec[];
}

export type EntityId =
  | { readonly kind: "country"; readonly country: number }
  | { readonly kind: "planet"; readonly country: number; readonly planet: number }
  | { readonly kind: "fleet"; readonly fleet: number }
  | { readonly kind: "situation"; readonly situation: number }
  | { readonly kind: "archaeological_site"; readonly site: number };

export interface CountryState {
  name: string;
  readonly flags: Set<string>;
  readonly technologies: Set<string>;
  readonly resources: Map<string, number>;
  /** Declared storage capacity per resource; an absent entry is uncapped. */
  readonly storage: Map<string, number>;
}

export interface PlanetState {
  name: string;
  readonly flags: Set<string>;
  readonly deposits: string[];
}

export interface FleetState {
  name: string;
}

export interface ArchaeologicalSiteState {
  name: string;
  progressLocked: boolean;
}

export interface SituationState {
  name: string;
  progress: number;
  approach: string | undefined;
  readonly variables: Map<string, number>;
  /** The situation's declared target — see {@link SituationSpec}. */
  readonly targetId: EntityId;
  /** The author's acknowledgement that progress standing still is fine here — see {@link SituationSpec.staticProgress}. */
  readonly staticProgress: boolean;
}

export interface PendingFire {
  readonly id: string;
  readonly dueDay: number;
  readonly scope: EntityId;
  readonly from: EntityId | undefined;
  /** Enqueue order; ties on dueDay deliver last-queued-first. */
  readonly seq: number;
  /** The execution chain's forced random-list choices and current cursor. */
  readonly choicePlan: ChoicePlanState;
}

export interface ChoicePlanState {
  readonly arms: readonly number[];
  next: number;
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
  readonly fleets: FleetState[];
  readonly sites: ArchaeologicalSiteState[];
  readonly situations: SituationState[];
  readonly queue: PendingFire[];
  readonly fired: FiredRecord[];
  readonly log: string[];
}

/**
 * A quantity that arithmetic can carry. NaN and the infinities are refused at
 * the fixture door rather than at first use: `Math.min(total, NaN)` is NaN, and
 * a poisoned stockpile spreads silently through every later comparison until
 * assertions stop meaning anything. Stockpiles may be negative — Stellaris runs
 * empires into deficit — so only capacities carry the lower bound.
 */
function requireQuantity(value: number, what: string, nonNegative: boolean): number {
  if (!Number.isFinite(value) || (nonNegative && value < 0)) {
    throw new Error(
      `${what} must be a finite${nonNegative ? " non-negative" : ""} number, got ${String(value)}.`
    );
  }
  return value;
}

export function buildState(spec: FixtureSpec): WorldState {
  const countries: CountryState[] = [];
  const planets: PlanetState[][] = [];
  (spec.countries ?? []).forEach((countrySpec, c) => {
    const name = countrySpec.name ?? `country${c}`;
    const resources = new Map(
      Object.entries(countrySpec.resources ?? {}).map(([resource, stockpile]) => [
        resource,
        requireQuantity(stockpile, `${name}'s starting ${resource}`, false),
      ])
    );
    const storage = new Map(
      Object.entries(countrySpec.storage ?? {}).map(([resource, capacity]) => [
        resource,
        requireQuantity(capacity, `${name}'s ${resource} storage capacity`, true),
      ])
    );
    for (const [resource, capacity] of storage) {
      const stockpile = resources.get(resource) ?? 0;
      if (stockpile > capacity) {
        throw new Error(
          `${name} starts with ${stockpile} ${resource} but declares storage for ${capacity}. ` +
            `A starting stockpile above its own capacity is a state the game cannot be in, and ` +
            `add_resource would silently clamp back down to ${capacity} on the first gain.`
        );
      }
    }
    countries.push({
      name,
      flags: new Set(countrySpec.flags ?? []),
      technologies: new Set((countrySpec.technologies ?? []).map((t) => String(refId(t)))),
      resources,
      storage,
    });
    planets.push(
      (countrySpec.planets ?? []).map((planetSpec, p) => ({
        name: planetSpec.name ?? `planet${p}`,
        flags: new Set(planetSpec.flags ?? []),
        deposits: [...(planetSpec.deposits ?? [])],
      }))
    );
  });
  const fleets: FleetState[] = (spec.fleets ?? []).map((fleetSpec, f) => ({
    name: fleetSpec.name ?? `fleet${f}`,
  }));
  const sites: ArchaeologicalSiteState[] = (spec.archaeologicalSites ?? []).map((siteSpec, s) => ({
    name: siteSpec.name ?? `site${s}`,
    progressLocked: siteSpec.progressLocked ?? false,
  }));
  const situations: SituationState[] = (spec.situations ?? []).map((situationSpec, i) => {
    if (countries[situationSpec.targetCountry] === undefined) {
      throw new Error(
        `situations[${i}] targets country ${situationSpec.targetCountry}, but the fixture only ` +
          `has ${countries.length} countr${countries.length === 1 ? "y" : "ies"}.`
      );
    }
    return {
      name: situationSpec.name ?? `situation${i}`,
      progress: situationSpec.initialProgress ?? 0,
      approach: situationSpec.approach,
      variables: new Map(Object.entries(situationSpec.variables ?? {})),
      targetId: { kind: "country", country: situationSpec.targetCountry },
      staticProgress: situationSpec.staticProgress ?? false,
    };
  });
  return {
    day: 0,
    seq: 0,
    globalFlags: new Set(spec.globalFlags ?? []),
    countries,
    planets,
    fleets,
    sites,
    situations,
    queue: [],
    fired: [],
    log: [],
  };
}

export function cloneState(state: WorldState): WorldState {
  const choicePlans = new Map<ChoicePlanState, ChoicePlanState>();
  const cloneChoicePlan = (plan: ChoicePlanState): ChoicePlanState => {
    const existing = choicePlans.get(plan);
    if (existing !== undefined) {
      return existing;
    }
    const clone = { arms: [...plan.arms], next: plan.next };
    choicePlans.set(plan, clone);
    return clone;
  };
  return {
    day: state.day,
    seq: state.seq,
    globalFlags: new Set(state.globalFlags),
    countries: state.countries.map((country) => ({
      name: country.name,
      flags: new Set(country.flags),
      technologies: new Set(country.technologies),
      resources: new Map(country.resources),
      storage: new Map(country.storage),
    })),
    planets: state.planets.map((row) =>
      row.map((planet) => ({
        name: planet.name,
        flags: new Set(planet.flags),
        deposits: [...planet.deposits],
      }))
    ),
    fleets: state.fleets.map((fleet) => ({ name: fleet.name })),
    sites: state.sites.map((site) => ({ name: site.name, progressLocked: site.progressLocked })),
    situations: state.situations.map((situation) => ({
      name: situation.name,
      progress: situation.progress,
      approach: situation.approach,
      variables: new Map(situation.variables),
      targetId: situation.targetId,
      staticProgress: situation.staticProgress,
    })),
    queue: state.queue.map((pending) => ({
      ...pending,
      choicePlan: cloneChoicePlan(pending.choicePlan),
    })),
    fired: [...state.fired],
    log: [...state.log],
  };
}

export function commitState(target: WorldState, source: WorldState): void {
  target.day = source.day;
  target.seq = source.seq;
  replaceSet(target.globalFlags, source.globalFlags);
  replaceArray(target.countries, source.countries, commitCountryState);
  replaceArray(target.planets, source.planets, (targetRow, sourceRow) => {
    replaceArray(targetRow, sourceRow, commitPlanetState);
  });
  replaceArray(target.fleets, source.fleets, (targetFleet, sourceFleet) => {
    targetFleet.name = sourceFleet.name;
  });
  replaceArray(target.sites, source.sites, (targetSite, sourceSite) => {
    targetSite.name = sourceSite.name;
    targetSite.progressLocked = sourceSite.progressLocked;
  });
  replaceArray(target.situations, source.situations, commitSituationState);
  target.queue.splice(0, target.queue.length, ...source.queue);
  target.fired.splice(0, target.fired.length, ...source.fired);
  target.log.splice(0, target.log.length, ...source.log);
}

function replaceArray<T>(
  target: T[],
  source: readonly T[],
  commitItem: (target: T, source: T) => void
): void {
  const sharedLength = Math.min(target.length, source.length);
  for (let index = 0; index < sharedLength; index += 1) {
    commitItem(target[index]!, source[index]!);
  }
  target.splice(sharedLength, target.length - sharedLength, ...source.slice(sharedLength));
}

function replaceSet<T>(target: Set<T>, source: ReadonlySet<T>): void {
  target.clear();
  for (const value of source) {
    target.add(value);
  }
}

function replaceMap<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>): void {
  target.clear();
  for (const [key, value] of source) {
    target.set(key, value);
  }
}

function commitCountryState(target: CountryState, source: CountryState): void {
  target.name = source.name;
  replaceSet(target.flags, source.flags);
  replaceSet(target.technologies, source.technologies);
  replaceMap(target.resources, source.resources);
  replaceMap(target.storage, source.storage);
}

function commitPlanetState(target: PlanetState, source: PlanetState): void {
  target.name = source.name;
  replaceSet(target.flags, source.flags);
  target.deposits.splice(0, target.deposits.length, ...source.deposits);
}

function commitSituationState(target: SituationState, source: SituationState): void {
  target.name = source.name;
  target.progress = source.progress;
  target.approach = source.approach;
  replaceMap(target.variables, source.variables);
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

export function fleetState(state: WorldState, id: EntityId): FleetState {
  if (id.kind !== "fleet") {
    throw new Error(`Expected a fleet scope, got ${describeEntity(state, id)}`);
  }
  const fleet = state.fleets[id.fleet];
  if (fleet === undefined) {
    throw new Error(`No fleet at index ${id.fleet}`);
  }
  return fleet;
}

export function archaeologicalSiteState(state: WorldState, id: EntityId): ArchaeologicalSiteState {
  if (id.kind !== "archaeological_site") {
    throw new Error(`Expected an archaeological_site scope, got ${describeEntity(state, id)}`);
  }
  const site = state.sites[id.site];
  if (site === undefined) {
    throw new Error(`No archaeological site at index ${id.site}`);
  }
  return site;
}

export function situationState(state: WorldState, id: EntityId): SituationState {
  if (id.kind !== "situation") {
    throw new Error(`Expected a situation scope, got ${describeEntity(state, id)}`);
  }
  const situation = state.situations[id.situation];
  if (situation === undefined) {
    throw new Error(`No situation at index ${id.situation}`);
  }
  return situation;
}

/** `country "player"` — for explain details and error messages. */
export function describeEntity(state: WorldState, id: EntityId): string {
  switch (id.kind) {
    case "country":
      return `country "${state.countries[id.country]?.name ?? id.country}"`;
    case "planet":
      return `planet "${state.planets[id.country]?.[id.planet]?.name ?? `${id.country}.${id.planet}`}"`;
    case "fleet":
      return `fleet "${state.fleets[id.fleet]?.name ?? id.fleet}"`;
    case "situation":
      return `situation "${state.situations[id.situation]?.name ?? id.situation}"`;
    case "archaeological_site":
      return `archaeological_site "${state.sites[id.site]?.name ?? id.site}"`;
  }
}

/** `country(0) "player"` / `planet(0.1) "beta"` — for the fired log. */
export function renderEntity(state: WorldState, id: EntityId): string {
  switch (id.kind) {
    case "country":
      return `country(${id.country}) "${state.countries[id.country]?.name ?? "?"}"`;
    case "planet":
      return `planet(${id.country}.${id.planet}) "${state.planets[id.country]?.[id.planet]?.name ?? "?"}"`;
    case "fleet":
      return `fleet(${id.fleet}) "${state.fleets[id.fleet]?.name ?? "?"}"`;
    case "situation":
      return `situation(${id.situation}) "${state.situations[id.situation]?.name ?? "?"}"`;
    case "archaeological_site":
      return `archaeological_site(${id.site}) "${state.sites[id.site]?.name ?? "?"}"`;
  }
}

export function sameEntity(a: EntityId | undefined, b: EntityId | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "country":
      return b.kind === "country" && a.country === b.country;
    case "planet":
      return b.kind === "planet" && a.country === b.country && a.planet === b.planet;
    case "fleet":
      return b.kind === "fleet" && a.fleet === b.fleet;
    case "situation":
      return b.kind === "situation" && a.situation === b.situation;
    case "archaeological_site":
      return b.kind === "archaeological_site" && a.site === b.site;
  }
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

export class Fleet implements SimScope<"fleet"> {
  readonly simScope: "fleet" = "fleet";
  readonly id: EntityId;
  readonly state: WorldState;

  constructor(state: WorldState, index: number) {
    this.state = state;
    this.id = { kind: "fleet", fleet: index };
  }

  get name(): string {
    return fleetState(this.state, this.id).name;
  }
}

export class ArchaeologicalSite implements SimScope<"archaeological_site"> {
  readonly simScope: "archaeological_site" = "archaeological_site";
  readonly id: EntityId;
  readonly state: WorldState;

  constructor(state: WorldState, index: number) {
    this.state = state;
    this.id = { kind: "archaeological_site", site: index };
  }

  get name(): string {
    return archaeologicalSiteState(this.state, this.id).name;
  }

  /** `set_site_progress_locked`'s target — the one piece of site state the whitelist touches. */
  get progressLocked(): boolean {
    return archaeologicalSiteState(this.state, this.id).progressLocked;
  }
}

export class Situation implements SimScope<"situation"> {
  readonly simScope: "situation" = "situation";
  readonly id: EntityId;
  readonly state: WorldState;

  constructor(state: WorldState, index: number) {
    this.state = state;
    this.id = { kind: "situation", situation: index };
  }

  get name(): string {
    return situationState(this.state, this.id).name;
  }

  /** The situation's stored progress value — what `situationProgress(...)` compares against. */
  get progress(): number {
    return situationState(this.state, this.id).progress;
  }

  /** The id of the currently-picked approach, or `undefined` if none has been. */
  get approach(): string | undefined {
    return situationState(this.state, this.id).approach;
  }

  /** Reads a situation variable; `undefined` if it was never set — see `is_variable_set`. */
  variable(name: string): number | undefined {
    return situationState(this.state, this.id).variables.get(name);
  }

  /** The situation's declared target — see {@link SituationSpec}. */
  get target(): Country {
    const targetId = situationState(this.state, this.id).targetId;
    if (targetId.kind !== "country") {
      throw new Error("unreachable: the fixture only builds country-targeted situations");
    }
    return new Country(this.state, targetId.country);
  }
}

export type HandleOf<S extends SimScopeName> = S extends "country"
  ? Country
  : S extends "planet"
    ? Planet
    : S extends "fleet"
      ? Fleet
      : S extends "situation"
        ? Situation
        : ArchaeologicalSite;

/** Any handle the fixture can hand back — the union `explainFor`/the matcher pack accept. */
export type AnySimHandle = Country | Planet | Fleet | Situation | ArchaeologicalSite;
