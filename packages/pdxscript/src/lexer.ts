/**
 * Tokenizer for PDXScript. See GRAMMAR.md for the language; this file owns
 * trivia (whitespace, `\r`, `\v`, `\f`, semicolons, `#` comments), quoted
 * strings (raw content, `\` skips the next character when scanning for the
 * closing quote), `@[ ... ]` inline-math tokens, `[[NAME] ... ]` conditional
 * regions, and the operator set.
 *
 * What counts as a legal token of each kind, and what an unquoted one means,
 * is `representable.ts` — shared with the parser, the constructors and the
 * serializer, so that no two of them can disagree.
 */

import { isParamName, TOKEN_TERMINATORS } from "./representable.ts";

/**
 * What a token is. `identifier` covers every unquoted word and every quoted
 * string — what such a token *means* is decided later, by `classifyUnquoted`,
 * so that the lexer holds no reading of its own.
 */
export type TokenKind =
  "identifier" | "op" | "lbrace" | "rbrace" | "math" | "param" | "rbracket" | "eof";

/** One token, with the source spelling kept and the line it opened on. */
export interface Token {
  readonly kind: TokenKind;
  /**
   * Identifiers: the raw text. Operators: the operator. Math: the `@[ ... ]`
   * source verbatim. Param: the opener text between `[[` and `]`, negation
   * bang included.
   */
  readonly text: string;
  /** Param tokens only: the region's source between the opener and its `]`. */
  readonly body?: string;
  readonly quoted: boolean;
  readonly line: number;
}

/**
 * Source this package cannot read, at a place it can name.
 *
 * The only error type {@link parse} raises for bad input, and the `message`
 * always begins `file:line: `. It means the text is not PDXScript — not that
 * it is malformed in a way the game tolerates, which is repaired instead and
 * reported through `PdxDocument.diagnostics`.
 */
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

// Trivia is a different question from termination — which characters are
// *skipped*, not which ones end a token — so it stays here. What ends a bare
// token is `TOKEN_TERMINATORS`, owned by `representable.ts` because the
// constructors and the serializer ask it too.
const TRIVIA = new Set([" ", "\t", "\r", "\v", "\f", ";"]);

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

function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let index = from; index < to; index += 1) {
    if (text[index] === "\n") {
      count += 1;
    }
  }
  return count;
}

/** Index of the quote closing the one at `open`, or -1. `\` skips one character. */
function scanQuoted(text: string, open: number): number {
  let index = open + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === '"') {
      return index;
    }
    index += 1;
  }
  return -1;
}

/** True when `@` at `index` opens inline math: `@[` or the deferred `@\[`. */
function opensMath(text: string, index: number): boolean {
  return (
    text[index] === "@" &&
    (text[index + 1] === "[" || (text[index + 1] === "\\" && text[index + 2] === "["))
  );
}

/**
 * Index of the `]` closing the region whose body starts at `start`, or -1.
 *
 * The scan is textual because the construct is (see GRAMMAR.md): a region is
 * conditional *text*, so braces are not counted at all — its body need only
 * balance after substitution. Quotes, comments, and `@[ ]` math are skipped
 * whole so a `]` inside one does not close the region, and a nested `[[NAME]`
 * raises the depth (its opener's own `]` is not a closer).
 */
function scanRegion(text: string, start: number): number {
  let index = start;
  let depth = 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "#") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '"') {
      const end = scanQuoted(text, index);
      if (end === -1) {
        return -1;
      }
      index = end + 1;
      continue;
    }
    if (opensMath(text, index)) {
      const end = text.indexOf("]", index);
      if (end === -1) {
        return -1;
      }
      index = end + 1;
      continue;
    }
    if (char === "[" && text[index + 1] === "[") {
      const opener = text.indexOf("]", index);
      if (opener === -1) {
        return -1;
      }
      depth += 1;
      index = opener + 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  return -1;
}

/**
 * `startLine` numbers the first line of `source`; the parser passes the
 * opener's line when it re-tokenizes a conditional region's body, so lines
 * stay absolute inside one.
 *
 * `text` is a *fragment*, not necessarily a file: this is also how a region's
 * body and `regionItems` are read. So nothing here is stripped — a byte-order
 * mark belongs to a document, and `parse()` removes it at that boundary.
 * Doing it here would eat a `U+FEFF` that opens a region body, which is
 * ordinary text inside one.
 */
export function tokenize(text: string, fileName: string, startLine = 1): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = startLine;

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
      const end = scanQuoted(text, index);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated quoted string", fileName, openLine);
      }
      tokens.push({
        kind: "identifier",
        text: text.slice(index + 1, end),
        quoted: true,
        line: openLine,
      });
      line += countNewlines(text, index, end);
      index = end + 1;
      continue;
    }
    // Inline math: `@[ ... ]`, or `@\[ ... ]` — the escaped form defers
    // evaluation until after $PARAM$ substitution in scripted effects.
    if (opensMath(text, index)) {
      const end = text.indexOf("]", index);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated @[ inline math", fileName, line);
      }
      tokens.push({ kind: "math", text: text.slice(index, end + 1), quoted: false, line });
      line += countNewlines(text, index, end);
      index = end + 1;
      continue;
    }
    // A `[[NAME] ... ]` region is captured whole: its body is conditional
    // text, not necessarily a balanced item sequence (GRAMMAR.md).
    if (char === "[" && text[index + 1] === "[") {
      const openLine = line;
      const opener = text.indexOf("]", index);
      if (opener === -1) {
        throw new PdxSyntaxError("Unterminated [[ parameter block", fileName, openLine);
      }
      const end = scanRegion(text, opener + 1);
      if (end === -1) {
        throw new PdxSyntaxError("Unterminated [[ parameter block", fileName, openLine);
      }
      const opened = text.slice(index + 2, opener);
      if (!isParamName(opened.startsWith("!") ? opened.slice(1) : opened)) {
        throw new PdxSyntaxError(
          `Invalid parameter name ${JSON.stringify(opened)}`,
          fileName,
          openLine
        );
      }
      tokens.push({
        kind: "param",
        text: opened,
        body: text.slice(opener + 1, end),
        quoted: false,
        line: openLine,
      });
      line += countNewlines(text, index, end);
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
    while (index < text.length && !TOKEN_TERMINATORS.has(text[index]!)) {
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
