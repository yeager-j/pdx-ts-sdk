import { describe, expect, it } from "vitest";

import { countryFlags } from "../src/generated/value-sets.ts";
import { createMod, render } from "../src/index.ts";
import { eventTarget } from "../src/script/effects/recorder.ts";
import {
  hasAuthority,
  hasTechnology,
  not,
  or,
  type ScopeRef,
  type ScopeValue,
} from "../src/stellaris.ts";

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
  it("refuses a split-root self witness even when its type is bypassed", () => {
    const runtimeMod = createMod({
      name: "Split-root witness",
      prefix: "split_root_witness",
      supportedVersion: "4.4.*",
    });
    const events = runtimeMod.namespace();
    const needsPlanetFrom = events.planet(1, {
      scopes: { from: "planet" },
      hideWindow: true,
      isTriggeredOnly: true,
    });

    expect(() => {
      const initializer = runtimeMod.solarSystemInitializer("runtime_backstop", {
        class: "sc_g",
        planet: [
          {
            initEffect: (planet, ctx) => {
              planet.planetEvent({
                id: needsPlanetFrom,
                scopes: { from: ctx.self as unknown as ScopeValue<"planet"> },
              });
            },
          },
        ],
      });
      runtimeMod.compile([runtimeMod.feature("runtime_backstop", [initializer, needsPlanetFrom])]);
    }).toThrow(/split-root.*natural FROM.*ROOT/i);
  });

  it("writes an explicit ROOT witness at a split-root fire site", () => {
    const runtimeMod = createMod({
      name: "Split-root ROOT witness",
      prefix: "split_root_root",
      supportedVersion: "4.4.*",
    });
    const events = runtimeMod.namespace();
    const needsCountryFrom = events.planet(2, {
      scopes: { from: "country" },
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const initializer = runtimeMod.solarSystemInitializer("root_witness", {
      class: "sc_g",
      planet: [
        {
          initEffect: (planet, ctx) => {
            planet.planetEvent({ id: needsCountryFrom, scopes: { from: ctx.root } });
          },
        },
      ],
    });

    const rendered = render(
      runtimeMod.compile([runtimeMod.feature("root_witness", [initializer, needsCountryFrom])])
    ).get("common/solar_system_initializers/split_root_root_root_witness.txt")!;

    expect(rendered).toContain("planet_event = {");
    expect(rendered).toContain("scopes = {");
    expect(rendered).toContain("from = root");
  });

  it("rejects a relative THIS witness for a deeper FROM slot", () => {
    const runtimeMod = createMod({
      name: "Relative deep witness",
      prefix: "relative_deep",
      supportedVersion: "4.4.*",
    });
    const events = runtimeMod.namespace();
    const chained = events.planet(3, {
      scopes: { from: "country", fromfrom: "country" },
      hideWindow: true,
      isTriggeredOnly: true,
    });
    expect(() => {
      const source = events.country(4, {
        hideWindow: true,
        isTriggeredOnly: true,
        immediate: (country, ctx) => {
          country.everyOwnedPlanet({}, (planet) => {
            planet.planetEvent({
              id: chained,
              scopes: {
                from: ctx.root,
                fromfrom: ctx.self as unknown as ScopeRef<"country">,
              },
            });
          });
        },
      });
      runtimeMod.compile([runtimeMod.feature("relative_deep", [source, chained])]);
    }).toThrow(/fromfrom.*relative THIS/i);
  });

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
      options: [
        { name: { english: "First.", key: "a" } },
        { name: { english: "Second.", key: "b" } },
      ],
    });
    const loc = render(mod.compile([mod.feature("events", [titled])])).get(
      "localisation/english/event_test_events_l_english.yml"
    )!;
    expect(loc).toContain(' event_test.2.name:0 "A Title"');
    expect(loc).toContain(' event_test.2.desc:0 "A description."');
    expect(loc).toContain(' event_test.2.a:0 "First."');
    expect(loc).toContain(' event_test.2.b:0 "Second."');
  });

  it("keeps an option localization key attached to its name when a prior option is inserted", () => {
    const events = makeEvents();
    const before = events.country(200, {
      isTriggeredOnly: true,
      options: [{ name: "Keep this translation." }],
    });
    const after = events.country(200, {
      isTriggeredOnly: true,
      options: [{ name: "Inserted option." }, { name: "Keep this translation." }],
    });
    const keyFor = (item: typeof before) => {
      const files = render(mod.compile([mod.feature("events", [item])]));
      const loc = files.get("localisation/english/event_test_events_l_english.yml")!;
      return /^ (\S+):0 "Keep this translation\."$/m.exec(loc)?.[1];
    };
    expect(keyFor(after)).toBe(keyFor(before));
  });

  it("uses an explicit option key for every localized option field", () => {
    const events = makeEvents();
    const item = events.country(201, {
      isTriggeredOnly: true,
      options: [
        {
          name: { english: "A changing caption.", key: "accept_quest" },
          icon: { icon: "GFX_option", text: "Icon caption." },
          responseText: "Response caption.",
          aiChance: {
            modifiers: [{ factor: 2, desc: { english: "AI tooltip.", key: "ai_tooltip" } }],
          },
        },
      ],
    });
    const files = render(mod.compile([mod.feature("events", [item])]));
    const rendered = files.get("events/event_test_events.txt")!;
    expect(rendered).toContain("name = event_test.201.accept_quest");
    expect(rendered).toContain("text = event_test.201.accept_quest.icon");
    expect(rendered).toContain("response_text = event_test.201.accept_quest.response");
    expect(files.get("localisation/english/event_test_events_l_english.yml")).toContain(
      "event_test.201_option_accept_quest.ai_chance_ai_tooltip"
    );
  });

  it("warns once and uses the exact eight-character name hash when key is omitted", () => {
    const events = makeEvents();
    const item = events.country(202, {
      isTriggeredOnly: true,
      options: [{ name: "Hash this option." }],
    });
    const compiled = mod.compile([mod.feature("events", [item])]);
    expect(
      compiled.warnings.filter((warning) => warning.code === "unstable-option-key")
    ).toHaveLength(1);
    expect(render(compiled).get("events/event_test_events.txt")).toContain(
      "name = event_test.202.7ef0c6d8"
    );
  });

  it("accepts a numeric-looking key and keeps it stable when the name changes", () => {
    const events = makeEvents();
    const before = events.country(204, {
      isTriggeredOnly: true,
      options: [{ name: { english: "Original", key: "2a" } }],
    });
    const after = events.country(204, {
      isTriggeredOnly: true,
      options: [{ name: { english: "Renamed", key: "2a" } }],
    });
    const keyFor = (item: typeof before) =>
      render(mod.compile([mod.feature("events", [item])]))
        .get("events/event_test_events.txt")!
        .match(/name = (event_test\.204\.2a)/)?.[1];
    expect(keyFor(before)).toBe("event_test.204.2a");
    expect(keyFor(after)).toBe(keyFor(before));
  });

  it("rejects an unsafe explicit option key", () => {
    const events = makeEvents();
    expect(() =>
      events.country(203, {
        isTriggeredOnly: true,
        options: [{ name: { english: "Unsafe", key: "not safe" } }],
      })
    ).toThrow('Localization key suffix "not safe"');
  });

  it("writes DoA-style conditional descriptions in order with generated localization", () => {
    const events = makeEvents();
    const ascension = events.country(30, {
      title: "Ascension",
      conditionalDesc: [
        {
          trigger: not(
            or(hasAuthority("auth_hive_mind"), hasAuthority("auth_machine_intelligence"))
          ),
          text: "The ascension belongs to ordinary empires.",
        },
        {
          trigger: hasAuthority("auth_hive_mind"),
          text: "The hive ascends as one.",
        },
        {
          trigger: hasAuthority("auth_machine_intelligence"),
          text: "The intelligence rewrites itself.",
        },
      ],
      isTriggeredOnly: true,
      options: [{ name: "Begin." }],
    });

    const files = render(mod.compile([mod.feature("events", [ascension])]));
    const rendered = files.get("events/event_test_events.txt")!;
    const loc = files.get("localisation/english/event_test_events_l_english.yml")!;

    expect(rendered).toContain("text = event_test.30.desc");
    expect(rendered).toContain("text = event_test.30.desc.1");
    expect(rendered).toContain("text = event_test.30.desc.2");
    expect(rendered.indexOf("text = event_test.30.desc")).toBeLessThan(
      rendered.indexOf("text = event_test.30.desc.1")
    );
    expect(rendered.indexOf("text = event_test.30.desc.1")).toBeLessThan(
      rendered.indexOf("text = event_test.30.desc.2")
    );
    expect(loc).toContain(' event_test.30.desc:0 "The ascension belongs to ordinary empires."');
    expect(loc).toContain(' event_test.30.desc.1:0 "The hive ascends as one."');
    expect(loc).toContain(' event_test.30.desc.2:0 "The intelligence rewrites itself."');
  });

  it("supports every conditional description field beside an ordinary description", () => {
    const events = makeEvents();
    const described = events.country(31, {
      desc: "The ordinary fallback.",
      conditionalDesc: [
        {
          exclusiveTrigger: hasAuthority("auth_hive_mind"),
          text: ["First hive paragraph.", "Second hive paragraph."],
          showSound: "event_default",
        },
        { trigger: hasAuthority("auth_machine_intelligence") },
      ],
      isTriggeredOnly: true,
      options: [{ name: "Continue." }],
    });

    const files = render(mod.compile([mod.feature("events", [described])]));
    const rendered = files.get("events/event_test_events.txt")!;
    const loc = files.get("localisation/english/event_test_events_l_english.yml")!;

    expect(rendered).toContain("desc = event_test.31.desc");
    expect(rendered).toContain(
      "desc = {\n\t\texclusive_trigger = {\n\t\t\thas_authority = auth_hive_mind\n\t\t}\n" +
        "\t\ttext = event_test.31.desc.1\n\t\ttext = event_test.31.desc.2\n" +
        "\t\tshow_sound = event_default\n\t}"
    );
    expect(rendered).toContain(
      "desc = {\n\t\ttrigger = {\n\t\t\thas_authority = auth_machine_intelligence\n\t\t}\n\t}"
    );
    expect(loc).toContain(' event_test.31.desc:0 "The ordinary fallback."');
    expect(loc).toContain(' event_test.31.desc.1:0 "First hive paragraph."');
    expect(loc).toContain(' event_test.31.desc.2:0 "Second hive paragraph."');
  });

  it("guards content references written by conditional description triggers", () => {
    const events = makeEvents();
    const orphan = mod.technology("conditional_orphan", {
      name: "Conditional orphan",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const described = events.country(32, {
      conditionalDesc: [
        {
          trigger: hasTechnology(orphan),
          exclusiveTrigger: hasTechnology(orphan),
          text: "Only with the orphan.",
        },
      ],
      isTriggeredOnly: true,
      options: [{ name: "Continue." }],
    });

    expect(described.refs.map((use) => use.field)).toEqual([
      "desc[0].trigger.has_technology",
      "desc[0].exclusive_trigger.has_technology",
    ]);
    expect(() => mod.compile([mod.feature("events", [described])])).toThrow(
      'event "event_test.32" references technology "event_test_tech_conditional_orphan" in ' +
        '"desc[0].trigger.has_technology"'
    );
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

  it("fires a third-party event from its raw id", () => {
    const events = makeEvents();
    const firing = events.country(14, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        country.countryEvent({ id: "third_party.5", days: 30 });
      },
    });
    const rendered = render(mod.compile([mod.feature("third_party", [firing])])).get(
      "events/event_test_third_party.txt"
    )!;
    expect(rendered).toContain("country_event = {\n\t\t\tid = third_party.5\n\t\t\tdays = 30");
  });

  it("serializes every explicit FROM override in canonical order", () => {
    const events = makeEvents();
    const fleet = eventTarget<"fleet">("event_test_fleet");
    const system = eventTarget<"system">("event_test_system");
    const target = events.country(16, {
      scopes: { from: "country", fromfrom: "fleet", fromfromfrom: "system" },
      hideWindow: true,
      isTriggeredOnly: true,
    });
    const firing = events.country(17, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.countryEvent({
          id: target,
          scopes: { from: ctx.root, fromfrom: fleet, fromfromfrom: system },
        });
      },
    });
    const rendered = render(mod.compile([mod.feature("chained_fires", [target, firing])])).get(
      "events/event_test_chained_fires.txt"
    )!;

    expect(rendered).toContain(
      "scopes = {\n\t\t\t\tfrom = root\n\t\t\t\tfromfrom = event_target:event_test_fleet\n\t\t\t\tfromfromfrom = event_target:event_test_system"
    );
  });

  it("opens the event's FROM from more than one of its blocks", () => {
    // One ctx serves the whole event, and its blocks record separately: the
    // immediate and the option are two recordings of the same lowering.
    const events = makeEvents();
    const withFrom = events.country(15, {
      scopes: { from: "planet" },
      isTriggeredOnly: true,
      immediate: (country, ctx) => {
        country.setCountryFlag(flags.event_test_flag);
        ctx.from.effects((planet) => planet.log("immediate"));
      },
      options: [
        {
          name: { english: "Open FROM here too.", key: "from_option" },
          effects: (country, ctx) => {
            ctx.from.effects((planet) => planet.log("option"));
          },
        },
      ],
    });
    const rendered = render(mod.compile([mod.feature("events", [withFrom])])).get(
      "events/event_test_events.txt"
    )!;

    expect(rendered).toContain("immediate = {\n\t\tset_country_flag = event_test_flag");
    expect(rendered).toContain("from = {\n\t\t\tlog = immediate");
    expect(rendered).toContain("from = {\n\t\t\tlog = option");
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
