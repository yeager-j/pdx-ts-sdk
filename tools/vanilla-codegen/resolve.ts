/**
 * Turns manifest rows into the directory layout each registry actually has in
 * the install.
 *
 * Nothing about where a registry's files live is written down here: `path`,
 * `path_extension`, `name_field`, and `skip_root_key` all come from the CWT
 * `type[...]` declaration. What the manifest states — the keyword a
 * `name_field` registry is written under — is cross-checked against any
 * `## type_key_filter` the rules declare, the same stance `tools/codegen`
 * takes: a keyword the rules contradict would emit a top-level key the game
 * quietly ignores.
 */

import type { TrieMode } from "../codegen/content-manifest.ts";
import { loadContentTypesFrom, loadRules, type ContentType } from "../codegen/cwt/rules.ts";
import type { VanillaIdRow } from "./manifest.ts";

/** Where one registry's definitions live, and how to recognise them. */
export interface RegistrySpec {
  readonly registry: string;
  /** Directory under the install root, e.g. `common/technology`. */
  readonly path: string;
  /** File extension the registry's files carry, including the dot. */
  readonly extension: string;
  /** Repeated top-level key each definition is written under, when it has one. */
  readonly keyword: string | null;
  /** Body field carrying the id, for registries keyed by a repeated keyword. */
  readonly nameField: string | null;
  /** Root block the definitions sit one level inside, e.g. `spriteTypes`. */
  readonly skipRootKey: string | null;
  /**
   * `path_strict`: read `path` itself and no subdirectory of it. Only
   * `technology` needs it among the registries here, and it needs it badly —
   * `common/technology/tier` and `common/technology/category` hold two other
   * CWT types, whose ids a recursive walk would emit as technologies.
   */
  readonly pathStrict: boolean;
  /** How this registry's trie is arranged, if it is large enough to get one. */
  readonly trieMode: TrieMode;
}

/** The extension the game assumes when the rules declare none. */
const DEFAULT_EXTENSION = ".txt";

/**
 * Resolves every id row against the rules.
 *
 * Types declared in a file `loadRules` reads come from there, so the main
 * pipeline's view stays the single source. The rest — sounds, sprites,
 * strategic resources — are read from their own files through
 * `loadContentTypesFrom`, which touches neither `RULE_FILES` nor the drift
 * baseline.
 */
export function resolveRegistries(
  configRoot: string,
  rows: readonly VanillaIdRow[]
): readonly RegistrySpec[] {
  const rules = loadRules(configRoot);
  const outside = rows.filter((row) => !rules.contentTypes.has(row.type));
  const extraSources = [...new Set(outside.map((row) => row.source))].sort();
  const extra = loadContentTypesFrom(configRoot, extraSources);
  return rows.map((row) =>
    resolveRow(row, rules.contentTypes.get(row.type) ?? extra.get(row.type))
  );
}

function resolveRow(row: VanillaIdRow, type: ContentType | undefined): RegistrySpec {
  if (type === undefined) {
    throw new Error(`${row.source} no longer declares type[${row.type}]`);
  }
  const path = type.path;
  if (path === null || !path.startsWith("game/")) {
    throw new Error(`type[${row.type}] has unusable path ${path}`);
  }
  const keyword = row.keyword ?? null;
  const skipRootKey = type.skipRootKey ?? null;
  if (keyword !== null && type.nameField === null) {
    throw new Error(`type[${row.type}] declares no name_field, so it has no keyword`);
  }
  // A `skip_root_key` registry is recognised by the presence of its name field
  // inside the root block instead: sprites are written under eight differently
  // spelled subtype keywords, so no single keyword identifies them.
  if (keyword === null && type.nameField !== null && skipRootKey === null) {
    throw new Error(
      `type[${row.type}] declares name_field=${type.nameField}, so the manifest entry ` +
        "needs the keyword its entries are written under"
    );
  }
  if (type.keyFilter !== null && keyword !== null && keyword !== type.keyFilter) {
    throw new Error(
      `type[${row.type}] declares ## type_key_filter = ${type.keyFilter} but the manifest ` +
        `claims keyword ${keyword}`
    );
  }
  return {
    registry: row.registry,
    path: path.slice("game/".length),
    extension: type.pathExtension ?? DEFAULT_EXTENSION,
    keyword,
    nameField: type.nameField,
    skipRootKey,
    pathStrict: type.pathStrict ?? false,
    trieMode: row.trie ?? "segments",
  };
}
