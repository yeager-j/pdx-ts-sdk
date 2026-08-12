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
 *
 * The parsed body, parameters, and provenance form one definition identity for
 * `infer-scopes.ts` to measure. Ambiguous duplicate identities stop the build;
 * combining one declaration's body with another declaration's parameter list
 * would describe neither. The body is in-memory only and no emitter may read
 * it: what leaves this generator is a name, a parameter list, and — since
 * SDK-13 — a scope name from `scopes.cwt`. The licensing chokepoint in
 * `emit.ts` is what actually enforces that, and it inspects every literal
 * regardless of where the emitter thinks it came from.
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
  /** The parsed body. Read by the scope inference; never emitted. */
  readonly body: readonly PdxItem[];
  /** Slash-normalized path relative to the scripted registry directory. */
  readonly source: string;
  /** Top-level declaration index within {@link source}. */
  readonly ordinal: number;
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

function recordCondition(name: string, into: Map<string, Occurrence[]>): void {
  into.set(name, [...(into.get(name) ?? []), { defaulted: false, conditional: true }]);
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
        recordCondition(item.name, into);
        walkItems(item.items, true, into);
        break;
      case "param-text":
        // The same construct without a tree. The parameter list is read off
        // the text either way — a `$NAME$` is a lexeme, not a node — so a
        // brace-crossing region costs nothing here.
        recordCondition(item.name, into);
        scan(item.text, true, into);
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

function walkFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort(compareIdentifiers);
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
    const source = path.relative(absolute, file).split(path.sep).join("/");
    const parsed = parse(readFileSync(file, "utf8"), source);
    diagnostics += parsed.diagnostics.length;
    for (const [ordinal, item] of parsed.items.entries()) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      const definition: ScriptedDefinition = {
        name: item.key,
        params: paramsOf(item.value.items),
        body: item.value.items,
        source,
        ordinal,
      };
      const identity = item.key.toLowerCase();
      const previous = byName.get(identity);
      if (previous !== undefined) {
        throw new Error(
          `${registry}: ambiguous duplicate definition ${JSON.stringify(item.key)} in ` +
            `${previous.source}#${previous.ordinal} and ${source}#${ordinal}`
        );
      }
      byName.set(identity, definition);
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
