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
 * lists, for SDK-13), sounds, sprites, and strategic resources. Each names the
 * `.cwt` file that declares it, so its path, keyword, and extension are read
 * from the rules rather than written down twice.
 */

import {
  CONTENT_MANIFEST,
  VANILLA_REF_EXTRAS,
  type VanillaRefExtra,
} from "@pdx-ts/codegen-cwt/content-manifest";

import type { BucketLayout } from "./trie.ts";

/**
 * A registry whose ids are enumerated from the install, resolved through the
 * CWT `type[...]` declaration named by {@link type}.
 */
export interface VanillaIdRow {
  readonly kind: "ids";
  /** The CWT type name. */
  readonly type: string;
  /** The id set's name: the type unless one CWT type backs several registries. */
  readonly registry: string;
  /** The declaring `.cwt` file, relative to the config root. */
  readonly source: string;
  /** Top-level keyword, for types the rules mark with `name_field`. */
  readonly keyword?: string;
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

const CONTENT_ROWS: readonly VanillaIdRow[] = CONTENT_MANIFEST.map((entry) => ({
  kind: "ids",
  type: entry.type,
  registry: "as" in entry ? entry.as : entry.type,
  source: entry.source,
  ...("keyword" in entry ? { keyword: entry.keyword } : {}),
}));

/**
 * Identifier sets outside the content manifest.
 *
 * `sound`/`sound_effect` are the two of sound.cwt's seven types whose ids are
 * referenced from script (`decision.sound`, `event.show_sound`); the other five
 * name categories and compressors nothing points at. `sprite` covers
 * `event.picture` and every other `<sprite>` field. `resource` unlocks typing
 * the `Record<string, number>` resource tables.
 *
 * These three are also the only registries whose files are laid out unlike
 * `common/`, so they are the only rows that state a {@link BucketLayout}.
 */
const SCRIPTED_ROWS: readonly VanillaScriptedRow[] = [
  { kind: "scripted", registry: "scripted_trigger", dir: "common/scripted_triggers" },
  { kind: "scripted", registry: "scripted_effect", dir: "common/scripted_effects" },
];

const EXTRA_BUCKETS = {
  sound: "directory",
  sound_effect: "directory",
  sprite: "file",
} as const satisfies Partial<Record<(typeof VANILLA_REF_EXTRAS)[number]["type"], BucketLayout>>;

const REF_ONLY_ROWS: readonly VanillaIdRow[] = VANILLA_REF_EXTRAS.map((row) => {
  const entry: VanillaRefExtra = row;
  return {
    kind: "ids",
    type: entry.type,
    registry: entry.type,
    source: entry.source,
    ...(entry.keyword === undefined ? {} : { keyword: entry.keyword }),
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
