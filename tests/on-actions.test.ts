import { describe, expect, it } from "vitest";

import { buildMod, collection, namespace, on, onActions, render } from "../src/index.ts";

const CONFIG = {
  name: "On-action runtime tests",
  prefix: "on_action_test",
  supportedVersion: "4.0.*",
};

describe("on-action authoring", () => {
  it("renders one deterministic additive file and preserves event order", () => {
    const events = namespace("on_action_test");
    const first = events.defineCountryEvent({ id: 1, isTriggeredOnly: true });
    const second = events.defineCountryEvent({ id: 2, isTriggeredOnly: true });
    const diplomacy = events.defineCountryEvent({
      id: 3,
      from: "country",
      isTriggeredOnly: true,
    });

    const hooks = collection(undefined, [
      on(onActions.onGameStartCountry, [first]),
      on(onActions.onGameStartCountry, [second]),
      on(onActions.onCustomDiplomacy, [diplomacy]),
    ]);

    // Hook blocks come out sorted by hook name — `on_custom_diplomacy` was
    // registered last and is emitted first (SDK-23: order is a function of
    // content). The event list inside a hook is author data and keeps the
    // order it was registered in.
    const mod = buildMod(CONFIG, [collection("events", [first, second, diplomacy]), hooks]);
    expect(render(mod).get("common/on_actions/on_action_test_on_actions.txt"))
      .toMatchInlineSnapshot(`
        "on_custom_diplomacy = {
        	events = { on_action_test.3 }
        }

        on_game_start_country = {
        	events = { on_action_test.1 on_action_test.2 }
        }
        "
      `);
    expect(render(mod)).toEqual(render(mod));
  });

  it("emits the same bytes when two collections bind one hook in either order", () => {
    // Two `on()` calls for the same hook, split across collections. The list
    // inside one call is author data; which call came first is layout, and
    // layout must not reach the output (SDK-23).
    const build = (reversed: boolean) => {
      const events = namespace("on_action_test");
      const zulu = events.defineCountryEvent({ id: 6, isTriggeredOnly: true });
      const alpha = events.defineCountryEvent({ id: 7, isTriggeredOnly: true });
      const first = collection(undefined, [on(onActions.onGameStartCountry, [zulu])]);
      const second = collection(undefined, [on(onActions.onGameStartCountry, [alpha])]);
      const hooks = reversed ? [second, first] : [first, second];
      return render(buildMod(CONFIG, [collection("events", [zulu, alpha]), ...hooks])).get(
        "common/on_actions/on_action_test_on_actions.txt"
      );
    };

    expect(build(false)).toBe(build(true));
    expect(build(false)).toMatchInlineSnapshot(`
      "on_game_start_country = {
      	events = { on_action_test.6 on_action_test.7 }
      }
      "
    `);
  });

  it("rejects duplicate registrations of one event on one hook", () => {
    const events = namespace("on_action_test");
    const event = events.defineCountryEvent({ id: 4, isTriggeredOnly: true });
    const hooks = collection(undefined, [
      on(onActions.onGameStartCountry, [event]),
      on(onActions.onGameStartCountry, [event]),
    ]);

    expect(() => buildMod(CONFIG, [collection("events", [event]), hooks])).toThrow(
      /already registered on on-action "on_game_start_country"/
    );
  });

  it("rejects events from a collection outside the build", () => {
    const foreign = namespace("other_mod");
    const event = foreign.defineCountryEvent({ id: 5, isTriggeredOnly: true });
    const hooks = collection(undefined, [on(onActions.onGameStartCountry, [event])]);

    expect(() => buildMod(CONFIG, [hooks])).toThrow(
      /is not among the collections passed to buildMod/
    );
  });
});
