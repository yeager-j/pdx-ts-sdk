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

/** A reserved word gets a trailing underscore: `if` becomes `if_`. */
export function safeIdentifier(name: string): string {
  return RESERVED.has(name) ? `${name}_` : name;
}

export function quoteLiteral(value: string): string {
  return JSON.stringify(value);
}

export function docComment(lines: readonly string[], indent = ""): string {
  const body = lines.filter((line) => line.trim() !== "");
  if (body.length === 0) {
    return "";
  }
  if (body.length === 1) {
    return `${indent}/** ${body[0]} */\n`;
  }
  return `${indent}/**\n${body.map((line) => `${indent} * ${line}`).join("\n")}\n${indent} */\n`;
}
