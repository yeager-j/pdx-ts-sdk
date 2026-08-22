/**
 * Enumerates the ids one registry defines in an install.
 *
 * `@pdx-ts/codegen-cwt`'s `corpus.ts` reads the same files for a different
 * question — which *fields* definitions write — and throws the ids away. Which
 * files those are is one question with one answer, so both call
 * `walkRegistryFiles`: recursive and extension-aware, except where the rules
 * declare `path_strict`, which is how a type says its subdirectories belong to
 * someone else.
 *
 * Parsing is non-strict, the corpus reader's stance: shipped files contain
 * repairs the parser reports and the game accepts, and a diagnostic is a number
 * for the report rather than a reason to abandon a registry. A missing
 * directory is likewise reported, not thrown — it is how a path that went stale
 * across a game version announces itself.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { auditedSpellings } from "@pdx-ts/codegen-cwt/corpus/casing";
import { relativeRegistryPath, walkRegistryFiles } from "@pdx-ts/codegen-cwt/corpus/registry-files";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";
import type { RegistrySpec } from "./resolve.ts";

export interface RegistryIds {
  readonly registry: string;
  /** Every id the registry defines, deduplicated and sorted. */
  readonly ids: readonly string[];
  readonly files: number;
  /** Parser repairs across the registry's files. Reported, never fatal. */
  readonly diagnostics: number;
  /** The registry's directory does not exist in this install. */
  readonly missing: boolean;
  /**
   * Id -> the path of the file that defines it, relative to the registry's own
   * directory and always `/`-separated. It is the whole relative path rather
   * than the stem because that is what the trie navigates by: `sound/` nests
   * several directories deep and every level is a category.
   *
   * An id defined in two files keeps the first path in walk order, which is
   * sorted — so which bucket a redefined id lands in is deterministic rather
   * than filesystem-dependent.
   */
  readonly sourcePaths: ReadonlyMap<string, string>;
}

/**
 * The id one definition carries, under the three layouts the rules describe.
 *
 * Without a `name_field` the top-level key *is* the id. With one, the top-level
 * key is a repeated keyword and the id sits in a body field. With a
 * `skip_root_key` on top of that the definitions sit one level inside a root
 * block, and the rules decide how those are recognised — see {@link collect}.
 */
function nameFieldValue(items: readonly PdxItem[], nameField: string): string | null {
  for (const item of items) {
    if (item.kind !== "entry" || item.key.toLowerCase() !== nameField.toLowerCase()) {
      continue;
    }
    if (item.value.kind === "str") {
      return item.value.value;
    }
    if (item.value.kind === "num") {
      return item.value.lexeme;
    }
  }
  return null;
}

/**
 * Every id the parsed items of one file define.
 *
 * The `skip_root_key` case is the one worth explaining, because the two
 * registries inside it are recognised differently and the rules say which.
 *
 * A type declaring its own non-negated `## type_key_filter` states the one key
 * every one of its definitions is written under, so a child of the root block
 * under any other key belongs to somebody else: `gfx/models/`'s `objectTypes`
 * holds `arrowType` blocks beside `type[model_mesh]`'s `pdxmesh` ones, and
 * accepting those handed 12 arrow names out as valid vanilla mesh references.
 *
 * A type declaring none is not silent by accident. `type[sprite]` leaves the
 * filter off precisely because its eight subtypes each carry their own
 * (`spriteType`, `PieChartType`, `progressbartype`, …), so no single key
 * identifies a sprite and the whole envelope is the reference universe: there,
 * the *presence* of the name field is the test, which is what keeps all 9,198
 * vanilla sprite ids rather than the 8,617 written under one keyword.
 *
 * Spelling is exact plus whatever `casing.ts` has audited for that key, never a
 * blanket lowercase — a key that differs from the filter only by case is a
 * finding, not something to absorb quietly.
 */
function collect(spec: RegistrySpec, items: readonly PdxItem[], add: (id: string) => void): void {
  for (const item of items) {
    if (item.kind !== "entry" || item.value.kind !== "container") {
      continue;
    }
    // A sibling type sharing this directory, told apart by its root key. Not
    // one of ours however the rest of the spec reads it.
    if (item.key === spec.excludedKey) {
      continue;
    }
    if (spec.skipRootKey !== null) {
      if (item.key !== spec.skipRootKey || spec.nameField === null) {
        continue;
      }
      const keys = spec.keyFilter === null ? null : auditedSpellings(spec.registry, spec.keyFilter);
      for (const inner of item.value.items) {
        if (inner.kind !== "entry" || inner.value.kind !== "container") {
          continue;
        }
        if (keys !== null && !keys.includes(inner.key)) {
          continue;
        }
        const id = nameFieldValue(inner.value.items, spec.nameField);
        if (id !== null) {
          add(id);
        }
      }
      continue;
    }
    if (spec.nameField !== null) {
      if (item.key !== spec.keyword) {
        continue;
      }
      const id = nameFieldValue(item.value.items, spec.nameField);
      if (id !== null) {
        add(id);
      }
      continue;
    }
    add(item.key);
  }
}

export function readRegistryIds(root: string, spec: RegistrySpec): RegistryIds {
  const dir = path.join(root, spec.path);
  const files = walkRegistryFiles(dir, spec.extension, !spec.pathStrict);
  const ids = new Set<string>();
  const sourcePaths = new Map<string, string>();
  let diagnostics = 0;
  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    diagnostics += parsed.diagnostics.length;
    const source = relativeRegistryPath(dir, file);
    collect(spec, parsed.items, (id) => {
      ids.add(id);
      if (!sourcePaths.has(id)) {
        sourcePaths.set(id, source);
      }
    });
  }
  return {
    registry: spec.registry,
    ids: [...ids].sort(compareIdentifiers),
    files: files.length,
    diagnostics,
    missing: files.length === 0 && !exists(dir),
    sourcePaths,
  };
}

function exists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
