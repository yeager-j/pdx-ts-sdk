/**
 * SDK-145's first half: the creed applied one level up.
 *
 * Entry-level discipline was already real — an unknown trigger or effect
 * throws where it is evaluated. Delivery was not: `World` runs an event's
 * `immediate` and nothing else, so an event whose payoff lived in an option
 * appeared in the fired log with its payoff never run, and a `trigger` block
 * the game checks before firing was dropped without a word. Both are green
 * tests for behavior the game does not have, which is the one failure this
 * package exists to prevent.
 *
 * The situation clock is the same argument about time: a situation is a
 * monthly mechanic, `advance` ticks nothing, and a frozen situation under a
 * moving clock is a lie the harness now refuses to tell.
 */

import { countryFlags, createMod, hasCountryFlag } from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { fixture } from "../src/index.ts";

const flags = countryFlags("sdk145_paid", "sdk145_gated");

function makeMod(prefix: string) {
  return createMod({ name: prefix, prefix, supportedVersion: "4.4.*" });
}

describe("registration refuses events delivery cannot run", () => {
  it("refuses the live repro: a hidden event whose payoff lives in an option", () => {
    // The reported case, verbatim in shape: the event "fires" — it lands in
    // the fired log — while `setCountryFlag` never runs, so an assertion on
    // the fired log passes for a payoff that was never paid.
    const mod = makeMod("sdk145_option_payoff");
    const event = mod.namespace().country(1, {
      hideWindow: true,
      isTriggeredOnly: true,
      options: [
        {
          name: "Take the reward.",
          effects: (country) => country.setCountryFlag(flags.sdk145_paid),
        },
      ],
    });

    expect(() => fixture({ countries: [{ name: "player" }] }, { events: [event] })).toThrow(
      /carries "option", which delivery will not run.*set_country_flag/s
    );
  });

  it("keeps presentation-only options deliverable, because nothing is skipped", () => {
    // The scaffold's own starter event is this shape: an option with a name
    // and no effects, whose payoff is in the immediate. Refusing it would
    // refuse the common case to catch nothing.
    const mod = makeMod("sdk145_option_presentation");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => country.setCountryFlag(flags.sdk145_paid),
      options: [{ name: "Noted." }],
    });
    const world = fixture({ countries: [{ name: "player" }] }, { events: [event] });

    world.fire(event, world.country(0));

    expect(world.country(0).hasFlag(flags.sdk145_paid)).toBe(true);
  });

  it("refuses an event whose firing the game gates on a trigger this harness never checks", () => {
    const mod = makeMod("sdk145_gate");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      trigger: hasCountryFlag(flags.sdk145_gated),
      immediate: (country) => country.setCountryFlag(flags.sdk145_paid),
    });

    expect(() => fixture({ countries: [{ name: "player" }] }, { events: [event] })).toThrow(
      /carries "trigger", which delivery will not run/
    );
  });

  it("refuses abort gates and the effects that pair with them", () => {
    const mod = makeMod("sdk145_abort");
    const events = mod.namespace();
    const gated = events.country(1, {
      isTriggeredOnly: true,
      abortTrigger: hasCountryFlag(flags.sdk145_gated),
    });
    const aborting = events.country(2, {
      isTriggeredOnly: true,
      abortEffect: (country) => country.setCountryFlag(flags.sdk145_paid),
    });

    expect(() => fixture({ countries: [{}] }, { events: [gated] })).toThrow(
      /carries "abort_trigger".*disappear without executing/s
    );
    expect(() => fixture({ countries: [{}] }, { events: [aborting] })).toThrow(
      /carries "abort_effect"/
    );
  });

  it("refuses an `after` block, whose effects delivery reaches no more than an option's", () => {
    const mod = makeMod("sdk145_after");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      after: (country) => country.setCountryFlag(flags.sdk145_paid),
    });

    expect(() => fixture({ countries: [{}] }, { events: [event] })).toThrow(
      /carries "after", which delivery will not run/
    );
  });

  it("refuses at registration, not at the fire that happens to reach it", () => {
    // Registration is where the fixture's event list is declared, so this is
    // where an undeliverable event has to be caught: a fire-time refusal would
    // let a chain build state for days and then throw at a queued delivery.
    const mod = makeMod("sdk145_registration_time");
    const events = mod.namespace();
    const followup = events.country(2, {
      isTriggeredOnly: true,
      after: (country) => country.setCountryFlag(flags.sdk145_paid),
    });
    const entry = events.country(1, {
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: followup, days: 10 }),
    });

    expect(() => fixture({ countries: [{}] }, { events: [entry, followup] })).toThrow(
      /Event "sdk145_registration_time\.2" carries "after"/
    );
  });

  it("accepts the window fields that carry no script at all", () => {
    const mod = makeMod("sdk145_window");
    const event = mod.namespace().country(1, {
      title: "A New Signal",
      desc: "Something in the data does not belong.",
      hideWindow: true,
      isTriggeredOnly: true,
      fireOnlyOnce: true,
      major: true,
      majorTrigger: hasCountryFlag(flags.sdk145_gated),
      immediate: (country) => country.setCountryFlag(flags.sdk145_paid),
    });
    const world = fixture({ countries: [{ name: "player" }] }, { events: [event] });

    world.fire(event, world.country(0));

    expect(world.country(0).hasFlag(flags.sdk145_paid)).toBe(true);
  });
});

