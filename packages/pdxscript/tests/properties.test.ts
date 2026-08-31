/**
 * Property tests: what the corpus cannot cover, generated inputs can.
 * The corpus fixpoint starts from text Paradox wrote; the properties here
 * start from arbitrary trees and arbitrary text — the direction nobody has
 * written yet.
 *
 * 1. Generator round-trip: serialize(tree) reparses to the same tree.
 * 2. Bare-safety symmetry: any string survives scalar → serialize → parse
 *    with its value intact (the serializer's quoting rule mechanically
 *    checked against the lexer's classification rule).
 * 3. Total robustness: arbitrary text either parses or throws
 *    PdxSyntaxError — never crashes, hangs, or overflows the stack.
 * 4. Repair idempotence: whatever parses (repairs included) serializes to
 *    something that parses clean.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canonicalNumeral,
  classifyUnquoted,
  decimalLexeme,
  entry,
  inlineMath,
  kv,
  numeral,
  parse,
  PDX_OPERATORS,
  PdxSyntaxError,
  quoted,
  scalar,
  serialize,
  tryNumberValue,
  varRef,
  withoutLines,
  type PdxItem,
  type PdxScalar,
  type PdxValue,
} from "../src/index.ts";

// --- generators -----------------------------------------------------------

const bareText = fc.stringMatching(/^[a-z0-9_.:@/|$-]{1,12}$/);

/**
 * Text an *unquoted* str can hold and keep its flag through the round trip:
 * anything else ("@a", "123", "yes") is quote-promoted by the serializer,
 * which changes `quoted` — a documented normalization for hand-built trees,
 * covered by the bare-safety property instead.
 */
const unquotedStrText = bareText.filter((text) => classifyUnquoted(text).kind === "str");

/** Strings whose raw content can sit between quotes (no unescapable `"`). */
const quotableText = fc
  .string({ maxLength: 20 })
  .filter((s) => !/(^|[^\\])(\\\\)*"/.test(s) && !s.endsWith("\\"));

/**
 * Numerals as the AST carries them. The big-integer branch is the point:
 * those have no double, so a model that stored one would fail this suite.
 */
const pdxNumeral = fc
  .oneof(
    fc.integer({ min: -1_000_000, max: 1_000_000 }).map(String),
    fc.integer({ min: -1_000_000, max: 1_000_000 }).map((n) => decimalLexeme(n / 1000)),
    fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }).map(String)
  )
  .map(canonicalNumeral);

const pdxScalar: fc.Arbitrary<PdxScalar> = fc.oneof(
  fc.boolean().map((value): PdxScalar => ({ kind: "bool", value })),
  pdxNumeral.map((lexeme): PdxScalar => ({ kind: "num", lexeme })),
  quotableText.map((value): PdxScalar => ({ kind: "str", value, quoted: true })),
  unquotedStrText.map((value): PdxScalar => scalar(value)),
  bareText.map((name): PdxScalar => ({ kind: "var", name: `@${name}` })),
  bareText.map((source): PdxScalar => ({ kind: "math", source: `@[ ${source} ]` }))
);

/**
 * Bodies a conditional region keeps as text: each is unbalanced on its own,
 * which is the whole reason it has no tree. Balanced text would come back as
 * a `param` node and fail the round trip for the right reason.
 */
const unbalancedRegionText = bareText.chain((text) =>
  fc.constantFrom(`\n\t${text} = {\n`, `\n\t}\n`, `\n\t{ ${text}\n`)
);

const key = fc.stringMatching(/^[a-z0-9_.@$-]{1,10}$/);
/** Drawn from the operator table, so the generator cannot drift from it. */
const op = fc.constantFrom(...PDX_OPERATORS);

const pdxItem: fc.Arbitrary<PdxItem> = fc.letrec<{ item: PdxItem; items: PdxItem[] }>((tie) => ({
  item: fc.oneof(
    { maxDepth: 4, withCrossShrink: true },
    pdxScalar,
    fc
      .record({ key, op, value: pdxScalar })
      .map(({ key: k, op: o, value }): PdxItem => ({ kind: "entry", key: k, op: o, value })),
    fc
      .record({ key, items: tie("items"), header: fc.option(bareText, { nil: undefined }) })
      .map(({ key: k, items, header }): PdxItem => ({
        kind: "entry",
        key: k,
        op: "=",
        value: { kind: "container", header, items },
      })),
    fc.record({ items: tie("items") }).map(({ items }): PdxItem => ({ kind: "container", items })),
    fc
      .record({ name: bareText, negated: fc.boolean(), items: tie("items") })
      .map(({ name, negated, items }): PdxItem => ({ kind: "param", name, negated, items })),
    fc
      .record({ name: bareText, negated: fc.boolean(), text: unbalancedRegionText })
      .map(({ name, negated, text }): PdxItem => ({ kind: "param-text", name, negated, text }))
  ),
  items: fc.array(tie("item"), { maxLength: 5 }),
})).item;

/** Top-level trees: any items. */
const pdxTree = fc.array(pdxItem, { maxLength: 6 });

/**
 * A scalar minus `quoted`, which is a rendering hint rather than part of the
 * value: the serializer promotes a bare `str` to quoted whenever bare would
 * read back as something else (`""`, `"123"`, `"yes"`). It never demotes one,
 * which the properties below assert separately.
 */
function asRead(value: PdxValue | undefined): unknown {
  return value?.kind === "str" ? { kind: "str", value: value.value } : value;
}

// --- properties -----------------------------------------------------------

