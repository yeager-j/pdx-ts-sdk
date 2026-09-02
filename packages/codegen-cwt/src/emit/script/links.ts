/**
 * Classifies `links.cwt`'s scope links and emits their trigger and value forms.
 *
 * A static scope link navigates from any of its input scopes to its output
 * scope and is legal in both trigger and effect position (`owner = { ... }`).
 * Trigger and value positions become one overloaded free function per link
 * here — a condition in, a condition out; a scope value in, the navigated
 * scope value out. Effect position rides the effect emitter as well, which
 * folds the same classified links into recursive path-property clusters and
 * marks them distinctly in `EFFECT_META`.
 *
 * The scopes come from `links.cwt`, the prose summaries fall back to the
 * game's `scopes.log` dump — the same authoritative/cross-check split
 * triggers use. Every link the emitter cannot lower is skipped with a named
 * reason and reported, never dropped silently.
 */

import type { LinkClassification } from "../../lower/links.ts";
import { docComment } from "../../naming.ts";
import { scopeType } from "./type-projection.ts";

/** Generated scope-link wrapper module text and its method count. */
export interface ScopeLinkEmission {
  /** Complete generated scope-link wrapper module text. */
  readonly code: string;
  /** Number of classified links represented by overload sets. */
  readonly emitted: number;
}

/**
 * The link vocabulary as data, for the one question the wrapper functions
 * cannot answer: given a key read back out of recorded script, is it scope
 * navigation, and where does it navigate to?
 *
 * A table rather than more functions because the asker has a string, not a
 * symbol — a tool interpreting recorded entries (`@pdx-ts/sdk-testing`) needs
 * to tell `owner` (a link it has not modeled) from a scripted trigger it can
 * never model, and those want opposite responses from the reader. It lands in
 * its own generated file so `packages/sdk/src/script/triggers.ts`'s `export *`
 * keeps exporting link functions and nothing else; the SDK's narrow accessor
 * over it is the public surface, the same split `EFFECT_META`/`isEffectKey`
 * already uses.
 */
export function emitScopeLinkNavigation(navigation: ReadonlyMap<string, string>): string {
  const rows = [...navigation]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, output]) => `  ${JSON.stringify(key)}: ${JSON.stringify(output)},\n`)
    .join("");
  return (
    "/**\n" +
    " * Every static scope link the rules declare, mapped to the scope it\n" +
    " * navigates to. `any` is the rules' own answer where the output scope is\n" +
    " * runtime-polymorphic, not a widening this table invents.\n" +
    " *\n" +
    " * Value links (which produce a number rather than a scope) and `from_data`\n" +
    " * links (whose key is a prefix rather than a name) are not navigation and\n" +
    " * are absent.\n" +
    " */\n" +
    'export const SCOPE_LINK_NAVIGATION: Readonly<Record<string, ScopeName | "any" | undefined>> = {\n' +
    rows +
    "};\n"
  );
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
 * not a skip: the file is star-re-exported through
 * `packages/sdk/src/script/triggers.ts`, and two `export *` sources sharing a
 * name silently drop the symbol for consumers.
 */
export function emitScopeLinks(
  classified: Pick<LinkClassification, "links">,
  scopeIndex: ReadonlyMap<string, string>,
  takenNames: ReadonlySet<string>
): ScopeLinkEmission {
  const chunks: string[] = [];
  for (const link of classified.links) {
    if (takenNames.has(link.method)) {
      throw new Error(
        `scope link "${link.key}" would emit "${link.method}", which ` +
          "packages/sdk/src/script/triggers.ts " +
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
        `    : trigger([block(${key}, [...arg.entries])], [...arg.refs]);\n}\n`
    );
  }
  return { code: chunks.join("\n"), emitted: classified.links.length };
}
