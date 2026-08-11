/**
 * Classifies `links.cwt`'s scope links and emits their trigger and value forms.
 *
 * A static scope link navigates from any of its input scopes to its output
 * scope and is legal in both trigger and effect position (`owner = { ... }`).
 * Both positions become one overloaded free function per link here — a
 * condition in, a condition out; a scope value in, the navigated scope value
 * out. Effect position rides the effect emitter as well, which folds the same
 * classified links into its scope-set clusters so the generated interfaces and
 * `EFFECT_META` carry them like any other wrapper.
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

export interface ScopeLinkEmission {
  readonly code: string;
  readonly emitted: number;
}

/**
 * One overloaded wrapper function per link, covering both positions the link
 * is written in.
 *
 * The two forms invert each other, which is why they can share a symbol
 * without ambiguity. In trigger position the condition runs in the link's
 * OUTPUT scope and the resulting trigger is valid in its INPUT scopes — the
 * reverse pairing from a `push_scope` iterator like `any_owned_planet`. In
 * value position the author navigates FROM an input scope TO the output one,
 * so the input set constrains the parameter and the output scope is what comes
 * back.
 *
 * The {@link ScopeRef} overload precedes the {@link ScopeValue} one so an
 * absolute base resolves to the ref-returning signature: navigation preserves
 * absoluteness, and `owner(ctx.from)` has to stay openable.
 *
 * A link whose name collides with an existing trigger export is a hard error,
 * not a skip: the file is star-re-exported through `src/script/triggers.ts`, and two
 * `export *` sources sharing a name silently drop the symbol for consumers.
 */
export function emitScopeLinks(
  classified: LinkClassification,
  scopeIndex: ReadonlyMap<string, string>,
  takenNames: ReadonlySet<string>
): ScopeLinkEmission {
  const chunks: string[] = [];
  for (const link of classified.links) {
    if (takenNames.has(link.method)) {
      throw new Error(
        `scope link "${link.key}" would emit "${link.method}", which src/script/triggers.ts ` +
          "already exports — rename via the overlay before generating"
      );
    }
    const validIn = scopeType(link.inputScopes, scopeIndex)!;
    const out = JSON.stringify(link.outputScope);
    const key = JSON.stringify(link.key);
    chunks.push(
      docComment(link.docs) +
        `export function ${link.method}(condition: Trigger<${out}>): Trigger<${validIn}>;\n` +
        docComment([
          `The same link as a value, from an absolute base: \`from.${link.key}\`.`,
          "Absolute in, absolute out — the result opens as a block too.",
        ]) +
        `export function ${link.method}(base: ScopeRef<${validIn}>): ScopeRef<${out}>;\n` +
        docComment([
          `The same link from a relative base: \`ctx.self\` writes a bare \`${link.key}\`.`,
          "Relative in, relative out — a value, never a block.",
        ]) +
        `export function ${link.method}(base: ScopeValue<${validIn}>): ScopeValue<${out}>;\n` +
        `export function ${link.method}(arg: Trigger<${out}> | ScopeValue): ` +
        `Trigger<${validIn}> | ScopeValue<${out}> {\n` +
        `  return "path" in arg\n` +
        `    ? navigateScope<${out}>(arg, ${key})\n` +
        `    : trigger([block(${key}, [...arg.entries])]);\n}\n`
    );
  }
  return { code: chunks.join("\n"), emitted: classified.links.length };
}
