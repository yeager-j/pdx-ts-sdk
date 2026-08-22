/**
 * Recursive-descent parser for the CWTools rule format.
 *
 * This is deliberately *not* the PDXScript parser. The two share a block/scalar
 * skeleton, but `.cwt` carries option and doc comments that bind to the entry
 * below them, and folding that into `PdxEntry` would put rule metadata on the
 * type used to emit game files.
 */

import { CwtSyntaxError, tokenize, type Token } from "./lexer.ts";

/** An assignment or comparison operator in a CWT rule. */
export type CwtOp = "=" | "==";

/** A scalar CWT value as written in the source. */
export interface CwtScalar {
  /** Identifies this value as a scalar. */
  readonly kind: "scalar";
  /** The scalar text without surrounding quotes. */
  readonly text: string;
  /** Whether the source enclosed the scalar in double quotes. */
  readonly quoted: boolean;
  /** The one-based source line containing the scalar. */
  readonly line: number;
}

/** An ordered CWT block containing assignments and bare values. */
export interface CwtBlock {
  /** Identifies this value as a block. */
  readonly kind: "block";
  /** The block's ordered child nodes. */
  readonly nodes: readonly CwtNode[];
  /** The one-based source line containing the opening brace. */
  readonly line: number;
}

/** A scalar or block value in a CWT rule. */
export type CwtValue = CwtScalar | CwtBlock;

/** A `## key = value`, `## key <> value`, or bare `## flag` annotation. */
export interface CwtOption {
  /** The option name after the `##` marker. */
  readonly name: string;
  /** Whether the option uses the `<>` operator. */
  readonly negated: boolean;
  /** The option value, or `null` for a bare flag. */
  readonly value: CwtValue | null;
  /** The one-based source line containing the option. */
  readonly line: number;
}

/** A keyed CWT rule with its bound documentation and options. */
export interface CwtAssignment {
  /** Identifies this node as an assignment. */
  readonly kind: "assignment";
  /** The scalar key on the left side of the operator. */
  readonly key: CwtScalar;
  /** The assignment or comparison operator. */
  readonly op: CwtOp;
  /** The value on the right side of the operator. */
  readonly value: CwtValue;
  /** Documentation comments bound to this assignment. */
  readonly docs: readonly string[];
  /** Option comments bound to this assignment. */
  readonly options: readonly CwtOption[];
  /** The one-based source line containing the key. */
  readonly line: number;
}

/** A value standing alone inside a block, such as `<technology>` in a prerequisites rule. */
export interface CwtBareValue {
  /** Identifies this node as a bare value. */
  readonly kind: "value";
  /** The scalar or block value. */
  readonly value: CwtValue;
  /** Documentation comments bound to this value. */
  readonly docs: readonly string[];
  /** Option comments bound to this value. */
  readonly options: readonly CwtOption[];
  /** The one-based source line containing the value. */
  readonly line: number;
}

/** An assignment or bare value within a CWT file or block. */
export type CwtNode = CwtAssignment | CwtBareValue;

/** A recoverable condition reported while reading CWT source. */
export type DiagnosticKind = "malformed-option" | "orphan-comment" | "unknown-keyword";

/**
 * Something in a CWT rule that parsing or classification recognised as
 * meaningful but could not interpret.
 *
 * These are never dropped silently: codegen reports them and fails when their
 * count moves, so an upstream typo surfaces as a build failure rather than a
 * quietly missing rule.
 */
export interface CwtDiagnostic {
  /** The diagnostic category. */
  readonly kind: DiagnosticKind;
  /** The source file that contains the condition. */
  readonly file: string;
  /** The one-based source line that contains the condition. */
  readonly line: number;
  /** The source text associated with the condition. */
  readonly text: string;
}

/** The parsed nodes and recoverable diagnostics for one CWT source file. */
export interface CwtParseResult {
  /** The source file name supplied to the parser. */
  readonly file: string;
  /** The ordered top-level nodes. */
  readonly nodes: readonly CwtNode[];
  /** Recoverable conditions found while parsing. */
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
    const { docs, options } = this.takePendingAnnotations();

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
    const { docs, options } = this.takePendingAnnotations();
    for (const doc of docs) {
      this.diagnostics.push({
        kind: "orphan-comment",
        file: this.file,
        line: this.peek().line,
        text: `### ${doc}`,
      });
    }
    for (const option of options) {
      this.diagnostics.push({
        kind: "orphan-comment",
        file: this.file,
        line: option.line,
        text: `## ${option.name}`,
      });
    }
  }

  private takePendingAnnotations(): { docs: string[]; options: CwtOption[] } {
    const annotations = { docs: this.pendingDocs, options: this.pendingOptions };
    this.pendingDocs = [];
    this.pendingOptions = [];
    return annotations;
  }
}

function describe(token: Token): string {
  return token.kind === "eof" ? "end of file" : `'${token.text}'`;
}

/** Parses one CWT source file without discarding recoverable diagnostics. */
export function parseCwt(source: string, file: string): CwtParseResult {
  const parser = new Parser(tokenize(source, file), file);
  const nodes = parser.parseTopLevel();
  return { file, nodes, diagnostics: parser.diagnostics };
}
