/**
 * Reads scripted trigger and effect *bodies* out of an install.
 *
 * `packages/codegen-vanilla/src/read-scripted.ts` walks the same files for
 * `$PARAM$` names and keeps nothing else — deliberately, since the shipped
 * package carries identifiers only. The probe needs the parsed body to measure
 * what a scope analysis could learn from it; nothing here is emitted, and if
 * the verdict is to ship, what crosses the licensing boundary is a scope name,
 * never the tree this module returns.
 *
 * Override is last-wins, matching `packages/sdk/src/resolver/rules.ts` for both
 * directories: a later-loading file redefining a name replaces it whole.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@pdx-ts/pdxscript";

import type { Definition } from "./infer.ts";

function walkFiles(dir: string): string[] {
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
      found.push(...walkFiles(full));
      continue;
    }
    if (name.endsWith(".txt")) {
      found.push(full);
    }
  }
  return found;
}

export interface BodyRead {
  readonly definitions: readonly Definition[];
  readonly files: number;
  readonly diagnostics: number;
}

export function readBodies(root: string, dir: string): BodyRead {
  const files = walkFiles(path.join(root, dir));
  const byName = new Map<string, Definition>();
  let diagnostics = 0;
  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    diagnostics += parsed.diagnostics.length;
    for (const item of parsed.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      byName.set(item.key.toLowerCase(), { name: item.key, items: item.value.items });
    }
  }
  return { definitions: [...byName.values()], files: files.length, diagnostics };
}
