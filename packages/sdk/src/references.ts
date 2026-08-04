/**
 * The vocabulary for recorded content references.
 *
 * It lives in its own module because all three encoders write them: content
 * lowering (`content.ts`), the trigger builders (`trigger-core.ts`), and the
 * effect recorder (`effect-core.ts`). `buildMod` resolves whatever they record
 * against the ids the build actually defined.
 *
 * Recording as the id is written, rather than scanning the emitted tree
 * afterwards, is what makes the reference guard registry-aware and
 * false-positive-free: at the point of writing, the field table still says
 * which registries the id may name, so a country flag, a localization key, and
 * a saved event target — all of them own-prefixed scalars in the same output —
 * are never mistaken for content.
 */

/** One id-valued reference, recorded while it is written. */
export interface ContentRefUse {
  /** Registries the id may name; every one of them a real content type. */
  readonly targets: readonly string[];
  /** The lowered id, with branded refs already resolved to their string. */
  readonly id: string;
  /** Dotted PDXScript key path to the field holding it, e.g. `section.template`. */
  readonly field: string;
}

/** Where an encoder reports the references it writes. */
export type ContentRefSink = (use: ContentRefUse) => void;

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
