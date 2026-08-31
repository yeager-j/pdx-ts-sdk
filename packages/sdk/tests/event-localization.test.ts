/**
 * SDK-308 for events: every stored-key position takes one localization input,
 * and `event.loc` reports the references the event actually writes rather than
 * only the keys it minted.
 */

import { describe, expect, it } from "vitest";

import { always, customTooltip } from "../src/generated/triggers.ts";
import { createMod, external, render } from "../src/index.ts";
import { shortLocalizationHash } from "../src/localization-key.ts";
import { vanilla } from "../src/stellaris.ts";

function capability(prefix = "ev") {
  return createMod({ name: "Event localization", prefix, supportedVersion: "4.4.*" });
}

type Mod = ReturnType<typeof capability>;

function texts(mod: Mod, stem: string, items: Parameters<Mod["feature"]>[1], dir: string): string {
  const files = render(mod.compile([mod.feature(stem, items)]));
  return [...files.keys()]
    .filter((path) => path.startsWith(dir))
    .map((path) => files.get(path) ?? "")
    .join("\n");
}

describe("event text slots", () => {
  it("keys inline text off the event id, exactly as before", () => {
    const mod = capability();
    const events = mod.namespace("story");
    const event = events.country(1, {
      title: "First Contact",
      desc: { english: "A signal.", french: "Un signal." },
      diplomaticTitle: "Envoy",
      messageDesc: "They are here.",
      isTriggeredOnly: true,
    });

    expect(event.loc.title?.key).toBe("ev_story.1.name");
    expect(event.loc.desc?.key).toBe("ev_story.1.desc");
    expect(texts(mod, "story", [event], "events/")).toContain("title = ev_story.1.name");
    expect(texts(mod, "story", [event], "localisation/english")).toContain(
      ' ev_story.1.name:0 "First Contact"'
    );
  });

  it("emits a supplied reference and preserves it in loc", () => {
    const mod = capability();
    const events = mod.namespace("story");
    const owned = mod.localization("shared_title", "Shared title.");
    const event = events.country(2, {
      title: owned,
      desc: external.localization("EXISTING_DESC"),
      isTriggeredOnly: true,
    });

    // `loc` reports the effective reference, and a consumed item keeps its
    // provenance rather than being rebuilt as a plain reference.
    expect(event.loc.title).toBe(owned);
    expect(event.loc.desc?.key).toBe("EXISTING_DESC");
    const emitted = texts(mod, "story", [event], "events/");
    expect(emitted).toContain("title = ev_shared_title");
    expect(emitted).toContain("desc = EXISTING_DESC");
  });

  it("places a consumed item's text and registers none for a foreign key", () => {
    const mod = capability();
    const events = mod.namespace("story");
    const event = events.country(3, {
      title: mod.localization("shared_title", "Shared title."),
      desc: external.localization("SOME_OTHER_MOD_DESC"),
      isTriggeredOnly: true,
    });
    const english = texts(mod, "story", [event], "localisation/english");

    expect(english).toContain(' ev_shared_title:0 "Shared title."');
    expect(english).not.toContain("SOME_OTHER_MOD_DESC:0");
  });

  it("accepts a foreign key spelled like one of this mod's event ids", () => {
    // "probe.404" is exactly what an own event id looks like, and it is a
    // localization key. References are checked where they are recorded, and
    // the title field records a localization use, so nothing here demands an
    // event definition (SDK-323).
    const mod = capability("probe");
    const event = mod.namespace("story").country(6, {
      title: external.localization("probe.404"),
      isTriggeredOnly: true,
    });

    expect(texts(mod, "story", [event], "events/")).toContain("title = probe.404");
  });

  it("refuses a consumed item another capability minted", () => {
    const mine = capability("mine");
    const theirs = capability("theirs");
    const event = mine.namespace("story").country(4, {
      title: theirs.localization("shared", "Theirs."),
      isTriggeredOnly: true,
    });

    expect(() => mine.compile([mine.feature("story", [event])])).toThrow(
      /belongs to mod prefix "theirs"/
    );
  });

  it("keeps locEntries to the text the event owns", () => {
    const mod = capability();
    const event = mod.namespace("story").country(5, {
      title: "Owned title",
      desc: external.localization("EXISTING_DESC"),
      isTriggeredOnly: true,
    });

    expect(event.locEntries.map((entry) => entry.key)).toEqual(["ev_story.5.name"]);
  });

  it("emits an effective reference from a modifier description", () => {
    const mod = capability();
    const event = mod.namespace("story").country(16, {
      isTriggeredOnly: false,
      meanTimeToHappen: {
        days: 10,
        modifiers: [{ factor: 2, desc: external.localization("EXISTING_MODIFIER_DESC") }],
      },
    });

    expect(texts(mod, "story", [event], "events/")).toContain("desc = EXISTING_MODIFIER_DESC");
    expect(event.locEntries).toEqual([]);
  });
});

