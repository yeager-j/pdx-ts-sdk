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

import {
  buildMod,
  collection,
  defineTechnology,
  namespace,
  render,
  vanilla,
} from "../src/index.ts";

const CONFIG = {
  name: "Vanilla ref tests",
  prefix: "vr",
  supportedVersion: "4.4.*",
};

describe("checked helpers in ref fields", () => {
  it("serializes a vanilla technology reference as its bare id", () => {
    const technologies = collection(undefined, [
      defineTechnology({
        id: "vr_tech_probe",
        name: "Probe",
        area: "physics",
        tier: 2,
        category: "computing",
        prerequisites: [vanilla.technology("tech_lasers_1")],
      }),
    ]);
    expect(
      render(buildMod(CONFIG, [technologies])).get("common/technology/vr_technology.txt")
    ).toBe(
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
  it("reconstructs a navigated path by joining its segments with an underscore", () => {
    // The proxy carries no id data; the generator split every sprite id on
    // `_`, so joining the segments back is what makes navigation and the real
    // id the same string.
    expect(navigate(vanilla.sprite)["GFX"]!["evt"]!.id).toBe("GFX_evt");
  });

  it("agrees with the string call form", () => {
    expect(vanilla.sprite("a_b").id).toBe("a_b");
    expect(navigate(vanilla.sprite)["a"]!["b"]!.id).toBe(vanilla.sprite("a_b").id);
  });

  it("reads a file-bucketed registry's id from the leaf key alone", () => {
    // `static_modifier` navigates by source file, so the bucket segment is not
    // part of the id — the opposite contract from the sprite trie above, and
    // the reason `makeIdTrie` takes a mode rather than assuming one.
    expect(navigate(vanilla.staticModifier)["deficit"]!["food_deficit"]!.id).toBe("food_deficit");
    expect(vanilla.staticModifier("food_deficit").id).toBe("food_deficit");
  });
});

describe("event media fields", () => {
  it("serializes picture and show_sound from vanilla references", () => {
    const events = namespace("vr");
    const shown = events.defineCountryEvent({
      id: 1,
      title: "A Sighting",
      isTriggeredOnly: true,
      picture: vanilla.sprite("GFX_evt_ship_in_orbit"),
      showSound: vanilla.soundEffect("event_alien_signal"),
    });
    const rendered = render(buildMod(CONFIG, [collection("events", [shown])])).get(
      "events/vr_events.txt"
    )!;
    expect(rendered).toContain("picture = GFX_evt_ship_in_orbit");
    expect(rendered).toContain("show_sound = event_alien_signal");
  });
});

describe("provenance consistency", () => {
  it("names the stamped package version in PROVENANCE.md", () => {
    // The generator stamps `package.json` and nothing else, so the prose that
    // tells a reader which game build these identifiers came from can silently
    // fall behind the artifact. This is what stops that.
    const manifest = JSON.parse(
      readFileSync("packages/stellaris-vanilla/package.json", "utf8")
    ) as { version: string };
    const provenance = readFileSync("packages/stellaris-vanilla/PROVENANCE.md", "utf8");
    expect(provenance).toContain(manifest.version);
  });
});
