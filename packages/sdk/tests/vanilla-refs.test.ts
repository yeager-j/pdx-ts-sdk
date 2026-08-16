/**
 * The `vanilla.*` namespace at runtime (SDK-12 seam D).
 *
 * Hermetic: none of this needs an install or the identifier package. What the
 * package adds is types, and the two `*.test-d.ts` suites cover that in both
 * worlds — here the question is only whether the values the helpers construct
 * survive `refId()` into serialized PDXScript, and whether the trie's two entry
 * points (navigation and the string call) agree about what an id is.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createMod, refId, render, vanilla } from "../src/index.ts";
import { toScalar } from "../src/script/scalar.ts";

const CONFIG = {
  name: "Vanilla ref tests",
  prefix: "vr",
  supportedVersion: "4.4.*",
};
const mod = createMod(CONFIG);

describe("checked helpers in ref fields", () => {
  it("serializes a vanilla technology reference as its bare id", () => {
    const technologies = mod.feature(undefined, [
      mod.technology("probe", {
        name: "Probe",
        area: "physics",
        tier: 2,
        category: "computing",
        prerequisites: [vanilla.technology("tech_lasers_1")],
      }),
    ]);
    expect(render(mod.compile([technologies])).get("common/technology/vr_technology.txt")).toBe(
      "vr_tech_probe = {\n" +
        "\tarea = physics\n" +
        "\ttier = 2\n" +
        "\tcategory = { computing }\n" +
        '\tprerequisites = { "tech_lasers_1" }\n' +
        "}\n"
    );
  });
});

/** Navigation is untyped in this program (the package is absent, so
 * `VanillaTrie<K>` is `{}`); the type-level version of each assertion below is
 * in the present-world suite. */
function navigate(trie: unknown): Record<string, Record<string, { readonly id: string }>> {
  return trie as Record<string, Record<string, { readonly id: string }>>;
}

describe("the oversized trie's two entry points", () => {
  it("reads a navigated id from the last segment alone", () => {
    // The proxy carries no id data. Every trie the generator emits spells its
    // leaf keys with the whole id and its earlier segments with the vanilla
    // file the id came from, so the last segment *is* the id and nothing is
    // reassembled — one behaviour, for every registry.
    expect(navigate(vanilla.spriteType)["eventpictures"]!["GFX_evt_ship_in_orbit"]!.id).toBe(
      "GFX_evt_ship_in_orbit"
    );
    expect(navigate(vanilla.staticModifier)["deficit"]!["food_deficit"]!.id).toBe("food_deficit");
  });

  it("reads the same id however deep the buckets go", () => {
    // `sound/toxoids/events/tox_events.asset` is three segments of navigation
    // before the leaf, and none of them is part of the id.
    const deep = navigate(vanilla.soundEffect)["toxoids"]!["events"] as unknown as Record<
      string,
      Record<string, { readonly id: string }>
    >;
    expect(deep["tox_events"]!["event_first_contact_toxoid"]!.id).toBe(
      "event_first_contact_toxoid"
    );
  });

  it("agrees with the string call form", () => {
    expect(vanilla.spriteType("GFX_evt_ship_in_orbit").id).toBe("GFX_evt_ship_in_orbit");
    expect(navigate(vanilla.spriteType)["eventpictures"]!["GFX_evt_ship_in_orbit"]!.id).toBe(
      vanilla.spriteType("GFX_evt_ship_in_orbit").id
    );
    expect(vanilla.staticModifier("food_deficit").id).toBe("food_deficit");
  });
});

describe("the event trie", () => {
  it("reconstructs the full id from namespace and local-id navigation", () => {
    const event = vanilla.event as unknown as Record<
      string,
      Record<string, { readonly id: string; readonly kind: string }>
    >;
    expect(event.story!.$5!.id).toBe("story.5");
    expect(event.story!.$5!.kind).toBe("event-ref");
    expect(event["federations"]!["type"]!.id).toBe("federations.type");
  });
});