describe("event options", () => {
  it("hangs child text off the option's own stem for an inline name", () => {
    const mod = capability();
    const event = mod.namespace("story").country(6, {
      isTriggeredOnly: true,
      options: [
        {
          name: { english: "Answer.", key: "answer" },
          responseText: "They reply.",
          icon: { icon: "GFX_option", text: "Answer" },
        },
      ],
    });
    const emitted = texts(mod, "story", [event], "events/");

    expect(event.loc.options[0]!.name.key).toBe("ev_story.6.answer");
    expect(emitted).toContain("name = ev_story.6.answer");
    expect(emitted).toContain("response_text = ev_story.6.answer.response");
    expect(emitted).toContain("text = ev_story.6.answer.icon");
  });

  it("derives an event-owned stem when the option name is a reference", () => {
    const mod = capability();
    const event = mod.namespace("story").country(7, {
      isTriggeredOnly: true,
      options: [{ name: vanilla.localization("OK"), responseText: "They reply." }],
    });
    const stem = `ev_story.7.${shortLocalizationHash("OK")}`;
    const emitted = texts(mod, "story", [event], "events/");

    // The emitted name is the referenced key; the child response is not
    // defined under that key's namespace, which this build does not own.
    expect(emitted).toContain("name = OK");
    expect(emitted).toContain(`response_text = ${stem}.response`);
    expect(event.loc.options[0]!.name.key).toBe("OK");
    expect(texts(mod, "story", [event], "localisation/english")).toContain(
      ` ${stem}.response:0 "They reply."`
    );
  });

  it("deduplicates identical children under two options naming one key", () => {
    const mod = capability();
    const event = mod.namespace("story").country(8, {
      isTriggeredOnly: true,
      options: [
        { name: vanilla.localization("OK"), responseText: "Same." },
        { name: vanilla.localization("OK"), responseText: "Same." },
      ],
    });
    const stem = `ev_story.8.${shortLocalizationHash("OK")}`;
    const english = texts(mod, "story", [event], "localisation/english");

    expect(english.split(`${stem}.response:0`)).toHaveLength(2);
  });

  it("refuses conflicting children under two options naming one key", () => {
    const mod = capability();
    const event = mod.namespace("story").country(9, {
      isTriggeredOnly: true,
      options: [
        { name: vanilla.localization("OK"), responseText: "One." },
        { name: vanilla.localization("OK"), responseText: "Two." },
      ],
    });

    expect(() => render(mod.compile([mod.feature("story", [event])]))).toThrow(
      /Duplicate localization key/
    );
  });

  it("still warns about an unpinned inline option name", () => {
    const mod = capability();
    const event = mod.namespace("story").country(10, {
      isTriggeredOnly: true,
      options: [{ name: "Answer." }],
    });

    expect(event.warnings.map((warning) => warning.code)).toContain("unstable-option-key");
  });

  it("raises no unstable-option-key warning for a referenced name", () => {
    const mod = capability();
    const event = mod.namespace("story").country(11, {
      isTriggeredOnly: true,
      options: [{ name: vanilla.localization("OK") }],
    });

    expect(event.warnings.map((warning) => warning.code)).not.toContain("unstable-option-key");
  });
});

describe("conditional descriptions", () => {
  it("takes inline text and a reference in one repeated block", () => {
    const mod = capability();
    const event = mod.namespace("story").country(12, {
      isTriggeredOnly: true,
      conditionalDesc: [
        { trigger: always(), text: "A signal." },
        { text: external.localization("FALLBACK_DESC") },
      ],
    });
    const emitted = texts(mod, "story", [event], "events/");

    expect(emitted).toContain("text = ev_story.12.desc");
    expect(emitted).toContain("text = FALLBACK_DESC");
  });
});

describe("recorded script inside an event", () => {
  it("keys inline text against the event id", () => {
    const mod = capability();
    const event = mod.namespace("story").country(13, {
      isTriggeredOnly: true,
      trigger: customTooltip("Requires a gateway."),
    });
    const key = `ev_story.13_custom_tooltip_${shortLocalizationHash("Requires a gateway.")}`;

    expect(texts(mod, "story", [event], "events/")).toContain(`custom_tooltip = ${key}`);
    expect(texts(mod, "story", [event], "localisation/english")).toContain(
      ` ${key}:0 "Requires a gateway."`
    );
  });

  it("keys inline text recorded by an option effect against the same event", () => {
    const mod = capability();
    const event = mod.namespace("story").country(14, {
      isTriggeredOnly: true,
      options: [
        {
          name: { english: "Answer.", key: "answer" },
          effects: (scope) => {
            scope.customTooltip("The gate opens.");
          },
        },
      ],
    });
    const key = `ev_story.14_custom_tooltip_${shortLocalizationHash("The gate opens.")}`;

    expect(texts(mod, "story", [event], "events/")).toContain(`custom_tooltip = ${key}`);
  });

  it("leaves no marker in the emitted event file", () => {
    const mod = capability();
    const event = mod.namespace("story").country(15, {
      isTriggeredOnly: true,
      trigger: customTooltip("Requires a gateway."),
    });

    expect(texts(mod, "story", [event], "events/")).not.toContain("__pdx_deferred_localization_");
  });
});
