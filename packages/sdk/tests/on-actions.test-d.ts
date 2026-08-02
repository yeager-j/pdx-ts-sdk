import { describe, it } from "vitest";

import { namespace, on, onActions } from "../src/index.ts";

describe("typed on-action registration", () => {
  it("accepts matching event scope and FROM contracts", () => {
    const events = namespace("on_action_types_a");
    const gameStart = events.defineCountryEvent({ id: 1, isTriggeredOnly: true });
    const diplomacy = events.defineCountryEvent({
      id: 2,
      from: "country",
      isTriggeredOnly: true,
    });

    on(onActions.onGameStartCountry, [gameStart]);
    on(onActions.onCustomDiplomacy, [diplomacy]);
  });

  it("rejects a wrong event scope", () => {
    const events = namespace("on_action_types_b");
    const planetEvent = events.definePlanetEvent({ id: 3, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start_country supplies country scope
    on(onActions.onGameStartCountry, [planetEvent]);
  });

  it("rejects unknown hooks", () => {
    const events = namespace("on_action_types_c");
    const event = events.defineCountryEvent({ id: 4, isTriggeredOnly: true });

    // @ts-expect-error — hook names come from generated onActions references
    on(onActions.onDefinitelyNotARealHook, [event]);
  });

  it("rejects no-scope hooks until scopeless events exist", () => {
    const events = namespace("on_action_types_d");
    const event = events.defineCountryEvent({ id: 5, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start is no_scope
    on(onActions.onGameStart, [event]);
  });
});
