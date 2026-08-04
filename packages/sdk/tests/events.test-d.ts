/**
 * The FROM contract, held against the pure authoring API — the probe's claims
 * 5, 5b, and 7 (see docs/verdict-effects-probe.md) pinned on the namespace
 * definers mod authors actually call.
 */

import { describe, it } from "vitest";

import { createMod, eventTarget } from "../src/index.ts";

describe("the FROM contract on the real event API", () => {
  it("requires a witness when the fired event declared from:", () => {
    const mod = createMod({ name: "A", prefix: "from_contract_a", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const needsCountryFrom = events.planet(1, {
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.planet(2, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet) => {
        // @ts-expect-error — the target event declared from: "country"; firing it needs a country FROM witness
        planet.planetEvent({ id: needsCountryFrom, days: 5 });
      },
    });
  });

  it("rejects a witness of the wrong scope", () => {
    const mod = createMod({ name: "B", prefix: "from_contract_b", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const needsCountryFrom = events.planet(3, {
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.planet(4, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet, ctx) => {
        // @ts-expect-error — ctx.self is a planet ref; the target's FROM contract wants a country
        planet.planetEvent({ id: needsCountryFrom, from: ctx.self, days: 5 });
      },
    });
  });

  it("accepts a matching witness", () => {
    const mod = createMod({ name: "C", prefix: "from_contract_c", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const needsCountryFrom = events.planet(5, {
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.country(6, {
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
    const mod = createMod({ name: "D", prefix: "from_contract_d", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const needsCountryFrom = events.situation(20, {
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.situation(21, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (situation, ctx) => {
        // @ts-expect-error — the target declared from: "country"; a situation witness does not satisfy it
        situation.situationEvent({ id: needsCountryFrom, from: ctx.self });
      },
    });
    // @ts-expect-error — a situation-scoped definition does not fit country()
    events.country(22, { immediate: (s) => s.setSituationFlag("x") });
  });

  it("lets FROM open a block but not self, whose path is relative", () => {
    const mod = createMod({ name: "Self", prefix: "self_is_a_value", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const aftershockFrom = events.planet(9, {
      from: "country",
      isTriggeredOnly: true,
    });
    const target = eventTarget<"planet">("self_is_a_value_planet");
    events.country(1, {
      from: "planet",
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        // FROM and a saved target name their scope absolutely, so both open.
        ctx.from.effects((planet) => planet.setPlanetFlag("x"));
        target.effects((planet) => planet.setPlanetFlag("y"));
        // `this` does not: inside a scope transition it is that scope, so a
        // block opened through it would run somewhere its type does not say.
        // @ts-expect-error — ctx.self is a value, not an openable ref
        ctx.self.effects(() => {});
        // It stays exactly as useful as a value, which is all it ever was.
        country.everyOwnedPlanet({}, (planet) => {
          planet.planetEvent({ id: aftershockFrom, from: ctx.self });
        });
      },
    });
  });

  it("makes an undeclared FROM unusable rather than any-typed", () => {
    const mod = createMod({ name: "E", prefix: "from_contract_e", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    events.country(7, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        // @ts-expect-error — this event declared no `from:`; ctx.from is an inert sentinel, not a ScopeRef
        ctx.from.effects(() => {});
      },
    });
  });
});
