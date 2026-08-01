/**
 * The FROM contract, held against the real Mod API — the probe's claims 5,
 * 5b, and 7 (see docs/verdict-effects-probe.md) pinned on the production
 * surface.
 */

import { describe, it } from "vitest";

import { Mod } from "../src/mod.ts";

function makeMod(): Mod<"from_contract"> {
  return new Mod({
    name: "FROM contract type tests",
    prefix: "from_contract",
    supportedVersion: "4.0.*",
  });
}

describe("the FROM contract on the real event API", () => {
  it("requires a witness when the fired event declared from:", () => {
    const mod = makeMod();
    const needsCountryFrom = mod.definePlanetEvent({
      id: 1,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    mod.definePlanetEvent({
      id: 2,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet) => {
        // @ts-expect-error — the target event declared from: "country"; firing it needs a country FROM witness
        planet.planetEvent({ id: needsCountryFrom, days: 5 });
      },
    });
  });

  it("rejects a witness of the wrong scope", () => {
    const mod = makeMod();
    const needsCountryFrom = mod.definePlanetEvent({
      id: 3,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    mod.definePlanetEvent({
      id: 4,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet, ctx) => {
        // @ts-expect-error — ctx.self is a planet ref; the target's FROM contract wants a country
        planet.planetEvent({ id: needsCountryFrom, from: ctx.self, days: 5 });
      },
    });
  });

  it("accepts a matching witness", () => {
    const mod = makeMod();
    const needsCountryFrom = mod.definePlanetEvent({
      id: 5,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    mod.defineCountryEvent({
      id: 6,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.everyOwnedPlanet({}, (planet) => {
          planet.planetEvent({ id: needsCountryFrom, from: ctx.self, days: 5 });
        });
      },
    });
  });

  it("holds the FROM contract on a generated kind beyond the original two", () => {
    const mod = makeMod();
    const needsCountryFrom = mod.defineSituationEvent({
      id: 20,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    mod.defineSituationEvent({
      id: 21,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (situation, ctx) => {
        // @ts-expect-error — the target declared from: "country"; a situation witness does not satisfy it
        situation.situationEvent({ id: needsCountryFrom, from: ctx.self });
      },
    });
    // @ts-expect-error — a situation-scoped def does not fit defineCountryEvent
    mod.defineCountryEvent({ id: 22, immediate: (s) => s.setSituationFlag("x") });
  });

  it("makes an undeclared FROM unusable rather than any-typed", () => {
    const mod = makeMod();
    mod.defineCountryEvent({
      id: 7,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        // @ts-expect-error — this event declared no `from:`; ctx.from is an inert sentinel, not a ScopeRef
        country.within(ctx.from, () => {});
      },
    });
  });
});
