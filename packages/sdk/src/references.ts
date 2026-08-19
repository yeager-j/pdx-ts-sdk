/**
 * The vocabulary for recorded content references.
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

/** One id-valued reference, recorded while it is written. */
export interface ContentRefUse {
  /** Registries the id may name; every one of them a real content type. */
  readonly targets: readonly string[];
  /** The lowered id, with branded refs already resolved to their string. */
  readonly id: string;
  /** Dotted PDXScript key path to the field holding it, e.g. `section.template`. */
  readonly field: string;
  /** The value came from a compile-time-checked `vanilla.*` helper. */
  readonly verifiedVanilla?: true;
}

/** Where an encoder reports the references it writes. */
export type ContentRefSink = (use: ContentRefUse) => void;

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
 * Separate from {@link ContentRefSink} rather than a widening of it: the two
 * other encoders that write a `ContentRefSink` — the trigger builders and the
 * effect recorder — write no filepath fields at all, and widening the sink they
 * share would give both of them an arm neither can ever produce.
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
export function underField(refs: readonly ContentRefUse[], path: string): readonly ContentRefUse[] {
  if (path === "") {
    return refs;
  }
  return refs.map((use) => ({ ...use, field: `${path}.${use.field}` }));
}
