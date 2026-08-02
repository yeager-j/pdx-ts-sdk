/**
 * The FROM contract, held against the pure authoring API — the probe's claims
 * 5, 5b, and 7 (see docs/verdict-effects-probe.md) pinned on the namespace
 * definers mod authors actually call.
 */

import { describe, it } from "vitest";

import { namespace } from "../src/index.ts";

describe("the FROM contract on the real event API", () => {
  it("requires a witness when the fired event declared from:", () => {
    const events = namespace("from_contract_a");
    const needsCountryFrom = events.definePlanetEvent({
      id: 1,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.definePlanetEvent({
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
    const events = namespace("from_contract_b");
    const needsCountryFrom = events.definePlanetEvent({
      id: 3,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.definePlanetEvent({
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
    const events = namespace("from_contract_c");
    const needsCountryFrom = events.definePlanetEvent({
      id: 5,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.defineCountryEvent({
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
    const events = namespace("from_contract_d");
    const needsCountryFrom = events.defineSituationEvent({
      id: 20,
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.defineSituationEvent({
      id: 21,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (situation, ctx) => {
        // @ts-expect-error — the target declared from: "country"; a situation witness does not satisfy it
        situation.situationEvent({ id: needsCountryFrom, from: ctx.self });
      },
    });
    // @ts-expect-error — a situation-scoped def does not fit defineCountryEvent
    events.defineCountryEvent({ id: 22, immediate: (s) => s.setSituationFlag("x") });
  });

  it("makes an undeclared FROM unusable rather than any-typed", () => {
    const events = namespace("from_contract_e");
    events.defineCountryEvent({
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
