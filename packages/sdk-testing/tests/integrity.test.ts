import { block, countryFlags, createMod, eventTarget, hasOwner, kv } from "@pdx-ts/sdk";
import { describe, expect, it } from "vitest";

import { fixture } from "../src/index.ts";
import { applyEffectEntries } from "../src/interpret.ts";
import { buildState } from "../src/state.ts";
import { coverageSummary, EFFECT_SEMANTICS, STRUCTURAL_SEMANTICS } from "../src/whitelist.ts";

const flags = countryFlags("sdk149_first", "sdk149_second", "sdk149_target_seen");

function makeMod(prefix: string) {
  return createMod({ name: prefix, prefix, supportedVersion: "4.4.*" });
}

describe("transactional event delivery", () => {
  it("rolls back state, fired records, logs, and queued effects when an immediate fails", () => {
    const mod = makeMod("sdk149_transaction");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.setCountryFlag(flags.sdk149_first);
        country.log("must roll back");
        country.addModifier({ modifier: "sdk149_unimplemented" });
      },
    });
    const world = fixture({ countries: [{ name: "player" }] }, { events: [event] });
    const player = world.country(0);

    expect(() => world.fire(event, player)).toThrow(/add_modifier.*unimplemented/);
    expect(player.hasFlag(flags.sdk149_first)).toBe(false);
    expect(world.fired).toEqual([]);
    expect(world.log).toEqual([]);
    expect(world.day).toBe(0);
  });

  it("keeps a failed queued delivery pending without advancing the clock", () => {
    const mod = makeMod("sdk149_queued_transaction");
    const events = mod.namespace();
    const failing = events.country(2, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.setCountryFlag(flags.sdk149_second);
        country.addModifier({ modifier: "sdk149_unimplemented" });
      },
    });
    const entry = events.country(1, {
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: failing, days: 1 }),
    });
    const world = fixture({ countries: [{ name: "player" }] }, { events: [entry, failing] });
    const player = world.country(0);

    world.fire(entry, player);
    expect(() => world.advance(1)).toThrow(/add_modifier.*unimplemented/);
    expect(player.hasFlag(flags.sdk149_second)).toBe(false);
    expect(world.day).toBe(0);
    expect(world.fired.map(({ id }) => id)).toEqual([entry.id]);
    expect(() => world.advance(1)).toThrow(/add_modifier.*unimplemented/);
  });

  it("commits into existing public collection references", () => {
    const mod = makeMod("sdk149_live_references");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.setCountryFlag(flags.sdk149_first);
        country.addResource({ resource: "influence", amount: 10 });
        country.log("committed");
        country.everyOwnedPlanet({}, (planet) => planet.addDeposit("d_minerals_1"));
      },
    });
    const world = fixture({ countries: [{ planets: [{}] }] }, { events: [event] });
    const country = world.country(0);
    const planet = country.planet(0);
    const fired = world.fired;
    const log = world.log;
    const deposits = planet.deposits;
    const countryState = country.state.countries[0]!;
    const countryFlags = countryState.flags;
    const resources = countryState.resources;

    world.fire(event, country);

    expect(fired.map(({ id }) => id)).toEqual([event.id]);
    expect(log).toEqual(["committed"]);
    expect(deposits).toEqual(["d_minerals_1"]);
    expect(countryFlags.has(flags.sdk149_first)).toBe(true);
    expect(resources.get("influence")).toBe(10);
  });
});

describe("event registration integrity", () => {
  it("rejects duplicate event IDs", () => {
    const mod = makeMod("sdk149_duplicate");
    const events = mod.namespace();
    const first = events.country(1, { isTriggeredOnly: true });
    const second = events.country(1, { isTriggeredOnly: true });

    expect(() => fixture({ countries: [{}] }, { events: [first, second] })).toThrow(
      /registered more than once/
    );
  });

  it("refuses to fire an unregistered event even when its ID is registered", () => {
    const mod = makeMod("sdk149_unregistered");
    const events = mod.namespace();
    const registered = events.country(1, { isTriggeredOnly: true });
    const unregistered = events.country(1, { isTriggeredOnly: true });
    const world = fixture({ countries: [{}] }, { events: [registered] });

    expect(() => world.fire(unregistered, world.country(0))).toThrow(
      /not registered with this fixture/
    );
    expect(world.fired).toEqual([]);
  });
});

