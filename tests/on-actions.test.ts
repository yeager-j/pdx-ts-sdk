import { describe, expect, it } from "vitest";

import { buildMod, createEvents, createOnActions, onActions, render } from "../src/index.ts";

const CONFIG = {
  name: "On-action runtime tests",
  prefix: "on_action_test",
  supportedVersion: "4.0.*",
};

describe("on-action authoring", () => {
  it("renders one deterministic additive file and preserves event order", () => {
    const events = createEvents("events", "on_action_test");
    const hooks = createOnActions();
    const first = events.defineCountryEvent({ id: 1, isTriggeredOnly: true });
    const second = events.defineCountryEvent({ id: 2, isTriggeredOnly: true });
    const diplomacy = events.defineCountryEvent({
      id: 3,
      from: "country",
      isTriggeredOnly: true,
    });

    hooks.on(onActions.onGameStartCountry, first);
    hooks.on(onActions.onGameStartCountry, second);
    hooks.on(onActions.onCustomDiplomacy, diplomacy);

    const mod = buildMod(CONFIG, [events, hooks]);
    expect(render(mod).get("common/on_actions/on_action_test_on_actions.txt"))
      .toMatchInlineSnapshot(`
        "on_game_start_country = {
        	events = { on_action_test.1 on_action_test.2 }
        }

        on_custom_diplomacy = {
        	events = { on_action_test.3 }
        }
        "
      `);
    expect(render(mod)).toEqual(render(mod));
  });

  it("rejects duplicate registrations of one event on one hook", () => {
    const events = createEvents("events", "on_action_test");
    const hooks = createOnActions();
    const event = events.defineCountryEvent({ id: 4, isTriggeredOnly: true });
    hooks.on(onActions.onGameStartCountry, event);
    hooks.on(onActions.onGameStartCountry, event);

    expect(() => buildMod(CONFIG, [events, hooks])).toThrow(
      /already registered on on-action "on_game_start_country"/
    );
  });

  it("rejects events from a collection outside the build", () => {
    const foreign = createEvents("events", "other_mod");
    const hooks = createOnActions();
    const event = foreign.defineCountryEvent({ id: 5, isTriggeredOnly: true });
    hooks.on(onActions.onGameStartCountry, event);

    expect(() => buildMod(CONFIG, [hooks])).toThrow(
      /is not among the collections passed to buildMod/
    );
  });
});
