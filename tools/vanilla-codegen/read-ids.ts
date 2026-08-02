/**
 * Enumerates the ids one registry defines in an install.
 *
 * `tools/codegen/corpus.ts` reads the same files for a different question —
 * which *fields* definitions write — and throws the ids away, walks one
 * directory flat, and only ever looks at `.txt`. Sounds live in nested
 * `.asset` files and sprites in nested `.gfx` files, so this walks recursively
 * and honours the extension the rules declare.
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
}

/** Every file under `dir` with the given extension, in a stable walk order. */
function walk(dir: string, extension: string): string[] {
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
      found.push(...walk(full, extension));
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

function collect(spec: RegistrySpec, items: readonly PdxItem[], into: Set<string>): void {
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
          into.add(id);
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
        into.add(id);
      }
      continue;
    }
    into.add(item.key);
  }
}

export function readRegistryIds(root: string, spec: RegistrySpec): RegistryIds {
  const dir = path.join(root, spec.path);
  const files = walk(dir, spec.extension);
  const ids = new Set<string>();
  let diagnostics = 0;
  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    diagnostics += parsed.diagnostics.length;
    collect(spec, parsed.items, ids);
  }
  return {
    registry: spec.registry,
    ids: [...ids].sort(compareIdentifiers),
    files: files.length,
    diagnostics,
    missing: files.length === 0 && !exists(dir),
  };
}

function exists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
