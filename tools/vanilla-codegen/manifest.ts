/**
 * What the vanilla identifier package covers.
 *
 * The content registries are not restated here: they come from
 * `tools/codegen/content-manifest.ts`, which is already the one authority on
 * which registries the SDK exposes. A registry added there gains vanilla
 * identifiers automatically, which is the point — the two lists cannot drift.
 *
 * The explicit rows are the identifier sets the SDK references but does not
 * define content for: scripted triggers and effects (names plus `$PARAM$`
 * lists, for SDK-13), sounds, sprites, and strategic resources. Each names the
 * `.cwt` file that declares it, so its path, keyword, and extension are read
 * from the rules rather than written down twice.
 */

import { CONTENT_MANIFEST } from "../codegen/content-manifest.ts";

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
 */
const EXTRA_ROWS: readonly VanillaManifestRow[] = [
  { kind: "scripted", registry: "scripted_trigger", dir: "common/scripted_triggers" },
  { kind: "scripted", registry: "scripted_effect", dir: "common/scripted_effects" },
  { kind: "ids", type: "sound", registry: "sound", source: "sound/sound.cwt", keyword: "sound" },
  {
    kind: "ids",
    type: "sound_effect",
    registry: "sound_effect",
    source: "sound/sound.cwt",
    keyword: "soundeffect",
  },
  { kind: "ids", type: "sprite", registry: "sprite", source: "interface/sprites.cwt" },
  { kind: "ids", type: "resource", registry: "resource", source: "common/strategic_resources.cwt" },
];

export const VANILLA_MANIFEST: readonly VanillaManifestRow[] = [...CONTENT_ROWS, ...EXTRA_ROWS];
