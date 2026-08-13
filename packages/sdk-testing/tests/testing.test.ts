import { kv } from "@pdx-ts/pdxscript";
import {
  countryFlags,
  createMod,
  eventTarget,
  globalFlags,
  hasCountryFlag,
  hasGlobalFlag,
  hiddenTrigger,
  nand,
  nor,
  numOwnedColonies,
  numOwnedPlanets,
  or,
  trigger,
} from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { evaluate, explain, fixture, renderExplanation } from "../src/index.ts";

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

  it("evaluates NOR and NAND through the interpreter", () => {
    const countryCondition = hasCountryFlag(flags.testing_group_left);
    const globalCondition = hasGlobalFlag(globals.testing_group_middle);

    for (const { countryFlags, globalFlags, neither, notBoth } of [
      { countryFlags: [], globalFlags: [], neither: true, notBoth: true },
      { countryFlags: [flags.testing_group_left], globalFlags: [], neither: false, notBoth: true },
      {
        countryFlags: [],
        globalFlags: [globals.testing_group_middle],
        neither: false,
        notBoth: true,
      },
      {
        countryFlags: [flags.testing_group_left],
        globalFlags: [globals.testing_group_middle],
        neither: false,
        notBoth: false,
      },
    ]) {
      const world = fixture(
        { globalFlags, countries: [{ name: "player", flags: countryFlags }] },
        { events: [] }
      );
      const country = world.country(0);

      expect(evaluate(nor(countryCondition, globalCondition), country)).toBe(neither);
      expect(evaluate(nand(countryCondition, globalCondition), country)).toBe(notBoth);
    }

    const world = fixture({ countries: [{ name: "player" }] }, { events: [] });
    expect(explain(nand(countryCondition, globalCondition), world.country(0))).toMatchObject({
      kind: "notAll",
      result: true,
    });
  });

  it("runs hidden effects and evaluates hidden conditions, transparently", () => {
    // Both hide from tooltips and neither changes what happens, so the
    // interpreter treats them as the wrappers they are rather than refusing
    // them as unknown semantics — the one case where transparency is the
    // whole meaning, not a guess about it.
    const mod = createMod({
      name: "Hidden semantics",
      prefix: "hidden_semantics",
      supportedVersion: "4.4.*",
    });
    const entry = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.hiddenEffect.effects((country) => country.setCountryFlag(flags.testing_group_left));
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
    const mod = createMod({
      name: "Target lifetime",
      prefix: "target_lifetime",
      supportedVersion: "4.4.*",
    });
    const target = eventTarget<"planet">("target_lifetime_planet");
    const followup = mod.namespace().country(2, {
      isTriggeredOnly: true,
      immediate: (country) => {
        target.effects((planet) => planet.log("should_not_run"));
      },
    });
    const entry = mod.namespace().country(1, {
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

  it("uses the firing execution ROOT as natural FROM inside a nested scope", () => {
    const mod = createMod({
      name: "Natural FROM",
      prefix: "natural_from",
      supportedVersion: "4.4.*",
    });
    const events = mod.namespace();
    const followup = events.planet(2, {
      from: "country",
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const entry = events.country(1, {
      from: "planet",
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        ctx.from.effects((planet) => {
          planet.planetEvent({ id: followup, from: ctx.self });
        });
      },
    });
    const world = fixture(
      { countries: [{ name: "player", planets: [{ name: "homeworld" }] }] },
      { events: [entry, followup] }
    );

    world.fire(entry, world.country(0), { from: world.country(0).planet(0) });
    world.advance(0);

    expect(world.fired).toMatchObject([
      {
        id: entry.id,
        scope: { kind: "country", country: 0 },
        from: { kind: "planet", country: 0, planet: 0 },
      },
      {
        id: followup.id,
        scope: { kind: "planet", country: 0, planet: 0 },
        from: { kind: "country", country: 0 },
      },
    ]);
  });
});

describe("resource storage", () => {
  function payoutEvent(prefix: string) {
    const mod = createMod({ name: prefix, prefix, supportedVersion: "4.4.*" });
    return mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => country.addResource({ resource: "energy", amount: 5000 }),
    });
  }

  it("bounds a payout at the declared capacity", () => {
    const event = payoutEvent("sdk140_capped");
    const world = fixture(
      { countries: [{ resources: { energy: 24_000 }, storage: { energy: 25_000 } }] },
      { events: [event] }
    );

    world.fire(event, world.country(0));

    expect(world.country(0).resource("energy")).toBe(25_000);
  });

  it("leaves a resource with no declared capacity unbounded", () => {
    const event = payoutEvent("sdk140_uncapped");
    const world = fixture(
      { countries: [{ resources: { energy: 24_000 }, storage: { minerals: 25_000 } }] },
      { events: [event] }
    );

    world.fire(event, world.country(0));

    expect(world.country(0).resource("energy")).toBe(29_000);
  });

  it.each([
    { value: Number.NaN, label: "NaN" },
    { value: Number.POSITIVE_INFINITY, label: "Infinity" },
    { value: -1, label: "a negative capacity" },
  ])("refuses $label as a storage capacity", ({ value }) => {
    // Left unchecked, Math.min(total, NaN) is NaN, and every later assertion
    // about that stockpile compares against a number that means nothing.
    expect(() =>
      fixture({ countries: [{ name: "player", storage: { energy: value } }] }, { events: [] })
    ).toThrow(/player's energy storage capacity must be a finite non-negative number/);
  });

  it("refuses a non-finite starting stockpile, but allows a deficit", () => {
    expect(() =>
      fixture(
        { countries: [{ name: "player", resources: { energy: Number.NaN } }] },
        { events: [] }
      )
    ).toThrow(/player's starting energy must be a finite number/);
    expect(
      fixture({ countries: [{ resources: { energy: -500 } }] }, { events: [] })
        .country(0)
        .resource("energy")
    ).toBe(-500);
  });

  it("refuses a fixture that starts above its own declared capacity", () => {
    expect(() =>
      fixture(
        { countries: [{ resources: { energy: 30_000 }, storage: { energy: 25_000 } }] },
        {
          events: [],
        }
      )
    ).toThrow(/starts with 30000 energy but declares storage for 25000/);
  });
});

describe("owned colony count", () => {
  it("answers the deprecated and current spellings from the one relation", () => {
    const world = fixture({ countries: [{ planets: [{}, {}] }] }, { events: [] });
    const country = world.country(0);

    expect(evaluate(numOwnedPlanets("=", 2), country)).toBe(true);
    expect(evaluate(numOwnedColonies("=", 2), country)).toBe(true);
    expect(explain(numOwnedColonies(">", 2), country).result).toBe(false);
    expect(renderExplanation(explain(numOwnedColonies("=", 2), country))).toContain(
      "2 owned colonies"
    );
  });
});
