/**
 * SDK-308: one input for every position that stores a localization key.
 *
 * A bare string is English display text everywhere a key is stored, an
 * existing key is a reference, and recorded script defers its key until the
 * definition, event, or patch it is spliced into supplies an owner.
 */

import { serialize, type PdxEntry } from "@pdx-ts/pdxscript";
import { describe, expect, it } from "vitest";

import {
  assertNoDeferredLocalization,
  isDeferredLocalization,
} from "../src/authoring/deferred-localization.ts";
import { always, customTooltip, customTooltipFail, failText } from "../src/generated/triggers.ts";
import { createMod, external, literalText, render } from "../src/index.ts";
import { makeScope } from "../src/internals.ts";
import { shortLocalizationHash } from "../src/localization-key.ts";
import type { ContentRefUse } from "../src/references.ts";
import { vanilla } from "../src/stellaris.ts";

function capability(prefix = "li") {
  return createMod({ name: "Localization input", prefix, supportedVersion: "4.4.*" });
}

type Mod = ReturnType<typeof capability>;

/** A technology whose `potential` carries whatever condition the case needs. */
function tech(mod: Mod, name: string, potential: ReturnType<typeof always>) {
  return mod.technology(name, {
    cost: 100,
    weight: 100,
    name: "Resonance Theory",
    area: "physics",
    tier: 1,
    category: "particles",
    potential,
  });
}

/** Every localisation line one feature ships, as one searchable string. */
function english(mod: Mod, stem: string, items: Parameters<Mod["feature"]>[1]): string {
  return texts(mod, stem, items, "localisation/english/");
}

/** Every content file one feature ships, as one searchable string. */
function body(mod: Mod, stem: string, items: Parameters<Mod["feature"]>[1]): string {
  return texts(mod, stem, items, "common/");
}

function texts(
  mod: Mod,
  stem: string,
  items: Parameters<Mod["feature"]>[1],
  prefix: string
): string {
  const files = render(mod.compile([mod.feature(stem, items)]));
  return [...files.keys()]
    .filter((path) => path.startsWith(prefix))
    .map((path) => files.get(path) ?? "")
    .join("\n");
}

describe("inline text in recorded script", () => {
  it("keys English shorthand against the definition the script is placed in", () => {
    const mod = capability();
    const item = tech(mod, "theory", customTooltip("Requires an awakened gateway."));
    const key = `li_tech_theory_custom_tooltip_${shortLocalizationHash("Requires an awakened gateway.")}`;

    expect(body(mod, "theory", [item])).toContain(`custom_tooltip = ${key}`);
    expect(english(mod, "theory", [item])).toContain(` ${key}:0 "Requires an awakened gateway."`);
  });

  it("ships every translation a language record supplies", () => {
    const mod = capability();
    const item = tech(
      mod,
      "theory",
      customTooltip({ english: "Needs a gateway.", french: "Exige un portail.", key: "gateway" })
    );
    const files = render(mod.compile([mod.feature("theory", [item])]));

    expect(files.get("localisation/english/li_theory_l_english.yml")).toContain(
      ' li_tech_theory_custom_tooltip_gateway:0 "Needs a gateway."'
    );
    expect(files.get("localisation/french/li_theory_l_french.yml")).toContain(
      ' li_tech_theory_custom_tooltip_gateway:0 "Exige un portail."'
    );
  });

  it("keeps a pinned key stable when the words change", () => {
    const pinned = (text: string): string => {
      const mod = capability();
      const item = tech(mod, "theory", customTooltip({ english: text, key: "gateway" }));
      return body(mod, "theory", [item]);
    };

    expect(pinned("First wording.")).toContain(
      "custom_tooltip = li_tech_theory_custom_tooltip_gateway"
    );
    expect(pinned("Second wording.")).toContain(
      "custom_tooltip = li_tech_theory_custom_tooltip_gateway"
    );
  });

  it("gives different English text a different derived key", () => {
    const mod = capability();
    const first = tech(mod, "a", customTooltip("One."));
    const second = tech(mod, "b", customTooltip("Two."));
    const emitted = body(mod, "pair", [first, second]);

    expect(emitted).toContain(`li_tech_a_custom_tooltip_${shortLocalizationHash("One.")}`);
    expect(emitted).toContain(`li_tech_b_custom_tooltip_${shortLocalizationHash("Two.")}`);
  });

  it("distinguishes two positions inside one condition by their script paths", () => {
    const mod = capability();
    const item = tech(
      mod,
      "theory",
      customTooltip({ failText: "Not yet.", successText: "Done.", conditions: always() })
    );
    const emitted = body(mod, "theory", [item]);

    expect(emitted).toContain(
      `fail_text = li_tech_theory_custom_tooltip_fail_text_${shortLocalizationHash("Not yet.")}`
    );
    expect(emitted).toContain(
      `success_text = li_tech_theory_custom_tooltip_success_text_${shortLocalizationHash("Done.")}`
    );
  });

  it("warns once per derived key when the key hashes text the author can edit", () => {
    const mod = capability();
    const shared = customTooltip("Requires a gateway.");
    const compiled = mod.compile([
      mod.feature("theory", [tech(mod, "a", shared), tech(mod, "b", shared)]),
    ]);
    const unstable = compiled.warnings.filter(
      (warning) => warning.code === "unstable-localization-key"
    );

    // Two owners, two derived keys, one warning each — and no repeat when the
    // same definition is lowered again.
    expect(unstable).toHaveLength(2);
    expect(unstable[0]!.message).toContain("custom_tooltip");
  });

  it("raises no warning for a pinned key", () => {
    const mod = capability();
    const item = tech(mod, "theory", customTooltip({ english: "Pinned.", key: "pinned" }));

    expect(
      mod
        .compile([mod.feature("theory", [item])])
        .warnings.filter((warning) => warning.code === "unstable-localization-key")
    ).toEqual([]);
  });
});

