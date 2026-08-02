import { describe, expect, it } from "vitest";

import { eventTarget } from "../src/effect-core.ts";
import { buildMod, createEvents, createSituationTypes, render } from "../src/index.ts";

const CONFIG = {
  name: "Event runtime tests",
  prefix: "event_test",
  supportedVersion: "4.0.*",
};

function makeEvents() {
  return createEvents("events", "event_test");
}

describe("event definitions on a collection", () => {
  it("rejects duplicate event ids within the namespace", () => {
    const events = makeEvents();
    events.defineCountryEvent({ id: 1, hideWindow: true, isTriggeredOnly: true });
    expect(() =>
      events.definePlanetEvent({ id: 1, hideWindow: true, isTriggeredOnly: true })
    ).toThrow(/Duplicate event id "event_test.1"/);
  });

  it("registers title, desc, and option localization under the event id", () => {
    const events = makeEvents();
    events.defineCountryEvent({
      id: 2,
      title: "A Title",
      desc: "A description.",
      isTriggeredOnly: true,
      options: [{ name: "First." }, { name: "Second." }],
    });
    const loc = render(buildMod(CONFIG, [events])).get(
      "localisation/english/event_test_l_english.yml"
    )!;
    expect(loc).toContain(' event_test.2.name:0 "A Title"');
    expect(loc).toContain(' event_test.2.desc:0 "A description."');
    expect(loc).toContain(' event_test.2.a:0 "First."');
    expect(loc).toContain(' event_test.2.b:0 "Second."');
  });

  it("writes the namespace declaration first in the events file", () => {
    const events = makeEvents();
    events.defineCountryEvent({
      id: 3,
      hideWindow: true,
      isTriggeredOnly: true,
      fireOnlyOnce: true,
    });
    const rendered = render(buildMod(CONFIG, [events])).get("events/event_test_events.txt")!;
    expect(rendered).toMatch(/^namespace = event_test\n/);
    expect(rendered).toContain("fire_only_once = yes");
    expect(rendered).toContain("hide_window = yes");
  });

  it("defines and fires a situation event through the generated kind methods", () => {
    const events = makeEvents();
    const chained = events.defineSituationEvent({
      id: 10,
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.defineSituationEvent({
      id: 11,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (situation) => {
        situation.situationEvent({ id: chained, days: 30 });
      },
    });
    const rendered = render(buildMod(CONFIG, [events])).get("events/event_test_events.txt")!;
    expect(rendered).toContain("situation_event = {\n\tid = event_test.10");
    expect(rendered).toContain("situation_event = {\n\t\t\tid = event_test.10\n\t\t\tdays = 30");
  });

  it("exposes observer_event's fire method in every scope", () => {
    // The observer_event fire effect declares `## scopes = any`, so its typed
    // signature rides UniversalEffects rather than one scope interface.
    const events = makeEvents();
    const observed = events.defineObserverEvent({
      id: 12,
      hideWindow: true,
      isTriggeredOnly: true,
    });
    events.definePlanetEvent({
      id: 13,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (planet) => {
        planet.observerEvent({ id: observed });
      },
    });
    const rendered = render(buildMod(CONFIG, [events])).get("events/event_test_events.txt")!;
    expect(rendered).toContain("observer_event = {\n\t\t\tid = event_test.12");
  });

  it("threads the declared target contract through start_situation", () => {
    const situations = createSituationTypes();
    const events = makeEvents();
    const sit = situations.defineSituationType({
      id: "event_test_sit",
      name: "S",
      monthlyProgress: { base: 1 },
      targetScope: "planet",
    });
    const world = eventTarget<"planet">("event_test_world");
    events.defineCountryEvent({
      id: 20,
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.startSituation({ type: sit, target: world });
      },
    });
    const files = render(buildMod(CONFIG, [situations, events]));
    const rendered = files.get("events/event_test_events.txt")!;
    expect(rendered).toContain("type = event_test_sit");
    expect(rendered).toContain("target = event_target:event_test_world");
    // The declaration is a compile-time contract only; it never serializes.
    const situationsFile = files.get("common/situations/event_test_situations.txt")!;
    expect(situationsFile).not.toContain("target");
  });
});
