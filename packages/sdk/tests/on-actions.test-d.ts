import { describe, it } from "vitest";

import { createMod, onActions, vanilla } from "../src/index.ts";

describe("typed on-action registration", () => {
  it("accepts matching event scope and FROM contracts", () => {
    const mod = createMod({ name: "A", prefix: "on_action_types_a", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const gameStart = events.country(1, { isTriggeredOnly: true });
    const diplomacy = events.country(2, {
      scopes: { from: "country" },
      isTriggeredOnly: true,
    });

    mod.on(onActions.onGameStartCountry, [gameStart]);
    mod.on(onActions.onCustomDiplomacy, [diplomacy]);
  });

  it("accepts object-form ordinary, weighted, and checked scopeless events", () => {
    const mod = createMod({
      name: "Object",
      prefix: "on_action_types_object",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const countryEvent = events.country(6, { isTriggeredOnly: true });

    mod.on(onActions.onGameStartCountry, {
      events: [countryEvent],
      randomEvents: [{ weight: 80, event: countryEvent }, { weight: 20 }],
    });
    mod.on(onActions.onFiveYearPulse, {
      randomEvents: [{ weight: 50, event: vanilla.event.situation.$2000 }, { weight: 50 }],
    });
    mod.on(onActions.onGameStartCountry, {
      randomEvents: [{ weight: 100, event: vanilla.event.observer.$1 }],
    });
    const observerHandle = events.observerHandle(8);
    mod.on(onActions.onGameStartCountry, {
      randomEvents: [{ weight: 100, event: observerHandle }],
    });
  });

  it("rejects a wrong event scope", () => {
    const mod = createMod({ name: "B", prefix: "on_action_types_b", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const planetEvent = events.planet(3, { isTriggeredOnly: true });

    // @ts-expect-error — on_game_start_country supplies country scope
    mod.on(onActions.onGameStartCountry, [planetEvent]);
    // @ts-expect-error — weighted events obey the same scope contract
    mod.on(onActions.onGameStartCountry, { randomEvents: [{ weight: 100, event: planetEvent }] });
  });

  it("rejects a wrong weighted-event FROM contract", () => {
    const mod = createMod({
      name: "From",
      prefix: "on_action_types_from",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const witnessed = events.country(7, { scopes: { from: "country" }, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start_country supplies no FROM
    mod.on(onActions.onGameStartCountry, { randomEvents: [{ weight: 100, event: witnessed }] });
  });

  it("rejects unknown hooks", () => {
    const mod = createMod({ name: "C", prefix: "on_action_types_c", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const event = events.country(4, { isTriggeredOnly: true });

    // @ts-expect-error — hook names come from generated onActions references
    mod.on(onActions.onDefinitelyNotARealHook, [event]);
  });

  it("rejects scoped authored events on scopeless hooks", () => {
    const mod = createMod({ name: "D", prefix: "on_action_types_d", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const event = events.country(5, { isTriggeredOnly: true });

    // @ts-expect-error — on_game_start is no_scope
    mod.on(onActions.onGameStart, [event]);
    // @ts-expect-error — a country event does not satisfy a scopeless random event reference
    mod.on(onActions.onGameStart, { randomEvents: [{ weight: 100, event }] });
  });

  it("rejects empty object-form contributions", () => {
    const mod = createMod({
      name: "Empty",
      prefix: "on_action_types_empty",
      supportedVersion: "4.4.*",
    });

    // @ts-expect-error — one list must be present
    mod.on(onActions.onGameStartCountry, {});
    // @ts-expect-error — present ordinary lists are non-empty
    mod.on(onActions.onGameStartCountry, { events: [] });
    // @ts-expect-error — present weighted lists are non-empty
    mod.on(onActions.onGameStartCountry, { randomEvents: [] });
  });
});
