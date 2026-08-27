import { describe, expect, it } from "vitest";

import {
  createMod,
  render,
  type LocalizationReplacementText,
  type LocalizationText,
} from "../src/index.ts";

function capability(prefix = "localization_test") {
  return createMod({
    name: "Standalone localization",
    prefix,
    supportedVersion: "4.4.*",
  });
}

describe("standalone localization authoring", () => {
  it("mints case-preserving keys from every corpus-supported shape", () => {
    const mod = capability();
    const suffixes = [
      "COUNTER",
      "01_NAME",
      "crisis.2010.name",
      "Neo-",
      "Jackson's_Planet",
    ] as const;

    expect(suffixes.map((suffix) => mod.localization(suffix, suffix).key)).toEqual(
      suffixes.map((suffix) => `localization_test_${suffix}`)
    );
    expect(mod.localization("EXPLICIT", "Explicit", { prefix: true }).key).toBe(
      "localization_test_EXPLICIT"
    );
    const optionalExactOptions: { readonly prefix?: false } = {};
    expect(mod.localization("OPTIONAL", "Optional", optionalExactOptions).key).toBe(
      "localization_test_OPTIONAL"
    );
  });

  it("rejects suffixes outside the empirical Stellaris 4.4.6 alphabet", () => {
    const mod = capability();
    for (const suffix of ["", "bad key", "bad:key", "bad$key", "bad@key", 'bad"key', "é"]) {
      expect(() => mod.localization(suffix, "Text")).toThrow(/must contain only ASCII letters/);
    }
  });

  it("rejects malformed language records at the runtime boundary", () => {
    const mod = capability();
    expect(() =>
      mod.localization("missing_english", { french: "Bonjour" } as LocalizationText)
    ).toThrow('must include an "english" string');
    expect(() =>
      mod.localization("unknown_language", {
        english: "Hello",
        klingon: "Qapla'",
      } as unknown as LocalizationText)
    ).toThrow('Unsupported localization language "klingon"');
  });

  it("emits standalone, content, and event text into their feature's language files", () => {
    const mod = capability();
    const counter = mod.localization("ASCENSION_COUNTER", {
      english: "Ascension",
      french: "Ascension française",
    });
    const technology = mod.technology("theory", {
      name: "Theory",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const event = mod.namespace("story").country(1, {
      title: "A Story",
      isTriggeredOnly: true,
    });

    const compiled = mod.compile([mod.feature("story", [counter, technology, event])]);
    const files = render(compiled);
    const englishPath = "localisation/english/localization_test_story_l_english.yml";
    const frenchPath = "localisation/french/localization_test_story_l_french.yml";

    expect(compiled.localizationFiles.map((file) => file.relPath)).toEqual([
      englishPath,
      frenchPath,
    ]);
    expect(files.get(englishPath)).toBe(
      "﻿l_english:\n" +
        ' localization_test_ASCENSION_COUNTER:0 "Ascension"\n' +
        ' localization_test_story.1.name:0 "A Story"\n' +
        ' localization_test_tech_theory:0 "Theory"\n'
    );
    expect(files.get(frenchPath)).toBe(
      '﻿l_french:\n localization_test_ASCENSION_COUNTER:0 "Ascension française"\n'
    );
  });

  it("preserves exact ordinary keys without using the replacement layer", () => {
    const mod = capability();
    const gateway = mod.localization("gateway_localization_test", "Gateway", { prefix: false });
    const files = render(mod.compile([mod.feature("gateway", [gateway])]));

    expect(gateway.key).toBe("gateway_localization_test");
    expect(files.get("localisation/english/localization_test_gateway_l_english.yml")).toBe(
      '﻿l_english:\n gateway_localization_test:0 "Gateway"\n'
    );
    expect([...files.keys()]).not.toContain(
      "localisation/replace/english/localization_test_gateway_l_english.yml"
    );
  });

  it("validates exact ordinary keys as complete localization keys", () => {
    const mod = capability();
    for (const key of ["", ".leading_dot", "-leading-hyphen", "bad key", "bad:key"]) {
      expect(() => mod.localization(key, "Text", { prefix: false })).toThrow(
        /Exact ordinary localization key/
      );
    }
  });

  it("uses the base filename for an undefined stem and emits no empty files", () => {
    const mod = capability();
    const label = mod.localization("LABEL", "Label");

    expect(
      render(mod.compile([mod.feature(undefined, [label])])).has(
        "localisation/english/localization_test_l_english.yml"
      )
    ).toBe(true);
    expect(mod.compile([]).localizationFiles).toEqual([]);
  });

  it("keeps localization feature ownership when content paths merge", () => {
    const mod = capability();
    const first = mod.technology("first", {
      name: "First",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const second = mod.technology("second", {
      name: "Second",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const compiled = mod.compile([
      mod.feature(undefined, [first]),
      mod.feature("technology", [second]),
    ]);

    expect(compiled.contentFiles.map((file) => file.relPath)).toEqual([
      "common/technology/localization_test_technology.txt",
    ]);
    expect(compiled.localizationFiles.map((file) => file.relPath)).toEqual([
      "localisation/english/localization_test_l_english.yml",
      "localisation/english/localization_test_technology_l_english.yml",
    ]);
  });

  it("replaces exact arbitrary keys through feature-scoped replace files", () => {
    const mod = capability();
    const replacement = mod.replaceLocalization("crisis.2010.a", {
      english: "Reconsider.",
      french: "Réfléchissez.",
    });
    const files = render(mod.compile([mod.feature("crisis", [replacement])]));

    expect(replacement.key).toBe("crisis.2010.a");
    expect(files.get("localisation/replace/english/localization_test_crisis_l_english.yml")).toBe(
      '﻿l_english:\n crisis.2010.a:0 "Reconsider."\n'
    );
    expect(files.get("localisation/replace/french/localization_test_crisis_l_french.yml")).toBe(
      '﻿l_french:\n crisis.2010.a:0 "Réfléchissez."\n'
    );
  });

  it("emits only the supplied languages for partial replacements", () => {
    const mod = capability();
    const replacement = mod.replaceLocalization("crisis.2010.a", {
      french: "Réfléchissez.",
    });
    const files = render(mod.compile([mod.feature("crisis", [replacement])]));

    expect(files.get("localisation/replace/french/localization_test_crisis_l_french.yml")).toBe(
      '﻿l_french:\n crisis.2010.a:0 "Réfléchissez."\n'
    );
    expect(files.has("localisation/replace/english/localization_test_crisis_l_english.yml")).toBe(
      false
    );
  });

  it("rejects empty replacement language records", () => {
    const mod = capability();

    expect(() => mod.replaceLocalization("empty_replacement", {})).toThrow(
      "A replacement must supply at least one language"
    );
  });

  it("keeps bare replacement strings English-only", () => {
    const mod = capability();
    const replacement = mod.replaceLocalization("crisis.2010.a", "Reconsider.");
    const files = render(mod.compile([mod.feature("crisis", [replacement])]));

    expect(files.get("localisation/replace/english/localization_test_crisis_l_english.yml")).toBe(
      '﻿l_english:\n crisis.2010.a:0 "Reconsider."\n'
    );
    expect(files.has("localisation/replace/french/localization_test_crisis_l_french.yml")).toBe(
      false
    );
  });

  it("rejects unsupported replacement languages", () => {
    const mod = capability();

    expect(() =>
      mod.replaceLocalization("unknown_language", {
        klingon: "Qapla'",
      } as unknown as LocalizationReplacementText)
    ).toThrow('Unsupported localization language "klingon"');
  });

  it("keeps deliberate replacements separate from ordinary localization", () => {
    const mod = capability();
    const ordinary = mod.localization("SHARED", "Owned text");
    const replacement = mod.replaceLocalization(ordinary.key, "Replacement text");
    const compiled = mod.compile([
      mod.feature("ordinary", [ordinary]),
      mod.feature("replacement", [replacement]),
    ]);

    expect(compiled.localizationFiles.map((file) => file.relPath)).toEqual([
      "localisation/english/localization_test_ordinary_l_english.yml",
      "localisation/replace/english/localization_test_replacement_l_english.yml",
    ]);
  });

  it("validates exact replacement keys without prefixing them", () => {
    const mod = capability();
    for (const key of ["", ".leading_dot", "-leading-hyphen", "bad key", "bad:key"]) {
      expect(() => mod.replaceLocalization(key, "Text")).toThrow(/Replacement localization key/);
    }
  });

  it("checks duplicates globally and assigns identical text to the first path", () => {
    const mod = capability();
    const shared = mod.localization("SHARED", "Shared");
    const compiled = mod.compile([mod.feature("zeta", [shared]), mod.feature("alpha", [shared])]);

    expect(compiled.localizationFiles.map((file) => file.relPath)).toEqual([
      "localisation/english/localization_test_alpha_l_english.yml",
    ]);
    expect(() =>
      mod.compile([
        mod.feature("alpha", [mod.localization("COLLISION", "First")]),
        mod.feature("zeta", [mod.localization("COLLISION", "Second")]),
      ])
    ).toThrow('Duplicate localization key "localization_test_COLLISION" for english');

    expect(() =>
      mod.compile([
        mod.feature("alpha", [
          mod.localization("gateway_localization_test", "First", { prefix: false }),
        ]),
        mod.feature("zeta", [
          mod.localization("gateway_localization_test", "Second", { prefix: false }),
        ]),
      ])
    ).toThrow('Duplicate localization key "gateway_localization_test" for english');
  });

  it("fans a content slot's language record out to one file per language", async () => {
    const mod = capability();
    const technology = mod.technology("lattice", {
      name: { english: "Lattice Theory", french: "Théorie du treillis" },
      desc: "Only the English half of this one is written.",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    const files = render(mod.compile([mod.feature("slots", [technology])]));

    // One key, two files: the slot's key comes from the definition id, so the
    // French entry lands under exactly the key the English entry uses.
    expect(files.get("localisation/english/localization_test_slots_l_english.yml")).toContain(
      ' localization_test_tech_lattice:0 "Lattice Theory"'
    );
    await expect(
      files.get("localisation/french/localization_test_slots_l_french.yml")
    ).toMatchFileSnapshot("__snapshots__/localization/slots_l_french.yml");
  });

  it("refuses a key pin on a slot whose key the definition id fixes", () => {
    const mod = capability();
    const technology = mod.technology("pinned", {
      name: { english: "Pinned", key: "pinned_name" },
      area: "physics",
      tier: 1,
      category: "particles",
    });
    expect(() => mod.compile([mod.feature("pinned", [technology])])).toThrow(
      'Localization "name" for "localization_test_tech_pinned" sets "key", but its ' +
        'localization key is always "localization_test_tech_pinned"'
    );
  });

  it("fans event title, desc, and option text out per language", () => {
    const mod = capability();
    const event = mod.namespace("story").country(2, {
      title: { english: "A Story", french: "Une histoire" },
      desc: { english: "It begins.", french: "Elle commence." },
      isTriggeredOnly: true,
      options: [{ name: { english: "Read on.", french: "Poursuivre.", key: "read_on" } }],
    });
    const files = render(mod.compile([mod.feature("story", [event])]));

    expect(files.get("localisation/french/localization_test_story_l_french.yml")).toBe(
      "﻿l_french:\n" +
        ' localization_test_story.2.desc:0 "Elle commence."\n' +
        ' localization_test_story.2.name:0 "Une histoire"\n' +
        ' localization_test_story.2.read_on:0 "Poursuivre."\n'
    );
  });

  it("fans a modifier desc's translations out under its pinned key", () => {
    const mod = capability();
    const tradition = mod.tradition("resonance", {
      name: "Resonance",
      aiWeight: {
        modifiers: [
          {
            factor: 2,
            desc: { english: "Already resonant.", german: "Bereits resonant.", key: "resonant" },
          },
        ],
      },
    });
    const compiled = mod.compile([mod.feature("weights", [tradition])]);
    const files = render(compiled);
    const key = "localization_test_tradition_resonance_ai_weight_resonant";

    expect(files.get("localisation/english/localization_test_weights_l_english.yml")).toContain(
      ` ${key}:0 "Already resonant."`
    );
    expect(files.get("localisation/german/localization_test_weights_l_german.yml")).toContain(
      ` ${key}:0 "Bereits resonant."`
    );
    // A pinned key is stable under text edits, so nothing is unstable here.
    expect(compiled.warnings).toEqual([]);
  });

  it("rejects placement through a different mod capability", () => {
    const alpha = capability("alpha_loc");
    const beta = capability("beta_loc");
    const label = alpha.localization("gateway_alpha_loc", "Label", { prefix: false });

    expect(() => beta.feature("foreign", [label])).toThrow(
      'Localization key "gateway_alpha_loc" belongs to mod prefix "alpha_loc", not "beta_loc"'
    );
  });
});