describe("random-list choice identity", () => {
  it("selects duplicate-weight arms by zero-based occurrence index", () => {
    const mod = makeMod("sdk149_duplicate_weights");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.randomList([
          { weight: 50, do: () => country.setCountryFlag(flags.sdk149_first) },
          { weight: 50, do: () => country.setCountryFlag(flags.sdk149_second) },
        ]);
      },
    });
    const world = fixture({ countries: [{}] }, { events: [event] });

    world.fire(event, world.country(0), { arms: [1] });

    expect(world.country(0).hasFlag(flags.sdk149_first)).toBe(false);
    expect(world.country(0).hasFlag(flags.sdk149_second)).toBe(true);
  });

  it("rejects unused choices and rolls the delivery back", () => {
    const mod = makeMod("sdk149_unused_choice");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.randomList([{ weight: 1, do: () => country.setCountryFlag(flags.sdk149_first) }]);
      },
    });
    const world = fixture({ countries: [{}] }, { events: [event] });

    expect(() => world.fire(event, world.country(0), { arms: [0, 0] })).toThrow(/1 unused choice/);
    expect(world.country(0).hasFlag(flags.sdk149_first)).toBe(false);
    expect(world.fired).toEqual([]);
  });

  it("carries the remaining choice plan through delayed event chains", () => {
    const mod = makeMod("sdk149_delayed_choice");
    const events = mod.namespace();
    const followup = events.country(2, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.randomList([
          { weight: 7, do: () => country.setCountryFlag(flags.sdk149_first) },
          { weight: 7, do: () => country.setCountryFlag(flags.sdk149_second) },
        ]);
      },
    });
    const entry = events.country(1, {
      isTriggeredOnly: true,
      immediate: (country) => country.countryEvent({ id: followup, days: 1 }),
    });
    const world = fixture({ countries: [{}] }, { events: [entry, followup] });

    world.fire(entry, world.country(0), { arms: [1] });
    world.advance(1);

    expect(world.country(0).hasFlag(flags.sdk149_first)).toBe(false);
    expect(world.country(0).hasFlag(flags.sdk149_second)).toBe(true);
  });
});

describe("structural semantics audit", () => {
  it("keeps structural dispatch and coverage in one non-vacuous audited descriptor", () => {
    const entries = Object.values(STRUCTURAL_SEMANTICS);

    expect(entries).not.toHaveLength(0);
    expect(entries.every(({ note }) => note.trim().length > 0)).toBe(true);
    expect(STRUCTURAL_SEMANTICS.random_list?.disposition).toBe("forced-list");
    expect(STRUCTURAL_SEMANTICS.while?.disposition).toBe("unimplemented");
    expect(
      Object.entries(STRUCTURAL_SEMANTICS)
        .filter(([, { disposition }]) => disposition === "leaf")
        .map(([key]) => key)
        .filter((key) => EFFECT_SEMANTICS[key] === undefined)
    ).toEqual([]);
    expect(coverageSummary()).toContain("5 walker-modeled structurals");
    expect(coverageSummary()).toContain("2 leaf-delegated structurals");
    expect(coverageSummary()).toContain("8 explicitly refused structurals");
  });

  it("breaks an if chain across a transparent structural statement", () => {
    const state = buildState({ countries: [{}] });
    const scope = { kind: "country", country: 0 } as const;

    expect(() =>
      applyEffectEntries(
        [
          block("if", [block("limit", [kv("has_country_flag", flags.sdk149_first)])]),
          block("hidden_effect", [kv("log", "between")]),
          block("else", [kv("set_country_flag", flags.sdk149_second)]),
        ],
        scope,
        {
          state,
          root: scope,
          from: undefined,
          choicePlan: { arms: [], next: 0 },
          targets: new Map(),
        }
      )
    ).toThrow(/else without a preceding if/);

    expect(state.log).toEqual(["between"]);
    expect(state.countries[0]?.flags.has(flags.sdk149_second)).toBe(false);
  });

  it("refuses structural forms whose game semantics have not been verified", () => {
    const mod = makeMod("sdk167_refused_structures");
    const events = mod.namespace();
    const random = events.country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.random({ chance: 100 }, () => country.setCountryFlag(flags.sdk149_first));
      },
    });
    const lockedList = events.country(2, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.lockedRandomList([
          { weight: 1, do: () => country.setCountryFlag(flags.sdk149_first) },
        ]);
      },
    });
    const loop = events.country(3, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.whileLoop({ count: 1 }, () => {
          country.setCountryFlag(flags.sdk149_first);
        });
      },
    });
    const world = fixture({ countries: [{}] }, { events: [random, lockedList, loop] });
    const country = world.country(0);

    expect(() => world.fire(random, country)).toThrow(
      /Structural effect "random" is deliberately unimplemented/
    );
    expect(() => world.fire(lockedList, country)).toThrow(
      /Structural effect "locked_random_list" is deliberately unimplemented/
    );
    expect(() => world.fire(loop, country)).toThrow(
      /Structural effect "while" is deliberately unimplemented/
    );
    expect(country.hasFlag(flags.sdk149_first)).toBe(false);
  });
});

