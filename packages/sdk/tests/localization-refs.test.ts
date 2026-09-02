/**
 * SDK-305: the localization keys a definition mints, exposed as references on
 * the item, and the `loc` tag that embeds them in another definition's text.
 */

import { describe, expect, it } from "vitest";

import { always } from "../src/generated/triggers.ts";
import { createMod, loc, render, type LocInterpolation } from "../src/index.ts";

function capability(prefix = "loc_refs") {
  return createMod({ name: "Localization references", prefix, supportedVersion: "4.4.*" });
}

function technology(mod: ReturnType<typeof capability>, name: string, desc?: string) {
  return mod.technology(name, {
    cost: 100,
    weight: 100,
    name: "Resonance Theory",
    ...(desc === undefined ? {} : { desc }),
    area: "physics",
    tier: 1,
    category: "particles",
  });
}

describe("content localization references", () => {
  it("carries the registry's derived key for every declared slot", () => {
    const mod = capability();
    const tech = technology(mod, "theory", "A hum beneath the vacuum.");

    expect(tech.loc.name.key).toBe("loc_refs_tech_theory");
    expect(tech.loc.desc.key).toBe("loc_refs_tech_theory_desc");
  });

  it("offers a slot whose text was never supplied, and ships no entry for it", () => {
    const mod = capability();
    const tech = technology(mod, "theory");
    const files = render(mod.compile([mod.feature("theory", [tech])]));

    // The key is derivable from the id alone, so the reference exists whether
    // or not anything is behind it — the trade the `loc` member documents.
    expect(tech.loc.desc.key).toBe("loc_refs_tech_theory_desc");
    expect(files.get("localisation/english/loc_refs_theory_l_english.yml")).not.toContain(
      "loc_refs_tech_theory_desc"
    );
  });

  it("emits one definition's key where another definition names a key", () => {
    const mod = capability();
    const tech = technology(mod, "theory", "A hum beneath the vacuum.");
    const site = mod.archaeologicalSiteType("dig", {
      name: "Resonant Dig",
      conditionalDesc: tech.loc.desc,
      allow: always(),
      visible: always(),
      stages: 1,
      onRollFailed: () => {},
    });
    const compiled = mod.compile([mod.feature("dig", [tech, site])]);
    const files = render(compiled);

    expect(compiled.warnings).toEqual([]);
    expect(files.get("common/archaeological_site_types/loc_refs_dig.txt")).toContain(
      "desc = loc_refs_tech_theory_desc"
    );
    // A reference names a key that already exists, so nothing new is registered
    // and the technology's own text stays the single entry under it.
    expect(
      files
        .get("localisation/english/loc_refs_dig_l_english.yml")!
        .match(/loc_refs_tech_theory_desc:0/g)
    ).toHaveLength(1);
  });

  it("exposes the reference for a synthetic-pointer slot", () => {
    const mod = capability();
    const site = mod.archaeologicalSiteType("dig", {
      name: "Resonant Dig",
      desc: "A crumbling ruin, half swallowed by the dust.",
      allow: always(),
      visible: always(),
      stages: 1,
      onRollFailed: () => {},
    });
    const files = render(mod.compile([mod.feature("dig", [site])]));

    // `desc` reaches the game through the generated `conditionalDesc` pointer
    // (SDK-50); the reference names the same key that pointer holds.
    expect(site.loc.desc.key).toBe("loc_refs_archaeological_site_type_dig_desc");
    expect(files.get("common/archaeological_site_types/loc_refs_dig.txt")).toContain(
      "desc = loc_refs_archaeological_site_type_dig_desc"
    );
  });
});

