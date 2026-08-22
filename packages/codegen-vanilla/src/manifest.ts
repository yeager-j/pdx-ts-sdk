/**
 * What the vanilla identifier package covers.
 *
 * The content registries are not restated here: they come from
 * `@pdx-ts/codegen-cwt`'s `content-manifest.ts`, which is already the one authority on
 * which registries the SDK exposes. A registry added there gains vanilla
 * identifiers automatically, which is the point — the two lists cannot drift.
 *
 * The explicit rows are the identifier sets the SDK references but does not
 * define content for: scripted triggers and effects (names plus `$PARAM$`
 * lists, for SDK-13), sounds, and strategic resources. Each names the
 * `.cwt` file that declares it, so its path, keyword, and extension are read
 * from the rules rather than written down twice.
 */

import { MINT_SHAPE_OVERLAYS } from "@pdx-ts/codegen-cwt/overlay";
import {
  CONTENT_MANIFEST,
  registryNameOf,
  VANILLA_REF_EXTRAS,
  type VanillaRefExtra,
} from "@pdx-ts/codegen-cwt/policy/manifest";

import type { BucketLayout } from "./trie.ts";

/**
 * A registry whose ids are enumerated from the install, resolved through the
 * CWT `type[...]` declaration named by {@link type}.
 */
export interface VanillaIdRow {
  readonly kind: "ids";
  /** The CWT type name. */
  readonly type: string;
  /** The id set's name: the type unless the manifest renames it. */
  readonly registry: string;
  /**
   * The CWT subtype the registry narrows to, when it is one. Only used to
   * derive the SDK reference these ids are branded with, which is why it is the
   * subtype and not the registry name — see `referenceNameOf`.
   */
  readonly as?: string;
  /** The declaring `.cwt` file, relative to the config root. */
  readonly source: string;
  /** Top-level keyword, for types the rules mark with `name_field`. */
  readonly keyword?: string;
  /** Emit a trie even when the current install is below the measured threshold. */
  readonly oversized?: true;
  /**
   * How this registry's files name their buckets *if* it turns out to be
   * oversized. Whether it gets a trie at all is measured, not declared — the id
   * count decides that. How its files are laid out is a fact about the
   * install's directories, so it is stated here, and defaults to the `common/`
   * convention every content registry follows.
   */
  readonly bucket?: BucketLayout;
}

/**
 * A `common/scripted_*` directory, whose definitions carry parameters rather
 * than a body the SDK types. Not a CWT `type[...]` at all, so the directory is
 * stated outright.
 */
export interface VanillaScriptedRow {
  readonly kind: "scripted";
  readonly registry: string;
  /** Directory under the install root. */
  readonly dir: string;
}

export type VanillaManifestRow = VanillaIdRow | VanillaScriptedRow;

/**
 * Bucket layouts for the content registries whose files are laid out unlike
 * `common/`, keyed by the *registry* name.
 *
 * Which registries exist is `content-manifest.ts`'s to say; how the install
 * arranges their files is this generator's, so the table sits here beside
 * {@link EXTRA_BUCKETS} rather than in the manifest.
 *
 * - `spriteType`: `interface/` is one flat directory of `.gfx` files with no
 *   load-order numbers and no restated token, so the verbatim stem is the
 *   bucket — the shape the `sprite` ref-only row already had before the
 *   registry became authorable.
 * - `pdxmesh`: `gfx/models/` is a deep tree (301 files, up to five levels) whose
 *   directories are the real categories — DLC, then subject, the way `sound/`
 *   is. Flattening 3,269 ids onto 301 sibling stem buckets would throw the
 *   navigation away and collide stems that repeat across directories
 *   (`effects/cosmic_storms/GravityL.gfx` and kin).
 */
const CONTENT_BUCKETS: Partial<Record<string, BucketLayout>> = {
  spriteType: "file",
  pdxmesh: "directory",
};

const CONTENT_ROWS: readonly VanillaIdRow[] = CONTENT_MANIFEST.map((entry) => {
  const registry = registryNameOf(entry);
  const bucket = CONTENT_BUCKETS[registry];
  return {
    kind: "ids",
    type: entry.type,
    registry,
    ...("as" in entry ? { as: entry.as } : {}),
    source: entry.source,
    ...("keyword" in entry ? { keyword: entry.keyword } : {}),
    ...("oversized" in entry ? { oversized: entry.oversized } : {}),
    ...(bucket === undefined ? {} : { bucket }),
  };
});

/**
 * Identifier sets outside the content manifest.
 *
 * `sound`/`sound_effect` are the two of sound.cwt's seven types whose ids are
 * referenced from script (`decision.sound`, `event.show_sound`); the other five
 * name categories and compressors nothing points at. `resource` unlocks typing
 * the `Record<string, number>` resource tables.
 *
 * The two sound rows are laid out unlike `common/`, so they state a
 * {@link BucketLayout}; the GFX registries do too, from {@link CONTENT_BUCKETS}.
 */
const SCRIPTED_ROWS: readonly VanillaScriptedRow[] = [
  { kind: "scripted", registry: "scripted_trigger", dir: "common/scripted_triggers" },
  { kind: "scripted", registry: "scripted_effect", dir: "common/scripted_effects" },
];

const EXTRA_BUCKETS = {
  sound: "directory",
  sound_effect: "directory",
} as const satisfies Partial<Record<(typeof VANILLA_REF_EXTRAS)[number]["type"], BucketLayout>>;

const REF_ONLY_ROWS: readonly VanillaIdRow[] = VANILLA_REF_EXTRAS.map((row) => {
  const entry: VanillaRefExtra = row;
  return {
    kind: "ids",
    type: entry.type,
    registry: entry.type,
    source: entry.source,
    ...(entry.keyword === undefined ? {} : { keyword: entry.keyword }),
    ...(entry.oversized === undefined ? {} : { oversized: entry.oversized }),
    ...(entry.type in EXTRA_BUCKETS
      ? { bucket: EXTRA_BUCKETS[entry.type as keyof typeof EXTRA_BUCKETS] }
      : {}),
  };
});

export const VANILLA_MANIFEST: readonly VanillaManifestRow[] = [
  ...CONTENT_ROWS,
  ...SCRIPTED_ROWS,
  ...REF_ONLY_ROWS,
];

/**
 * Registries whose ids ship as a runtime membership set as well as a type.
 *
 * Read off `MINT_SHAPE_OVERLAYS` rather than listed, because that table is
 * exactly the question: a registry with a mint shape has no id segment between
 * the mod prefix and the name, so its minted names share one flat namespace
 * with vanilla's — `GFX_${prefix}_${name}` sits beside vanilla's 9,198 `GFX_`
 * names, and a bare `${prefix}_${name}` mesh sits beside vanilla's bare mesh
 * names. Every other registry mints `${prefix}_${segment}_${name}`, where the
 * segment is what keeps the two name spaces apart by construction and there is
 * nothing for a lookup to find.
 *
 * So this is not "the GFX registries" spelled a second way; it is the property
 * that makes the refusal necessary, and a future segmentless registry gets the
 * evidence without anyone remembering to add it.
 */
export const RUNTIME_ID_SET_REGISTRIES: readonly string[] = CONTENT_ROWS.filter((row) =>
  MINT_SHAPE_OVERLAYS.has(row.registry)
).map((row) => row.registry);
