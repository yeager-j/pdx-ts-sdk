/**
 * Tokenizer for PDXScript. See GRAMMAR.md for the language; this file owns
 * trivia (whitespace, `\r`, `\v`, `\f`, semicolons, `#` comments), quoted
 * strings (raw content, `\` skips the next character when scanning for the
 * closing quote), `@[ ... ]` inline-math tokens, and the operator set.
 *
 * `classifyUnquoted` also lives here because the serializer needs the same
 * answer the lexer would give: a string may render bare only if re-lexing it
 * yields one identifier token that classifies back to `str`.
 */

import type { PdxScalar } from "./ast.ts";

export type TokenKind =
  "identifier" | "op" | "lbrace" | "rbrace" | "math" | "param-open" | "rbracket" | "eof";

export interface Token {
  readonly kind: TokenKind;
  /**
   * Identifiers: the raw text. Operators: the operator. Math: the `@[ ... ]`
   * source verbatim. Param-open: the text between `[[` and `]`, negation
   * bang included.
   */
  readonly text: string;
  readonly quoted: boolean;
  readonly line: number;
}

export class PdxSyntaxError extends Error {
  readonly fileName: string;
  readonly line: number;

  constructor(message: string, fileName: string, line: number) {
    super(`${fileName}:${line}: ${message}`);
    this.name = "PdxSyntaxError";
    this.fileName = fileName;
    this.line = line;
  }
}

const TRIVIA = new Set([" ", "\t", "\r", "\v", "\f", ";"]);
const TERMINATORS = new Set([
  " ",
  "\t",
  "\r",
  "\n",
  "\v",
  "\f",
  ";",
  "{",
  "}",
  "[",
  "]",
  "=",
  "<",
  ">",
  "!",
  "#",
  '"',
]);

/** True when `text` would lex back as a single unquoted identifier token. */
export function isBareToken(text: string): boolean {
  if (text.length === 0) {
    return false;
  }
  for (const char of text) {
    if (TERMINATORS.has(char)) {
      return false;
    }
  }
  return true;
}

const NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

/** How an unquoted token reads as a value. Shared by the parser and the serializer. */
export function classifyUnquoted(text: string): PdxScalar {
  if (text === "yes" || text === "no") {
    return { kind: "bool", value: text === "yes" };
  }
  if (NUMBER.test(text)) {
    const value = Number(text);
    // Vanilla writes `-0`; String(-0) is "0", so normalize at parse to keep
    // the round trip a fixpoint. Negative zero is semantically zero here.
    return { kind: "num", value: value === 0 ? 0 : value };
  }
  if (text.startsWith("@")) {
    return { kind: "var", name: text };
  }
  return { kind: "str", value: text, quoted: false };
}

function operatorAt(text: string, index: number): string | null {
  const char = text[index];
  if (char === "=") {
    return "=";
  }
  if (char === ">" || char === "<") {
    return text[index + 1] === "=" ? `${char}=` : char;
  }
  if (char === "!" && text[index + 1] === "=") {
    return "!=";
  }
  return null;
}

export function tokenize(source: string, fileName: string): Token[] {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;

  while (index < text.length) {
    const char = text[index]!;

    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (TRIVIA.has(char)) {
      index += 1;
      continue;
    }
    if (char === "{" || char === "}") {
      tokens.push({
        kind: char === "{" ? "lbrace" : "rbrace",
        text: char,
        quoted: false,
        line,
      });
      index += 1;
      continue;
    }
    if (char === "#") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '"') {
      const openLine = line;
      let cursor = index + 1;
      while (cursor < text.length && text[cursor] !== '"') {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === "\n") {
          line += 1;
        }
        cursor += 1;
      }
      if (cursor >= text.length) {
        throw new PdxSyntaxError("Unterminated quoted string", fileName, openLine);
      }
      tokens.push({
        kind: "identifier",
        text: text.slice(index + 1, cursor),
        quoted: true,
        line: openLine,
      });
      index = cursor + 1;
      continue;
    }
    // Inline math: `@[ ... ]`, or `@\[ ... ]` — the escaped form defers
    // evaluation until after $PARAM$ substitution in scripted effects.
    if (
      char === "@" &&
      (text[index + 1] === "[" || (text[index + 1] === "\\" && text[index + 2] === "["))
    ) {
      const end = text.indexOf("]", index);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated @[ inline math", fileName, line);
      }
      tokens.push({ kind: "math", text: text.slice(index, end + 1), quoted: false, line });
      index = end + 1;
      continue;
    }
    if (char === "[" && text[index + 1] === "[") {
      const end = text.indexOf("]", index);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated [[ parameter block", fileName, line);
      }
      tokens.push({ kind: "param-open", text: text.slice(index + 2, end), quoted: false, line });
      index = end + 1;
      continue;
    }
    if (char === "]") {
      tokens.push({ kind: "rbracket", text: "]", quoted: false, line });
      index += 1;
      continue;
    }
    if (char === "?" && text[index + 1] === "=") {
      throw new PdxSyntaxError("Unsupported operator '?='", fileName, line);
    }
    const operator = operatorAt(text, index);
    if (operator !== null) {
      tokens.push({ kind: "op", text: operator, quoted: false, line });
      index += operator.length;
      continue;
    }

    const start = index;
    while (index < text.length && !TERMINATORS.has(text[index]!)) {
      if (text[index] === "?" && text[index + 1] === "=") {
        throw new PdxSyntaxError("Unsupported operator '?='", fileName, line);
      }
      index += 1;
    }
    if (index === start) {
      throw new PdxSyntaxError(`Unexpected character ${JSON.stringify(char)}`, fileName, line);
    }
    tokens.push({ kind: "identifier", text: text.slice(start, index), quoted: false, line });
  }

  tokens.push({ kind: "eof", text: "", quoted: false, line });
  return tokens;
}
