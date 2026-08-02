import { describe, it } from "vitest";

import { createEvents, createOnActions, onActions } from "../src/index.ts";

describe("typed on-action registration", () => {
  it("accepts matching event scope and FROM contracts", () => {
    const events = createEvents("on_action_types_a", "on_action_types_a");
    const hooks = createOnActions();
    const gameStart = events.defineCountryEvent({ id: 1, isTriggeredOnly: true });
    const diplomacy = events.defineCountryEvent({
      id: 2,
      from: "country",
      isTriggeredOnly: true,
    });

    hooks.on(onActions.onGameStartCountry, gameStart);
    hooks.on(onActions.onCustomDiplomacy, diplomacy);
  });

  it("rejects a wrong event scope", () => {
    const events = createEvents("on_action_types_b", "on_action_types_b");
    const hooks = createOnActions();
    const planetEvent = events.definePlanetEvent({ id: 3, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start_country supplies country scope
    hooks.on(onActions.onGameStartCountry, planetEvent);
  });

  it("rejects unknown hooks", () => {
    const events = createEvents("on_action_types_c", "on_action_types_c");
    const hooks = createOnActions();
    const event = events.defineCountryEvent({ id: 4, isTriggeredOnly: true });

    // @ts-expect-error — hook names come from generated onActions references
    hooks.on(onActions.onDefinitelyNotARealHook, event);
  });

  it("rejects no-scope hooks until scopeless events exist", () => {
    const events = createEvents("on_action_types_d", "on_action_types_d");
    const hooks = createOnActions();
    const event = events.defineCountryEvent({ id: 5, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start is no_scope
    hooks.on(onActions.onGameStart, event);
  });
});
