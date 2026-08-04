import { describe, expect, it } from "vitest";

import { eventTarget } from "../src/effect-core.ts";
import { countryFlags } from "../src/generated/value-sets.ts";
import { createMod, render } from "../src/index.ts";

const flags = countryFlags("event_test_flag");

const CONFIG = {
  name: "Event runtime tests",
  prefix: "event_test",
  supportedVersion: "4.0.*",
};
const mod = createMod(CONFIG);

function makeEvents() {
  return mod.namespace();
}

describe("event definitions in a namespace", () => {
  it("rejects duplicate event ids within the namespace", () => {
    const events = makeEvents();
    const country = events.country(1, { hideWindow: true, isTriggeredOnly: true });
    const planet = events.planet(1, { hideWindow: true, isTriggeredOnly: true });
    expect(() => mod.compile([mod.feature("events", [country, planet])])).toThrow(
      /Duplicate event id "event_test.1"/
    );
  });

  it("registers title, desc, and option localization under the event id", () => {
    const events = makeEvents();
    const titled = events.country(2, {
      title: "A Title",
      desc: "A description.",
      isTriggeredOnly: true,
      options: [{ name: "First." }, { name: "Second." }],
    });
    const loc = render(mod.compile([mod.feature("events", [titled])])).get(
      "localisation/english/event_test_l_english.yml"
    )!;
    expect(loc).toContain(' event_test.2.name:0 "A Title"');
    expect(loc).toContain(' event_test.2.desc:0 "A description."');
    expect(loc).toContain(' event_test.2.a:0 "First."');
    expect(loc).toContain(' event_test.2.b:0 "Second."');
  });

  it("writes the namespace declaration first in the events file", () => {
    const events = makeEvents();
    const once = events.country(3, {
      hideWindow: true,
      isTriggeredOnly: true,
      fireOnlyOnce: true,
    });
    const rendered = render(mod.compile([mod.feature("events", [once])])).get(
      "events/event_test_events.txt"
    )!;
    expect(rendered).toMatch(/^namespace = event_test\n/);
    expect(rendered).toContain("fire_only_once = yes");
    expect(rendered).toContain("hide_window = yes");
  });

  it("defines and fires a situation event through the generated kind methods", () => {
    const events = makeEvents();
    const chained = events.situation(10, {
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const firing = events.situation(11, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (situation) => {
        situation.situationEvent({ id: chained, days: 30 });
      },
    });
    const rendered = render(mod.compile([mod.feature("events", [chained, firing])])).get(
      "events/event_test_events.txt"
    )!;
    expect(rendered).toContain("situation_event = {\n\tid = event_test.10");
    expect(rendered).toContain("situation_event = {\n\t\t\tid = event_test.10\n\t\t\tdays = 30");
  });

  it("exposes observer_event's fire method in every scope", () => {
    // The observer_event fire effect declares `## scopes = any`, so its typed
    // signature rides UniversalEffects rather than one scope interface.
    const events = makeEvents();
    const observed = events.observer(12, {
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const observer = events.planet(13, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet) => {
        planet.observerEvent({ id: observed });
      },
    });
    const rendered = render(mod.compile([mod.feature("events", [observed, observer])])).get(
      "events/event_test_events.txt"
    )!;
    expect(rendered).toContain("observer_event = {\n\t\t\tid = event_test.12");
  });

  it("threads the declared target contract through start_situation", () => {
    const events = makeEvents();
    const sit = mod.situationType("sit", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("event_test_world");
    const starter = events.country(20, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.startSituation({ type: sit, target: world });
      },
    });
    const files = render(
      mod.compile([mod.feature(undefined, [sit]), mod.feature("events", [starter])])
    );
    const rendered = files.get("events/event_test_events.txt")!;
    expect(rendered).toContain("type = event_test_sit");
    expect(rendered).toContain("target = event_target:event_test_world");
    // The declaration is a compile-time contract only; it never serializes.
    const situationsFile = files.get("common/situations/event_test_situations.txt")!;
    expect(situationsFile).not.toContain("target");
  });

  it("ergonomics: opens the situation's declared target with no explicit <T>", () => {
    // SDK-53: `targetScope` is declared once on `defineSituationType`, so the
    // `effect` body's `.target(...)` no longer restates it — unlike the
    // free-standing `target<S>(...)` trigger, which still has to (no
    // definition object is in scope there).
    const events = makeEvents();
    const sit = mod.situationType("sit_ergo", {
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "country",
    });
    const world = eventTarget<"country">("event_test_ergo_target");
    const starter = events.country(21, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.startSituation({
          type: sit,
          target: world,
          effect: (situation) => {
            situation.target((targetCountry) => {
              targetCountry.setCountryFlag(flags.event_test_flag);
            });
          },
        });
      },
    });
    const rendered = render(
      mod.compile([mod.feature(undefined, [sit]), mod.feature("events", [starter])])
    ).get("events/event_test_events.txt")!;
    expect(rendered).toContain(
      "effect = {\n\t\t\t\ttarget = {\n\t\t\t\t\tset_country_flag = event_test_flag"
    );
  });
});
