import { describe, it } from "vitest";

import { Mod, onActions } from "../src/index.ts";

function makeMod(): Mod<"on_action_types"> {
  return new Mod({
    name: "On-action type tests",
    prefix: "on_action_types",
    supportedVersion: "4.0.*",
  });
}

describe("typed on-action registration", () => {
  it("accepts matching event scope and FROM contracts", () => {
    const mod = makeMod();
    const gameStart = mod.defineCountryEvent({ id: 1, isTriggeredOnly: true });
    const diplomacy = mod.defineCountryEvent({
      id: 2,
      from: "country",
      isTriggeredOnly: true,
    });

    mod.on(onActions.onGameStartCountry, gameStart);
    mod.on(onActions.onCustomDiplomacy, diplomacy);
  });

  it("rejects a wrong event scope", () => {
    const mod = makeMod();
    const planetEvent = mod.definePlanetEvent({ id: 3, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start_country supplies country scope
    mod.on(onActions.onGameStartCountry, planetEvent);
  });

  it("rejects unknown hooks", () => {
    const mod = makeMod();
    const event = mod.defineCountryEvent({ id: 4, isTriggeredOnly: true });

    // @ts-expect-error — hook names come from generated onActions references
    mod.on(onActions.onDefinitelyNotARealHook, event);
  });

  it("rejects no-scope hooks until scopeless events exist", () => {
    const mod = makeMod();
    const event = mod.defineCountryEvent({ id: 5, isTriggeredOnly: true });

    // @ts-expect-error — on_game_start is no_scope
    mod.on(onActions.onGameStart, event);
  });
});
