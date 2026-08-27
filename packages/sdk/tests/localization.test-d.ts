import { describe, expectTypeOf, it } from "vitest";

import type { JobFields } from "../src/generated/job.ts";
import type { TraditionFields } from "../src/generated/tradition.ts";
import {
  createMod,
  external,
  type LocalizationItem,
  type LocalizationRef,
  type LocalizationReplacements,
  type LocalizedText,
  type LocalizedTextRecord,
  type MintedLocalizationKey,
  type ReplacementLocalizationItem,
} from "../src/index.ts";
import type { TechnologyFields, TechnologyPatch } from "../src/stellaris.ts";

describe("standalone localization types", () => {
  it("preserves the exact minted key and accepts supported translations", () => {
    const mod = createMod({
      name: "Localization types",
      prefix: "localization_types",
      supportedVersion: "4.4.*",
    });
    const counter = mod.localization("COUNTER.01", {
      english: "Counter",
      french: "Compteur",
      simp_chinese: "计数器",
    });

    expectTypeOf(counter).toEqualTypeOf<LocalizationItem<"localization_types", "COUNTER.01">>();
    expectTypeOf(counter.key).toEqualTypeOf<"localization_types_COUNTER.01">();
    expectTypeOf(counter.key).toEqualTypeOf<
      MintedLocalizationKey<"localization_types", "COUNTER.01">
    >();
    const explicitPrefix = mod.localization("explicit_prefix", "Explicit prefix", {
      prefix: true,
    });
    expectTypeOf(explicitPrefix).toEqualTypeOf<
      LocalizationItem<"localization_types", "explicit_prefix">
    >();
    expectTypeOf(explicitPrefix.key).toEqualTypeOf<"localization_types_explicit_prefix">();

    const exact = mod.localization("gateway_localization_types", "Gateway", { prefix: false });
    expectTypeOf(exact).toEqualTypeOf<
      LocalizationItem<"localization_types", "gateway_localization_types", false>
    >();
    expectTypeOf(exact.key).toEqualTypeOf<"gateway_localization_types">();
    mod.feature("exact", [mod.localization("COUNTER", "Counter", { prefix: false })]);

    const optionalExactOptions: { readonly prefix?: false } = {};
    const optionalExact = mod.localization(
      "optional_exact",
      "Optional exact",
      optionalExactOptions
    );
    expectTypeOf(optionalExact).toEqualTypeOf<
      LocalizationItem<"localization_types", "optional_exact", boolean>
    >();
    expectTypeOf(optionalExact.key).toEqualTypeOf<
      "optional_exact" | "localization_types_optional_exact"
    >();

    const replacement = mod.replaceLocalization("crisis.2010.a", {
      english: "Reconsider.",
      french: "Réfléchissez.",
    });
    expectTypeOf(replacement).toEqualTypeOf<
      ReplacementLocalizationItem<"localization_types", "crisis.2010.a">
    >();
    expectTypeOf(replacement.key).toEqualTypeOf<"crisis.2010.a">();

    const englishOnly = mod.replaceLocalization("crisis.2010.english", {
      english: "Reconsider.",
    });
    expectTypeOf(englishOnly.translations).toMatchTypeOf<LocalizationReplacements>();
    const frenchOnly: LocalizationReplacements = { french: "Réfléchissez." };
    const partialReplacement = mod.replaceLocalization("crisis.2010.french", frenchOnly);
    expectTypeOf(partialReplacement).toEqualTypeOf<
      ReplacementLocalizationItem<"localization_types", "crisis.2010.french">
    >();
    // @ts-expect-error — replacement language records must supply at least one language.
    mod.replaceLocalization("empty_replacement", {});
    // @ts-expect-error — standalone localization records need English as their base text.
    mod.localization("partial_not_allowed", frenchOnly);

    mod.localization("english_only", "English only");
    mod.localization("unknown_language", {
      english: "Known",
      // @ts-expect-error — language records accept only supported Stellaris languages.
      klingon: "Qapla'",
    });
    // @ts-expect-error — every language record supplies the English source text.
    mod.localization("missing_english", {
      french: "Seulement français",
    });
    // @ts-expect-error — a standalone item's key is its own argument, so the
    // text it carries has no key member to pin.
    mod.localization("pinned", { english: "Pinned", key: "elsewhere" });
  });
});

