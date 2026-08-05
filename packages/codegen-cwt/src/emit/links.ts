/**
 * Classifies `links.cwt`'s scope links and emits their trigger-position form.
 *
 * A static scope link navigates from any of its input scopes to its output
 * scope and is legal in both trigger and effect position (`owner = { ... }`).
 * Trigger position becomes one free wrapper function per link here; effect
 * position rides the effect emitter, which folds the same classified links
 * into its scope-set clusters so the generated interfaces and `EFFECT_META`
 * carry them like any other wrapper.
 *
 * The scopes come from `links.cwt`, the prose summaries fall back to the
 * game's `scopes.log` dump — the same authoritative/cross-check split
 * triggers use. Every link the emitter cannot lower is skipped with a named
 * reason and reported, never dropped silently.
 */

import type { ScopeLink } from "../logs/scopes.ts";
import { camelCase, docComment, safeIdentifier } from "../naming.ts";
import { canonicalScopeSet, scopeType, type SkippedRule } from "./shape.ts";
import type { Emitter } from "./types.ts";

/** A link both emitters can lower: output canonical and singular. */
export interface ClassifiedLink {
  /** The script key, e.g. `capital_scope`. */
  readonly key: string;
  /** The generated identifier, e.g. `capitalScope`. */
  readonly method: string;
  /** Raw input tokens, resolvable through the scope index. */
  readonly inputScopes: readonly string[];
  /** Canonical output scope. */
  readonly outputScope: string;
  readonly docs: readonly string[];
}

export interface LinkClassification {
  readonly links: readonly ClassifiedLink[];
  readonly skipped: readonly SkippedRule[];
}

export function classifyLinks(
  emitter: Emitter,
  dumpLinks: ReadonlyMap<string, ScopeLink>,
  scopeIndex: ReadonlyMap<string, string>
): LinkClassification {
  const links: ClassifiedLink[] = [];
  const skipped: SkippedRule[] = [];
  for (const name of [...emitter.rules.links.keys()].sort()) {
    const link = emitter.rules.links.get(name)!;
    if (link.type === "value") {
      skipped.push({ name, reason: "value link (produces a number, not scope navigation)" });
      continue;
    }
    if (link.fromData) {
      skipped.push({ name, reason: "data-driven link (from_data)" });
      continue;
    }
    if (link.outputScope === null) {
      skipped.push({ name, reason: "declares no output_scope" });
      continue;
    }
    if (link.outputScope.toLowerCase() === "any") {
      skipped.push({
        name,
        reason: "output scope is runtime-polymorphic (any) — gated on situations, see roadmap",
      });
      continue;
    }
    const outputScope = emitter.canonicalScope(link.outputScope);
    if (outputScope === null) {
      skipped.push({ name, reason: `output names no known scope (${link.outputScope})` });
      continue;
    }
    if (canonicalScopeSet(link.inputScopes, scopeIndex) === null) {
      skipped.push({ name, reason: `unknown scope in ${link.inputScopes.join(" ")}` });
      continue;
    }
    links.push({
      key: name,
      method: safeIdentifier(camelCase(name)),
      inputScopes: link.inputScopes,
      outputScope,
      docs: [link.docs[0] ?? dumpLinks.get(name)?.summary ?? ""],
    });
  }
  return { links, skipped };
}

export interface TriggerLinkEmission {
  readonly code: string;
  readonly emitted: number;
}

/**
 * Trigger position: one wrapper function per link. The condition runs in the
 * link's OUTPUT scope and the resulting trigger is valid in its INPUT scopes —
 * the reverse pairing from a `push_scope` iterator like `any_owned_planet`.
 *
 * A link whose name collides with an existing trigger export is a hard error,
 * not a skip: the file is star-re-exported through `src/script/triggers.ts`, and two
 * `export *` sources sharing a name silently drop the symbol for consumers.
 */
export function emitTriggerLinks(
  classified: LinkClassification,
  scopeIndex: ReadonlyMap<string, string>,
  takenNames: ReadonlySet<string>
): TriggerLinkEmission {
  const chunks: string[] = [];
  for (const link of classified.links) {
    if (takenNames.has(link.method)) {
      throw new Error(
        `scope link "${link.key}" would emit "${link.method}", which src/script/triggers.ts ` +
          "already exports — rename via the overlay before generating"
      );
    }
    const validIn = scopeType(link.inputScopes, scopeIndex)!;
    chunks.push(
      docComment(link.docs) +
        `export function ${link.method}(condition: Trigger<${JSON.stringify(link.outputScope)}>): Trigger<${validIn}> {\n` +
        `  return trigger([block(${JSON.stringify(link.key)}, [...condition.entries])]);\n}\n`
    );
  }
  return { code: chunks.join("\n"), emitted: classified.links.length };
}
