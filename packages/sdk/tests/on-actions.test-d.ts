import { describe, it } from "vitest";

import { createMod, onActions } from "../src/index.ts";

describe("typed on-action registration", () => {
  it("accepts matching event scope and FROM contracts", () => {
    const mod = createMod({ name: "A", prefix: "on_action_types_a", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const gameStart = events.country(1, { isTriggeredOnly: true });
    const diplomacy = events.country(2, {
      from: "country",
      isTriggeredOnly: true,
    });

    mod.on(onActions.onGameStartCountry, [gameStart]);
    mod.on(onActions.onCustomDiplomacy, [diplomacy]);
  });

  it("rejects a wrong event scope", () => {
    const mod = createMod({ name: "B", prefix: "on_action_types_b", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const planetEvent = events.planet(3, { isTriggeredOnly: true });

    // @ts-expect-error — on_game_start_country supplies country scope
    mod.on(onActions.onGameStartCountry, [planetEvent]);
  });

  it("rejects unknown hooks", () => {
    const mod = createMod({ name: "C", prefix: "on_action_types_c", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const event = events.country(4, { isTriggeredOnly: true });

    // @ts-expect-error — hook names come from generated onActions references
    mod.on(onActions.onDefinitelyNotARealHook, [event]);
  });

  it("rejects no-scope hooks until scopeless events exist", () => {
    const mod = createMod({ name: "D", prefix: "on_action_types_d", supportedVersion: "4.4.*" });
    const events = mod.namespace();
    const event = events.country(5, { isTriggeredOnly: true });

    // @ts-expect-error — on_game_start is no_scope
    mod.on(onActions.onGameStart, [event]);
  });
});
