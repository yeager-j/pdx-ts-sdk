/**
 * The negative half of the testing probe: one `@ts-expect-error` per safety
 * claim the harness makes. If any annotation stops firing, `npm run
 * typecheck` fails — the claims are pinned, not assumed. Nothing here runs;
 * every case is wrapped in a function that is never called, so the file is
 * inert at runtime.
 */

import { expect } from "vitest";

import { evaluate } from "../../packages/sdk-testing/src/interpret.ts";
import { countryFlags, planetFlags } from "../../packages/sdk/src/generated/value-sets.ts";

import "../../packages/sdk-testing/src/matchers.ts";

import type { Country, Planet } from "../../packages/sdk-testing/src/state.ts";
import { declareFrom, fixture, type World } from "../../packages/sdk-testing/src/world.ts";
import { hasCountryFlag } from "../../packages/sdk/src/triggers.ts";
import { aftershock, humReturns } from "./probe-mod.ts";

const countryFlag = countryFlags("tp_neg_country_flag");
const planetFlag = planetFlags("tp_neg_planet_flag");

function handles(): { world: World; player: Country; alpha: Planet } {
  const world = fixture(
    { countries: [{ name: "player", planets: [{ name: "alpha" }] }] },
    { events: [humReturns, declareFrom(aftershock, "country")] }
  );
  const player = world.country(0);
  return { world, player, alpha: player.planet(0) };
}

/** Claim 1: firing an event that declares `from:` requires the FROM witness. */
export function fireWithoutDeclaredFrom(): void {
  const { world, alpha } = handles();
  // @ts-expect-error — aftershock declares from: "country"; the witness overload requires { from }
  world.fire(aftershock, alpha);
}

/** Claim 2: a contract-less event refuses a FROM witness. */
export function fireWithUndeclaredFrom(): void {
  const { world, player } = handles();
  // @ts-expect-error — humReturns declares no from:; supplying a witness is a contract violation
  world.fire(humReturns, player, { from: player });
}

/** Claim 3: a witness of the wrong kind does not satisfy the contract. */
export function fireWithWrongKindFrom(): void {
  const { world, alpha } = handles();
  // @ts-expect-error — aftershock's FROM contract wants a country; a planet handle does not unify
  world.fire(aftershock, alpha, { from: alpha });
}

/** Claim 4: evaluating a trigger against the wrong scope kind is rejected. */
export function evaluateWrongScope(): void {
  const { alpha } = handles();
  // @ts-expect-error — hasCountryFlag is country-scoped; a planet handle is not a country witness
  evaluate(hasCountryFlag(countryFlag.tp_neg_country_flag), alpha);
}

/** Claim 5: value sets stay distinct — a planet flag is not a country flag. */
export function wrongFlagKind(): void {
  const { player } = handles();
  // @ts-expect-error — Country.hasFlag takes a CountryFlag, not a PlanetFlag
  player.hasFlag(planetFlag.tp_neg_planet_flag);
}

/** Claim 6: assertions take objects, not strings. */
export function eventAssertionByString(): void {
  const { world } = handles();
  // @ts-expect-error — toContainEvent takes the event object, not its id string
  expect(world.fired).toContainEvent("testing_probe.2");
}

/** Claim 7: the fixture spec is closed — unknown state cannot sneak in. */
export function unknownFixtureKey(): void {
  fixture(
    {
      // @ts-expect-error — leaders are not modeled; the spec only holds what the semantics touch
      leaders: [{ name: "curator" }],
    },
    { events: [] }
  );
}