describe("references in recorded script", () => {
  it("emits a vanilla or external key and registers no text for it", () => {
    const mod = capability();
    const item = tech(
      mod,
      "theory",
      customTooltip(vanilla.localization("requires_independence")).and(
        customTooltipFail({ text: external.localization("other_mod_key"), conditions: always() })
      )
    );
    const files = render(mod.compile([mod.feature("theory", [item])]));
    const emittedBody = [...files.keys()]
      .filter((path) => path.startsWith("common/"))
      .map((path) => files.get(path) ?? "")
      .join("\n");
    const emittedEnglish = [...files.keys()]
      .filter((path) => path.startsWith("localisation/english/"))
      .map((path) => files.get(path) ?? "")
      .join("\n");

    expect(emittedBody).toContain("custom_tooltip = requires_independence");
    expect(emittedEnglish).not.toContain("requires_independence:0");
    expect(emittedEnglish).not.toContain("other_mod_key:0");
  });

  it("places a standalone item consumed by recorded script", () => {
    const mod = capability();
    const owned = mod.localization("gateway_tip", "Requires a gateway.");
    const item = tech(mod, "theory", customTooltip(owned));

    expect(body(mod, "theory", [item])).toContain("custom_tooltip = li_gateway_tip");
    expect(english(mod, "theory", [item])).toContain(' li_gateway_tip:0 "Requires a gateway."');
  });

  it("refuses an item another capability minted", () => {
    const mine = capability("mine");
    const theirs = capability("theirs");
    const item = tech(mine, "theory", customTooltip(theirs.localization("tip", "Theirs.")));

    expect(() => mine.compile([mine.feature("theory", [item])])).toThrow(
      /belongs to mod prefix "theirs"/
    );
  });

  it("emits effective references from both modifier row kinds", () => {
    const mod = capability();
    const owned = mod.localization("weighted_desc", "Owned modifier text.");
    const item = mod.technology("weighted", {
      cost: 100,
      weight: 100,
      name: "Weighted",
      area: "physics",
      tier: 1,
      category: "particles",
      weightModifier: {
        modifiers: [
          { factor: 2, desc: owned },
          {
            trigger: "some_scripted_trigger",
            mode: "factor",
            desc: external.localization("OTHER_MOD_COMPLEX_DESC"),
          },
        ],
      },
    });
    const emitted = body(mod, "weighted", [item]);

    expect(emitted).toContain("desc = li_weighted_desc");
    expect(emitted).toContain("desc = OTHER_MOD_COMPLEX_DESC");
    expect(english(mod, "weighted", [item])).toContain(
      ' li_weighted_desc:0 "Owned modifier text."'
    );
  });
});

