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
export interface LocalizationItem<
  P extends string = string,
  Key extends string = string,
  ShouldPrefix extends boolean = true,
> {
  readonly itemKind: "localization";
  readonly layer: "ordinary";
  /** The complete emitted key. */
  readonly key: ShouldPrefix extends false ? Key : MintedLocalizationKey<P, Key>;
  /** Runtime ownership proof used when the item is placed in a feature. */
  readonly prefix: P;
  /** English plus every explicitly supplied translation. */
  readonly translations: LocalizationTranslations;
}

/** The standalone localization method bound to one mod prefix. */
export interface LocalizationMethod<P extends string> {
  <const Key extends string>(key: Key, text: LocalizationText): LocalizationItem<P, Key>;
  <const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix: false }
  ): LocalizationItem<P, Key, false>;
  <const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix?: true }
  ): LocalizationItem<P, Key>;
  <const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix?: boolean }
  ): LocalizationItem<P, Key, boolean>;
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

function assertExactOrdinaryLocalizationKey(key: string): void {
  if (!LOCALIZATION_KEY_PATTERN.test(key)) {
    throw new Error(
      `Exact ordinary localization key "${key}" must start with an ASCII letter, digit, or "_" ` +
        `and contain only ASCII letters, digits, "_", ".", "-", or "'"`
    );
  }
}

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
function createLocalizationItem<const P extends string, const Key extends string>(
  prefix: P,
  key: Key,
  text: LocalizationText,
  options: { readonly prefix?: boolean } = {}
): LocalizationItem<P, Key, boolean> {
  const shouldPrefix = options.prefix ?? true;
  let emittedKey: string;
  if (shouldPrefix) {
    assertLocalizationSuffix(key);
    emittedKey = `${prefix}_${key}`;
    if (!LOCALIZATION_KEY_PATTERN.test(emittedKey)) {
      throw new Error(`Localization key "${emittedKey}" is not valid for Stellaris 4.4.6`);
    }
  } else {
    assertExactOrdinaryLocalizationKey(key);
    emittedKey = key;
  }
  const typedKey = emittedKey as LocalizationItem<P, Key, boolean>["key"];
  return Object.freeze({
    itemKind: "localization",
    layer: "ordinary",
    key: typedKey,
    prefix,
    translations: resolveTranslations(text),
  });
}

/** Binds standalone localization authoring to one mod prefix. */
export function localizationFor<const P extends string>(prefix: P): LocalizationMethod<P> {
  function localization<const Key extends string>(
    key: Key,
    text: LocalizationText
  ): LocalizationItem<P, Key>;
  function localization<const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix: false }
  ): LocalizationItem<P, Key, false>;
  function localization<const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix?: true }
  ): LocalizationItem<P, Key>;
  function localization<const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix?: boolean }
  ): LocalizationItem<P, Key, boolean>;
  function localization<const Key extends string>(
    key: Key,
    text: LocalizationText,
    options: { readonly prefix?: boolean } = {}
  ): LocalizationItem<P, Key, boolean> {
    return createLocalizationItem(prefix, key, text, options);
  }
  return localization;
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
