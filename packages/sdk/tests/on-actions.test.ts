import { describe, expect, it } from "vitest";

import { createFeature } from "../src/authoring/feature.ts";
import { buildMod } from "../src/compiler/compile.ts";
import { on } from "../src/events/on-actions.ts";
import { namespace } from "../src/generated/event-definers.ts";
import { createMod, onActions, render, vanilla } from "../src/index.ts";

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
      scopes: { from: "country" },
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

  it("emits the same bytes when two features bind one hook in either order", () => {
    // Two `on()` calls for the same hook, split across features. The list
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

  it("renders weighted scopeless events and the literal no-op arm", () => {
    const pulse = mod.feature(undefined, [
      mod.on(onActions.onFiveYearPulse, {
        randomEvents: [{ weight: 150 }, { weight: 50, event: vanilla.event.situation.$2000 }],
      }),
    ]);

    expect(render(mod.compile([pulse])).get("common/on_actions/on_action_test_on_actions.txt"))
      .toMatchInlineSnapshot(`
      "on_five_year_pulse = {
      \trandom_events = {
      \t\t150 = 0
      \t\t50 = situation.2000
      \t}
      }
      "
    `);
  });

  it("emits ordinary events before weighted events and preserves duplicate weighted rows", () => {
    const events = mod.namespace();
    const first = events.country(8, { isTriggeredOnly: true });
    const second = events.country(9, { isTriggeredOnly: true });
    const feature = mod.feature("mixed", [
      first,
      second,
      mod.on(onActions.onGameStartCountry, {
        events: [first, second],
        randomEvents: [
          { weight: 25, event: second },
          { weight: 25, event: second },
          { weight: 50 },
        ],
      }),
    ]);

    expect(render(mod.compile([feature])).get("common/on_actions/on_action_test_on_actions.txt"))
      .toMatchInlineSnapshot(`
        "on_game_start_country = {
        \tevents = { on_action_test.8 on_action_test.9 }
        \trandom_events = {
        \t\t25 = on_action_test.9
        \t\t25 = on_action_test.9
        \t\t50 = 0
        \t}
        }
        "
      `);
  });

  it("orders separate weighted contributions by content, not Feature order", () => {
    const build = (reversed: boolean) => {
      const first = mod.feature(undefined, [
        mod.on(onActions.onFiveYearPulse, {
          randomEvents: [{ weight: 20, event: vanilla.event.origin.$1334 }, { weight: 20 }],
        }),
      ]);
      const second = mod.feature(undefined, [
        mod.on(onActions.onFiveYearPulse, {
          randomEvents: [{ weight: 10, event: "third_party.1" }],
        }),
      ]);
      return render(mod.compile(reversed ? [second, first] : [first, second])).get(
        "common/on_actions/on_action_test_on_actions.txt"
      );
    };

    expect(build(false)).toBe(build(true));
    expect(build(false)).toContain(
      "random_events = {\n\t\t10 = third_party.1\n\t\t20 = origin.1334\n\t\t20 = 0\n\t}"
    );
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

  it("rejects events from a feature outside the build", () => {
    const foreign = namespace("other_mod");
    const event = foreign.defineCountryEvent({ id: 5, isTriggeredOnly: true });
    const hooks = createFeature(undefined, [on(onActions.onGameStartCountry, [event])]);

    expect(() => buildMod(CONFIG, [hooks])).toThrow(/is not among the features passed to buildMod/);
  });

  it("rejects authored weighted events from a feature outside the build", () => {
    const events = mod.namespace();
    const omitted = events.country(10, { isTriggeredOnly: true });
    const hooks = mod.feature(undefined, [
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: omitted }],
      }),
    ]);

    expect(() => mod.compile([hooks])).toThrow(/is not among the features passed to buildMod/);
  });

  it("resolves weighted event handles against selected definitions", () => {
    const events = mod.namespace("handles");
    const selectedHandle = events.countryHandle(11);
    const selectedEvent = selectedHandle.define({ isTriggeredOnly: true });
    const selected = mod.feature("selected_handle", [
      selectedEvent,
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: selectedHandle }],
      }),
    ]);
    expect(
      render(mod.compile([selected])).get("common/on_actions/on_action_test_on_actions.txt")
    ).toContain("100 = on_action_test_handles.11");

    const omittedHandle = events.countryHandle(12);
    const omitted = mod.feature(undefined, [
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: omittedHandle }],
      }),
    ]);
    expect(() => mod.compile([omitted])).toThrow(/is not among the features passed to buildMod/);

    const wrongScopeHandle = events.planetHandle(13);
    const wrongScopeEvent = wrongScopeHandle.define({ isTriggeredOnly: true });
    const wrongScope = mod.feature("wrong_scope_handle", [
      wrongScopeEvent,
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: wrongScopeHandle as never }],
      }),
    ]);
    expect(() => mod.compile([wrongScope])).toThrow(
      /supplies country scope with no ambient scopes, but event "on_action_test_handles.13" declares planet scope/
    );

    const otherMod = createMod({
      name: "Other capability",
      prefix: "other_on_action",
      supportedVersion: "4.4.*",
    });
    const foreignHandle = otherMod.namespace().countryHandle(1);
    const foreign = mod.feature(undefined, [
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: foreignHandle }],
      }),
    ]);
    expect(() => mod.compile([foreign])).toThrow(/is not among the features passed to buildMod/);
  });

  it("rejects raw weighted ids that claim this mod's namespace but are omitted", () => {
    const hooks = mod.feature(undefined, [
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: "on_action_test.404" }],
      }),
    ]);

    expect(() => mod.compile([hooks])).toThrow(/is not among the features passed to buildMod/);
  });

  it("validates the selected definition behind a raw own event id", () => {
    const events = mod.namespace();
    const planetEvent = events.planet(13, { isTriggeredOnly: true });
    const feature = mod.feature("raw_own_event", [
      planetEvent,
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [{ weight: 100, event: "on_action_test.13" }],
      }),
    ]);

    expect(() => mod.compile([feature])).toThrow(
      /supplies country scope with no ambient scopes, but event "on_action_test.13" declares planet scope/
    );
  });

  it("checks every declared ambient slot on a deep hook contract", () => {
    const events = mod.namespace();
    const matching = events.country(14, {
      scopes: {
        from: "country",
        fromfrom: "country",
        fromfromfrom: "country",
        fromfromfromfrom: "war",
      },
      isTriggeredOnly: true,
    });
    const mismatched = events.country(15, {
      scopes: {
        from: "country",
        fromfrom: "fleet",
        fromfromfrom: "country",
        fromfromfromfrom: "war",
      },
      isTriggeredOnly: true,
    });
    const feature = mod.feature("deep_contract", [
      matching,
      mismatched,
      mod.on(onActions.onStatusQuo, [matching]),
      mod.on(onActions.onStatusQuo, [mismatched] as never),
    ]);

    expect(() => mod.compile([feature])).toThrow(
      /supplies country scope with from country, fromfrom country, fromfromfrom country, fromfromfromfrom war, but event "on_action_test.15" declares country scope with from country, fromfrom fleet/
    );
  });

  it("accepts the split ROOT contract a generated hook declares", () => {
    const events = mod.namespace();
    const colonization = events.carrier(16, {
      scopes: { root: "planet" },
      isTriggeredOnly: true,
      immediate: (carrier, ctx) => {
        carrier.log("carrier");
        ctx.root.effects((planet) => planet.log("root planet"));
      },
    });
    const feature = mod.feature("split_root", [
      colonization,
      mod.on(onActions.onColonizationStarted, [colonization]),
    ]);

    expect(
      render(mod.compile([feature])).get("common/on_actions/on_action_test_on_actions.txt")
    ).toContain("on_colonization_started = {\n\tevents = { on_action_test.16 }");
  });

  it("rejects empty object-form lists at runtime", () => {
    expect(() =>
      mod.on(onActions.onGameStartCountry, {
        randomEvents: [],
      } as never)
    ).toThrow(/randomEvents must contain at least one row/);
    expect(() => mod.on(onActions.onGameStartCountry, {} as never)).toThrow(
      /must define events, randomEvents, or both/
    );
  });
});
