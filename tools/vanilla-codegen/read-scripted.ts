/**
 * Scripted trigger and effect names, with their `$PARAM$` lists.
 *
 * This is the licensing boundary at its narrowest: a scripted trigger's body is
 * game script and stays in the game. What leaves is the definition's name and
 * the names of the parameters it substitutes — the interface SDK-13 needs to
 * check a call offline, and nothing more. Default values are body content and
 * are never captured, only the fact that one exists.
 *
 * Optionality has two sources, both of them structural. `$AGE|10$` supplies a
 * default, so the caller may omit it. A parameter used only inside a
 * `[[FLAG] ... ]` block is only substituted when the block is active, so it is
 * optional too — and `FLAG` itself, the block's own condition, is the archetype
 * of an optional parameter.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";

export interface ScriptedParam {
  readonly name: string;
  readonly optional: boolean;
}

export interface ScriptedDefinition {
  readonly name: string;
  readonly params: readonly ScriptedParam[];
}

export interface ScriptedRegistry {
  readonly registry: string;
  readonly definitions: readonly ScriptedDefinition[];
  readonly files: number;
  readonly diagnostics: number;
  readonly missing: boolean;
}

/**
 * `$NAME$` and `$NAME|default$`. The default itself is matched only so the
 * token ends where it should — the capture is the name alone.
 */
const PARAM_TOKEN = /\$([A-Za-z0-9_]+)(?:\|[^$]*)?\$/g;

interface Occurrence {
  /** The occurrence supplied a default, so the parameter may be omitted. */
  readonly defaulted: boolean;
  /** The occurrence sits inside a `[[NAME] ... ]` block. */
  readonly conditional: boolean;
}

function scan(text: string, conditional: boolean, into: Map<string, Occurrence[]>): void {
  for (const match of text.matchAll(PARAM_TOKEN)) {
    const name = match[1]!;
    into.set(name, [...(into.get(name) ?? []), { defaulted: match[0].includes("|"), conditional }]);
  }
}

function walkItems(
  items: readonly PdxItem[],
  conditional: boolean,
  into: Map<string, Occurrence[]>
): void {
  for (const item of items) {
    switch (item.kind) {
      case "entry":
        scan(item.key, conditional, into);
        walkItems([item.value], conditional, into);
        break;
      case "container":
        if (item.header !== undefined) {
          scan(item.header, conditional, into);
        }
        walkItems(item.items, conditional, into);
        break;
      case "param":
        // The block's own condition is a parameter, and one whose whole purpose
        // is to be omissible.
        into.set(item.name, [
          ...(into.get(item.name) ?? []),
          { defaulted: false, conditional: true },
        ]);
        walkItems(item.items, true, into);
        break;
      case "str":
        scan(item.value, conditional, into);
        break;
      case "var":
        scan(item.name, conditional, into);
        break;
      case "math":
        scan(item.source, conditional, into);
        break;
      default:
        break;
    }
  }
}

function paramsOf(items: readonly PdxItem[]): ScriptedParam[] {
  const occurrences = new Map<string, Occurrence[]>();
  walkItems(items, false, occurrences);
  return [...occurrences]
    .map(([name, seen]) => ({
      name,
      optional: seen.some((one) => one.defaulted) || seen.every((one) => one.conditional),
    }))
    .sort((left, right) => compareIdentifiers(left.name, right.name));
}

/**
 * Merges two declarations of the same name.
 *
 * Vanilla overrides a scripted trigger by redefining it in a later-loading
 * file, so the same name can appear twice with different bodies. Parameters are
 * unioned and required wins: a caller who satisfies the union satisfies either
 * definition, which is the only shape that stays true whichever one the game
 * ends up loading.
 */
function merge(left: ScriptedDefinition, right: ScriptedDefinition): ScriptedDefinition {
  const optional = new Map<string, boolean>();
  for (const param of [...left.params, ...right.params]) {
    optional.set(param.name, (optional.get(param.name) ?? true) && param.optional);
  }
  return {
    name: left.name,
    params: [...optional]
      .map(([name, isOptional]) => ({ name, optional: isOptional }))
      .sort((one, other) => compareIdentifiers(one.name, other.name)),
  };
}

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

export function readScriptedDefinitions(
  root: string,
  registry: string,
  dir: string
): ScriptedRegistry {
  const absolute = path.join(root, dir);
  const files = walkFiles(absolute);
  const byName = new Map<string, ScriptedDefinition>();
  let diagnostics = 0;
  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    diagnostics += parsed.diagnostics.length;
    for (const item of parsed.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      const definition = { name: item.key, params: paramsOf(item.value.items) };
      const previous = byName.get(item.key);
      byName.set(item.key, previous === undefined ? definition : merge(previous, definition));
    }
  }
  let missing = false;
  try {
    missing = !statSync(absolute).isDirectory();
  } catch {
    missing = true;
  }
  return {
    registry,
    definitions: [...byName.values()].sort((left, right) =>
      compareIdentifiers(left.name, right.name)
    ),
    files: files.length,
    diagnostics,
    missing,
  };
}