describe("properties", () => {
  it("generator round-trip: serialize(tree) reparses to the same tree", () => {
    fc.assert(
      fc.property(pdxTree, (tree) => {
        const emitted = serialize(tree);
        const reparsed = parse(emitted, "prop.txt");
        expect(reparsed.diagnostics).toEqual([]);
        expect(withoutLines(reparsed.items)).toEqual(withoutLines(tree));
      }),
      { numRuns: 500 }
    );
  });

  it("bare-safety symmetry: any string value survives with its text intact", () => {
    fc.assert(
      fc.property(quotableText, (text) => {
        const emitted = serialize([kv("k", scalar(text))]);
        const document = parse(emitted, "prop.txt");
        const item = document.items[0]!;
        if (item.kind !== "entry" || item.value.kind !== "str") {
          throw new Error(`expected a str entry, got ${JSON.stringify(item)}`);
        }
        expect(item.value.value).toBe(text);
      }),
      { numRuns: 1000 }
    );
  });

  it("total robustness: arbitrary text parses or throws PdxSyntaxError", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        try {
          parse(text, "prop.txt");
        } catch (error) {
          expect(error).toBeInstanceOf(PdxSyntaxError);
        }
      }),
      { numRuns: 2000 }
    );
  });

  it("total robustness: token soup parses or throws PdxSyntaxError", () => {
    const token = fc.constantFrom(
      "{",
      "}",
      "[[X]",
      "]",
      "=",
      "<=",
      "a",
      "@v",
      '"q"',
      "1.5",
      "yes",
      "# c\n",
      "hsv"
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 30 }), (tokens) => {
        try {
          parse(tokens.join(" "), "prop.txt");
        } catch (error) {
          expect(error).toBeInstanceOf(PdxSyntaxError);
        }
      }),
      { numRuns: 2000 }
    );
  });

  /**
   * Closure: the values the constructors can build, the values the
   * serializer can write, and the values the parser can read are one set.
   * Each property below is a way the three used to disagree — a constructed
   * value that emitted something reading back as a different node, or text
   * that parsed and then could not be written again.
   */
  it("closure: a constructed scalar reparses as itself, or was refused up front", () => {
    const construct = (kind: string, text: string): PdxScalar => {
      switch (kind) {
        case "quoted":
          return quoted(text);
        case "var":
          return varRef(`@${text}`);
        case "math":
          return inlineMath(`@[ ${text} ]`);
        default:
          return scalar(text);
      }
    };
    fc.assert(
      fc.property(
        fc.constantFrom("quoted", "bare", "var", "math"),
        fc.string({ maxLength: 20 }),
        (kind, text) => {
          let value: PdxScalar;
          try {
            value = construct(kind, text);
          } catch {
            return; // outside the language, and said so before emitting
          }
          const document = parse(serialize([kv("k", value)]), "prop.txt");
          const item = document.items[0]!;
          const seen = item.kind === "entry" ? item.value : undefined;
          expect(asRead(seen)).toEqual(asRead(value));
          if (value.kind === "str" && value.quoted) {
            expect(seen?.kind === "str" && seen.quoted).toBe(true);
          }
        }
      ),
      { numRuns: 3000 }
    );
  });

  it("closure: every finite JS number has a lexeme that reads back as it", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        const lexeme = decimalLexeme(value);
        expect(lexeme).not.toMatch(/[eE]/);
        expect(tryNumberValue(lexeme)).toBe(value === 0 ? 0 : value);
      }),
      { numRuns: 2000 }
    );
  });

  it("closure: every numeral keeps every digit through the round trip", () => {
    fc.assert(
      fc.property(pdxNumeral, (lexeme) => {
        const document = parse(serialize([kv("k", numeral(lexeme))]), "prop.txt");
        const item = document.items[0]!;
        if (item.kind !== "entry" || item.value.kind !== "num") {
          throw new Error("expected a numeric entry");
        }
        expect(item.value.lexeme).toBe(lexeme);
        // And the JS projection is offered only when it is the same number.
        // For an integer that is an integer comparison, not a comparison of
        // spellings: past 2^53 the two stop agreeing in both directions.
        const projected = tryNumberValue(lexeme);
        if (lexeme.includes(".")) {
          expect(projected === null || decimalLexeme(projected) === lexeme).toBe(true);
        } else {
          const exact =
            Number.isInteger(Number(lexeme)) && BigInt(Number(lexeme)) === BigInt(lexeme);
          expect(projected === null).toBe(!exact);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("closure: a key survives as itself, bare or quoted", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (text) => {
        let built;
        try {
          built = entry(text, "=", scalar(1));
        } catch {
          return; // outside the language, and said so before emitting
        }
        const document = parse(serialize([built]), "prop.txt");
        const item = document.items[0]!;
        expect(item.kind === "entry" && item.key).toBe(text);
      }),
      { numRuns: 2000 }
    );
  });

  it("repair idempotence: whatever parses serializes to something that parses clean", () => {
    const token = fc.constantFrom("{", "}", "=", "a", "b", "1", "yes", "@v");
    fc.assert(
      fc.property(fc.array(token, { maxLength: 20 }), (tokens) => {
        let document;
        try {
          document = parse(tokens.join(" "), "prop.txt");
        } catch {
          return; // hard errors are out of scope here
        }
        const reparsed = parse(serialize(document.items), "prop.txt");
        expect(reparsed.diagnostics).toEqual([]);
        expect(withoutLines(reparsed.items)).toEqual(withoutLines(document.items));
      }),
      { numRuns: 2000 }
    );
  });
});
