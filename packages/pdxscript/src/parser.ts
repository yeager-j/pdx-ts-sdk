/**
 * Recursive-descent parser for PDXScript. See GRAMMAR.md for the grammar,
 * the disambiguation rules, and the repair policy.
 *
 * The top level is a container body without braces — one item loop serves
 * the file, `{ ... }` containers, and `[[NAME] ... ]` parameter blocks.
 *
 * Malformed-but-shipped input (stray `}`, unclosed containers at EOF,
 * same-line operator-less `foo{...}` entries) is repaired the way the game repairs
 * it, with a diagnostic per repair — never silently. Everything else that
 * cannot be read throws a `PdxSyntaxError` carrying `file:line`.
 */

import type { PdxContainer, PdxDiagnostic, PdxDocument, PdxItem, PdxOp, PdxValue } from "./ast.ts";
import { classifyUnquoted, PdxSyntaxError, tokenize, type Token } from "./lexer.ts";

/** Fuzz-proofing: error on absurd nesting instead of overflowing the stack. */
const MAX_DEPTH = 1000;

type Closer = "rbrace" | "rbracket" | "eof";

function classify(token: Token): PdxItem & PdxValue {
  if (token.quoted) {
    return { kind: "str", value: token.text, quoted: true };
  }
  return classifyUnquoted(token.text);
}

class Parser {
  private readonly tokens: Token[];
  private readonly fileName: string;
  private index = 0;
  readonly diagnostics: PdxDiagnostic[] = [];

  constructor(tokens: Token[], fileName: string) {
    this.tokens = tokens;
    this.fileName = fileName;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    const token = this.tokens[this.index]!;
    this.index += 1;
    return token;
  }

  private fail(message: string, line: number): never {
    throw new PdxSyntaxError(message, this.fileName, line);
  }

  private repair(kind: PdxDiagnostic["kind"], line: number, text: string): void {
    this.diagnostics.push({ kind, fileName: this.fileName, line, text });
  }

  parseTopLevel(): PdxItem[] {
    return this.parseItems("eof", 1, 0);
  }

  /**
   * The shared item loop. `closer` distinguishes the three body kinds: a
   * container ends at `}` (EOF is repaired), a parameter block ends at `]`
   * (EOF is a hard error), the top level ends at EOF (a stray `}` is
   * repaired and skipped).
   */
  private parseItems(closer: Closer, openLine: number, depth: number): PdxItem[] {
    if (depth > MAX_DEPTH) {
      this.fail(`Nesting exceeds ${MAX_DEPTH} levels`, openLine);
    }
    const items: PdxItem[] = [];
    for (;;) {
      const next = this.peek();
      if (next.kind === "eof") {
        if (closer === "rbrace") {
          this.repair("unclosed-at-eof", openLine, "{");
        }
        if (closer === "rbracket") {
          this.fail("Unterminated [[ parameter block", openLine);
        }
        return items;
      }
      if (next.kind === closer) {
        this.advance();
        return items;
      }
      if (next.kind === "rbrace") {
        // Only reachable at top level (containers consume their own `}`).
        this.repair("stray-closing-brace", next.line, "}");
        this.advance();
        continue;
      }
      if (next.kind === "rbracket") {
        this.fail("Unexpected ']'", next.line);
      }
      if (next.kind === "lbrace") {
        this.advance();
        items.push({ kind: "container", items: this.parseItems("rbrace", next.line, depth + 1) });
        continue;
      }
      if (next.kind === "param-open") {
        this.advance();
        const negated = next.text.startsWith("!");
        items.push({
          kind: "param",
          name: negated ? next.text.slice(1) : next.text,
          negated,
          items: this.parseItems("rbracket", next.line, depth + 1),
        });
        continue;
      }
      if (next.kind === "math") {
        this.advance();
        items.push({ kind: "math", source: next.text });
        continue;
      }
      if (next.kind === "op") {
        this.fail(`Expected a key or value but found '${next.text}'`, next.line);
      }
      items.push(this.parseScalarLed(closer, depth));
    }
  }

  /** An identifier was peeked: entry, operator-less repair, or bare scalar. */
  private parseScalarLed(closer: Closer, depth: number): PdxItem {
    const first = this.advance();
    const next = this.peek();
    if (next.kind === "op") {
      this.advance();
      return {
        kind: "entry",
        key: first.text,
        op: next.text as PdxOp,
        value: this.parseValue(depth),
        line: first.line,
      };
    }
    // Same-line only. At nested item position `rgb { 1 2 3 }` is a legitimate
    // bare scalar plus scalar container, while `spriteType { name = ... }` is the shipped
    // missing-`=` defect. The first entry-shaped child distinguishes them
    // without a game-semantic list of header names. A `{` on a later line is
    // the separate bare container item the serializer emits for that tree.
    const nestedBodyStartsWithEntry =
      closer !== "eof" &&
      this.tokens[this.index + 1]?.kind === "identifier" &&
      this.tokens[this.index + 2]?.kind === "op";
    if (
      next.kind === "lbrace" &&
      next.line === first.line &&
      (closer === "eof" || nestedBodyStartsWithEntry)
    ) {
      this.repair("operator-less-entry", first.line, first.text);
      this.advance();
      return {
        kind: "entry",
        key: first.text,
        op: "=",
        value: { kind: "container", items: this.parseItems("rbrace", next.line, depth + 1) },
        line: first.line,
      };
    }
    return classify(first);
  }

  private parseValue(depth: number): PdxValue {
    const token = this.advance();
    if (token.kind === "identifier") {
      // Header form (`hsv { ... }`) is same-line only, so a scalar value
      // followed by a bare container item on the next line stays two nodes.
      if (!token.quoted && this.peek().kind === "lbrace" && this.peek().line === token.line) {
        const open = this.advance();
        return {
          kind: "container",
          header: token.text,
          items: this.parseItems("rbrace", open.line, depth + 1),
        };
      }
      return classify(token);
    }
    if (token.kind === "math") {
      return { kind: "math", source: token.text };
    }
    if (token.kind !== "lbrace") {
      this.fail(`Expected a value but found ${describe(token)}`, token.line);
    }
    return {
      kind: "container",
      items: this.parseItems("rbrace", token.line, depth + 1),
    } satisfies PdxContainer;
  }
}

function describe(token: Token): string {
  return token.kind === "eof" ? "end of file" : `'${token.text}'`;
}

export function parse(source: string, fileName = "<input>"): PdxDocument {
  const parser = new Parser(tokenize(source, fileName), fileName);
  const items = parser.parseTopLevel();
  return { fileName, items, diagnostics: parser.diagnostics };
}