describe("sentinels and raw text", () => {
  it("keeps an engine sentinel out of the display-text arm", () => {
    const mod = capability();
    const item = tech(
      mod,
      "theory",
      customTooltip({ failText: "default", text: "", conditions: always() })
    );
    const emitted = body(mod, "theory", [item]);

    expect(emitted).toContain("fail_text = default");
    expect(emitted).toContain('text = ""');
    expect(english(mod, "theory", [item])).not.toContain('"default"');
  });

  it("shows the sentinel word itself when it is written as display text", () => {
    const mod = capability();
    const item = tech(
      mod,
      "theory",
      customTooltip({ failText: { english: "default" }, conditions: always() })
    );
    const key = `li_tech_theory_custom_tooltip_fail_text_${shortLocalizationHash("default")}`;

    expect(body(mod, "theory", [item])).toContain(`fail_text = ${key}`);
    expect(english(mod, "theory", [item])).toContain(` ${key}:0 "default"`);
  });

  it("writes literalText as a raw scalar with no localization entry", () => {
    const sink: PdxEntry[] = [];
    const refs: ContentRefUse[] = [];
    // `create_country`'s name is CWT's `localisation | scalar | block`, so the
    // raw arm is real and needs the spelling that cannot be read as text.
    makeScope<"country">(sink, refs).createCountry({
      name: literalText("The Contingency"),
      type: "faction",
    });

    expect(serialize(sink)).toContain('name = "The Contingency"');
    expect(serialize(sink)).not.toContain("__pdx_deferred_localization_");
  });

  it("refuses a value that names no key at all", () => {
    expect(() => customTooltip(42 as never)).toThrow(/names no localization key/);
  });

  it("refuses raw text that cannot be written as one scalar", () => {
    // The file format has no quote escape, so a value carrying one could not
    // come back as itself.
    expect(() => literalText('The "Contingency"')).toThrow(
      /cannot be written as a PDXScript scalar/
    );
    expect(literalText("The Contingency")).toEqual({
      kind: "literal-text",
      text: "The Contingency",
    });
  });

  it("refuses an external reference that is not a bare string identifier", () => {
    expect(() => external.reference("not an id")).toThrow(/is not a content id/);
    expect(() => external.reference("@other")).toThrow(/is not a content id/);
    expect(() => external.reference("yes")).toThrow(/is not a content id/);
    expect(() => external.reference("123")).toThrow(/is not a content id/);
    expect(external.reference("other_mod_design")).toEqual({ id: "other_mod_design" });
  });

  it("emits an external reference as the id it names", () => {
    const mod = capability();
    const scriptedLoc = mod.scriptedLoc("flavour", {
      default: external.reference("other_mod_sprite"),
    });

    expect(body(mod, "flavour", [scriptedLoc])).toContain("default = other_mod_sprite");
  });
});

