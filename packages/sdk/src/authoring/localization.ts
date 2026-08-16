/** Standalone, mod-bound localization authoring. */

import { assertLocalizationSuffix } from "../localization-key.ts";

/** Language directories and file headers supported by Stellaris 4.4.6. */
export const LOCALIZATION_LANGUAGES = Object.freeze([
  "english",
  "braz_por",
  "french",
  "german",
  "japanese",
  "korean",
  "polish",
  "russian",
  "simp_chinese",
  "spanish",
] as const);

/** A language directory and `l_<language>:` header supported by Stellaris 4.4.6. */
export type LocalizationLanguage = (typeof LOCALIZATION_LANGUAGES)[number];

/** English text plus any translations supplied for the same localization key. */
export type LocalizationTranslations = Readonly<
  { english: string } & Partial<Record<Exclude<LocalizationLanguage, "english">, string>>
>;

/** English shorthand or an explicitly translated localization value. */
export type LocalizationText = string | LocalizationTranslations;

/** The complete localization key minted from a mod prefix and author-chosen suffix. */
export type MintedLocalizationKey<P extends string, Suffix extends string> = `${P}_${Suffix}`;

/** An immutable standalone localization entry placed through `mod.feature()`. */
export interface LocalizationItem<P extends string = string, Suffix extends string = string> {
  readonly itemKind: "localization";
  readonly layer: "ordinary";
  /** The complete emitted key, including the owning mod prefix. */
  readonly key: MintedLocalizationKey<P, Suffix>;
  /** Runtime ownership proof used when the item is placed in a feature. */
  readonly prefix: P;
  /** English plus every explicitly supplied translation. */
  readonly translations: LocalizationTranslations;
}

/** An immutable, deliberate replacement of an exact existing localization key. */
export interface ReplacementLocalizationItem<
  P extends string = string,
  Key extends string = string,
> {
  readonly itemKind: "localization";
  readonly layer: "replace";
  /** The exact existing key written without prefixing or normalization. */
  readonly key: Key;
  /** Runtime ownership proof used when the item is placed in a feature. */
  readonly prefix: P;
  /** English plus every explicitly supplied replacement translation. */
  readonly translations: LocalizationTranslations;
}

const LOCALIZATION_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.\-']*$/;
const languageSet = new Set<string>(LOCALIZATION_LANGUAGES);

function resolveTranslations(text: LocalizationText): LocalizationTranslations {
  if (typeof text === "string") {
    return Object.freeze({ english: text });
  }
  if (text === null || Array.isArray(text) || typeof text !== "object") {
    throw new Error("Localization text must be an English string or a language record");
  }
  for (const language of Object.keys(text)) {
    if (!languageSet.has(language)) {
      throw new Error(`Unsupported localization language "${language}"`);
    }
  }
  if (typeof text.english !== "string") {
    throw new Error('Localization language records must include an "english" string');
  }
  for (const [language, value] of Object.entries(text)) {
    if (typeof value !== "string") {
      throw new Error(`Localization text for "${language}" must be a string`);
    }
  }
  return Object.freeze({ ...text });
}

/** Creates a prefix-owned standalone localization item. */
export function createLocalizationItem<const P extends string, const Suffix extends string>(
  prefix: P,
  keySuffix: Suffix,
  text: LocalizationText
): LocalizationItem<P, Suffix> {
  assertLocalizationSuffix(keySuffix);
  const key = `${prefix}_${keySuffix}` as MintedLocalizationKey<P, Suffix>;
  if (!LOCALIZATION_KEY_PATTERN.test(key)) {
    throw new Error(`Localization key "${key}" is not valid for Stellaris 4.4.6`);
  }
  return Object.freeze({
    itemKind: "localization",
    layer: "ordinary",
    key,
    prefix,
    translations: resolveTranslations(text),
  });
}

/** Creates a prefix-owned item that deliberately replaces an exact existing key. */
export function createReplacementLocalizationItem<const P extends string, const Key extends string>(
  prefix: P,
  key: Key,
  text: LocalizationText
): ReplacementLocalizationItem<P, Key> {
  if (!LOCALIZATION_KEY_PATTERN.test(key)) {
    throw new Error(
      `Replacement localization key "${key}" must start with an ASCII letter, digit, or "_" ` +
        `and contain only ASCII letters, digits, "_", ".", "-", or "'"`
    );
  }
  return Object.freeze({
    itemKind: "localization",
    layer: "replace",
    key,
    prefix,
    translations: resolveTranslations(text),
  });
}
