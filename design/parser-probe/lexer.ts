/**
 * Tokenizer for PDXScript — the probe's, not yet the SDK's.
 *
 * This is the sibling of packages/codegen/src/cwt/lexer.ts, for the game's own
 * format: no doc or option comments (every `#` runs to end of line and is
 * dropped), the full comparison-operator set, and two constructs `.cwt` has
 * no notion of — `@variable` tokens and `@[ ... ]` inline math, the latter
 * captured verbatim as a single token with its semantics deferred.
 *
 * Deferred with named reasons: `hsv {}` / `rgb {}` color headers (never in
 * technology or scripted-variable files), `?=` (not a Stellaris operator),
 * comment preservation (the probe's fidelity claim is semantic, not textual).
 */

export type TokenKind = "identifier" | "op" | "lbrace" | "rbrace" | "math" | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** Identifiers: the raw text. Operators: the operator. Math: the `@[ ... ]` source verbatim. */
  readonly text: string;
  readonly quoted: boolean;
  readonly line: number;
}

export class PdxSyntaxError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(message: string, file: string, line: number) {
    super(`${file}:${line}: ${message}`);
    this.name = "PdxSyntaxError";
    this.file = file;
    this.line = line;
  }
}

const TERMINATORS = new Set([" ", "\t", "\r", "\n", "{", "}", "=", "<", ">", "!", "#", '"']);

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
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '"') {
      const end = text.indexOf('"', index + 1);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated quoted string", file, line);
      }
      tokens.push({ kind: "identifier", text: text.slice(index + 1, end), quoted: true, line });
      index = end + 1;
      continue;
    }
    if (char === "@" && text[index + 1] === "[") {
      const end = text.indexOf("]", index);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated @[ inline math", file, line);
      }
      tokens.push({ kind: "math", text: text.slice(index, end + 1), quoted: false, line });
      index = end + 1;
      continue;
    }
    const operator = operatorAt(text, index);
    if (operator !== null) {
      tokens.push({ kind: "op", text: operator, quoted: false, line });
      index += operator.length;
      continue;
    }

    const start = index;
    while (index < text.length && !TERMINATORS.has(text[index]!)) {
      index += 1;
    }
    if (index === start) {
      throw new PdxSyntaxError(`Unexpected character ${JSON.stringify(char)}`, file, line);
    }
    tokens.push({ kind: "identifier", text: text.slice(start, index), quoted: false, line });
  }

  tokens.push({ kind: "eof", text: "", quoted: false, line });
  return tokens;
}