describe("ownership and reuse", () => {
  it("resolves one reused condition independently under each owner", () => {
    const mod = capability();
    const shared = customTooltip("Requires a gateway.");
    const hash = shortLocalizationHash("Requires a gateway.");
    const emitted = body(mod, "pair", [tech(mod, "a", shared), tech(mod, "b", shared)]);

    expect(emitted).toContain(`custom_tooltip = li_tech_a_custom_tooltip_${hash}`);
    expect(emitted).toContain(`custom_tooltip = li_tech_b_custom_tooltip_${hash}`);
  });

  it("leaves the reusable condition itself untouched", () => {
    const mod = capability();
    const shared = customTooltip("Requires a gateway.");
    const before = shared.entries;

    body(mod, "pair", [tech(mod, "a", shared), tech(mod, "b", shared)]);

    // The Trigger is a template: placing it neither rewrites its entries nor
    // consumes the marker it carries.
    expect(shared.entries).toBe(before);
    expect(shared.entries[0]!.value).toSatisfy(isDeferredLocalization);
  });

  it("renders the same bytes on a second render", () => {
    const mod = capability();
    const item = tech(mod, "theory", customTooltip("Requires a gateway."));
    const compiled = mod.compile([mod.feature("theory", [item])]);

    expect([...render(compiled).entries()]).toEqual([...render(compiled).entries()]);
  });

  it("keys script inside a nested repeated definition against the nested id", () => {
    const mod = capability();
    const situation = mod.situationType("uprising", {
      name: "Uprising",
      monthlyProgress: { base: 1 },
      stages: {
        li_stage_calm: {
          name: "Calm",
          icon: "GFX_situation_stage_calm",
          iconBackground: "GFX_situation_stage_calm_bg",
          // Script inside a nested stage keys against the stage's own id, the
          // same rebind a `WeightBlock` desc already makes there.
          potential: customTooltip("Inside."),
        },
      },
    });
    const emitted = body(mod, "uprising", [situation]);

    expect(emitted).toContain(
      `custom_tooltip = li_stage_calm_custom_tooltip_${shortLocalizationHash("Inside.")}`
    );
  });

  it("resolves an effect closure's inline text under the definition that holds it", () => {
    const mod = capability();
    const decision = mod.decision("awaken", {
      name: "Awaken",
      potential: always(),
      allow: always(),
      effect: (scope) => {
        scope.customTooltip("The gate opens.");
      },
    });
    const emitted = body(mod, "awaken", [decision]);

    expect(emitted).toContain(
      `custom_tooltip = li_decision_awaken_custom_tooltip_${shortLocalizationHash("The gate opens.")}`
    );
  });

  it("leaves no marker in any emitted file", () => {
    const mod = capability();
    const item = tech(mod, "theory", customTooltip("Requires a gateway."));
    const compiled = mod.compile([mod.feature("theory", [item])]);

    for (const file of compiled.contentFiles) {
      assertNoDeferredLocalization(file.entries, "test");
    }
    for (const [, text] of render(compiled)) {
      expect(text).not.toContain("__pdx_deferred_localization_");
    }
  });

  it("preserves a marker across the recorder's context-PREV rewrite", () => {
    const sink: PdxEntry[] = [];
    const refs: ContentRefUse[] = [];
    const country = makeScope<"country">(sink, refs);
    country.everyOwnedPlanet({}, () => {
      // Recorded against the enclosing country from one scope in, which the
      // recorder commits as a `prev` block rather than by rebuilding nodes:
      // the marker travels by identity, so it still resolves at the splice.
      country.customTooltip("One scope out.");
    });

    const emitted = serialize(sink);
    expect(emitted).toContain("prev = {");
    expect(emitted).toContain("__pdx_deferred_localization_");
  });
});

