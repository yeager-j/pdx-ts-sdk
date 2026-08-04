import { describe, expect, it } from "vitest";

import { collection } from "../src/authoring/feature.ts";
import { buildMod } from "../src/build.ts";
import { on } from "../src/events/on-actions.ts";
import { namespace } from "../src/generated/event-definers.ts";
import { createMod, onActions, render } from "../src/index.ts";

const CONFIG = {
  name: "On-action runtime tests",
  prefix: "on_action_test",
  supportedVersion: "4.0.*",
};
const mod = createMod(CONFIG);

describe("on-action authoring", () => {
  it("renders one deterministic additive file and preserves event order", () => {
    const events = mod.namespace();
    const first = events.country(1, { isTriggeredOnly: true });
    const second = events.country(2, { isTriggeredOnly: true });
    const diplomacy = events.country(3, {
      from: "country",
      isTriggeredOnly: true,
    });

    const hooks = mod.feature(undefined, [
      mod.on(onActions.onGameStartCountry, [first]),
      mod.on(onActions.onGameStartCountry, [second]),
      mod.on(onActions.onCustomDiplomacy, [diplomacy]),
    ]);

    // Hook blocks come out sorted by hook name — `on_custom_diplomacy` was
    // registered last and is emitted first (SDK-23: order is a function of
    // content). The event list inside a hook is author data and keeps the
    // order it was registered in.
    const compiled = mod.compile([mod.feature("events", [first, second, diplomacy]), hooks]);
    expect(render(compiled).get("common/on_actions/on_action_test_on_actions.txt"))
      .toMatchInlineSnapshot(`
        "on_custom_diplomacy = {
        	events = { on_action_test.3 }
        }

        on_game_start_country = {
        	events = { on_action_test.1 on_action_test.2 }
        }
        "
      `);
    expect(render(compiled)).toEqual(render(compiled));
  });

  it("emits the same bytes when two collections bind one hook in either order", () => {
    // Two `on()` calls for the same hook, split across collections. The list
    // inside one call is author data; which call came first is layout, and
    // layout must not reach the output (SDK-23).
    const build = (reversed: boolean) => {
      const events = mod.namespace();
      const zulu = events.country(6, { isTriggeredOnly: true });
      const alpha = events.country(7, { isTriggeredOnly: true });
      const first = mod.feature(undefined, [mod.on(onActions.onGameStartCountry, [zulu])]);
      const second = mod.feature(undefined, [mod.on(onActions.onGameStartCountry, [alpha])]);
      const hooks = reversed ? [second, first] : [first, second];
      return render(mod.compile([mod.feature("events", [zulu, alpha]), ...hooks])).get(
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
    const events = mod.namespace();
    const event = events.country(4, { isTriggeredOnly: true });
    const hooks = mod.feature(undefined, [
      mod.on(onActions.onGameStartCountry, [event]),
      mod.on(onActions.onGameStartCountry, [event]),
    ]);

    expect(() => mod.compile([mod.feature("events", [event]), hooks])).toThrow(
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
