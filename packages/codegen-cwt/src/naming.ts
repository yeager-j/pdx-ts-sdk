const RESERVED_BINDING_NAMES = new Set([
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

const PLAIN_NAME = /^[a-z][a-z0-9_]*$/;
const PROPERTY_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Returns whether a CWT rule key uses lowercase letters, digits, and underscores. */
export function isPlainName(name: string): boolean {
  return PLAIN_NAME.test(name);
}

function splitWords(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+/).filter((part) => part !== "");
}

function splitNameWords(name: string): string[] {
  return splitWords(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

function capitalizeInitial(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1);
}

/** Converts a snake_case or camelCase name to a lowercase kebab-case file stem. */
export function kebabCase(name: string): string {
  return splitNameWords(name)
    .map((part) => part.toLowerCase())
    .join("-");
}

/** Converts a snake_case or camelCase registry name to lowercase prose. */
export function spokenName(name: string): string {
  return splitNameWords(name)
    .map((part) => part.toLowerCase())
    .join(" ");
}

/** Converts a separated name to a lower-camel-case TypeScript name. */
export function camelCase(name: string): string {
  const [head = "", ...tail] = splitWords(name);
  const lowerCamelHead = head === "" ? "" : head[0]!.toLowerCase() + head.slice(1);
  return lowerCamelHead + tail.map(capitalizeInitial).join("");
}

/** Converts a separated name to a PascalCase TypeScript name. */
export function pascalCase(name: string): string {
  return splitWords(name).map(capitalizeInitial).join("");
}

/**
 * Selects the lowercase indefinite article for a generated display name.
 * This uses the first letter because callers provide registry and rule names without phonetic exceptions.
 */
export function indefiniteArticle(name: string): "a" | "an" {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

/**
 * Forms a generated collection name by appending `s` unless the name already ends in `s`.
 * It does not implement general English pluralization because callers provide CWT rule keys.
 */
export function pluralize(name: string): string {
  return name.endsWith("s") ? name : `${name}s`;
}

/** Suffixes a reserved TypeScript binding name with an underscore. Other names are unchanged. */
export function safeIdentifier(name: string): string {
  return RESERVED_BINDING_NAMES.has(name) ? `${name}_` : name;
}

/** Converts a camelCase name to the uppercase snake case used by generated constants. */
export function constantCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** Selects the sentence-initial form of {@link indefiniteArticle}. */
export function capitalizedArticle(name: string): "A" | "An" {
  return indefiniteArticle(name) === "an" ? "An" : "A";
}

/** Serializes a string as a quoted JavaScript and TypeScript literal. */
export function quoteLiteral(value: string): string {
  return JSON.stringify(value);
}

/**
 * Formats a name for an interface member or object-literal key.
 * Valid property identifiers stay bare; all other names become quoted literals.
 */
export function propertyName(name: string): string {
  return PROPERTY_IDENTIFIER.test(name) ? name : quoteLiteral(name);
}

/**
 * Formats property access against an emitted object expression.
 * Valid property identifiers use dot access; all other names use bracket access.
 */
export function propertyAccess(objectExpression: string, name: string): string {
  return PROPERTY_IDENTIFIER.test(name)
    ? `${objectExpression}.${name}`
    : `${objectExpression}[${quoteLiteral(name)}]`;
}

/**
 * Compares strings by codepoint for deterministic generated output.
 * Unlike `localeCompare`, the result does not depend on the host locale or ICU data.
 */
export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Returns whether generated source contains a complete TypeScript identifier.
 * The `identifier` argument must contain only ASCII word characters.
 */
export function referencesIdentifier(code: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier}\\b`).test(code);
}

/**
 * Renders non-empty lines as an emitted JSDoc block with optional indentation.
 * Returns an empty string when no content remains and rejects a closing JSDoc delimiter.
 */
export function docComment(lines: readonly string[], indent = ""): string {
  const contentLines = lines.filter((line) => line.trim() !== "");
  const closingDelimiterLine = contentLines.find((line) => line.includes("*/"));
  if (closingDelimiterLine !== undefined) {
    throw new Error(`Doc line closes its own comment with "*/": ${closingDelimiterLine}`);
  }
  if (contentLines.length === 0) {
    return "";
  }
  if (contentLines.length === 1) {
    return `${indent}/** ${contentLines[0]} */\n`;
  }
  return `${indent}/**\n${contentLines.map((line) => `${indent} * ${line}`).join("\n")}\n${indent} */\n`;
}