describe("definition-attached text types", () => {
  const mod = createMod({
    name: "Localized text types",
    prefix: "localized_text_types",
    supportedVersion: "4.4.*",
  });
  const events = mod.namespace("story");

  it("accepts one shared text type in every slot the SDK keys itself", () => {
    expectTypeOf<LocalizedText>().toEqualTypeOf<string | LocalizedTextRecord>();
    expectTypeOf<TechnologyFields["name"]>().toEqualTypeOf<LocalizedText>();
    expectTypeOf<TechnologyPatch["name"]>().toEqualTypeOf<LocalizedText | undefined>();

    mod.technology("theory", {
      name: { english: "Theory", french: "Théorie" },
      desc: "English shorthand.",
      area: "physics",
      tier: 1,
      category: "particles",
    });
    mod.technology("unknown_language", {
      // @ts-expect-error — slot records accept only supported Stellaris languages.
      name: { english: "Theory", klingon: "Qapla'" },
      area: "physics",
      tier: 1,
      category: "particles",
    });
  });

  it("carries the key pin on the text rather than beside it", () => {
    events.country(1, {
      isTriggeredOnly: true,
      options: [{ name: { english: "Noted.", key: "noted" } }],
    });
    events.country(2, {
      isTriggeredOnly: true,
      // @ts-expect-error — the option's own `key` member is gone; the pin
      // rides on the name, which is what the suffix is derived from.
      options: [{ name: "Noted.", key: "noted" }],
    });
    mod.tradition("resonance", {
      name: "Resonance",
      aiWeight: {
        // @ts-expect-error — `descKey` is gone; the pin rides on `desc`.
        modifiers: [{ factor: 2, desc: "Already resonant.", descKey: "resonant" }],
      },
    });
  });
});

describe("localization references", () => {
  const mod = createMod({
    name: "Localization refs",
    prefix: "localization_refs",
    supportedVersion: "4.4.*",
  });

  it("takes text, a language record, or a reference in a key-typed member", () => {
    expectTypeOf<TraditionFields["customTooltip"]>().toEqualTypeOf<
      (LocalizedText | LocalizationRef)[] | undefined
    >();
    mod.tradition("every_form", {
      name: "Every form",
      customTooltip: [
        "Inline English.",
        { english: "Inline English.", french: "Anglais en ligne." },
        mod.localization("shared", "Shared."),
        external.localization("tr_vanilla_key"),
      ],
    });
  });

  it("takes the same three forms in a key-typed value list", () => {
    expectTypeOf<JobFields["localizedTags"]>().toEqualTypeOf<
      (LocalizedText | LocalizationRef)[] | undefined
    >();
    mod.job("tagged", {
      name: "Tagged",
      plural: "Tagged",
      desc: "Tagged.",
      category: "specialist",
      localizedTags: [
        "Inline tag text",
        { english: "Tagged", french: "Étiqueté" },
        external.localization("SOME_TAG"),
      ],
    });
  });

  it("brands the reference so a bare key object cannot stand in for one", () => {
    const owned: LocalizationRef = mod.localization("owned", "Owned.");
    const replaced: LocalizationRef = mod.replaceLocalization("crisis.2010.a", "Replaced.");
    expectTypeOf(owned.key).toEqualTypeOf<string>();
    expectTypeOf(replaced.key).toEqualTypeOf<string>();
    const forged = { key: "tr_vanilla_key" };
    // @ts-expect-error — a reference comes from a constructor, not from any
    // object that happens to carry a `key`.
    const asRef: LocalizationRef = forged;
    void asRef;
    mod.tradition("forged", {
      name: "Forged",
      // @ts-expect-error — same, at the member that would consume one.
      customTooltip: [forged],
    });
  });
});
