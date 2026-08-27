/**
 * SDK-306: a standalone localization item consumed through a reference rides
 * the consumer's Feature and stem, so placing it in a Feature of its own is
 * needed only for a key nothing references, or to choose a different stem.
 */

import { describe, expect, it } from "vitest";

import { createMod, external, render } from "../src/index.ts";
import { viewFromFiles } from "../src/installation/vanilla/view.ts";
import { always, customTooltip } from "../src/stellaris.ts";
import { BUILDING_FILE } from "./fixtures/vanilla-fixture.ts";

function capability(prefix = "place") {
  return createMod({ name: "Referenced placement", prefix, supportedVersion: "4.4.*" });
}

const TOOLTIP = { english: "Hums with resonance.", french: "Vibre de résonance." };

const vanilla = viewFromFiles(
  { "common/buildings/pp_buildings.txt": BUILDING_FILE },
  { gameVersion: "4.4.6" }
);

describe("a content field consuming a standalone item", () => {
  it("places the item's text in the consuming definition's own files", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const archive = mod.building("archive", { name: "Resonance Archive", customTooltip: tooltip });

    // The item itself is never placed: the reference is what carries it.
    const compiled = mod.compile([mod.feature("archive", [archive])]);
    const files = render(compiled);

    expect(compiled.warnings).toEqual([]);
    expect(files.get("common/buildings/place_archive.txt")).toContain(
      "custom_tooltip = place_archive_tooltip"
    );
    expect(files.get("localisation/english/place_archive_l_english.yml")).toContain(
      ' place_archive_tooltip:0 "Hums with resonance."'
    );
    expect(files.get("localisation/french/place_archive_l_french.yml")).toContain(
      ' place_archive_tooltip:0 "Vibre de résonance."'
    );
  });

  it("writes one file per language when two Features consume the same item", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const files = render(
      mod.compile([
        mod.feature("zeta", [mod.building("zeta", { name: "Zeta Vault", customTooltip: tooltip })]),
        mod.feature("alpha", [
          mod.building("alpha", { name: "Alpha Vault", customTooltip: tooltip }),
        ]),
      ])
    );

    // Identical registrations merge their stems, and the accumulator keeps the
    // lowest resulting path — so the entry is in `alpha`, not in both.
    expect(files.get("localisation/english/place_alpha_l_english.yml")).toContain(
      "place_archive_tooltip:0"
    );
    expect(files.get("localisation/english/place_zeta_l_english.yml")).not.toContain(
      "place_archive_tooltip:0"
    );
  });

  it("collapses an item that is both placed explicitly and consumed", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const compiled = mod.compile([
      mod.feature("shared", [tooltip]),
      mod.feature("zeta", [mod.building("zeta", { name: "Zeta Vault", customTooltip: tooltip })]),
    ]);
    const files = render(compiled);

    // Same layer, key and text, so the two registrations are one entry: the
    // explicit placement only adds a stem for the lowest-path rule to pick.
    // The building's own name text stays in its own Feature's file.
    expect(compiled.warnings).toEqual([]);
    expect(files.get("localisation/english/place_shared_l_english.yml")).toContain(
      "place_archive_tooltip:0"
    );
    expect(files.get("localisation/english/place_zeta_l_english.yml")).not.toContain(
      "place_archive_tooltip:0"
    );
  });

  it("still refuses two items that share a key but not their text", () => {
    const mod = capability();
    const first = mod.localization("archive_tooltip", "Hums with resonance.");
    const second = mod.localization("archive_tooltip", "Silent.");

    // Consuming registers on the same terms placing does, so the duplicate-key
    // check reaches text that no Feature places directly.
    expect(() =>
      mod.compile([
        mod.feature("alpha", [
          mod.building("alpha", { name: "Alpha Vault", customTooltip: first }),
        ]),
        mod.feature("zeta", [mod.building("zeta", { name: "Zeta Vault", customTooltip: second })]),
      ])
    ).toThrow('Duplicate localization key "place_archive_tooltip" for english');
  });

  it("registers nothing for an external key or a replacement item", () => {
    const mod = capability();
    const replacement = mod.replaceLocalization("BUILDING_RESEARCH_LAB_1", "Study Hall");
    const files = render(
      mod.compile([
        mod.feature("archive", [
          mod.building("archive", {
            name: "Resonance Archive",
            customTooltip: external.localization("VANILLA_KEY"),
          }),
          mod.building("annex", { name: "Annex", customTooltip: replacement }),
        ]),
      ])
    );

    expect(files.get("common/buildings/place_archive.txt")).toContain(
      "custom_tooltip = VANILLA_KEY"
    );
    expect(files.get("localisation/english/place_archive_l_english.yml")).not.toContain(
      "VANILLA_KEY"
    );
    // A replacement is a layer its author places deliberately, so consuming
    // its key opens no file for it.
    expect(files.get("localisation/replace/english/place_archive_l_english.yml")).toBeUndefined();
  });
});

