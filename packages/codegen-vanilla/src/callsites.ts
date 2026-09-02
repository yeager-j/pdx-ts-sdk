/**
 * The inferred scopes, measured against where vanilla actually calls each
 * definition.
 *
 * The rest of the generator's evidence proves the inference agrees with the CWT
 * rules. Nothing there can prove the rules agree with the game. This can, in
 * the one direction that matters: an event declares its own scope in its key
 * (`country_event = { ... }` runs in country scope, from the same canonical CWT
 * event-kind facts the current build uses), so anything called at the top of
 * that event's condition and effect blocks must admit country. A call site
 * where the inference disagrees is a **false narrowing** — a binding that would
 * forbid at compile time something the game ships.
 *
 * Only calls whose enclosing scope is certain are counted. `option` bodies and
 * a top-level `if`'s `limit` are still the event's scope; anything inside a
 * link, an iterator, or a scope-changing effect is not, and is skipped rather
 * than guessed at. Attributing the event's scope to a call that has moved would
 * manufacture failures, which is the same error in the opposite direction.
 *
 * Mutation-tested: making a link's body constrain its caller — the likeliest
 * error in the analysis — produces 328 contradictions here, so this gate has
 * demonstrated power and not merely coverage.
 */

import { readFileSync } from "node:fs";
import type { EventKindSpec } from "@pdx-ts/codegen-cwt/lower/event-kinds";
import type { RuleScopes } from "@pdx-ts/codegen-cwt/scope-facts";
import { parse, type PdxItem } from "@pdx-ts/pdxscript";

import { compareIdentifiers } from "./emit.ts";
import type { ScriptedKind } from "./infer-scopes.ts";
import type { VanillaEventSource } from "./read-events.ts";

/** Event body fields whose contents are conditions in the event's own scope. */
const CONDITION_FIELDS = new Set(["trigger", "is_triggered_only_check"]);
/** Event body fields whose contents are effects in the event's own scope. */
const EFFECT_FIELDS = new Set(["immediate", "after", "abort_effect"]);
/**
 * Effect wrappers that do not change scope, so their contents stay countable:
 * the branch keyword itself, plus its condition block.
 */
const TRANSPARENT_EFFECTS = new Set(["if", "else_if", "else", "hidden_effect"]);

export interface ScopeContradiction {
  readonly name: string;
  readonly kind: ScriptedKind;
  /** The scope the call site runs in, from the event's own kind. */
  readonly scope: string;
  readonly inferred: readonly string[];
  readonly file: string;
}

export interface CallSiteReport {
  readonly events: number;
  /** Calls to a scripted definition from an event body of known scope. */
  readonly checked: number;
  /** Distinct scripted definitions the check reached. */
  readonly covered: number;
  readonly contradictions: readonly ScopeContradiction[];
}

export type InferredScopes = Readonly<Record<ScriptedKind, ReadonlyMap<string, RuleScopes>>>;

export function checkCallSites(
  eventFiles: readonly VanillaEventSource[],
  inferred: InferredScopes,
  eventKinds: readonly EventKindSpec[]
): CallSiteReport {
  const scopeByEventKey = new Map(eventKinds.map((kind) => [kind.key, kind.scope]));
  const contradictions: ScopeContradiction[] = [];
  const covered = new Set<string>();
  let events = 0;
  let checked = 0;

  const record = (name: string, kind: ScriptedKind, scope: string, file: string): void => {
    const scopes = inferred[kind].get(name.toLowerCase());
    if (scopes === undefined) {
      return;
    }
    checked += 1;
    covered.add(`${kind}:${name.toLowerCase()}`);
    if (scopes !== "universal" && !scopes.includes(scope)) {
      contradictions.push({ name, kind, scope, inferred: scopes, file });
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
      if (TRANSPARENT_EFFECTS.has(item.key.toLowerCase())) {
        if (item.value.kind !== "container") {
          continue;
        }
        for (const child of item.value.items) {
          if (
            child.kind === "entry" &&
            child.value.kind === "container" &&
            child.key.toLowerCase() === "limit"
          ) {
            visitConditions(child.value.items, scope, file);
          }
        }
        visitEffects(item.value.items, scope, file);
        continue;
      }
      record(item.key, "effect", scope, file);
    }
  };

  for (const file of eventFiles) {
    const parsed = parse(readFileSync(file.path, "utf8"), file.source);
    for (const item of parsed.items) {
      if (item.kind !== "entry" || item.value.kind !== "container") {
        continue;
      }
      const scope = scopeByEventKey.get(item.key);
      if (scope === undefined || scope === null) {
        continue;
      }
      events += 1;
      for (const field of item.value.items) {
        if (field.kind !== "entry" || field.value.kind !== "container") {
          continue;
        }
        const key = field.key.toLowerCase();
        if (CONDITION_FIELDS.has(key)) {
          visitConditions(field.value.items, scope, file.source);
        } else if (EFFECT_FIELDS.has(key)) {
          visitEffects(field.value.items, scope, file.source);
        } else if (key === "option") {
          for (const part of field.value.items) {
            if (part.kind !== "entry" || part.value.kind !== "container") {
              continue;
            }
            const optionKey = part.key.toLowerCase();
            if (optionKey === "trigger" || optionKey === "allow") {
              visitConditions(part.value.items, scope, file.source);
            }
          }
          visitEffects(field.value.items, scope, file.source);
        }
      }
    }
  }

  contradictions.sort(
    (left, right) =>
      compareIdentifiers(left.file, right.file) ||
      compareIdentifiers(left.name, right.name) ||
      compareIdentifiers(left.kind, right.kind) ||
      compareIdentifiers(left.scope, right.scope)
  );
  return { events, checked, covered: covered.size, contradictions };
}
