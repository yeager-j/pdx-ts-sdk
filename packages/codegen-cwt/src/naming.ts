/**
 * Name mangling is public API: these rules decide what modders type.
 *
 * They must be deterministic and stable, because changing one renames an
 * exported symbol for everyone.
 */

/**
 * Reserved words that cannot be a `function` declaration name in a strict-mode
 * module. `and`, `or`, and `not` are deliberately absent — they are legal
 * identifiers, and the SDK uses them for its combinators.
 */
const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
]);

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** Rejects rule keys that are not plain names, such as `<scripted_trigger>`. */
export function isPlainName(name: string): boolean {
  return IDENTIFIER.test(name);
}

/**
 * Splits on every non-alphanumeric run, not just underscores: rule names are
 * also dotted (`building.corporate`) and spaced (`Pop Group`).
 */
function words(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+/).filter((part) => part !== "");
}

/**
 * The same split, plus camel humps: `spriteType` is two words, not one.
 *
 * Registry names are mostly the rules' own snake_case, where the two splits
 * agree. A `name` rename in the content manifest is the exception — it carries
 * the game's own spelling of a definition keyword, and those are camelCase
 * (`spriteType`). Splitting them keeps the file name and the prose spelling
 * readable rather than emitting `spritetype.ts` and "a spriteType".
 */
function humpWords(name: string): string[] {
  return words(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

/**
 * A registry's generated file stem: `ascension_perk` -> `ascension-perk`,
 * `spriteType` -> `sprite-type`.
 */
export function kebabCase(name: string): string {
  return humpWords(name)
    .map((part) => part.toLowerCase())
    .join("-");
}

/**
 * A registry's name as prose, for the generated doc comments a modder reads on
 * hover: "an ascension perk", "a sprite type".
 */
export function spokenName(name: string): string {
  return humpWords(name)
    .map((part) => part.toLowerCase())
    .join(" ");
}

export function camelCase(name: string): string {
  const [head = "", ...rest] = words(name);
  const start = head === "" ? "" : head[0]!.toLowerCase() + head.slice(1);
  return start + rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

export function pascalCase(name: string): string {
  return words(name)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

/**
 * The article for a generated doc comment's display name — "a technology", "an
 * ascension perk", "an observer event".
 *
 * Generated docs are what a modder reads on hover, so "a agreement event" is a
 * visible defect in the public API. A leading-vowel test is the whole rule: the
 * names this is called with are registry and rule keys, and none of the
 * spelling-versus-sound exceptions ("a unique...", "an hour") appears among
 * them — checked against the full manifest and the event-kind table, and it
 * degrades to the merely-inelegant rather than the wrong if one ever does.
 */
export function indefiniteArticle(name: string): "a" | "an" {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

/**
 * The plural of a generated collection name — `starFlags`, `customStarNames`.
 *
 * Appending `s` unconditionally is right for every name that does not already
 * end in one, and `custom_star_names` / `custom_planet_names` are the first that
 * do: they arrived with the solar system initializer registry and spelled
 * themselves `customStarNamess`. Only the doubling is worth fixing — these are
 * snake_case rule keys, so there are no `-y`/`-ch` cases to pluralize and no
 * irregulars, and a name already ending in `s` is already the plural the caller
 * wants.
 */
export function pluralize(name: string): string {
  return name.endsWith("s") ? name : `${name}s`;
}

/** A reserved word gets a trailing underscore: `if` becomes `if_`. */
export function safeIdentifier(name: string): string {
  return RESERVED.has(name) ? `${name}_` : name;
}

export function quoteLiteral(value: string): string {
  return JSON.stringify(value);
}

/**
 * A member name (reserved words included — `interface { for: number }` is
 * legal, since a property key is never evaluated as a binding) fit to
 * interpolate bare into an interface member or object-literal key position.
 *
 * Every `camelCase`/`pascalCase` output the emitters mint from CWT names is
 * one of these today, so nothing currently exercises the quoted arm; it
 * exists for the CWT or enum name that eventually is not — `90_day`,
 * `some-dashed-key` — which would otherwise interpolate into invalid
 * TypeScript that Prettier fails on with no indication of which generated
 * name caused it.
 */
export function propertyName(name: string): string {
  return PROPERTY_IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

const PROPERTY_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Whether generated `code` names `identifier` as a whole word, not merely as a
 * substring.
 *
 * Deciding which types a generated file needs to import reads emitted source
 * back with this check. A bare `code.includes(identifier)` false-matches
 * whenever `identifier` occurs inside a longer identifier or string literal —
 * `ModifierBlock` inside `shape: "triggeredModifierBlock"`, or
 * `EconomicResourceBlock` inside `EconomicResourceBlockNoProduce` — which pulls
 * in an unused `import type`. Every candidate this is called with is a plain
 * identifier, so a literal `\b` regex is exact; no escaping is needed.
 */
export function referencesIdentifier(code: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier}\\b`).test(code);
}

export function docComment(lines: readonly string[], indent = ""): string {
  const body = lines.filter((line) => line.trim() !== "");
  // A `*/` inside the body closes the comment early, so the rest of the line
  // becomes code and the whole generated file stops parsing — which surfaces as
  // a Prettier stack trace naming neither the file nor the doc line. One glob
  // in a derived doc (`gfx/particles/**/*.asset`) is all it takes.
  const closed = body.find((line) => line.includes("*/"));
  if (closed !== undefined) {
    throw new Error(`Doc line closes its own comment with "*/": ${closed}`);
  }
  if (body.length === 0) {
    return "";
  }
  if (body.length === 1) {
    return `${indent}/** ${body[0]} */\n`;
  }
  return `${indent}/**\n${body.map((line) => `${indent} * ${line}`).join("\n")}\n${indent} */\n`;
}
