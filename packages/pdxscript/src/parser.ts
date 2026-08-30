/**
 * Recursive-descent parser for PDXScript. See GRAMMAR.md for the grammar,
 * the disambiguation rules, and the repair policy.
 *
 * The top level is a container body without braces — one item loop serves
 * the file, `{ ... }` containers, and the body of a `[[NAME] ... ]` region.
 *
 * Malformed-but-shipped input (stray `}`, unclosed containers at EOF,
 * same-line operator-less `foo{...}` entries) is repaired the way the game repairs
 * it, with a diagnostic per repair — never silently. Everything else that
 * cannot be read throws a `PdxSyntaxError` carrying `file:line`.
 */

import type {
  PdxContainer,
  PdxDiagnostic,
  PdxDocument,
  PdxItem,
  PdxOp,
  PdxParamBlock,
  PdxParamText,
  PdxScalar,
  PdxValue,
} from "./ast.ts";
import { PdxSyntaxError, tokenize, type Token } from "./lexer.ts";
import { BYTE_ORDER_MARK, classifyUnquoted, MAX_NESTING_DEPTH } from "./representable.ts";

/**
 * The depth guard, as an error the textual fallback must not absorb — every
 * way of reaching the limit, braces inside a region included. A region's body
 * is re-scanned per level, so swallowing this would turn deep nesting into a
 * slow success instead of a refusal, and it would report the refusal as a
 * *syntactic* fact about the body ("this is not a tree") when it is a
 * resource bound.
 *
 * It extends `PdxSyntaxError`, so callers still catch one error type and read
 * the same `file:line`.
 */
class NestingLimitError extends PdxSyntaxError {}

/**
 * Which body the item loop is reading. It decides where the body ends and
 * how a defect there is handled: `file` and `region` run to EOF (the lexer
 * has already cut the region out of the source), `container` ends at `}`.
 * Only `file` gets the top-level operator-less rule — inside a body,
 * `rgb { 1 2 3 }` is a bare scalar plus a container, not a missing `=`.
 */
