/**
 * Enumerates the ids one registry defines in an install.
 *
 * `tools/codegen/corpus.ts` reads the same files for a different question —
 * which *fields* definitions write — and throws the ids away, walks one
 * directory flat, and only ever looks at `.txt`. Sounds live in nested
 * `.asset` files and sprites in nested `.gfx` files, so this walks recursively
 * and honours the extension the rules declare — except where the rules declare
 * `path_strict`, which is how a type says its subdirectories belong to someone
 * else.
 *
 * Parsing is non-strict, the corpus reader's stance: shipped files contain
 * repairs the parser reports and the game accepts, and a diagnostic is a number
 * for the report rather than a reason to abandon a registry. A missing
 * directory is likewise reported, not thrown — it is how a path that went stale
 * across a game version announces itself.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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
   * Id -> the stem of the file that defines it, for `file-buckets` registries
   * only. Every other registry gets `null`: provenance costs a map per id and
   * nothing but a file-bucketed trie has any use for it.
   *
   * An id defined in two files keeps the first stem in walk order, which is
   * sorted — so which bucket a redefined id lands in is deterministic rather
   * than filesystem-dependent.
   */
  readonly sourceStems: ReadonlyMap<string, string> | null;
}

/**
 * Every file under `dir` with the given extension, in a stable walk order.
 *
 * `recurse` is what the rules' `path_strict` decides: subdirectories of a
 * strict path hold *other* CWT types (`common/technology/tier`,
 * `common/technology/category`), and descending into them would attribute
 * their ids to this registry.
 */
function walk(dir: string, extension: string, recurse: boolean): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (recurse) {
        found.push(...walk(full, extension, recurse));
      }
      continue;
    }
    if (name.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The id one definition carries, under the three layouts the rules describe.
 *
 * Without a `name_field` the top-level key *is* the id. With one, the top-level
 * key is a repeated keyword and the id sits in a body field. With a
 * `skip_root_key` on top of that the definitions sit one level inside a root
 * block, and are accepted by the *presence* of the name field rather than by
 * their keyword: sprites are written under eight subtype keywords whose casing
 * varies between files (`spriteType`, `PieChartType`, `progressbartype`), and
 * matching on those would silently drop whole files.
 */
function nameFieldValue(items: readonly PdxItem[], nameField: string): string | null {
  for (const item of items) {
    if (item.kind !== "entry" || item.key !== nameField) {
      continue;
    }
    if (item.value.kind === "str") {
      return item.value.value;
    }
    if (item.value.kind === "num") {
      return String(item.value.value);
    }
  }
  return null;
}

function collect(spec: RegistrySpec, items: readonly PdxItem[], add: (id: string) => void): void {
  for (const item of items) {
    if (item.kind !== "entry" || item.value.kind !== "container") {
      continue;
    }
    if (spec.skipRootKey !== null) {
      if (item.key !== spec.skipRootKey || spec.nameField === null) {
        continue;
      }
      for (const inner of item.value.items) {
        if (inner.kind !== "entry" || inner.value.kind !== "container") {
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

/** `09_static_modifiers_deficit.txt` -> `09_static_modifiers_deficit`. */
function stemOf(file: string): string {
  const name = path.basename(file);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

export function readRegistryIds(root: string, spec: RegistrySpec): RegistryIds {
  const dir = path.join(root, spec.path);
  const files = walk(dir, spec.extension, !spec.pathStrict);
  const ids = new Set<string>();
  const sourceStems = spec.trieMode === "file-buckets" ? new Map<string, string>() : null;
  let diagnostics = 0;
  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    diagnostics += parsed.diagnostics.length;
    const stem = stemOf(file);
    collect(spec, parsed.items, (id) => {
      ids.add(id);
      if (sourceStems !== null && !sourceStems.has(id)) {
        sourceStems.set(id, stem);
      }
    });
  }
  return {
    registry: spec.registry,
    ids: [...ids].sort(compareIdentifiers),
    files: files.length,
    diagnostics,
    missing: files.length === 0 && !exists(dir),
    sourceStems,
  };
}

function exists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
