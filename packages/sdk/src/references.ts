/**
 * The vocabulary for the references recorded script and content lowering write.
 *
 * It lives in its own module because all three encoders write them: content
 * lowering (`content/lower.ts`), the trigger builders (`script/trigger-core.ts`), and
 * the effect recorder (`script/effects/recorder.ts`). `buildMod` resolves whatever they record
 * against the ids the build actually defined.
 *
 * Recording as the id is written, rather than scanning the emitted tree
 * afterwards, is what makes the reference guard registry-aware and
 * false-positive-free: at the point of writing, the field table still says
 * which registries the id may name, so a country flag, a localization key, and
 * a saved event target — all of them own-prefixed scalars in the same output —
 * are never mistaken for content.
 */

import type { AssetFileItem } from "./authoring/assets.ts";
import { isPlaceableLocalizationItem, type LocalizationItem } from "./authoring/localization.ts";

/** One id-valued reference, recorded while it is written. */
export interface ContentRefUse {
  /**
   * Absent, which is how a content use is told from the localization arm of
   * {@link RecordedRefUse}. Declared as absent rather than spelled `"content"`
   * so none of the recording sites — most of them generated — has to write it.
   */
  readonly kind?: undefined;
  /** Registries the id may name; every one of them a real content type. */
  readonly targets: readonly string[];
  /** The lowered id, with branded refs already resolved to their string. */
  readonly id: string;
  /** Dotted PDXScript key path to the field holding it, e.g. `section.template`. */
  readonly field: string;
  /** The value came from a compile-time-checked `vanilla.*` helper. */
  readonly verifiedVanilla?: true;
}

/**
 * One `mod.localization()` item consumed by reference, recorded while its key
 * is written.
 *
 * The item is carried whole rather than as its key: the fold places its text
 * in the consuming definition's own localization file, so it needs the
 * translations and not only the name of the key. Only an ordinary item is
 * recorded — a replacement layer is a file the author places deliberately, and
 * an `external.localization` key has no text this build could place (SDK-306).
 */
export interface LocalizationRefUse {
  readonly kind: "localization";
  /** The consumed item, carried whole so the fold can place its translations. */
  readonly item: LocalizationItem;
  /** Dotted PDXScript key path to the field holding its key, e.g. `custom_tooltip.text`. */
  readonly field: string;
}

/** One reference an encoder recorded, of either recorded vocabulary. */
export type RecordedRefUse = ContentRefUse | LocalizationRefUse;

/** Where an encoder reports the references it writes. */
export type RefUseSink = (use: RecordedRefUse) => void;

/**
 * Records a consumed localization item beside the key an encoder just wrote.
 *
 * Call it wherever a `LocalizationRef` is lowered through `refId`, passing the
 * value as it was authored: anything that is not a placeable item — a bare key
 * string, an external reference, a replacement — is silently not recorded,
 * because none of them names text this build places.
 *
 * @param field - Dotted PDXScript key path to the field holding the key.
 */
export function recordLocalization(refs: RecordedRefUse[], value: unknown, field: string): void {
  if (isPlaceableLocalizationItem(value)) {
    refs.push({ kind: "localization", item: value, field });
  }
}

/**
 * One filepath-valued field, recorded while it is written.
 *
 * The `kind` is the whole point of recording these: an `AssetFileItem` names a
 * file this build is shipping, so a use naming an Item no Feature placed is a
 * dangling path the fold can prove and refuse. A plain string names a file the
 * SDK knows nothing about — vanilla's, a DLC's, another mod's, or one the
 * author will ship by hand — so it can only ever be checked against the
 * evidence at hand and reported as a warning.
 */
interface AssetPathUseBase {
  /** What was written into the file: the Item's declared logical path, or the raw string. */
  readonly path: string;
  /** Dotted PDXScript key path to the field holding it, e.g. `animation.animationmaskfile`. */
  readonly field: string;
}

/** A captured Asset, carried whole so the fold can compare it by identity. */
interface AssetPathItemUse extends AssetPathUseBase {
  readonly kind: "item";
  readonly item: AssetFileItem;
}

/** A path the author wrote out, which the SDK can only check against evidence. */
interface AssetPathStringUse extends AssetPathUseBase {
  readonly kind: "string";
  readonly item?: undefined;
}

export type AssetPathUse = AssetPathItemUse | AssetPathStringUse;

/**
 * Where an encoder reports the asset paths it writes.
 *
 * Separate from {@link RefUseSink} rather than a widening of it: the two other
 * encoders that write a `RefUseSink` — the trigger builders and the effect
 * recorder — write no filepath fields at all, and widening the sink they share
 * would give both of them an arm neither can ever produce.
 */
export type AssetPathSink = (use: AssetPathUse) => void;

/**
 * Re-roots recorded references under an enclosing field path.
 *
 * A trigger or effect closure records against its own key (`has_technology`),
 * knowing nothing about where it was spliced. Splicing it into a content field
 * or an event prepends that context, so the diagnostic names the whole path
 * rather than a bare condition name.
 */
export function underField(
  refs: readonly RecordedRefUse[],
  path: string
): readonly RecordedRefUse[] {
  if (path === "") {
    return refs;
  }
  return refs.map((use) => ({ ...use, field: `${path}.${use.field}` }));
}