describe("event and link semantics", () => {
  it("refuses to execute an observer-event body when the observer country is unresolved", () => {
    const mod = makeMod("sdk149_observer");
    const events = mod.namespace();
    const observed = events.observer(2, { hideWindow: true, isTriggeredOnly: true });
    const entry = events.planet(1, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet) => planet.observerEvent({ id: observed }),
    });
    const world = fixture(
      { countries: [{ planets: [{ name: "homeworld" }] }] },
      { events: [entry, observed] }
    );

    expect(() => world.fire(entry, world.country(0).planet(0))).toThrow(
      /observer_event is legal to fire from planet scope.*cannot resolve that observer country/
    );
    expect(world.fired).toEqual([]);
  });

  it("resolves saved event-target links while traversing triggers", () => {
    const mod = makeMod("sdk149_target_trigger");
    const target = eventTarget<"planet">("sdk149_target");
    const event = mod.namespace().country(1, {
      isTriggeredOnly: true,
      immediate: (country) => {
        country.everyOwnedPlanet({}, (planet) => planet.saveEventTargetAs(target));
        country.if(target.trigger(hasOwner()), () => {
          country.setCountryFlag(flags.sdk149_target_seen);
        });
      },
    });
    const world = fixture({ countries: [{ planets: [{}] }] }, { events: [event] });

    world.fire(event, world.country(0));

    expect(world.country(0).hasFlag(flags.sdk149_target_seen)).toBe(true);
  });
});

describe("time boundaries", () => {
  for (const days of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`rejects invalid advance duration ${String(days)}`, () => {
      const world = fixture({ countries: [{}] }, { events: [] });

      expect(() => world.advance(days)).toThrow(/advance days must be a non-negative safe integer/);
      expect(world.day).toBe(0);
    });
  }

  // NaN never reaches here: it has no PDXScript spelling, so the effect
  // recorder refuses it when the event is defined rather than emitting a
  // `days = NaN` no game would read.
  it("rejects a fire delay with no numeric spelling when the event is defined", () => {
    const mod = makeMod("sdk149_delay_nan");
    const events = mod.namespace();
    const followup = events.country(2, { isTriggeredOnly: true });

    expect(() =>
      events.country(1, {
        isTriggeredOnly: true,
        immediate: (country) => country.countryEvent({ id: followup, days: Number.NaN }),
      })
    ).toThrow(/Cannot represent NaN/);
  });

  for (const days of [-1]) {
    it(`rejects invalid fire delay ${String(days)} transactionally`, () => {
      const mod = makeMod(
        `sdk149_delay_${String(days)
          .replaceAll(/[^a-z0-9]/gi, "_")
          .toLowerCase()}`
      );
      const events = mod.namespace();
      const followup = events.country(2, { isTriggeredOnly: true });
      const entry = events.country(1, {
        isTriggeredOnly: true,
        immediate: (country) => country.countryEvent({ id: followup, days }),
      });
      const world = fixture({ countries: [{}] }, { events: [entry, followup] });

      expect(() => world.fire(entry, world.country(0))).toThrow(
        /country_event days must be a non-negative safe integer/
      );
      expect(world.fired).toEqual([]);
      expect(world.day).toBe(0);
    });
  }
});
