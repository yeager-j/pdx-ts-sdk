/**
 * Recursive-descent parser for PDXScript. See GRAMMAR.md for the grammar,
 * the disambiguation rules, and the repair policy.
 *
 * Malformed-but-shipped input (stray `}`, unclosed containers at EOF,
 * top-level operator-less `foo{...}`) is repaired the way the game repairs
 * it, with a diagnostic per repair — never silently. Everything else that
 * cannot be read throws a `PdxSyntaxError` carrying `file:line`.
 */

import type {
  PdxContainer,
  PdxDiagnostic,
  PdxDocument,
  PdxEntry,
  PdxItem,
  PdxOp,
  PdxValue,
} from "./ast.ts";
import { classifyUnquoted, PdxSyntaxError, tokenize, type Token } from "./lexer.ts";

/** Fuzz-proofing: error on absurd nesting instead of overflowing the stack. */
const MAX_DEPTH = 1000;

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

  parseTopLevel(): PdxEntry[] {
    const entries: PdxEntry[] = [];
    while (this.peek().kind !== "eof") {
      if (this.peek().kind === "rbrace") {
        this.repair("stray-closing-brace", this.peek().line, "}");
        this.advance();
        continue;
      }
      entries.push(this.parseEntry());
    }
    return entries;
  }

  private parseEntry(): PdxEntry {
    const key = this.advance();
    if (key.kind !== "identifier") {
      this.fail(`Expected a key but found ${describe(key)}`, key.line);
    }
    const next = this.peek();
    if (next.kind === "lbrace") {
      this.repair("operator-less-entry", key.line, key.text);
      this.advance();
      return {
        kind: "entry",
        key: key.text,
        op: "=",
        value: this.parseContainerBody(next.line, 1),
        line: key.line,
      };
    }
    if (next.kind !== "op") {
      this.fail(`Expected an operator after '${key.text}' but found ${describe(next)}`, next.line);
    }
    this.advance();
    return {
      kind: "entry",
      key: key.text,
      op: next.text as PdxOp,
      value: this.parseValue(1),
      line: key.line,
    };
  }

  private parseValue(depth: number): PdxValue {
    const token = this.advance();
    if (token.kind === "identifier") {
      if (!token.quoted && this.peek().kind === "lbrace") {
        const open = this.advance();
        const body = this.parseContainerBody(open.line, depth);
        return { ...body, header: token.text };
      }
      return classify(token);
    }
    if (token.kind === "math") {
      return { kind: "math", source: token.text };
    }
    if (token.kind !== "lbrace") {
      this.fail(`Expected a value but found ${describe(token)}`, token.line);
    }
    return this.parseContainerBody(token.line, depth);
  }

  private parseContainerBody(openLine: number, depth: number): PdxContainer {
    if (depth > MAX_DEPTH) {
      this.fail(`Nesting exceeds ${MAX_DEPTH} levels`, openLine);
    }
    const items: PdxItem[] = [];
    for (;;) {
      const next = this.peek();
      if (next.kind === "eof") {
        this.repair("unclosed-at-eof", openLine, "{");
        break;
      }
      if (next.kind === "rbrace") {
        this.advance();
        break;
      }
      if (next.kind === "lbrace") {
        this.advance();
        items.push(this.parseContainerBody(next.line, depth + 1));
        continue;
      }
      if (next.kind === "math") {
        this.advance();
        items.push({ kind: "math", source: next.text });
        continue;
      }
      if (next.kind === "op") {
        this.fail(`Expected a key or value but found ${describe(next)}`, next.line);
      }
      const first = this.advance();
      if (this.peek().kind === "op") {
        const op = this.advance();
        items.push({
          kind: "entry",
          key: first.text,
          op: op.text as PdxOp,
          value: this.parseValue(depth + 1),
          line: first.line,
        });
        continue;
      }
      items.push(classify(first));
    }
    return { kind: "container", items };
  }
}

function describe(token: Token): string {
  return token.kind === "eof" ? "end of file" : `'${token.text}'`;
}

export function parse(source: string, fileName = "<input>"): PdxDocument {
  const parser = new Parser(tokenize(source, fileName), fileName);
  const entries = parser.parseTopLevel();
  return { fileName, entries, diagnostics: parser.diagnostics };
}
