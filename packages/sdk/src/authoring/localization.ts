/** Author-facing localization text, and standalone, mod-bound localization authoring. */

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

/** One or more explicitly translated values used when replacing existing text. */
export type LocalizationReplacements = Readonly<Partial<Record<LocalizationLanguage, string>>>;

/** English shorthand or a replacement language map with at least one supplied value. */
export type LocalizationReplacementText = string | LocalizationReplacements;

/**
 * A language record for a text position whose localization key the SDK derives
 * rather than the author spelling it, with an optional pin for that key.
 */
export type LocalizedTextRecord = Readonly<
  LocalizationTranslations & {
    /**
     * Pins the derived key's anonymous part instead of hashing the English
     * text, so editing that text does not orphan shipped translations. Only
     * accepted where the key would otherwise be a hash — a modifier row's
     * `desc`, an event option's `name`.
     */
    readonly key?: string;
  }
>;

/**
 * Display text for any slot the SDK keys itself: a bare string is the English
 * shorthand, and a language record carries English plus every translation
 * supplied for the same key.
 *
 * @example
 * ```ts
 * mod.building("resonance_archive", {
 *   name: { english: "Resonance Archive", french: "Archive de résonance" },
 * });
 * ```
 */
export type LocalizedText = string | LocalizedTextRecord;

/** {@link LocalizedText} split into the text to emit and the key pin, if any. */
export interface ResolvedLocalizedText {
  /** English plus every explicitly supplied translation. */
  readonly translations: LocalizationTranslations;
  /** The author's key pin, absent when the key stays fully derived. */
  readonly key?: string;
}

/** One localization key and its supplied language text, before a file is chosen. */
export interface KeyedLocalization {
  readonly key: string;
  readonly translations: LocalizationReplacements;
}

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
  /** Every explicitly supplied replacement translation. */
  readonly translations: LocalizationReplacements;
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

function assertLanguageRecord(
  languages: Readonly<Record<string, unknown>>
): asserts languages is LocalizationTranslations {
  assertLanguageNamesAndValues(languages);
  if (typeof languages["english"] !== "string") {
    throw new Error('Localization language records must include an "english" string');
  }
}

function assertLanguageNamesAndValues(languages: Readonly<Record<string, unknown>>): void {
  for (const language of Object.keys(languages)) {
    if (!languageSet.has(language)) {
      throw new Error(`Unsupported localization language "${language}"`);
    }
  }
  for (const [language, value] of Object.entries(languages)) {
    if (typeof value !== "string") {
      throw new Error(`Localization text for "${language}" must be a string`);
    }
  }
}

function assertReplacementLanguageRecord(
  languages: Readonly<Record<string, unknown>>
): asserts languages is LocalizationReplacements {
  assertLanguageNamesAndValues(languages);
  if (Object.keys(languages).length === 0) {
    throw new Error("A replacement must supply at least one language");
  }
}

function assertTextRecord(text: unknown): asserts text is Readonly<Record<string, unknown>> {
  if (text === null || Array.isArray(text) || typeof text !== "object") {
    throw new Error("Localization text must be an English string or a language record");
  }
}

function resolveTranslations(text: LocalizationText): LocalizationTranslations {
  if (typeof text === "string") {
    return Object.freeze({ english: text });
  }
  assertTextRecord(text);
  assertLanguageRecord(text);
  return Object.freeze({ ...text });
}

/**
 * Validates authored display text and separates its key pin from its languages.
 *
 * Use this wherever the SDK derives the localization key itself. `mod.localization`
 * takes {@link LocalizationText}, while `mod.replaceLocalization` takes
 * {@link LocalizationReplacementText}: their key is an explicit argument, so a pin there would
 * have nothing to pin.
 */
export function resolveLocalizedText(text: LocalizedText): ResolvedLocalizedText {
  if (typeof text === "string") {
    return { translations: Object.freeze({ english: text }) };
  }
  assertTextRecord(text);
  const { key, ...languages } = text;
  assertLanguageRecord(languages);
  if (key === undefined) {
    return { translations: Object.freeze(languages) };
  }
  if (typeof key !== "string") {
    throw new Error('Localization text "key" must be a string');
  }
  assertLocalizationSuffix(key);
  return { translations: Object.freeze(languages), key };
}

/**
 * Resolves display text for a position whose localization key is fixed by the
 * definition it rides on, refusing a key pin that could not take effect.
 *
 * @param position - Names the text position in the refusal, e.g. `technology "x" name`.
 * @param derivedKey - The key the position always emits under.
 */
export function resolveFixedKeyText(
  text: LocalizedText,
  position: string,
  derivedKey: string
): LocalizationTranslations {
  const { translations, key } = resolveLocalizedText(text);
  if (key !== undefined) {
    throw new Error(
      `${position} sets "key", but its localization key is always "${derivedKey}": no part of ` +
        `it comes from the English text, so there is nothing to pin. Remove "key" — it is for ` +
        `anonymous text, a modifier row's desc or an event option's name, whose key would ` +
        `otherwise hash that text.`
    );
  }
  return translations;
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

function resolveReplacementTranslations(
  text: LocalizationReplacementText
): LocalizationReplacements {
  if (typeof text === "string") {
    return Object.freeze({ english: text });
  }
  assertTextRecord(text);
  assertReplacementLanguageRecord(text);
  return Object.freeze({ ...text });
}

/** Creates a prefix-owned item that deliberately replaces an exact existing key. */
export function createReplacementLocalizationItem<const P extends string, const Key extends string>(
  prefix: P,
  key: Key,
  text: LocalizationReplacementText
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
    translations: resolveReplacementTranslations(text),
  });
}