describe("every generated shape a localization key reaches", () => {
  it("keys each element of a value-list argument by its own path", () => {
    const mod = capability();
    const decision = mod.decision("muster", {
      name: "Muster",
      potential: always(),
      allow: always(),
      effect: (scope) => {
        scope.owner.effects((country) => {
          country.createBalancedFleet({
            size: 2,
            shipDesigns: ["Vanguard", external.localization("NAME_Sentry")],
          });
        });
      },
    });
    const emitted = body(mod, "muster", [decision]);

    expect(emitted).toContain(
      `li_decision_muster_create_balanced_fleet_ship_designs_${shortLocalizationHash("Vanguard")}`
    );
    expect(emitted).toContain("NAME_Sentry");
  });

  it("keys a mixed scalar-or-block argument's scalar arm", () => {
    const mod = capability();
    const decision = mod.decision("rename", {
      name: "Rename",
      potential: always(),
      allow: always(),
      effect: (scope) => {
        scope.setName("The Resonant Concord");
      },
    });

    expect(body(mod, "rename", [decision])).toContain(
      `set_name = li_decision_rename_set_name_${shortLocalizationHash("The Resonant Concord")}`
    );
  });

  it("keys a nested field of a structured argument", () => {
    const mod = capability();
    const decision = mod.decision("army", {
      name: "Army",
      potential: always(),
      allow: always(),
      effect: (scope, ctx) => {
        scope.createArmy({ name: "The Iron Watch", owner: ctx.self, type: "assault_army" });
      },
    });

    expect(body(mod, "army", [decision])).toContain(
      `li_decision_army_create_army_name_${shortLocalizationHash("The Iron Watch")}`
    );
  });

  it("keys an ordinary scalar field inside an effect argument block", () => {
    const mod = capability();
    const decision = mod.decision("message", {
      name: "Message",
      potential: always(),
      allow: always(),
      effect: (scope) => {
        scope.owner.effects((country) => {
          country.createMessage({
            type: "li_message_type",
            localization: "The signal is clear.",
          });
        });
      },
    });
    const key = `li_decision_message_create_message_localization_${shortLocalizationHash("The signal is clear.")}`;

    expect(body(mod, "message", [decision])).toContain(`localization = ${key}`);
    expect(english(mod, "message", [decision])).toContain(` ${key}:0 "The signal is clear."`);
  });

  it("keys a key-typed content member alongside a repeated element's index", () => {
    const mod = capability();
    const job = mod.job("archivist", {
      name: "Archivist",
      category: "specialist",
      localizedTags: ["Resonant", external.localization("JOB_TAG_MACHINE")],
    });
    const emitted = body(mod, "archivist", [job]);

    // A content member's key comes from the walk, so it counts elements
    // rather than hashing them — the derivation this change does not move.
    expect(emitted).toContain("li_job_archivist_localized_tags_0");
    expect(emitted).toContain("JOB_TAG_MACHINE");
  });

  it("keys text inside a weight block's nested condition", () => {
    const mod = capability();
    const item = mod.technology("weighted", {
      cost: 100,
      weight: 100,
      name: "Weighted",
      area: "physics",
      tier: 1,
      category: "particles",
      weightModifier: {
        modifiers: [{ factor: 2, when: customTooltip("Weighted branch.") }],
      },
    });

    expect(body(mod, "weighted", [item])).toContain(
      `li_tech_weighted_custom_tooltip_${shortLocalizationHash("Weighted branch.")}`
    );
  });

  it("keys a condition nested inside an effect closure", () => {
    const mod = capability();
    const decision = mod.decision("gated", {
      name: "Gated",
      potential: always(),
      allow: always(),
      effect: (scope) => {
        scope.if(customTooltip("Only sometimes."), () => {
          scope.setPlanetFlag("li_seen");
        });
      },
    });

    expect(body(mod, "gated", [decision])).toContain(
      `li_decision_gated_custom_tooltip_${shortLocalizationHash("Only sometimes.")}`
    );
  });
});

describe("duplicate registrations", () => {
  it("collapses two owners writing identical text under one key", () => {
    const mod = capability();
    const shared = { english: "Shared.", key: "shared" } as const;
    const emitted = english(mod, "pair", [
      tech(mod, "a", customTooltip(shared)),
      tech(mod, "a2", customTooltip(shared)),
    ]);

    // Different owners, so different keys — the collapse to test is one owner
    // writing the same key twice, which the second render already exercises.
    expect(emitted).toContain(' li_tech_a_custom_tooltip_shared:0 "Shared."');
    expect(emitted).toContain(' li_tech_a2_custom_tooltip_shared:0 "Shared."');
  });

  it("refuses two pins that put different text under one derived key", () => {
    const mod = capability();
    const item = tech(
      mod,
      "clash",
      customTooltip({
        failText: { english: "One.", key: "same" },
        successText: { english: "Two.", key: "same" },
        conditions: always(),
      })
    );

    // Both pins are on the same owner but different script paths, so they do
    // not collide; a collision needs the same path, which one field cannot
    // produce twice. This pins that the paths are part of the identity.
    expect(body(mod, "clash", [item])).toContain("li_tech_clash_custom_tooltip_fail_text_same");
    expect(body(mod, "clash", [item])).toContain("li_tech_clash_custom_tooltip_success_text_same");
  });
});

describe("the deferred marker itself", () => {
  it("refuses to reach emission unresolved", () => {
    const marker = failText({ text: "Unowned.", conditions: always() });

    expect(() => assertNoDeferredLocalization([...marker.entries], "A test channel")).toThrow(
      /still holds unresolved inline localization/
    );
  });

  it("is a valid PDXScript scalar so nothing downstream has to know about it", () => {
    const marker = customTooltip("Unowned.").entries[0]!.value;

    expect(isDeferredLocalization(marker)).toBe(true);
    expect(Object.keys(marker)).toEqual(["kind", "value", "quoted"]);
    expect(serialize([customTooltip("Unowned.").entries[0]!])).toMatch(
      /^custom_tooltip = __pdx_deferred_localization_\d+__\n$/
    );
  });
});
