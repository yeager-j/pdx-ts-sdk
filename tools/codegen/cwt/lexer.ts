/**
 * Tokenizer for the CWTools rule format (`.cwt`).
 *
 * The format shares PDXScript's `key = value` / block skeleton but adds three
 * things PDXScript has no notion of: `###` doc comments and `##` option
 * comments that bind to the *following* entry, and the `==` operator.
 */

export type TokenKind = "identifier" | "op" | "lbrace" | "rbrace" | "doc" | "option" | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** Identifiers: the raw text. Operators: "=" or "==". Comments: the body after the `#` run. */
  readonly text: string;
  readonly quoted: boolean;
  readonly line: number;
}

export class CwtSyntaxError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(message: string, file: string, line: number) {
    super(`${file}:${line}: ${message}`);
    this.name = "CwtSyntaxError";
    this.file = file;
    this.line = line;
  }
}

const TERMINATORS = new Set([" ", "\t", "\r", "\n", "{", "}", "=", "#", '"']);

/**
 * `#` plain and `####` decorative comments carry no meaning and are dropped
 * here; `##` and `###` become tokens because later stages need them.
 */
function classifyComment(hashes: number): TokenKind | null {
  if (hashes === 2) {
    return "option";
  }
  if (hashes === 3) {
    return "doc";
  }
  return null;
}

export function tokenize(source: string, file: string): Token[] {
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
    if (char === " " || char === "\t" || char === "\r") {
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
      const start = index;
      while (index < text.length && text[index] === "#") {
        index += 1;
      }
      const hashes = index - start;
      const end = text.indexOf("\n", index);
      const body = text.slice(index, end === -1 ? text.length : end);
      const kind = classifyComment(hashes);
      if (kind !== null) {
        tokens.push({ kind, text: body.trim(), quoted: false, line });
      }
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '"') {
      const end = text.indexOf('"', index + 1);
      if (end === -1) {
        throw new CwtSyntaxError("Unterminated quoted string", file, line);
      }
      tokens.push({ kind: "identifier", text: text.slice(index + 1, end), quoted: true, line });
      index = end + 1;
      continue;
    }
    if (char === "=") {
      const isDouble = text[index + 1] === "=";
      tokens.push({ kind: "op", text: isDouble ? "==" : "=", quoted: false, line });
      index += isDouble ? 2 : 1;
      continue;
    }

    const start = index;
    while (index < text.length && !TERMINATORS.has(text[index]!)) {
      index += 1;
    }
    if (index === start) {
      throw new CwtSyntaxError(`Unexpected character ${JSON.stringify(char)}`, file, line);
    }
    tokens.push({ kind: "identifier", text: text.slice(start, index), quoted: false, line });
  }

  tokens.push({ kind: "eof", text: "", quoted: false, line });
  return tokens;
}
