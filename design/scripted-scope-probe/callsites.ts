/**
 * The falsification test: measure the inferred scopes against where vanilla
 * actually calls each scripted trigger and effect.
 *
 * The golden is a control — it proves the walk agrees with a hand-application
 * of its own rules. It cannot prove those rules match the game. This can, in
 * the one direction that matters: an event declares its own scope in its key
 * (`country_event = { ... }` runs in country scope, from the generated
 * `EVENT_KINDS`), so anything called at the top level of that event's condition
 * and effect blocks must admit country. A call site where it does not is a
 * **false narrowing** — the analysis forbidding something the game ships.
 *
 * Only calls whose enclosing scope is certain are counted. `option` bodies and
 * a top-level `if`'s `limit` are still the event's scope; anything inside a
 * link, an iterator, or a scope-changing effect is not, and is skipped rather
 * than guessed at. Attributing the event's scope to a call that has moved would
 * manufacture failures, which is the same error in the opposite direction.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";

import { EVENT_KINDS, type EventKindKey } from "../../packages/sdk/src/generated/events.ts";
import type { RuleScopes } from "./scope-tables.ts";

/** Event body fields whose contents are conditions in the event's own scope. */
const CONDITION_FIELDS = new Set(["trigger", "is_triggered_only_check"]);
/** Event body fields whose contents are effects in the event's own scope. */
const EFFECT_FIELDS = new Set(["immediate", "after", "abort_effect"]);
/**
 * Effect wrappers that do not change scope, so their contents stay countable:
 * the branch keyword itself, plus its condition block.
 */
const TRANSPARENT_EFFECTS = new Set(["if", "else_if", "else", "hidden_effect"]);

export interface Contradiction {
  readonly name: string;
  readonly registry: "trigger" | "effect";
  readonly scope: string;
  readonly inferred: readonly string[];
  readonly file: string;
}

export interface CallSiteReport {
  readonly files: number;
  readonly events: number;
  /** Calls to a scripted definition from an event body of known scope. */
  readonly checked: number;
  /** Distinct scripted definitions the check reached. */
  readonly covered: number;
  readonly contradictions: readonly Contradiction[];
}

export interface Inference {
  readonly trigger: ReadonlyMap<string, RuleScopes>;
  readonly effect: ReadonlyMap<string, RuleScopes>;
}

function eventFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return names
    .map((name) => path.join(dir, name))
    .filter((full) => !statSync(full).isDirectory() && full.endsWith(".txt"));
}

function eventScope(key: string): string | null {
  const kind = Object.hasOwn(EVENT_KINDS, key) ? EVENT_KINDS[key as EventKindKey] : undefined;
  return kind === undefined ? null : kind.scope;
}

export function checkCallSites(root: string, inferred: Inference): CallSiteReport {
  const files = eventFiles(path.join(root, "events"));
  const contradictions: Contradiction[] = [];
  const covered = new Set<string>();
  let events = 0;
  let checked = 0;

  const record = (
    name: string,
    registry: "trigger" | "effect",
    scope: string,
    file: string
  ): void => {
    const scopes = inferred[registry].get(name.toLowerCase());
    if (scopes === undefined) {
      return;
    }
    checked += 1;
    covered.add(`${registry}:${name.toLowerCase()}`);
    if (scopes !== "universal" && !scopes.includes(scope)) {
      contradictions.push({ name, registry, scope, inferred: scopes, file });
    }
  };

  const visitConditions = (items: readonly PdxItem[], scope: string, file: string): void => {
    for (const item of items) {
      if (item.kind === "entry") {
        record(item.key, "trigger", scope, file);
      }
    }
  };

  const visitEffects = (items: readonly PdxItem[], scope: string, file: string): void => {
    for (const item of items) {
      if (item.kind !== "entry") {
        continue;
      }
      const key = item.key.toLowerCase();
      if (TRANSPARENT_EFFECTS.has(key)) {
        if (item.value.kind !== "container") {
          continue;
        }
        for (const child of item.value.items) {
          if (child.kind !== "entry" || child.value.kind !== "container") {
            continue;
          }
          if (child.key.toLowerCase() === "limit") {
            visitConditions(child.value.items, scope, file);
          }
        }
        visitEffects(item.value.items, scope, file);
        continue;
      }
      record(item.key, "effect", scope, file);
    }
  };

  for (const file of files) {
    const parsed = parse(readFileSync(file, "utf8"), path.basename(file));
    const name = path.basename(file);
    for (const item of parsed.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      const scope = eventScope(item.key);
      if (scope === null) {
        continue;
      }
      events += 1;
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.value.kind !== "container") {
          continue;
        }
        const key = field.key.toLowerCase();
        if (CONDITION_FIELDS.has(key)) {
          visitConditions(field.value.items, scope, name);
        } else if (EFFECT_FIELDS.has(key)) {
          visitEffects(field.value.items, scope, name);
        } else if (key === "option") {
          for (const part of field.value.items) {
            if (part.kind !== "entry" || part.value.kind !== "container") {
              continue;
            }
            const optionKey = part.key.toLowerCase();
            if (optionKey === "trigger" || optionKey === "allow") {
              visitConditions(part.value.items, scope, name);
            }
          }
          visitEffects(field.value.items, scope, name);
        }
      }
    }
  }

  return { files: files.length, events, checked, covered: covered.size, contradictions };
}