type Body = "file" | "container" | "region";

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
    return this.parseItems("file", 1, 0);
  }

  /** The shared item loop; `body` decides where it ends and how it repairs. */
  private parseItems(body: Body, openLine: number, depth: number): PdxItem[] {
    if (depth > MAX_NESTING_DEPTH) {
      throw new NestingLimitError(
        `Nesting exceeds ${MAX_NESTING_DEPTH} levels`,
        this.fileName,
        openLine
      );
    }
    const items: PdxItem[] = [];
    for (;;) {
      const next = this.peek();
      if (next.kind === "eof") {
        if (body === "container") {
          this.repair("unclosed-at-eof", openLine, "{");
        }
        return items;
      }
      if (next.kind === "rbrace") {
        if (body === "container") {
          this.advance();
          return items;
        }
        this.repair("stray-closing-brace", next.line, "}");
        this.advance();
        continue;
      }
      if (next.kind === "rbracket") {
        // The lexer closes every region it opens, so a `]` here has no opener.
        this.fail("Unexpected ']'", next.line);
      }
      if (next.kind === "lbrace") {
        this.advance();
        items.push({
          kind: "container",
          items: this.parseItems("container", next.line, depth + 1),
        });
        continue;
      }
      if (next.kind === "param") {
        this.advance();
        items.push(this.parseRegion(next, depth));
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
      items.push(this.parseScalarLed(body, depth));
    }
  }

  /**
   * A `[[NAME] ... ]` region. The engine splices these as text before it
   * parses, so a body is only a tree when it happens to be one on its own:
   * whatever fails to read, or reads only by repairing brace balance, is
   * kept verbatim as `param-text` instead of being rejected. A repair the
   * body does not depend on (a missing `=`) is reported and the tree kept.
   */
  private parseRegion(token: Token, depth: number): PdxParamBlock | PdxParamText {
    const negated = token.text.startsWith("!");
    const name = negated ? token.text.slice(1) : token.text;
    const body = token.body ?? "";
    if (depth + 1 > MAX_NESTING_DEPTH) {
      throw new NestingLimitError(
        `Nesting exceeds ${MAX_NESTING_DEPTH} levels`,
        this.fileName,
        token.line
      );
    }
    const inner = new Parser(tokenize(body, this.fileName, token.line), this.fileName);
    let items: PdxItem[];
    try {
      items = inner.parseItems("region", token.line, depth + 1);
    } catch (error) {
      // `param-text` is a claim about the body — that it is not a balanced
      // item sequence — so only the failure that establishes that claim may
      // produce one. A depth-limit failure is a resource bound, not a fact
      // about the text, and anything that is not a `PdxSyntaxError` is a
      // defect in this package. Turning either into `param-text` would report
      // a bug as a legitimate syntactic distinction, silently.
      if (!(error instanceof PdxSyntaxError) || error instanceof NestingLimitError) {
        throw error;
      }
      return { kind: "param-text", name, negated, text: body };
    }
    if (inner.diagnostics.some((diagnostic) => diagnostic.kind !== "operator-less-entry")) {
      return { kind: "param-text", name, negated, text: body };
    }
    this.diagnostics.push(...inner.diagnostics);
    return { kind: "param", name, negated, items };
  }

  /** An identifier was peeked: entry, operator-less repair, or bare scalar. */
  private parseScalarLed(body: Body, depth: number): PdxItem {
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
      body !== "file" &&
      this.tokens[this.index + 1]?.kind === "identifier" &&
      this.tokens[this.index + 2]?.kind === "op";
    if (
      next.kind === "lbrace" &&
      next.line === first.line &&
      (body === "file" || nestedBodyStartsWithEntry)
    ) {
      this.repair("operator-less-entry", first.line, first.text);
      this.advance();
      return {
        kind: "entry",
        key: first.text,
        op: "=",
        value: { kind: "container", items: this.parseItems("container", next.line, depth + 1) },
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
          items: this.parseItems("container", open.line, depth + 1),
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
      items: this.parseItems("container", token.line, depth + 1),
    } satisfies PdxContainer;
  }
}

function describe(token: Token): string {
  return token.kind === "eof" ? "end of file" : `'${token.text}'`;
}

/**
 * A `param-text` region's body, read flat: its scalars in source order, and
 * any region nested inside it as a region of its own. Braces and operators
 * are gone, because the structure they would describe belongs to the call
 * site — which is what made the body untreeable to begin with.
 *
 * This is the sanctioned reading of a body with no tree: a consumer that
 * needs to know what a region names (an `@variable` a patch must re-declare,
 * a nested region's parameter) asks here rather than re-deriving the lexer's
 * rules over raw text — which would also read a commented-out `# $OLD$` as a
 * live token. Bodies that are not lexable PDXScript throw, exactly as a file
 * of the same text would.
 */
export function regionItems(region: PdxParamText, fileName = "<region>"): PdxItem[] {
  const items: PdxItem[] = [];
  for (const token of tokenize(region.text, fileName)) {
    if (token.kind === "identifier") {
      items.push(
        token.quoted
          ? ({ kind: "str", value: token.text, quoted: true } satisfies PdxScalar)
          : classifyUnquoted(token.text)
      );
    } else if (token.kind === "math") {
      items.push({ kind: "math", source: token.text });
    } else if (token.kind === "param") {
      const negated = token.text.startsWith("!");
      items.push({
        kind: "param-text",
        name: negated ? token.text.slice(1) : token.text,
        negated,
        text: token.body ?? "",
      });
    }
  }
  return items;
}

export function parse(source: string, fileName = "<input>"): PdxDocument {
  // The file boundary, and the only place a byte-order mark means one: it
  // states the encoding of this document. `tokenize` reads fragments too
  // (a region body, `regionItems`), where a leading `U+FEFF` is just text.
  const text = source.startsWith(BYTE_ORDER_MARK) ? source.slice(BYTE_ORDER_MARK.length) : source;
  const parser = new Parser(tokenize(text, fileName), fileName);
  const items = parser.parseTopLevel();
  return { fileName, items, diagnostics: parser.diagnostics };
}
