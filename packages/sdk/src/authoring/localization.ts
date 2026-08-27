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

type AtLeastOneLanguage = {
  [L in LocalizationLanguage]: Readonly<
    Partial<Record<LocalizationLanguage, string>> & Record<L, string>
  >;
}[LocalizationLanguage];

/** One or more explicitly translated values used when replacing existing text. */
export type LocalizationReplacements = AtLeastOneLanguage;

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

/**
 * Which of the two localization directories an entry is emitted into.
 *
 * `replace` is `localisation/replace/`, which the game reads with priority
 * over the ordinary directory. Filename order never decides a localisation
 * winner, so this layer — not a file stem — is how text lands on a key some
 * other source already defines.
 */
export type LocalizationLayer = "ordinary" | "replace";

/** One localization key and its supplied language text, before a file is chosen. */
export interface KeyedLocalization {
  readonly key: string;
  readonly translations: LocalizationReplacements;
  /**
   * Overrides the layer the registering collector would otherwise use, for a
   * collector that produces both. Absent means the collector's own layer.
   */
  readonly layer?: LocalizationLayer;
}

declare const localizationRefBrand: unique symbol;

/**
 * A reference to one localization key, in the only form a key-typed content
 * field accepts besides inline text.
 *
 * `mod.localization()` and `mod.replaceLocalization()` return references, so
 * their result goes straight into a field that wants a key. A key this build
 * does not define — vanilla's, or another mod's — is spelled
 * `external.localization("key")`.
 *
 * The brand exists only in the type: the constructors above are the only way
 * to obtain one, so a bare `{ key }` object cannot stand in for a key the SDK
 * has no record of.
 */
export interface LocalizationRef {
  /** Separates a key reference from authored display text at runtime. */
  readonly refKind: "localization";
  /** The complete emitted key. */
  readonly key: string;
  readonly [localizationRefBrand]: true;
}

/** A definition's minted localization keys, one reference per named slot. */
export type LocalizationRefs = Readonly<Record<string, LocalizationRef>>;

/**
 * The `loc` member of a registry that declares no localization slots at all.
 *
 * An empty surface rather than an absent member: the registry mints no keys,
 * so naming one is a compile error instead of a reference to nothing.
 */
export type NoLocalizationRefs = { readonly [slot in never]: LocalizationRef };

/**
 * Whether an authored text value is a key reference rather than display text.
 *
 * The runtime signature is `refKind` rather than the presence of `key`:
 * {@link LocalizedTextRecord} carries an optional `key` of its own, which
 * pins a derived key and is not a reference to anything.
 */
export function isLocalizationRef(value: unknown): value is LocalizationRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly refKind?: unknown }).refKind === "localization"
  );
}

/**
 * Adds the phantom brand to a record that already carries the runtime marker.
 *
 * The brand has no runtime presence, so this assertion is what makes a
 * `LocalizationRef`. Keeping it here means every reference the SDK hands out
 * comes from a constructor in this module.
 */
function brandLocalizationRef<T extends { readonly refKind: "localization"; readonly key: string }>(
  value: T
): T & LocalizationRef {
  return value as T & LocalizationRef;
}

/** The complete localization key minted from a mod prefix and author-chosen suffix. */
export type MintedLocalizationKey<P extends string, Suffix extends string> = `${P}_${Suffix}`;

/**
 * An immutable standalone localization entry placed through `mod.feature()`.
 *
 * It is also a {@link LocalizationRef}, so it can be passed directly to any
 * content field that names a localization key.
 */
export interface LocalizationItem<
  P extends string = string,
  Key extends string = string,
  ShouldPrefix extends boolean = true,
> extends LocalizationRef {
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

/**
 * An immutable, deliberate replacement of an exact existing localization key.
 *
 * It is also a {@link LocalizationRef}: the key it rewrites is a key a content
 * field may name.
 */
export interface ReplacementLocalizationItem<
  P extends string = string,
  Key extends string = string,
> extends LocalizationRef {
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

function assertExactLocalizationKey(key: string, subject: string): void {
  if (!LOCALIZATION_KEY_PATTERN.test(key)) {
    throw new Error(
      `${subject} "${key}" must start with an ASCII letter, digit, or "_" ` +
        `and contain only ASCII letters, digits, "_", ".", "-", or "'"`
    );
  }
}

/**
 * References a localization key by its exact spelling, validating only its
 * syntax. Published as `external.localization`.
 *
 * The reference is declared rather than checked: nothing knows which keys the
 * game or a third-party mod defines, so a misspelling reaches the shipped mod,
 * where an unresolved key shows as itself.
 */
export function localizationRef(key: string): LocalizationRef {
  assertExactLocalizationKey(key, "Localization key");
  return brandLocalizationRef(Object.freeze({ refKind: "localization" as const, key }));
}

/** What a {@link loc} template accepts in an interpolation. */
export type LocInterpolation = LocalizationRef | string | number;

function interpolatedText(value: LocInterpolation, position: number): string {
  if (isLocalizationRef(value)) {
    return `$${value.key}$`;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  throw new TypeError(
    `loc\`\` interpolation ${position} is of type "${typeof value}": it takes a localization ` +
      "reference, a string, or a number. Text a definition owns is authored on that " +
      "definition, and the reference its `loc` member carries is what goes here."
  );
}

/**
 * Builds display text that embeds the localization keys other definitions mint.
 *
 * A {@link LocalizationRef} becomes the game's `$<key>$` variable, which
 * resolves at display time to whatever text that key holds; a string or a
 * number is written as it stands. Everything else — colour codes, icon tags,
 * scope properties — is ordinary text, so write the game's markup directly.
 *
 * @throws TypeError If an interpolated value is not a reference, string, or number.
 * @example
 * ```ts
 * const glory = mod.resource("glory", { name: "Glory" });
 *
 * mod.ascensionPerk("ambition", {
 *   name: "Boundless Ambition",
 *   desc: loc`Allows the accumulation of §Y${glory.loc.name}§! by completing objectives.`,
 * });
 * ```
 */
export function loc(strings: TemplateStringsArray, ...values: readonly LocInterpolation[]): string {
  const parts = [strings[0] ?? ""];
  values.forEach((value, index) => {
    parts.push(interpolatedText(value, index), strings[index + 1] ?? "");
  });
  return parts.join("");
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
  if (isLocalizationRef(text)) {
    throw new Error(
      `A localization reference ("${text.key}") was given where the SDK derives the key ` +
        "itself, so the reference has nowhere to point. Write the display text here, or move " +
        "the reference to a field that names a key."
    );
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
    assertExactLocalizationKey(key, "Exact ordinary localization key");
    emittedKey = key;
  }
  const typedKey = emittedKey as LocalizationItem<P, Key, boolean>["key"];
  return brandLocalizationRef(
    Object.freeze({
      itemKind: "localization" as const,
      layer: "ordinary" as const,
      refKind: "localization" as const,
      key: typedKey,
      prefix,
      translations: resolveTranslations(text),
    })
  );
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
  assertExactLocalizationKey(key, "Replacement localization key");
  return brandLocalizationRef(
    Object.freeze({
      itemKind: "localization" as const,
      layer: "replace" as const,
      refKind: "localization" as const,
      key,
      prefix,
      translations: resolveReplacementTranslations(text),
    })
  );
}
