/**
 * Recursive-descent parser for PDXScript — the probe's, not yet the SDK's.
 *
 * Produces `ParsedEntry` trees, a superset of `src/ast.ts`'s `PdxEntry`: two
 * extra scalar kinds (`var` for `@name` references, `math` for `@[ ... ]`
 * carried verbatim) plus source lines for loud errors. Duplicate keys are
 * preserved in order — six `modifier` blocks inside one `weight_modifier` is
 * the normal case, not an edge. `emit.ts` lowers this tree into `PdxValue`
 * for the shared serializer.
 *
 * The list/block call: a `{ ... }` whose members are all bare scalars is a
 * list; one with only `key = value` members is a block; empty braces are an
 * empty block (the serializer emits `{}` for both). Mixing bare values and
 * assignments in one block is recognized and refused loudly — deferred until
 * a real file demands it.
 */

import type { PdxOp } from "../../src/ast.ts";
import { PdxSyntaxError, tokenize, type Token } from "./lexer.ts";

export type ParsedScalar =
  | { kind: "str"; value: string; quoted: boolean }
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "math"; source: string };

export type ParsedValue =
  | ParsedScalar
  | { kind: "block"; entries: ParsedEntry[] }
  | { kind: "list"; items: ParsedScalar[] };

export interface ParsedEntry {
  readonly key: string;
  readonly op: PdxOp;
  readonly value: ParsedValue;
  readonly line: number;
}

export interface ParsedFile {
  readonly file: string;
  readonly entries: readonly ParsedEntry[];
  /** Top-level `@name = <number>` definitions, in declaration order. */
  readonly variables: ReadonlyMap<string, number>;
}

const NUMBER = /^-?(\d+(\.\d+)?|\.\d+)$/;

function classifyScalar(token: Token): ParsedScalar {
  if (token.quoted) {
    return { kind: "str", value: token.text, quoted: true };
  }
  if (token.text === "yes" || token.text === "no") {
    return { kind: "bool", value: token.text === "yes" };
  }
  if (NUMBER.test(token.text)) {
    return { kind: "num", value: Number(token.text) };
  }
  if (token.text.startsWith("@")) {
    return { kind: "var", name: token.text };
  }
  return { kind: "str", value: token.text, quoted: false };
}

class Parser {
  private readonly tokens: Token[];
  private readonly file: string;
  private index = 0;

  constructor(tokens: Token[], file: string) {
    this.tokens = tokens;
    this.file = file;
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
    throw new PdxSyntaxError(message, this.file, line);
  }

  parseTopLevel(): ParsedEntry[] {
    const entries: ParsedEntry[] = [];
    while (this.peek().kind !== "eof") {
      if (this.peek().kind === "rbrace") {
        this.fail("Unbalanced '}'", this.peek().line);
      }
      entries.push(this.parseEntry());
    }
    return entries;
  }

  private parseEntry(): ParsedEntry {
    const key = this.advance();
    if (key.kind !== "identifier") {
      this.fail(`Expected a key but found ${describe(key)}`, key.line);
    }
    const op = this.advance();
    if (op.kind !== "op") {
      this.fail(`Expected an operator after '${key.text}' but found ${describe(op)}`, op.line);
    }
    return {
      key: key.text,
      op: op.text as PdxOp,
      value: this.parseValue(),
      line: key.line,
    };
  }

  private parseValue(): ParsedValue {
    const token = this.advance();
    if (token.kind === "identifier") {
      return classifyScalar(token);
    }
    if (token.kind === "math") {
      return { kind: "math", source: token.text };
    }
    if (token.kind !== "lbrace") {
      this.fail(`Expected a value but found ${describe(token)}`, token.line);
    }
    return this.parseBraced(token.line);
  }

  private parseBraced(openLine: number): ParsedValue {
    const entries: ParsedEntry[] = [];
    const bares: ParsedScalar[] = [];
    for (;;) {
      const next = this.peek();
      if (next.kind === "eof") {
        this.fail("Unterminated block", openLine);
      }
      if (next.kind === "rbrace") {
        this.advance();
        break;
      }
      if (next.kind === "lbrace") {
        this.fail("A bare block inside a block is not supported yet (deferred)", next.line);
      }
      if (next.kind === "op") {
        this.fail(`Expected a key or value but found ${describe(next)}`, next.line);
      }
      const first = this.advance();
      if (first.kind === "math") {
        bares.push({ kind: "math", source: first.text });
        continue;
      }
      if (this.peek().kind === "op") {
        const op = this.advance();
        entries.push({
          key: first.text,
          op: op.text as PdxOp,
          value: this.parseValue(),
          line: first.line,
        });
        continue;
      }
      bares.push(classifyScalar(first));
    }
    if (entries.length > 0 && bares.length > 0) {
      this.fail(
        "A block mixing bare values and assignments is not supported yet (deferred)",
        openLine
      );
    }
    if (bares.length > 0) {
      return { kind: "list", items: bares };
    }
    return { kind: "block", entries };
  }
}

function describe(token: Token): string {
  return token.kind === "eof" ? "end of file" : `'${token.text}'`;
}

export function parseSource(source: string, file: string): ParsedFile {
  const entries = new Parser(tokenize(source, file), file).parseTopLevel();
  const variables = new Map<string, number>();
  for (const entry of entries) {
    if (entry.key.startsWith("@") && entry.value.kind === "num") {
      variables.set(entry.key, entry.value.value);
    }
  }
  return { file, entries, variables };
}