describe("both lowering funnels see through the callable trie proxy", () => {
  // Both tries build their proxy over a bare function so the same value stays
  // callable *and* navigable (`vanilla.spriteType("id")` vs `vanilla.spriteType.a.b`).
  // `typeof` on such a proxy reflects the function target, so the shared
  // `refId` authority has to gate on `object` *or* `function`, or a navigated
  // reference falls through as an unusable non-scalar instead of lowering to
  // its id/path.
  const navigatedEvent = navigate(vanilla.event)["story"]!["$5"]!;
  const navigatedSprite = navigate(vanilla.spriteType)["eventpictures"]!["GFX_evt_ringworld"]!;

  it("lowers a navigated event reference through refId", () => {
    expect(refId(navigatedEvent)).toBe("story.5");
  });

  it("lowers a navigated event reference through toScalar", () => {
    expect(toScalar(navigatedEvent)).toBe("story.5");
  });

  it("lowers a navigated sprite reference through refId", () => {
    expect(refId(navigatedSprite)).toBe("GFX_evt_ringworld");
  });

  it("lowers a navigated sprite reference through toScalar", () => {
    expect(toScalar(navigatedSprite)).toBe("GFX_evt_ringworld");
  });

  it("still lowers the call form through refId and toScalar (regression pin)", () => {
    expect(refId(vanilla.spriteType("GFX_evt_ringworld"))).toBe("GFX_evt_ringworld");
    expect(toScalar(vanilla.spriteType("GFX_evt_ringworld"))).toBe("GFX_evt_ringworld");
  });

  it("keeps toScalar's explanatory error for unsupported objects", () => {
    expect(() => toScalar({ nope: true })).toThrow(
      'Cannot serialize {"nope":true} as an effect argument'
    );
  });

  it("answers `in` truthfully for the property the get trap serves", () => {
    // The proxy's reflection contract agrees with the properties its `get`
    // trap serves, independently of how a scalar consumer reads the id.
    expect("id" in navigatedEvent).toBe(true);
    expect("id" in navigatedSprite).toBe(true);
  });
});

describe("event media fields", () => {
  it("serializes picture and show_sound from vanilla references", () => {
    const events = mod.namespace();
    const shown = events.country(1, {
      title: "A Sighting",
      isTriggeredOnly: true,
      picture: vanilla.spriteType("GFX_evt_ship_in_orbit"),
      showSound: vanilla.soundEffect("event_alien_signal"),
    });
    const rendered = render(mod.compile([mod.feature("events", [shown])])).get(
      "events/vr_events.txt"
    )!;
    expect(rendered).toContain("picture = GFX_evt_ship_in_orbit");
    expect(rendered).toContain("show_sound = event_alien_signal");
  });
});

describe("firing a vanilla event by its navigable trie reference", () => {
  it("renders id = story.5 end to end", () => {
    const events = mod.namespace();
    const firing = events.country(2, {
      hideWindow: true,
      isTriggeredOnly: true,
      immediate: (country) => {
        const eventRef = vanilla.event as unknown as {
          readonly story: {
            readonly $5: { readonly id: string; readonly kind: "event-ref" };
          };
        };
        country.countryEvent({ id: eventRef.story.$5, days: 30 });
      },
    });
    const rendered = render(mod.compile([mod.feature("events", [firing])])).get(
      "events/vr_events.txt"
    )!;
    expect(rendered).toContain("country_event = {\n\t\t\tid = story.5\n\t\t\tdays = 30");
  });
});

describe("provenance consistency", () => {
  it("names the stamped package version in PROVENANCE.md", () => {
    // The generator stamps `package.json` and nothing else, so the prose that
    // tells a reader which game build these identifiers came from can silently
    // fall behind the artifact. This is what stops that.
    const manifest = JSON.parse(readFileSync("packages/stellaris-ids/package.json", "utf8")) as {
      version: string;
    };
    const provenance = readFileSync("packages/stellaris-ids/PROVENANCE.md", "utf8");
    expect(provenance).toContain(manifest.version);
  });
});