describe("fire_only_once is enforced by refusing the repeat", () => {
  const payingEvent = (prefix: string, fireOnlyOnce: boolean) => {
    const mod = makeMod(prefix);
    return mod.namespace().country(1, {
      isTriggeredOnly: true,
      fireOnlyOnce,
      immediate: (country) => country.addResource({ resource: "influence", amount: 50 }),
    });
  };

  it("refuses a second harness fire, and pays out exactly once", () => {
    const event = payingEvent("sdk145_once", true);
    const world = fixture({ countries: [{ name: "player" }] }, { events: [event] });

    world.fire(event, world.country(0));

    expect(() => world.fire(event, world.country(0))).toThrow(
      /declares fire_only_once and was already delivered in this world \(day 0/
    );
    expect(world.country(0).resource("influence")).toBe(50);
    expect(world.fired).toHaveLength(1);
  });

  it("refuses a repeat that arrives through the queue, rolling the delivery back", () => {
    const mod = makeMod("sdk145_once_queued");
    const events = mod.namespace();
    const once = events.country(2, {
      isTriggeredOnly: true,
      fireOnlyOnce: true,
      immediate: (country) => country.addResource({ resource: "influence", amount: 50 }),
    });
    const entry = events.country(1, {
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: once, days: 5 }),
    });
    const world = fixture({ countries: [{ name: "player" }] }, { events: [entry, once] });

    world.fire(entry, world.country(0));
    world.fire(once, world.country(0));

    expect(() => world.advance(5)).toThrow(/declares fire_only_once/);
    expect(world.country(0).resource("influence")).toBe(50);
    expect(world.day).toBe(0);
  });

  it("says nothing about an event that never made the claim", () => {
    const event = payingEvent("sdk145_repeatable", false);
    const world = fixture({ countries: [{ name: "player" }] }, { events: [event] });

    world.fire(event, world.country(0));
    world.fire(event, world.country(0));

    expect(world.country(0).resource("influence")).toBe(100);
  });

  it("counts per world, so a second fixture is the way to fire it again", () => {
    const event = payingEvent("sdk145_once_second_world", true);
    const first = fixture({ countries: [{ name: "player" }] }, { events: [event] });
    const second = fixture({ countries: [{ name: "player" }] }, { events: [event] });

    first.fire(event, first.country(0));
    second.fire(event, second.country(0));

    expect(second.country(0).resource("influence")).toBe(50);
  });
});

describe("the situation clock", () => {
  const situationWorld = (staticProgress?: boolean) =>
    fixture(
      {
        countries: [{ name: "player" }],
        situations: [
          {
            name: "identity crisis",
            targetCountry: 0,
            initialProgress: 50,
            ...(staticProgress === undefined ? {} : { staticProgress }),
          },
        ],
      },
      { events: [] }
    );

  it("refuses to cross a month boundary while a situation's progress would silently freeze", () => {
    const world = situationWorld();

    expect(() => world.advance(360)).toThrow(
      /crossing a month boundary while the fixture holds 1 situation.*"identity crisis"/s
    );
    expect(world.day).toBe(0);
    expect(world.situation(0).progress).toBe(50);
  });

  it("says what to do instead, rather than only what it refused", () => {
    expect(() => situationWorld().advance(30)).toThrow(
      /evaluateWeightBlock.*keep the advance inside the month.*staticProgress: true/s
    );
  });

  it("allows an advance that stays inside the month", () => {
    const world = situationWorld();

    world.advance(29);

    expect(world.day).toBe(29);
  });

  it("measures the boundary from the world's current day, not from the length of the step", () => {
    const world = situationWorld();

    world.advance(20);
    expect(() => world.advance(15)).toThrow(/crossing a month boundary/);
    expect(world.day).toBe(20);
  });

  it("takes the author's acknowledgement, and still never ticks anything", () => {
    const world = situationWorld(true);

    world.advance(360);

    expect(world.day).toBe(360);
    expect(world.situation(0).progress).toBe(50);
  });

  it("leaves a fixture with no situations alone", () => {
    const world = fixture({ countries: [{ name: "player" }] }, { events: [] });

    world.advance(3600);

    expect(world.day).toBe(3600);
  });
});
