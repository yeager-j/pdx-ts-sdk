/**
 * Inline display text recorded by script, before an owner exists to key it
 * against.
 *
 * A `Trigger` is a value that travels: it is built once and spliced into
 * whatever field, event, or patch wants it, and the recorder that builds it
 * knows neither the consuming definition's id nor the localization file its
 * text will land in. So a recorded position validates the author's text
 * immediately and defers only the two things it cannot know — the final key,
 * and where the translations are registered.
 *
 * The deferred value is structurally a PDXScript `str` scalar carrying one
 * extra symbol-keyed property. Symbol keys are invisible to `Object.keys`,
 * to the serializer, and to tree comparison, so nothing in
 * `packages/pdxscript` learns about localization; the placeholder text is a
 * reserved token that could not be authored, so a marker that somehow reached
 * a file would be obvious rather than plausible. Every emission channel
 * asserts it did not ({@link assertNoDeferredLocalization}).
 *
 * `Trigger.entries` is public, so a Trigger holding one of these is an
 * owner-relative recorded template rather than finished script: reading its
 * entries before it is placed shows the placeholder, not a localization key.
 */

import { isScalar, type PdxItem } from "@pdx-ts/pdxscript";

import type { ModWarning } from "../diagnostics.ts";
import { shortLocalizationHash } from "../localization-key.ts";
import {
  resolveLocalizedText,
  type KeyedLocalization,
  type LocalizationTranslations,
} from "./localization.ts";

const deferredLocalizationMark = Symbol("pdx.localization.deferred");

/** What a deferred position knows about its own text before it has an owner. */
export interface DeferredLocalizationMeta {
  /** English plus every explicitly supplied translation, already validated. */
  readonly translations: LocalizationTranslations;
  /** The author's key pin, absent when the derived key hashes the English text. */
  readonly key?: string;
  /** The generated script field path the text was recorded at, e.g. `custom_tooltip.fail_text`. */
  readonly path: string;
  /** Distinguishes two markers carrying identical metadata, for diagnostics. */
  readonly id: number;
}

/**
 * A PDXScript scalar standing in for a localization key that is not derivable
 * yet. Valid input to every `@pdx-ts/pdxscript` constructor, and replaced
 * before anything renders it.
 */
export interface DeferredLocalizationScalar {
  readonly kind: "str";
  readonly value: string;
  readonly quoted: boolean;
  readonly [deferredLocalizationMark]: DeferredLocalizationMeta;
}

/**
 * How many markers this process has created.
 *
 * Resolution and the emission assertions walk whole subtrees, so a build that
 * never records inline script text should not pay for the walk at all. The
 * counter only ever grows, so zero is a sound reason to skip.
 */
let created = 0;

let nextMarkerId = 0;

/** The placeholder text a marker carries, which no author could write. */
function placeholderText(id: number): string {
  return `__pdx_deferred_localization_${String(id)}__`;
}

/**
 * Records inline display text at a script position, deferring its key.
 *
 * @param path - The generated script field path, e.g. `custom_tooltip.fail_text`.
 * @throws Error If the text is neither an English string nor a valid language record.
 */
export function deferLocalization(text: unknown, path: string): DeferredLocalizationScalar {
  const { translations, key } = resolveLocalizedText(text as string);
  const id = nextMarkerId++;
  created += 1;
  return Object.freeze({
    kind: "str" as const,
    value: placeholderText(id),
    quoted: false,
    [deferredLocalizationMark]: Object.freeze({ translations, key, path, id }),
  });
}

/** Whether a value is a deferred localization marker rather than an ordinary scalar. */
export function isDeferredLocalization(value: unknown): value is DeferredLocalizationScalar {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<DeferredLocalizationScalar>)[deferredLocalizationMark] !== undefined
  );
}

/**
 * Where a resolved marker's text is registered, and the identity its key is
 * derived from.
 *
 * `warned` is supplied by a caller that outlives one resolution — a
 * definition lowered twice, a Trigger spliced into two fields — so the
 * `unstable-localization-key` warning is raised once per derived key rather
 * than once per occurrence.
 */
export interface ScriptLocalizationSink {
  /** Collects one entry per key resolved, in resolution order. */
  readonly into: KeyedLocalization[];
  /** Receives diagnostics; already deduplicated by derived key. */
  readonly warn: (warning: ModWarning) => void;
  /** Derived keys already warned about. */
  readonly warned?: Set<string>;
}