describe("recorded script consuming a standalone item", () => {
  it("places an item a trigger inside a definition names", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const archive = mod.building("archive", {
      name: "Resonance Archive",
      potential: customTooltip({ text: tooltip, conditions: always() }),
    });
    const files = render(mod.compile([mod.feature("archive", [archive])]));

    expect(files.get("common/buildings/place_archive.txt")).toContain(
      "text = place_archive_tooltip"
    );
    expect(files.get("localisation/english/place_archive_l_english.yml")).toContain(
      ' place_archive_tooltip:0 "Hums with resonance."'
    );
    expect(files.get("localisation/french/place_archive_l_french.yml")).toContain(
      "place_archive_tooltip:0"
    );
  });

  it("places an item an effect inside a definition names", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const archive = mod.building("archive", {
      name: "Resonance Archive",
      onBuilt: (scope) => {
        scope.customTooltip(tooltip);
      },
    });
    const files = render(mod.compile([mod.feature("archive", [archive])]));

    expect(files.get("common/buildings/place_archive.txt")).toContain(
      "custom_tooltip = place_archive_tooltip"
    );
    expect(files.get("localisation/english/place_archive_l_english.yml")).toContain(
      "place_archive_tooltip:0"
    );
  });

  it("places an item an event's closure names", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const event = mod.namespace("story").country(1, {
      title: "A Story",
      isTriggeredOnly: true,
      immediate: (scope) => {
        scope.customTooltip(tooltip);
      },
    });
    const files = render(mod.compile([mod.feature("story", [event])]));

    expect(files.get("events/place_story.txt")).toContain("custom_tooltip = place_archive_tooltip");
    expect(files.get("localisation/english/place_story_l_english.yml")).toContain(
      "place_archive_tooltip:0"
    );
  });
});

describe("a patch consuming a standalone item", () => {
  it("places the item under the patch's own stem", () => {
    const mod = capability();
    const tooltip = mod.localization("archive_tooltip", TOOLTIP);
    const patch = mod.patchBuilding(vanilla.definition("building", "building_pp_refinery"), () => ({
      customTooltip: tooltip,
    }));
    const files = render(mod.compile([mod.feature("refinery", [patch])], { vanilla }));

    expect(files.get("localisation/english/place_refinery_l_english.yml")).toContain(
      ' place_archive_tooltip:0 "Hums with resonance."'
    );
    expect(files.get("localisation/french/place_refinery_l_french.yml")).toContain(
      "place_archive_tooltip:0"
    );
  });
});

describe("ownership of a consumed item", () => {
  it("refuses a content field consuming another capability's item", () => {
    const mod = capability();
    const other = capability("elsewhere");
    const foreign = other.localization("archive_tooltip", TOOLTIP);
    const archive = mod.building("archive", { name: "Resonance Archive", customTooltip: foreign });

    // Placing the item throws already; referencing it places it, so it throws
    // on the same terms rather than shipping another mod's text.
    expect(() => mod.compile([mod.feature("archive", [archive])])).toThrow(
      'Localization key "elsewhere_archive_tooltip" belongs to mod prefix "elsewhere", ' +
        'not "place"'
    );
  });

  it("refuses recorded script consuming another capability's item", () => {
    const mod = capability();
    const other = capability("elsewhere");
    const foreign = other.localization("archive_tooltip", TOOLTIP);
    const archive = mod.building("archive", {
      name: "Resonance Archive",
      potential: customTooltip({ text: foreign, conditions: always() }),
    });

    expect(() => mod.compile([mod.feature("archive", [archive])])).toThrow(
      'Localization key "elsewhere_archive_tooltip" belongs to mod prefix "elsewhere", ' +
        'not "place"'
    );
  });

  it("names the consuming position in both refusals", () => {
    const mod = capability();
    const other = capability("elsewhere");
    const foreign = other.localization("archive_tooltip", TOOLTIP);

    expect(() =>
      mod.compile([
        mod.feature("archive", [
          mod.building("archive", { name: "Resonance Archive", customTooltip: foreign }),
        ]),
      ])
    ).toThrow('building.custom_tooltip for "place_building_archive"');
    expect(() =>
      mod.compile([
        mod.feature("archive", [
          mod.building("archive", {
            name: "Resonance Archive",
            potential: customTooltip({ text: foreign, conditions: always() }),
          }),
        ]),
      ])
    ).toThrow('building "place_building_archive" in "potential.custom_tooltip.text"');
  });

  it("refuses a foreign item a patch consumes", () => {
    const mod = capability();
    const other = capability("elsewhere");
    const foreign = other.localization("archive_tooltip", TOOLTIP);

    expect(() =>
      mod.patchBuilding(vanilla.definition("building", "building_pp_refinery"), () => ({
        customTooltip: foreign,
      }))
    ).toThrow('belongs to mod prefix "elsewhere", not "place"');
  });

  it("applies the same rule to an unprefixed item, whose owner is still its capability", () => {
    const mod = capability();
    const other = capability("elsewhere");
    const own = mod.localization("gateway_place_orbital", "Orbital gateway.", { prefix: false });
    const foreign = other.localization("gateway_place_orbital", "Orbital gateway.", {
      prefix: false,
    });

    // The emitted key carries no prefix either way; `item.prefix` still records
    // the capability that minted it, which is what the rule reads.
    const files = render(
      mod.compile([
        mod.feature("archive", [
          mod.building("archive", { name: "Resonance Archive", customTooltip: own }),
        ]),
      ])
    );
    expect(files.get("localisation/english/place_archive_l_english.yml")).toContain(
      ' gateway_place_orbital:0 "Orbital gateway."'
    );

    expect(() =>
      mod.compile([
        mod.feature("annex", [mod.building("annex", { name: "Annex", customTooltip: foreign })]),
      ])
    ).toThrow('Localization key "gateway_place_orbital" belongs to mod prefix "elsewhere"');
  });
});
