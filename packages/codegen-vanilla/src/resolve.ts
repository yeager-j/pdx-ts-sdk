/**
 * Turns manifest rows into the directory layout each registry actually has in
 * the install.
 *
 * Nothing about where a registry's files live is written down here: `path`,
 * `path_extension`, `name_field`, and `skip_root_key` all come from the CWT
 * `type[...]` declaration. What the manifest states — the keyword a
 * `name_field` registry is written under — is cross-checked against any
 * `## type_key_filter` the rules declare, the same stance `@pdx-ts/codegen-cwt`
 * takes: a keyword the rules contradict would emit a top-level key the game
 * quietly ignores.
 */

import { loadContentTypesFrom, loadRules, type ContentType } from "@pdx-ts/codegen-cwt/cwt/rules";

import type { VanillaIdRow } from "./manifest.ts";
import type { BucketLayout } from "./trie.ts";

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
   * A top-level key that is *not* one of this registry's definitions, from a
   * negated `## type_key_filter <> key`.
   *
   * Two CWT types can share a directory and be told apart by their root key.
   * `common/solar_system_initializers` holds both `solar_system_initializer`
   * and `solar_system_initializer_random_list`, the latter written under
   * `random_list`. Without this an id-keyed registry reads every top-level key
   * as one of its own and would emit `random_list` as an initializer id.
   */
  readonly excludedKey: string | null;
  /**
   * `path_strict`: read `path` itself and no subdirectory of it. Only
   * `technology` needs it among the registries here, and it needs it badly —
   * `common/technology/tier` and `common/technology/category` hold two other
   * CWT types, whose ids a recursive walk would emit as technologies.
   */
  readonly pathStrict: boolean;
  /** How much of a file's path names its bucket, if the registry gets a trie. */
  readonly bucket: BucketLayout;
  /** An explicitly oversized public registry gets a trie regardless of current count. */
  readonly oversized: boolean;
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
  // A negated filter says which key the entries are *not* written under, so it
  // constrains nothing about the keyword and cannot contradict it.
  if (
    type.keyFilter !== null &&
    !type.keyFilter.negated &&
    keyword !== null &&
    keyword !== type.keyFilter.key
  ) {
    throw new Error(
      `type[${row.type}] declares ## type_key_filter = ${type.keyFilter.key} but the manifest ` +
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
    excludedKey: type.keyFilter?.negated === true ? type.keyFilter.key : null,
    pathStrict: type.pathStrict ?? false,
    bucket: row.bucket ?? "stripped-file",
    oversized: row.oversized === true,
  };
}
