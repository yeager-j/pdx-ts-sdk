import { kv } from "@pdx-ts/pdxscript";
import {
  countryFlags,
  eventTarget,
  globalFlags,
  hasCountryFlag,
  hasGlobalFlag,
  hiddenTrigger,
  namespace,
  or,
  trigger,
} from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { evaluate, fixture } from "../src/index.ts";

const flags = countryFlags("testing_group_left", "testing_group_right");
const globals = globalFlags("testing_group_middle");

describe("production testing module", () => {
  it("evaluates a multi-entry OR operand as an AND group", () => {
    const world = fixture(
      {
        globalFlags: [globals.testing_group_middle],
        countries: [{ name: "player" }],
      },
      { events: [] }
    );
    const multiEntry = trigger<"country">([
      kv("has_country_flag", flags.testing_group_left),
      kv("has_global_flag", globals.testing_group_middle),
    ]);
    const condition = or(multiEntry, hasCountryFlag(flags.testing_group_right));

    expect(condition.entries).toHaveLength(1);
    expect(evaluate(condition, world.country(0))).toBe(false);
  });

  it("still evaluates an ordinary generated OR leaf", () => {
    const world = fixture(
      {
        globalFlags: [globals.testing_group_middle],
        countries: [{ name: "player" }],
      },
      { events: [] }
    );
    expect(
      evaluate(
        or(hasCountryFlag(flags.testing_group_left), hasGlobalFlag(globals.testing_group_middle)),
        world.country(0)
      )
    ).toBe(true);
  });

  it("runs hidden effects and evaluates hidden conditions, transparently", () => {
    // Both hide from tooltips and neither changes what happens, so the
    // interpreter treats them as the wrappers they are rather than refusing
    // them as unknown semantics — the one case where transparency is the
    // whole meaning, not a guess about it.
    const events = namespace("hidden_semantics");
    const entry = events.defineCountryEvent({
      id: 1,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.hiddenEffect((hidden) => hidden.setCountryFlag(flags.testing_group_left));
      },
    });
    const world = fixture({ countries: [{ name: "player" }] }, { events: [entry] });

    expect(
      evaluate(hiddenTrigger(hasCountryFlag(flags.testing_group_left)), world.country(0))
    ).toBe(false);
    world.fire(entry, world.country(0));
    expect(
      evaluate(hiddenTrigger(hasCountryFlag(flags.testing_group_left)), world.country(0))
    ).toBe(true);
    // And it is AND, not OR: every entry still has to hold.
    expect(
      evaluate(
        hiddenTrigger(
          hasCountryFlag(flags.testing_group_left),
          hasCountryFlag(flags.testing_group_right)
        ),
        world.country(0)
      )
    ).toBe(false);
  });

  it("does not carry saved event targets into delayed delivery", () => {
    const events = namespace("target_lifetime");
    const target = eventTarget<"planet">("target_lifetime_planet");
    const followup = events.defineCountryEvent({
      id: 2,
      isTriggeredOnly: true,
      immediate: (country) => {
        target.effects((planet) => planet.log("should_not_run"));
      },
    });
    const entry = events.defineCountryEvent({
      id: 1,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.everyOwnedPlanet({}, (planet) => planet.saveEventTargetAs(target));
        country.countryEvent({ id: followup, days: 1 });
      },
    });
    const world = fixture(
      { countries: [{ planets: [{ name: "homeworld" }] }] },
      { events: [entry, followup] }
    );

    world.fire(entry, world.country(0));

    expect(() => world.advance(1)).toThrow(/event target "target_lifetime_planet" was never saved/);
  });
});
