import { describe, expectTypeOf, it } from "vitest";

import {
  createMod,
  type LocalizationItem,
  type MintedLocalizationKey,
  type ReplacementLocalizationItem,
} from "../src/index.ts";

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

    const replacement = mod.replaceLocalization("crisis.2010.a", {
      english: "Reconsider.",
      french: "Réfléchissez.",
    });
    expectTypeOf(replacement).toEqualTypeOf<
      ReplacementLocalizationItem<"localization_types", "crisis.2010.a">
    >();
    expectTypeOf(replacement.key).toEqualTypeOf<"crisis.2010.a">();

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
  });
});
