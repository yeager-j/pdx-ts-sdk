/** Emitters for the small supporting modules: scopes, enums, and references. */

import { camelCase, docComment, pascalCase, pluralize } from "../naming.ts";
import { EXTRA_SCOPES } from "../overlay.ts";
import type { Emitter } from "./types.ts";

export function canonicalScopes(scopes: ReadonlyMap<string, readonly string[]>): string[] {
  const names = [...scopes.keys()].map((name) => name.toLowerCase().replaceAll(" ", "_"));
  return [...new Set([...names, ...EXTRA_SCOPES])].sort();
}

export function emitScopes(names: readonly string[]): string {
  const members = names.map((name) => `  | ${JSON.stringify(name)}`).join("\n");
  return (
    docComment([
      "Every scope the game evaluates script in.",
      "",
      "Canonical names come from `scopes.cwt`; the aliases the game also answers to",
      "(`galactic_object` for `system`, say) are normalised away at generation time.",
    ]) + `export type ScopeName =\n${members};\n`
  );
}

export function emitEnums(emitter: Emitter): string {
  const chunks: string[] = [];
  for (const name of [...emitter.usedEnums].sort()) {
    const values = emitter.rules.enums.get(name) ?? [];
    if (values.length === 0) {
      // `enum[component_tag]` is declared with no members: the values come from
      // the game's own content files, not the rules. A union of nothing is
      // `never`, which would make every field of this type unsatisfiable, and
      // an empty alias body is not even parseable — so it widens to `string`,
      // reported by emitEnumsReport so the looseness stays visible.
      chunks.push(
        docComment([
          `\`enum[${name}]\`.`,
          "",
          "The rules declare this enum with no values — its members come from " +
            "content files rather than from `enums.cwt` — so it cannot narrow " +
            "beyond `string`.",
        ]) + `export type ${pascalCase(name)} = string;\n`
      );
      continue;
    }
    const members = values.map((value) => `  | ${JSON.stringify(value)}`).join("\n");
    chunks.push(
      docComment([`\`enum[${name}]\`.`]) + `export type ${pascalCase(name)} =\n${members};\n`
    );
  }
  return chunks.join("\n");
}

/** Enums referenced by generated types that the rules declare with no values. */
export function valuelessEnums(emitter: Emitter): readonly string[] {
  return [...emitter.usedEnums]
    .filter((name) => (emitter.rules.enums.get(name) ?? []).length === 0)
    .sort();
}

/**
 * Value sets are names the script invents rather than names a content type
 * defines: `set_country_flag = heard_the_hum` brings `heard_the_hum` into
 * existence, and `has_country_flag` can then read it.
 *
 * The rules record which set each rule draws from — `value[country_flag]` versus
 * `value[planet_flag]` — so each set gets its own branded type. The brand is
 * optional, so a raw string still assigns and vanilla flags keep working, but a
 * name declared as a planet flag will not typecheck as a country flag.
 */
export function emitValueSets(emitter: Emitter): string {
  const declarations = [...emitter.usedValueSets]
    .sort()
    .map((name) => {
      const type = emitter.valueSetTypeName(name);
      return (
        docComment([`A name belonging to \`value[${name}]\`.`]) +
        `export type ${type} = ValueSetMember<${JSON.stringify(name)}>;\n\n` +
        docComment([
          `Declares ${name} names, so they autocomplete and cannot be`,
          "confused with a name from another set.",
        ]) +
        `export const ${pluralize(camelCase(name))} = declare<${JSON.stringify(name)}>();\n`
      );
    })
    .join("\n");

  return (
    "declare const valueSetBrand: unique symbol;\n\n" +
    docComment([
      "A name belonging to one of the game's value sets.",
      "",
      "The brand is optional so a raw string still assigns — vanilla and other",
      "mods' names have to keep working — but two different sets are not",
      "interchangeable once a name has been declared as belonging to one.",
    ]) +
    "export type ValueSetMember<T extends string> = string & {\n" +
    "  readonly [valueSetBrand]?: T;\n" +
    "};\n\n" +
    docComment([
      "Builds a lookup of names belonging to a single value set.",
      "",
      "The keys are the names themselves, so `flags.heard_the_hum` autocompletes",
      "and a typo is a compile error rather than a condition that never fires.",
    ]) +
    "function declare<T extends string>() {\n" +
    "  return <const Names extends readonly string[]>(\n" +
    "    ...names: Names\n" +
    "  ): { readonly [K in Names[number]]: ValueSetMember<T> } => {\n" +
    "    const entries = names.map((name) => [name, name] as const);\n" +
    "    return Object.fromEntries(entries) as {\n" +
    "      readonly [K in Names[number]]: ValueSetMember<T>;\n" +
    "    };\n" +
    "  };\n" +
    "}\n\n" +
    declarations
  );
}

/**
 * The brand an alias for `<name>` accepts.
 *
 * A qualified reference names one subtype and takes exactly it. An unqualified
 * one is the whole type, subtypes included — the rules write both `<event>`
 * (`set_next_astral_rift_event`'s id) and `<event.fleet>` (an archaeology
 * stage's), and a fleet event satisfies the first as surely as the second.
 * The relation only runs that way: a `<event.fleet>` field still refuses a
 * value branded with the bare type, which proves nothing about its subtype.
 */
function refBrandType(name: string): string {
  return name.includes(".")
    ? JSON.stringify(name)
    : `${JSON.stringify(name)} | \`${name}.\${string}\``;
}

export function emitRefs(emitter: Emitter): string {
  const aliases = [...emitter.usedRefs]
    .sort()
    .map(
      (name) =>
        docComment([`A reference to a \`<${name}>\`.`]) +
        `export type ${pascalCase(name)}Ref = TypedRef<${refBrandType(name)}>;\n`
    )
    .join("\n");

  return (
    "declare const refBrand: unique symbol;\n\n" +
    docComment([
      "A reference to a key defined by some content type.",
      "",
      "The rules say a field holds a `<technology>`, but which technologies exist is",
      "decided by the game install, not by the rules — so the brand is optional and a",
      "raw id string still assigns. When the parser slice lands it can narrow these to",
      "real unions without breaking a single caller.",
    ]) +
    "export interface TypedRef<T extends string> {\n" +
    "  readonly id: string;\n" +
    "  readonly [refBrand]?: T;\n" +
    "}\n\n" +
    docComment([
      "Resolves an authored reference to the bare word the game expects, passing",
      "plain values through.",
      "",
      "Some rules are overloaded between a reference and a literal — `has_building`",
      "accepts both `<building>` and a bool — so this has to handle either. A scope",
      "value (`ctx.self`, an event target) is a reference too, and rules overload",
      "against those as freely: `is_planet_class` takes a `<planet_class>` or any",
      "scope the game coerces to a planet. It lowers to its path rather than an id,",
      "which is the only reason the two are told apart here at all.",
    ]) +
    "export function refId<T extends string | number | boolean>(\n" +
    "  value: TypedRef<string> | { readonly path: string } | T\n" +
    "): string | T {\n" +
    '  if (typeof value === "object") {\n' +
    '    return "path" in value ? value.path : value.id;\n' +
    "  }\n" +
    "  return value;\n" +
    "}\n\n" +
    aliases
  );
}
