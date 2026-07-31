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
  classifyUnquoted,
  kv,
  parse,
  PdxSyntaxError,
  scalar,
  serialize,
  withoutLines,
  type PdxItem,
  type PdxScalar,
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

/** Numbers the serializer can render (no exponent notation either way). */
const pdxNumber = fc
  .oneof(
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.integer({ min: -1_000_000, max: 1_000_000 }).map((n) => n / 1000)
  )
  .map((n) => (n === 0 ? 0 : n));

const pdxScalar: fc.Arbitrary<PdxScalar> = fc.oneof(
  fc.boolean().map((value): PdxScalar => ({ kind: "bool", value })),
  pdxNumber.map((value): PdxScalar => ({ kind: "num", value })),
  quotableText.map((value): PdxScalar => ({ kind: "str", value, quoted: true })),
  unquotedStrText.map((value): PdxScalar => scalar(value)),
  bareText.map((name): PdxScalar => ({ kind: "var", name: `@${name}` })),
  bareText.map((source): PdxScalar => ({ kind: "math", source: `@[ ${source} ]` }))
);

const key = fc.stringMatching(/^[a-z0-9_.@$-]{1,10}$/);
const op = fc.constantFrom("=", ">", "<", ">=", "<=", "!=" as const);

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
      .map(({ name, negated, items }): PdxItem => ({ kind: "param", name, negated, items }))
  ),
  items: fc.array(tie("item"), { maxLength: 5 }),
})).item;

/** Top-level trees: any items. */
const pdxTree = fc.array(pdxItem, { maxLength: 6 });

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
