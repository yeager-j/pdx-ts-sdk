/**
 * Recursive-descent parser for the CWTools rule format.
 *
 * This is deliberately *not* the PDXScript parser. The two share a block/scalar
 * skeleton, but `.cwt` carries option and doc comments that bind to the entry
 * below them, and folding that into `PdxEntry` would put rule metadata on the
 * type used to emit game files.
 */

import { CwtSyntaxError, tokenize, type Token } from "./lexer.ts";

export type CwtOp = "=" | "==";

export interface CwtScalar {
  readonly kind: "scalar";
  readonly text: string;
  readonly quoted: boolean;
  readonly line: number;
}

export interface CwtBlock {
  readonly kind: "block";
  readonly nodes: readonly CwtNode[];
  readonly line: number;
}

export type CwtValue = CwtScalar | CwtBlock;

/** A `## key = value`, `## key <> value`, or bare `## flag` annotation. */
export interface CwtOption {
  readonly name: string;
  readonly negated: boolean;
  readonly value: CwtValue | null;
  readonly line: number;
}

export interface CwtAssignment {
  readonly kind: "assignment";
  readonly key: CwtScalar;
  readonly op: CwtOp;
  readonly value: CwtValue;
  readonly docs: readonly string[];
  readonly options: readonly CwtOption[];
  readonly line: number;
}

/** A value standing alone inside a block, such as `<technology>` in a prerequisites rule. */
export interface CwtBareValue {
  readonly kind: "value";
  readonly value: CwtValue;
  readonly docs: readonly string[];
  readonly options: readonly CwtOption[];
  readonly line: number;
}

export type CwtNode = CwtAssignment | CwtBareValue;

export type DiagnosticKind = "malformed-option" | "orphan-comment";

/**
 * Something the parser recognised as meaningful but could not interpret.
 *
 * These are never dropped silently: codegen reports them and fails when their
 * count moves, so an upstream typo surfaces as a build failure rather than a
 * quietly missing rule.
 */
export interface CwtDiagnostic {
  readonly kind: DiagnosticKind;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface CwtParseResult {
  readonly file: string;
  readonly nodes: readonly CwtNode[];
  readonly diagnostics: readonly CwtDiagnostic[];
}

const OPTION_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\s*(<>|=)?\s*(.*)$/;

class Parser {
  private readonly tokens: Token[];
  private readonly file: string;
  private index = 0;
  private pendingDocs: string[] = [];
  private pendingOptions: CwtOption[] = [];
  readonly diagnostics: CwtDiagnostic[] = [];

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
    throw new CwtSyntaxError(message, this.file, line);
  }

  parseTopLevel(): CwtNode[] {
    const nodes = this.parseNodes();
    if (this.peek().kind !== "eof") {
      this.fail("Unbalanced '}'", this.peek().line);
    }
    this.flushOrphans();
    return nodes;
  }

  /** Parses a single value and requires the token stream to end there. */
  parseValueOnly(): CwtValue {
    const value = this.parseValue();
    if (this.peek().kind !== "eof") {
      this.fail("Trailing tokens after value", this.peek().line);
    }
    return value;
  }

  private parseNodes(): CwtNode[] {
    const nodes: CwtNode[] = [];
    for (;;) {
      const token = this.peek();
      if (token.kind === "eof" || token.kind === "rbrace") {
        return nodes;
      }
      if (token.kind === "doc") {
        this.pendingDocs.push(token.text);
        this.advance();
        continue;
      }
      if (token.kind === "option") {
        this.collectOption(token);
        this.advance();
        continue;
      }
      nodes.push(this.parseNode());
    }
  }

  private parseNode(): CwtNode {
    const docs = this.pendingDocs;
    const options = this.pendingOptions;
    this.pendingDocs = [];
    this.pendingOptions = [];

    const first = this.parseValue();
    const next = this.peek();
    if (next.kind !== "op") {
      return { kind: "value", value: first, docs, options, line: first.line };
    }
    if (first.kind !== "scalar") {
      this.fail("A block cannot be used as a key", first.line);
    }
    this.advance();
    const value = this.parseValue();
    return {
      kind: "assignment",
      key: first,
      op: next.text as CwtOp,
      value,
      docs,
      options,
      line: first.line,
    };
  }

  private parseValue(): CwtValue {
    const token = this.advance();
    if (token.kind === "identifier") {
      return { kind: "scalar", text: token.text, quoted: token.quoted, line: token.line };
    }
    if (token.kind !== "lbrace") {
      this.fail(`Expected a value but found ${describe(token)}`, token.line);
    }
    const nodes = this.parseNodes();
    if (this.peek().kind !== "rbrace") {
      this.fail("Unterminated block", token.line);
    }
    this.advance();
    this.flushOrphans();
    return { kind: "block", nodes, line: token.line };
  }

  private collectOption(token: Token): void {
    const option = this.readOption(token);
    if (option === null) {
      this.diagnostics.push({
        kind: "malformed-option",
        file: this.file,
        line: token.line,
        text: `## ${token.text}`,
      });
      return;
    }
    this.pendingOptions.push(option);
  }

  private readOption(token: Token): CwtOption | null {
    const match = OPTION_PATTERN.exec(token.text);
    if (match === null) {
      return null;
    }
    const [, name = "", operator, rest = ""] = match;
    if (operator === undefined) {
      return rest === "" ? { name, negated: false, value: null, line: token.line } : null;
    }
    return {
      name,
      negated: operator === "<>",
      value: this.readOptionValue(rest, token.line),
      line: token.line,
    };
  }

  /**
   * Options mostly hold a scalar or a block, but a few (`display_name`,
   * `abbreviation`) hold unquoted prose that runs to end of line. Falling back
   * to the raw text keeps those readable instead of reporting them as broken.
   */
  private readOptionValue(rest: string, line: number): CwtValue {
    try {
      return new Parser(tokenize(rest, this.file), this.file).parseValueOnly();
    } catch {
      return { kind: "scalar", text: rest, quoted: false, line };
    }
  }

  private flushOrphans(): void {
    for (const doc of this.pendingDocs) {
      this.diagnostics.push({
        kind: "orphan-comment",
        file: this.file,
        line: this.peek().line,
        text: `### ${doc}`,
      });
    }
    for (const option of this.pendingOptions) {
      this.diagnostics.push({
        kind: "orphan-comment",
        file: this.file,
        line: option.line,
        text: `## ${option.name}`,
      });
    }
    this.pendingDocs = [];
    this.pendingOptions = [];
  }
}

function describe(token: Token): string {
  return token.kind === "eof" ? "end of file" : `'${token.text}'`;
}

export function parseCwt(source: string, file: string): CwtParseResult {
  const parser = new Parser(tokenize(source, file), file);
  const nodes = parser.parseTopLevel();
  return { file, nodes, diagnostics: parser.diagnostics };
}
