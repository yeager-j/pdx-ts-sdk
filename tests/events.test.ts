import { describe, expect, it } from "vitest";

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
});