const KEY_UNSAFE = /[^A-Za-z0-9_\-']/g;

/**
 * The key one marker resolves to under an owner.
 *
 * The outer content field is diagnostic context rather than identity: the
 * marker's own generated script path is what distinguishes two positions
 * inside one condition, so the same reusable Trigger keys the same way
 * whichever field of an owner it is composed under.
 */
function deferredLocalizationKey(ownerId: string, meta: DeferredLocalizationMeta): string {
  const path = meta.path.replace(KEY_UNSAFE, "_");
  const tail = meta.key ?? shortLocalizationHash(meta.translations.english);
  return `${ownerId}_${path}_${tail}`;
}

/**
 * Registers one marker's translations and returns the key its scalar becomes.
 *
 * A pin keeps the key stable when the words change; without one the key
 * hashes the English text, which is what {@link ScriptLocalizationSink.warn}
 * reports so a shipped translation cannot be orphaned silently.
 */
function resolveMarker(
  meta: DeferredLocalizationMeta,
  ownerId: string,
  sink: ScriptLocalizationSink,
  warned: Set<string>
): string {
  const key = deferredLocalizationKey(ownerId, meta);
  sink.into.push({ key, translations: meta.translations });
  if (meta.key === undefined && !warned.has(key)) {
    warned.add(key);
    sink.warn({
      code: "unstable-localization-key",
      message:
        `Recorded script text at "${meta.path}" under "${ownerId}" has no key; its ` +
        `localization key "${key}" hashes the English text and will change if that text is ` +
        "edited, orphaning any translation shipped against it. Write the text as " +
        '`{ english: "...", key: "..." }` to pin a stable key.',
    });
  }
  return key;
}

function resolveItem(
  item: PdxItem,
  ownerId: string,
  sink: ScriptLocalizationSink,
  warned: Set<string>
): PdxItem {
  if (isDeferredLocalization(item)) {
    return {
      kind: "str",
      value: resolveMarker(item[deferredLocalizationMark], ownerId, sink, warned),
      quoted: false,
    };
  }
  if (item.kind === "entry") {
    const value = item.value;
    if (isScalar(value)) {
      const resolved = resolveItem(value, ownerId, sink, warned);
      return resolved === value ? item : { ...item, value: resolved as typeof value };
    }
    const items = resolveItems(value.items, ownerId, sink, warned);
    return items === value.items ? item : { ...item, value: { ...value, items } };
  }
  if (item.kind === "container" || item.kind === "param") {
    const items = resolveItems(item.items, ownerId, sink, warned);
    return items === item.items ? item : { ...item, items };
  }
  return item;
}

function resolveItems<T extends PdxItem>(
  items: readonly T[],
  ownerId: string,
  sink: ScriptLocalizationSink,
  warned: Set<string>
): readonly T[] {
  let resolved: T[] | undefined;
  for (const [index, item] of items.entries()) {
    const next = resolveItem(item, ownerId, sink, warned) as T;
    if (next !== item && resolved === undefined) {
      resolved = items.slice(0, index);
    }
    resolved?.push(next);
  }
  return resolved ?? items;
}

/**
 * Replaces every deferred marker in a recorded subtree with its final key,
 * registering the text it carried.
 *
 * The subtree is rebuilt rather than edited: a `Trigger` is reusable, so the
 * array it hands out and every node inside it must survive the splice
 * unchanged and resolve independently under the next owner. Untouched
 * branches are returned by identity, so a subtree with no markers costs one
 * walk and no allocation.
 *
 * @param ownerId - The nearest enclosing identity, which the derived key hangs off.
 */
export function resolveDeferredLocalization<T extends PdxItem>(
  items: readonly T[],
  ownerId: string,
  sink: ScriptLocalizationSink | undefined
): readonly T[] {
  if (created === 0 || sink === undefined) {
    return items;
  }
  return resolveItems(items, ownerId, sink, sink.warned ?? new Set<string>());
}

/**
 * Refuses a subtree still holding a deferred marker, naming the channel that
 * was about to emit it.
 *
 * The marker's whole safety argument is that it never reaches a file, so the
 * channels that write one check rather than trust: an unresolved marker means
 * a splice point that never asked for an owner, which is a generator or
 * lowering bug and not something an author can fix.
 */
export function assertNoDeferredLocalization(items: readonly PdxItem[], where: string): void {
  if (created === 0) {
    return;
  }
  const found = findMarker(items);
  if (found !== undefined) {
    throw new Error(
      `${where} still holds unresolved inline localization recorded at "${found.path}". ` +
        "Recorded script text is keyed where it is spliced into a definition, an event, or a " +
        "patch, so reaching emission unresolved means that splice point never supplied an " +
        "owner. Report this: it is an SDK bug, not an authoring mistake."
    );
  }
}

function findMarker(items: readonly PdxItem[]): DeferredLocalizationMeta | undefined {
  for (const item of items) {
    if (isDeferredLocalization(item)) {
      return item[deferredLocalizationMark];
    }
    if (item.kind === "entry") {
      const found = isScalar(item.value) ? findMarker([item.value]) : findMarker(item.value.items);
      if (found !== undefined) {
        return found;
      }
      continue;
    }
    if (item.kind === "container" || item.kind === "param") {
      const found = findMarker(item.items);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}
