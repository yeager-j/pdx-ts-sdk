/**
 * SDK-305: what an item's `loc` member resolves to per registry, and what it
 * refuses.
 */

import { describe, expectTypeOf, it } from "vitest";

import { always } from "../src/generated/triggers.ts";
import { createMod, type LocalizationRef, type NoLocalizationRefs } from "../src/index.ts";
import type {
  ContentLoc,
  EventItemBase,
  EventLoc,
  EventOptionLoc,
  TechnologyLoc,
} from "../src/stellaris.ts";

const mod = createMod({
  name: "Localization reference types",
  prefix: "loc_ref_types",
  supportedVersion: "4.4.*",
});

describe("content loc references", () => {
  it("names one reference per localization slot the registry declares", () => {
    expectTypeOf<TechnologyLoc>().toEqualTypeOf<{
      readonly name: LocalizationRef;
      readonly desc: LocalizationRef;
    }>();
    expectTypeOf<ContentLoc<"technology">>().toEqualTypeOf<TechnologyLoc>();

    const tech = mod.technology("theory", {
      name: "Resonance Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expectTypeOf(tech.loc).toEqualTypeOf<TechnologyLoc>();
    expectTypeOf(tech.loc.name).toEqualTypeOf<LocalizationRef>();
    // Present whether or not the definition supplied the text, so it is never
    // optional and never needs narrowing before use.
    expectTypeOf(tech.loc.desc).toEqualTypeOf<LocalizationRef>();
  });

  it("gives a registry with no declared slots an empty surface", () => {
    expectTypeOf<ContentLoc<"pdxparticle">>().toEqualTypeOf<NoLocalizationRefs>();

    const particle = mod.pdxparticle("dust", { type: "dust_cloud" });
    expectTypeOf(particle.loc).toEqualTypeOf<NoLocalizationRefs>();
    // @ts-expect-error — a pdxparticle mints no localization key to name.
    particle.loc.name;
  });

  it("refuses a slot the registry does not declare", () => {
    const perk = mod.ascensionPerk("ambition", {
      name: "Boundless Ambition",
      potential: always(),
    });
    // @ts-expect-error — `title` is not an ascension perk localization slot.
    perk.loc.title;
  });
});

describe("event loc references", () => {
  it("makes the supplied text slots optional and the option list ordered", () => {
    const event = mod.namespace("story").country(1, {
      title: "A Story",
      isTriggeredOnly: true,
      options: [{ name: { english: "Trace it.", key: "trace" } }],
    });

    expectTypeOf(event.loc).toEqualTypeOf<EventLoc>();
    expectTypeOf(event.loc.title).toEqualTypeOf<LocalizationRef | undefined>();
    expectTypeOf(event.loc.desc).toEqualTypeOf<LocalizationRef | undefined>();
    expectTypeOf(event.loc.options).toEqualTypeOf<readonly EventOptionLoc[]>();
    expectTypeOf<EventOptionLoc>().toEqualTypeOf<{ readonly name: LocalizationRef }>();
  });

  it("keeps the references readable off a compiled mod, not just an authored event", () => {
    const event = mod.namespace("story").country(1, { title: "A Story", isTriggeredOnly: true });
    const compiled = mod.compile([mod.feature("story", [event])]);

    // `PureMod.events` is `EventItemBase`; inspection and tooling read the
    // references there rather than from the definer's return value.
    expectTypeOf<EventItemBase["loc"]>().toEqualTypeOf<EventLoc>();
    expectTypeOf(compiled.events[0]!.loc).toEqualTypeOf<EventLoc>();
  });
});
