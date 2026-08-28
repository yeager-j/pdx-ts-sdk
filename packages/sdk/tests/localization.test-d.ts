import { describe, expectTypeOf, it } from "vitest";

import type { JobFields } from "../src/generated/job.ts";
import type { ScopeName } from "../src/generated/scopes.ts";
import type { ScriptedLocFields } from "../src/generated/scripted-loc.ts";
import type { TraditionFields } from "../src/generated/tradition.ts";
import {
  createMod,
  external,
  literalText,
  type LiteralText,
  type LocalizationInput,
  type LocalizationItem,
  type LocalizationRef,
  type LocalizationReplacements,
  type LocalizedText,
  type LocalizedTextRecord,
  type MintedLocalizationKey,
  type ReplacementLocalizationItem,
} from "../src/index.ts";
import type { Trigger } from "../src/script/trigger-core.ts";
import {
  and,
  customTooltip,
  vanilla,
  type TechnologyFields,
  type TechnologyPatch,
} from "../src/stellaris.ts";

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
      LocalizationInput[] | undefined
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
    expectTypeOf<JobFields["localizedTags"]>().toEqualTypeOf<LocalizationInput[] | undefined>();
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

  it("takes every reference form on a recorded-script key", () => {
    const perk = mod.ascensionPerk("every_source", {
      name: "Every source",
      potential: and(
        // The four ways to name an existing key, and the whole set of them.
        customTooltip(mod.localization("owned", "Owned.")),
        customTooltip(vanilla.localization("requires_independence")),
        customTooltip(external.localization("some_other_mods_key")),
        customTooltip(mod.replaceLocalization("crisis.2010.a", "Replaced."))
      ),
    });
    void perk;
  });

  it("takes a reference in modifier description positions", () => {
    mod.technology("modifier_reference", {
      name: "Modifier reference",
      area: "physics",
      tier: 1,
      category: "particles",
      weightModifier: {
        modifiers: [
          { factor: 2, desc: external.localization("EXISTING_MODIFIER_DESC") },
          {
            trigger: "some_scripted_trigger",
            mode: "factor",
            desc: mod.localization("complex_desc", "Complex description."),
          },
        ],
      },
    });
  });

  it("reads a bare string on a recorded-script key as English display text", () => {
    mod.ascensionPerk("inline", {
      name: "Inline",
      potential: and(
        customTooltip("Requires an awakened gateway."),
        customTooltip({ english: "Requires a gateway.", french: "Exige un portail." }),
        customTooltip({ english: "Pinned.", key: "pinned" }),
        customTooltip({
          failText: "Not yet.",
          successText: vanilla.localization("requires_independence"),
          conditions: and(),
        }),
        // The sentinel the rules declare beside the key stays in the union.
        customTooltip({ failText: "default", conditions: and() })
      ),
    });
  });

  it("keeps a language record off the block arm of an overloaded key", () => {
    // `{ english }` is an object like the gated block is, so the overload has
    // to place it by membership rather than by "not a string".
    expectTypeOf(customTooltip({ english: "Inline." })).toEqualTypeOf<Trigger<ScopeName>>();
  });

  it("refuses raw displayed text where the rules declare no raw scalar arm", () => {
    // @ts-expect-error — `custom_tooltip` stores a key and nothing else, so
    // there is no raw arm for `literalText()` to write into.
    customTooltip(literalText("requires_independence"));
    mod.tradition("no_raw_arm", {
      name: "No raw arm",
      // @ts-expect-error — the same at a key-typed content member.
      customTooltip: [literalText("tr_adaptability_delta")],
    });
  });

  it("takes literal text and a declared external reference on the mixed arms", () => {
    // `scripted_loc`'s `default` is CWT's `localisation | <sprite> | scalar`:
    // one position with all three of the mixed arms on it.
    const inline: ScriptedLocFields["default"] = "Fallback text";
    const record: ScriptedLocFields["default"] = { english: "Fallback", french: "Repli" };
    const reference: ScriptedLocFields["default"] = vanilla.localization("NAME_Sentry");
    const raw: ScriptedLocFields["default"] = literalText("§Y");
    const unchecked: ScriptedLocFields["default"] = external.reference("other_mod_sprite");
    void [inline, record, reference, raw, unchecked];
    expectTypeOf(literalText("x")).toEqualTypeOf<LiteralText>();
  });

  it("keeps a swap's own id out of the localization surface", () => {
    // A `technology_swap` name is the swap's id — other definitions reference
    // it — so it stays a bare string however CWT spells it.
    const swap: TechnologyFields["technologySwap"] = [{ name: "hello_galaxy_tech_swap" }];
    void swap;
    // @ts-expect-error — an id is not display text, so no language record.
    const recorded: TechnologyFields["technologySwap"] = [{ name: { english: "Swap" } }];
    void recorded;
  });
});
