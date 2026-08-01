import { describe, expect, it } from "vitest";

import { eventTarget } from "../src/effect-core.ts";
import { Mod } from "../src/mod.ts";

function makeMod(): Mod<"event_test"> {
  return new Mod({
    name: "Event runtime tests",
    prefix: "event_test",
    supportedVersion: "4.0.*",
  });
}

describe("event definitions on Mod", () => {
  it("rejects duplicate event ids within the namespace", () => {
    const mod = makeMod();
    mod.defineCountryEvent({ id: 1, hideWindow: true, isTriggeredOnly: true });
    expect(() => mod.definePlanetEvent({ id: 1, hideWindow: true, isTriggeredOnly: true })).toThrow(
      /Duplicate event id "event_test.1"/
    );
  });

  it("registers title, desc, and option localization under the event id", () => {
    const mod = makeMod();
    mod.defineCountryEvent({
      id: 2,
      title: "A Title",
      desc: "A description.",
      isTriggeredOnly: true,
      options: [{ name: "First." }, { name: "Second." }],
    });
    const loc = mod.render().get("localisation/english/event_test_l_english.yml")!;
    expect(loc).toContain(' event_test.2.name:0 "A Title"');
    expect(loc).toContain(' event_test.2.desc:0 "A description."');
    expect(loc).toContain(' event_test.2.a:0 "First."');
    expect(loc).toContain(' event_test.2.b:0 "Second."');
  });

  it("writes the namespace declaration first in the events file", () => {
    const mod = makeMod();
    mod.defineCountryEvent({ id: 3, hideWindow: true, isTriggeredOnly: true, fireOnlyOnce: true });
    const events = mod.render().get("events/event_test_events.txt")!;
    expect(events).toMatch(/^namespace = event_test\n/);
    expect(events).toContain("fire_only_once = yes");
    expect(events).toContain("hide_window = yes");
  });

  it("defines and fires a situation event through the generated kind methods", () => {
    const mod = makeMod();
    const chained = mod.defineSituationEvent({ id: 10, hideWindow: true, isTriggeredOnly: true });
    mod.defineSituationEvent({
      id: 11,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (situation) => {
        situation.situationEvent({ id: chained, days: 30 });
      },
    });
    const events = mod.render().get("events/event_test_events.txt")!;
    expect(events).toContain("situation_event = {\n\tid = event_test.10");
    expect(events).toContain("situation_event = {\n\t\t\tid = event_test.10\n\t\t\tdays = 30");
  });

  it("exposes observer_event's fire method in every scope", () => {
    // The observer_event fire effect declares `## scopes = any`, so its typed
    // signature rides UniversalEffects rather than one scope interface.
    const mod = makeMod();
    const observed = mod.defineObserverEvent({ id: 12, hideWindow: true, isTriggeredOnly: true });
    mod.definePlanetEvent({
      id: 13,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet) => {
        planet.observerEvent({ id: observed });
      },
    });
    const events = mod.render().get("events/event_test_events.txt")!;
    expect(events).toContain("observer_event = {\n\t\t\tid = event_test.12");
  });

  it("threads the declared target contract through start_situation", () => {
    const mod = makeMod();
    const sit = mod.defineSituationType({
      id: "event_test_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("event_test_world");
    mod.defineCountryEvent({
      id: 20,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.startSituation({ type: sit, target: world });
      },
    });
    const render = mod.render();
    const events = render.get("events/event_test_events.txt")!;
    expect(events).toContain("type = event_test_sit");
    expect(events).toContain("target = event_target:event_test_world");
    // The declaration is a compile-time contract only; it never serializes.
    const situations = render.get("common/situations/event_test_situations.txt")!;
    expect(situations).not.toContain("target");
  });
});