describe("event localization references", () => {
  it("carries a reference for each text slot the event supplied, and no others", () => {
    const mod = capability();
    const events = mod.namespace("story");
    const both = events.country(1, { title: "A Story", desc: "It begins.", isTriggeredOnly: true });
    const titleOnly = events.country(2, { title: "A Story", isTriggeredOnly: true });
    const neither = events.country(3, { isTriggeredOnly: true });

    expect(both.loc.title?.key).toBe("loc_refs_story.1.name");
    expect(both.loc.desc?.key).toBe("loc_refs_story.1.desc");
    expect(titleOnly.loc.desc).toBeUndefined();
    expect(neither.loc.title).toBeUndefined();
    expect(neither.loc.desc).toBeUndefined();
  });

  it("aligns option references with the authored order and the emitted keys", () => {
    const mod = capability();
    const event = mod.namespace("story").country(1, {
      isTriggeredOnly: true,
      options: [
        { name: { english: "Trace it to the source.", key: "trace_source" } },
        { name: { english: "Leave it alone.", key: "leave_alone" } },
      ],
    });
    const compiled = mod.compile([mod.feature("story", [event])]);
    const english = render(compiled).get("localisation/english/loc_refs_story_l_english.yml")!;

    expect(compiled.warnings).toEqual([]);
    expect(event.loc.options.map((option) => option.name.key)).toEqual([
      "loc_refs_story.1.trace_source",
      "loc_refs_story.1.leave_alone",
    ]);
    expect(english).toContain(' loc_refs_story.1.trace_source:0 "Trace it to the source."');
    expect(english).toContain(' loc_refs_story.1.leave_alone:0 "Leave it alone."');
  });

  it("keys an unpinned option reference to the hashed key the event emits", () => {
    const mod = capability();
    const event = mod.namespace("story").country(1, {
      isTriggeredOnly: true,
      options: [{ name: "Hash this option." }],
    });
    const english = render(mod.compile([mod.feature("story", [event])])).get(
      "localisation/english/loc_refs_story_l_english.yml"
    )!;

    expect(english).toContain(` ${event.loc.options[0]!.name.key}:0 "Hash this option."`);
  });

  it("carries the references through to the compiled mod's own events", () => {
    const mod = capability();
    const event = mod.namespace("story").country(1, {
      title: "A Story",
      isTriggeredOnly: true,
      options: [{ name: { english: "Answer.", key: "answer" } }],
    });
    const compiled = mod.compile([mod.feature("story", [event])]);
    const compiledEvent = compiled.events[0]!;

    // `PureMod.events` is `EventItemBase`, which is what inspection and tooling
    // read; the references have to survive the fold, not just the definer.
    expect(compiledEvent.loc.title?.key).toBe("loc_refs_story.1.name");
    expect(compiledEvent.loc.options.map((option) => option.name.key)).toEqual([
      "loc_refs_story.1.answer",
    ]);
  });

  it("deep-freezes the references a compiled mod hands back", () => {
    const mod = capability();
    const event = mod.namespace("story").country(1, {
      title: "A Story",
      isTriggeredOnly: true,
      options: [{ name: { english: "Answer.", key: "answer" } }],
    });
    const compiled = mod.compile([mod.feature("story", [event])]);
    const compiledLoc = compiled.events[0]!.loc;

    // The rest of an event's metadata is deep-frozen in `PureMod`; a mutable
    // option record inside it would be the one hole.
    expect(Object.isFrozen(compiledLoc)).toBe(true);
    expect(Object.isFrozen(compiledLoc.options)).toBe(true);
    expect(Object.isFrozen(compiledLoc.options[0])).toBe(true);
    expect(Object.isFrozen(compiledLoc.options[0]!.name)).toBe(true);
    expect(Object.isFrozen(compiledLoc.title)).toBe(true);
    // The authored event freezes the same shape at the lowering site, so the
    // guarantee does not depend on the fold having run.
    expect(Object.isFrozen(event.loc.options[0])).toBe(true);
  });
});

describe("the loc template tag", () => {
  it("writes a reference as the game's key variable and everything else as text", () => {
    const mod = capability();
    const tech = technology(mod, "theory", "A hum beneath the vacuum.");

    expect(loc`§Y${tech.loc.name}§! costs ${300} ${"credits"}.`).toBe(
      "§Y$loc_refs_tech_theory$§! costs 300 credits."
    );
    expect(loc`No interpolation at all.`).toBe("No interpolation at all.");
    expect(loc`${tech.loc.name}`).toBe("$loc_refs_tech_theory$");
  });

  it("refuses a value it cannot write as display text", () => {
    const mod = capability();
    const tech = technology(mod, "theory");

    expect(() => loc`Built by ${tech as unknown as LocInterpolation}.`).toThrow(
      /loc`` interpolation 0 is of type "object"/
    );
    expect(() => loc`Built by ${undefined as unknown as LocInterpolation}.`).toThrow(
      /interpolation 0 is of type "undefined"/
    );
  });

  it("reads back as ordinary display text in the slot it is written into", () => {
    const mod = capability();
    const tech = technology(mod, "theory", "A hum beneath the vacuum.");
    const perk = mod.ascensionPerk("ambition", {
      name: "Boundless Ambition",
      desc: loc`Unlocked by §Y${tech.loc.name}§!.`,
      potential: always(),
    });
    const english = render(mod.compile([mod.feature("ambition", [tech, perk])])).get(
      "localisation/english/loc_refs_ambition_l_english.yml"
    )!;

    expect(english).toContain(
      ' loc_refs_ascension_perk_ambition_desc:0 "Unlocked by §Y$loc_refs_tech_theory$§!."'
    );
  });
});
