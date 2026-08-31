/**
 * The per-claim suite: one `it` per grammatical claim from GRAMMAR.md, each
 * with a one-line input. This file was committed as an `it.todo` plan before
 * the implementation existed; the claims are the reviewed spec.
 *
 * Claims marked (jomini) were mined from the jomini crate's test suite and
 * the pdx.tools syntax-tour post — battle-tested corners from shipped game
 * files, adapted for this API (jomini is MIT; inputs are quirk-shaped, not
 * copied text). Claims marked (corpus) were forced by the vanilla sweep:
 * constructs the plan missed until reality produced them.
 *
 * Property tests (corpus fixpoint, the jomini differential, fast-check
 * properties) live in their own files; this one is the TDD driver loop, and
 * every claim here should stay a one-liner.
 */

import { describe, expect, it } from "vitest";

import {
  block,
  container,
  inlineMath,
  isBareToken,
  kv,
  list,
  numberValue,
  numeral,
  parse,
  PdxSyntaxError,
  quoted,
  regionItems,
  scalar,
  scalarText,
  serialize,
  tryNumberValue,
  varRef,
  withoutLines,
  type PdxDocument,
  type PdxEntry,
  type PdxValue,
} from "../src/index.ts";
import { tokenize } from "../src/lexer.ts";

function clean(source: string): PdxDocument {
  const document = parse(source, "claims.txt");
  expect(document.diagnostics).toEqual([]);
  return document;
}

function entryAt(document: PdxDocument, index: number): PdxEntry {
  const item = document.items[index]!;
  if (item.kind !== "entry") {
    throw new Error(`Expected an entry at ${index}, got ${item.kind}`);
  }
  return item;
}

/** Item keys, with null standing in for bare (non-entry) items. */
function keys(document: PdxDocument): (string | null)[] {
  return document.items.map((item) => (item.kind === "entry" ? item.key : null));
}

function first(source: string): PdxEntry {
  return entryAt(clean(source), 0);
}

function value(source: string): PdxValue {
  return first(source).value;
}

/** Round trip: parse, serialize, return the text. */
function emitted(source: string): string {
  return serialize(parse(source, "claims.txt").items);
}

/** Semantic fixpoint: the re-parse of the emission equals the original tree. */
function expectFixpoint(source: string): void {
  const original = parse(source, "claims.txt");
  const reparsed = parse(serialize(original.items), "claims.txt");
  expect(withoutLines(reparsed.items)).toEqual(withoutLines(original.items));
}

describe("lexer", () => {
  it("strips a leading UTF-8 BOM", () => {
    expect(first("﻿a = 1").key).toBe("a");
  });

  /**
   * A mark states the encoding of a *file*, so it is read as one only where
   * a file begins (SDK-318). A region body is a fragment the engine splices
   * mid-file, where the same character is ordinary text.
   */
  it("keeps a U+FEFF that opens a region body, where it is text rather than a mark", () => {
    const region = clean("[[X]\uFEFFa = 1 ]").items[0]!;
    if (region.kind !== "param") {
      throw new Error(`Expected a param region, got ${region.kind}`);
    }
    expect(region.items[0]).toMatchObject({ kind: "entry", key: "\uFEFFa" });
  });

  it("keeps a U+FEFF opening the body of a region with no tree", () => {
    const region = clean("[[X]\uFEFFa = {\n]").items[0]!;
    if (region.kind !== "param-text") {
      throw new Error(`Expected a text region, got ${region.kind}`);
    }
    expect(region.text.startsWith("\uFEFF")).toBe(true);
    expect(regionItems(region)[0]).toEqual({ kind: "str", value: "\uFEFFa", quoted: false });
  });

  it("keeps a U+FEFF that is not the first character of the file as ordinary text", () => {
    expect(first("a = \uFEFFfoo").value).toEqual({
      kind: "str",
      value: "\uFEFFfoo",
      quoted: false,
    });
    expectFixpoint("a = 1\n\uFEFFb = 2");
  });

  it("drops # comments to end of line, including inline after a value", () => {
    expect(keys(clean("a = 1 # trailing\n# whole line\nb = 2"))).toEqual(["a", "b"]);
  });

  it("drops a comment adjacent to a token without whitespace: foo=abc#def (jomini)", () => {
    const document = clean("foo=abc#def\nbar=qux");
    expect(entryAt(document, 0).value).toEqual({ kind: "str", value: "abc", quoted: false });
    expect(entryAt(document, 1).key).toBe("bar");
  });

  it("drops a comment that ends the file with no trailing newline (jomini)", () => {
    expect(clean("foo = a\n# bee").items).toHaveLength(1);
  });

  it("lexes a BOM followed by only a comment as an empty document (jomini)", () => {
    expect(clean("﻿#hello").items).toEqual([]);
  });

  it("treats semicolons as trivia: a = 1;; b = 2; (jomini — vanilla gfx files)", () => {
    const document = clean("a = 1;; b = 2;");
    expect(document.items.map((item) => (item.kind === "entry" ? item.value : null))).toEqual([
      { kind: "num", lexeme: "1" },
      { kind: "num", lexeme: "2" },
    ]);
  });

  it("lexes CRLF sources identically to LF", () => {
    const lf = clean("a = 1\nb = {\n\tc = 2\n}\n");
    const crlf = clean("a = 1\r\nb = {\r\n\tc = 2\r\n}\r\n");
    expect(withoutLines(crlf.items)).toEqual(withoutLines(lf.items));
  });

  it('captures quoted strings raw, honoring \\" only for termination (jomini)', () => {
    expect(value('name = "Joe \\"Captain\\" Rogers"')).toEqual({
      kind: "str",
      value: 'Joe \\"Captain\\" Rogers',
      quoted: true,
    });
  });

  it("allows newlines and arbitrary bytes inside quoted strings (jomini)", () => {
    expect(value('a = "line one\nline\ttwo"')).toEqual({
      kind: "str",
      value: "line one\nline\ttwo",
      quoted: true,
    });
  });

  it("throws on an unterminated quoted string, with file:line", () => {
    expect(() => parse('a = "oops', "claims.txt")).toThrow(PdxSyntaxError);
    expect(() => parse('\n\na = "oops', "claims.txt")).toThrow(/claims\.txt:3/);
  });

  it("lexes each operator as one token: = < > <= >= !=", () => {
    for (const op of ["=", "<", ">", "<=", ">=", "!="] as const) {
      expect(first(`k ${op} 2`).op).toBe(op);
    }
  });

  it("rejects unsupported ?= without rejecting question marks inside keys", () => {
    for (const source of ["owner ?= { x = 1 }", "owner?={ x = 1 }"]) {
      expect(() => parse(source, "operators.txt")).toThrow(
        new PdxSyntaxError("Unsupported operator '?='", "operators.txt", 1)
      );
    }
    expect(keys(clean("$PLAYER_COUNTRY$? = { x = 1 }"))).toEqual(["$PLAYER_COUNTRY$?"]);
  });

  it("lexes @name as one token", () => {
    expect(value("a = @tier3cost1")).toEqual({ kind: "var", name: "@tier3cost1" });
  });

  it("lexes @[ ... ] as one verbatim token, spaces included", () => {
    expect(value("pos = @[ 1 - leopard_x ]")).toEqual({
      kind: "math",
      source: "@[ 1 - leopard_x ]",
    });
  });

  it("throws on unterminated @[ inline math, with file:line", () => {
    expect(() => parse("a = @[ 1 -", "claims.txt")).toThrow(/claims\.txt:1/);
  });

  it("lexes escaped inline math @\\[ ... ] as one verbatim token (corpus — scripted_effects)", () => {
    expect(value("v = @\\[( 72 * $PROGRESS$ )]")).toEqual({
      kind: "math",
      source: "@\\[( 72 * $PROGRESS$ )]",
    });
  });

  it("splits braces adjacent to tokens: a={b}", () => {
    expect(value("a={b}")).toEqual({
      kind: "container",
      items: [{ kind: "str", value: "b", quoted: false }],
    });
  });

  it('starts a token immediately after a closing quote: "foo"="bar"3="x" (jomini)', () => {
    const document = clean('"foo"="bar"3="1444.11.11"');
    expect(keys(document)).toEqual(["foo", "3"]);
    expect(entryAt(document, 1).value).toEqual({
      kind: "str",
      value: "1444.11.11",
      quoted: true,
    });
  });

  it("keeps | : . - $ inside unquoted tokens: value:x|JOB|y| scope:a.b (jomini — Stellaris script values)", () => {
    expect(value("mult = value:job_weights_research_modifier|JOB|head_researcher|")).toEqual({
      kind: "str",
      value: "value:job_weights_research_modifier|JOB|head_researcher|",
      quoted: false,
    });
    expect(value("t = scope:attacker.primary_title.tier")).toEqual({
      kind: "str",
      value: "scope:attacker.primary_title.tier",
      quoted: false,
    });
    expect(first("dashed-identifier = yes").key).toBe("dashed-identifier");
  });

  it("keeps non-ASCII bytes inside unquoted tokens (jomini)", () => {
    expect(first("jean_jaurès = bar").key).toBe("jean_jaurès");
  });

  /**
   * The two ends of one question, checked against each other rather than
   * against a list: `isBareToken` says whether text is a single token, and
   * the lexer decides it again while scanning. They read one terminator
   * table (SDK-319), and this is what would fail if a second one appeared —
   * for every character, not for the handful anyone thought to enumerate.
   */
  it("ends a bare token at exactly the characters representability refuses", () => {
    const sweep = [
      ...Array.from({ length: 0x80 }, (_, code) => String.fromCharCode(code)),
      "è",
      "中",
      "𝕏",
      "\uFEFF",
    ];
    for (const char of sweep) {
      const text = `a${char}b`;
      let lexesAsOneToken: boolean;
      try {
        const tokens = tokenize(text, "terminators.txt");
        const [token, ...rest] = tokens;
        lexesAsOneToken =
          rest.length === 1 && token?.kind === "identifier" && !token.quoted && token.text === text;
      } catch (error) {
        expect(error).toBeInstanceOf(PdxSyntaxError);
        lexesAsOneToken = false;
      }
      expect(isBareToken(text), JSON.stringify(char)).toBe(lexesAsOneToken);
    }
  });
});

describe("parser: top level", () => {
  it("parses a file as a sequence of items, order preserved", () => {
    expect(keys(clean("b = 1\n\na = 2"))).toEqual(["b", "a"]);
  });

  it("parses a top-level bare scalar list (corpus — vanilla job_tags)", () => {
    expect(clean("food\nminerals\nenergy").items).toEqual([
      { kind: "str", value: "food", quoted: false },
      { kind: "str", value: "minerals", quoted: false },
      { kind: "str", value: "energy", quoted: false },
    ]);
  });

  it("parses a top-level anonymous container (corpus — vanilla gamesetup_settings)", () => {
    const document = clean("{\tcategories = { x }\n}");
    expect(document.items).toHaveLength(1);
    expect(document.items[0]!.kind).toBe("container");
  });

  it("preserves duplicate keys in order", () => {
    const document = clean("m = 1\nm = 2\nm = 3");
    expect(document.items.map((item) => (item.kind === "entry" ? item.value : null))).toEqual([
      { kind: "num", lexeme: "1" },
      { kind: "num", lexeme: "2" },
      { kind: "num", lexeme: "3" },
    ]);
  });

  it("preserves comparison operators on entries", () => {
    const limit = value("limit = { has_level >= 2 count < 5 }");
    expect(limit.kind).toBe("container");
    if (limit.kind === "container") {
      expect(limit.items.map((item) => (item.kind === "entry" ? item.op : null))).toEqual([
        ">=",
        "<",
      ]);
    }
  });

  it("accepts @name keys (variable definitions)", () => {
    const entry = first("@tier3cost1 = 4000");
    expect(entry.key).toBe("@tier3cost1");
    expect(entry.value).toEqual({ kind: "num", lexeme: "4000" });
  });

  it("accepts quoted keys as their text (deferral documented) (jomini)", () => {
    expect(first('"key" = 1').key).toBe("key");
  });

  it("records the 1-based source line on every entry", () => {
    const document = clean("a = 1\nb = {\n\tc = 2\n}");
    expect(entryAt(document, 0).line).toBe(1);
    expect(entryAt(document, 1).line).toBe(2);
    const body = entryAt(document, 1).value;
    if (body.kind === "container" && body.items[0]!.kind === "entry") {
      expect(body.items[0]!.line).toBe(3);
    } else {
      expect.unreachable();
    }
  });

  it("throws when an operator has no value, with file:line", () => {
    expect(() => parse("a =", "claims.txt")).toThrow(/claims\.txt:1/);
    expect(() => parse("b = { a = }", "claims.txt")).toThrow(PdxSyntaxError);
  });

  it("throws when nesting exceeds the depth guard instead of overflowing the stack (jomini)", () => {
    expect(() => parse("a = " + "{".repeat(5000), "claims.txt")).toThrow(/Nesting exceeds/);
  });
});

describe("parser: scalars", () => {
  it("classifies yes/no as bool", () => {
    expect(value("a = yes")).toEqual({ kind: "bool", value: true });
    expect(value("a = no")).toEqual({ kind: "bool", value: false });
  });

  it('keeps quoted "yes" a string', () => {
    expect(value('a = "yes"')).toEqual({ kind: "str", value: "yes", quoted: true });
  });

  it("classifies integers, decimals, negatives, and leading-dot as num", () => {
    expect(value("a = 3")).toEqual({ kind: "num", lexeme: "3" });
    expect(value("a = 0.25")).toEqual({ kind: "num", lexeme: "0.25" });
    expect(value("a = -1.5")).toEqual({ kind: "num", lexeme: "-1.5" });
    expect(value("a = .5")).toEqual({ kind: "num", lexeme: "0.5" });
  });

  it("classifies plus-signed numbers as num: +0.10 (jomini — Stellaris)", () => {
    expect(value("pop_happiness = +0.10")).toEqual({ kind: "num", lexeme: "0.1" });
  });

  it("normalizes -0 to 0 (corpus — vanilla writes it; String(-0) would break the fixpoint)", () => {
    expect(value("min = -0")).toEqual({ kind: "num", lexeme: "0" });
  });

  it("keeps every digit of a numeral no double holds (SDK-150)", () => {
    expect(value("x = 9007199254740993")).toEqual({ kind: "num", lexeme: "9007199254740993" });
    expectFixpoint("x = 9007199254740993");
    expect(emitted("x = 1000000000000000000000")).toBe("x = 1000000000000000000000\n");
    expect(emitted("x = 0.0000001")).toBe("x = 0.0000001\n");
    expect(emitted(`x = 1${"0".repeat(400)}`)).toBe(`x = 1${"0".repeat(400)}\n`);
    // And one written by hand, for a value no JS literal could carry either.
    expect(serialize([kv("x", numeral("9007199254740993"))])).toBe("x = 9007199254740993\n");
    expect(() => numeral("1e21")).toThrow(/Cannot represent/);
  });

  it("offers the JS reading of a numeral only when it is the same number", () => {
    expect(numberValue("0.1")).toBe(0.1);
    expect(tryNumberValue("9007199254740993")).toBeNull();
    expect(() => numberValue("9007199254740993")).toThrow(/no double has that value/);
  });

  it("compares an integer as an integer, not as a formatted spelling", () => {
    // `String(1000000000000000128)` is "1000000000000000100": past 2^53 the
    // shortest spelling that reparses is not the value the double holds.
    expect(tryNumberValue("1000000000000000128")).toBe(1000000000000000128);
    expect(tryNumberValue("1000000000000000100")).toBeNull();
    expect(scalarText(scalar(1000000000000000128))).toBe("1000000000000000128");
  });

  it("classifies date-like tokens (2200.01.01) as str", () => {
    expect(value("a = 2200.01.01")).toEqual({ kind: "str", value: "2200.01.01", quoted: false });
  });

  it("classifies @name values as var", () => {
    expect(value("cost = @t3cost")).toEqual({ kind: "var", name: "@t3cost" });
  });

  it("classifies everything else as str", () => {
    expect(value("a = tech_lasers")).toEqual({ kind: "str", value: "tech_lasers", quoted: false });
  });
});

describe("parser: containers", () => {
  it("parses all-scalar braces as a container of scalar items", () => {
    expect(value("category = { biology industry }")).toEqual({
      kind: "container",
      items: [
        { kind: "str", value: "biology", quoted: false },
        { kind: "str", value: "industry", quoted: false },
      ],
    });
  });

  it("parses all-entry braces as a container of entry items", () => {
    const parsed = value("a = { b = 1 c = 2 }");
    expect(parsed.kind).toBe("container");
    if (parsed.kind === "container") {
      expect(parsed.items.map((item) => item.kind)).toEqual(["entry", "entry"]);
    }
  });

  it("parses mixed bare-and-entry braces, item order preserved (OR-prerequisites)", () => {
    const parsed = value("prerequisites = { tech_stingers OR = { tech_a tech_b } }");
    expect(parsed.kind).toBe("container");
    if (parsed.kind === "container") {
      expect(parsed.items[0]).toEqual({ kind: "str", value: "tech_stingers", quoted: false });
      expect(parsed.items[1]!.kind).toBe("entry");
    }
  });

  it('parses a quoted bare item in a mixed container: url "" (jomini — Stellaris DLC metadata)', () => {
    const parsed = value('dlc = { name = "x" paradoxplaza_store_url "" show = no }');
    expect(parsed.kind).toBe("container");
    if (parsed.kind === "container") {
      expect(parsed.items.map((item) => item.kind)).toEqual(["entry", "str", "str", "entry"]);
      expect(parsed.items[2]).toEqual({ kind: "str", value: "", quoted: true });
    }
  });

  it("parses empty braces as an empty container", () => {
    expect(value("a = {}")).toEqual({ kind: "container", items: [] });
  });

  it("preserves empty anonymous containers as items (documented jomini divergence)", () => {
    expect(value("h = { {} {} }")).toEqual({
      kind: "container",
      items: [
        { kind: "container", items: [] },
        { kind: "container", items: [] },
      ],
    });
  });

  it("parses nested containers to arbitrary depth (within the guard)", () => {
    const document = clean("a = { b = { c = { d = 1 } } }");
    expect(serialize(document.items)).toBe(
      "a = {\n\tb = {\n\t\tc = {\n\t\t\td = 1\n\t\t}\n\t}\n}\n"
    );
  });

  it("parses bare container items: { { 0 1 } { 2 3 } }", () => {
    expect(value("p = { { 0 1 } { 2 3 } }")).toEqual({
      kind: "container",
      items: [
        {
          kind: "container",
          items: [
            { kind: "num", lexeme: "0" },
            { kind: "num", lexeme: "1" },
          ],
        },
        {
          kind: "container",
          items: [
            { kind: "num", lexeme: "2" },
            { kind: "num", lexeme: "3" },
          ],
        },
      ],
    });
  });

  it("parses any scalar followed by { at value position as a header: hsv, rgb, hex, LIST (jomini)", () => {
    for (const [source, header] of [
      ["color = hsv { 0.63 0.13 0.5 }", "hsv"],
      ["color = hsv360{ 25 75 63 }", "hsv360"],
      ["color = hex { aabbccdd }", "hex"],
      ["mild_winter = LIST { 3700 3701 }", "LIST"],
    ] as const) {
      const parsed = value(source);
      expect(parsed.kind).toBe("container");
      if (parsed.kind === "container") {
        expect(parsed.header).toBe(header);
      }
    }
  });

  it("parses a 4-component rgb header container (jomini)", () => {
    const parsed = value("color = rgb { 100 200 150 10 }");
    expect(parsed.kind === "container" && parsed.items).toHaveLength(4);
  });

  it("parses name = rgb followed by another key as the plain scalar rgb (jomini)", () => {
    const document = clean("name = rgb\ntype = 4713");
    expect(entryAt(document, 0).value).toEqual({ kind: "str", value: "rgb", quoted: false });
    expect(entryAt(document, 1).key).toBe("type");
  });

  it("keeps scalar-then-container at item position as two bare items", () => {
    const parsed = value("m = { foo\n{ 1 2 } }");
    expect(parsed.kind).toBe("container");
    if (parsed.kind === "container") {
      expect(parsed.items.map((item) => item.kind)).toEqual(["str", "container"]);
    }
  });
});

describe("parser: parameter blocks (corpus — Stellaris scripted_effects)", () => {
  it("parses [[NAME] ... ] and [[!NAME] ... ] as param items", () => {
    const parsed = value("e = { [[POP_GROUP] $POP_GROUP$ = { x = 1 } ] [[!POP_GROUP] y = 2 ] }");
    expect(parsed.kind).toBe("container");
    if (parsed.kind === "container") {
      expect(parsed.items.map((item) => item.kind)).toEqual(["param", "param"]);
      const positive = parsed.items[0]!;
      const negative = parsed.items[1]!;
      if (positive.kind === "param" && negative.kind === "param") {
        expect(positive.name).toBe("POP_GROUP");
        expect(positive.negated).toBe(false);
        expect(positive.items[0]!.kind).toBe("entry");
        expect(negative.name).toBe("POP_GROUP");
        expect(negative.negated).toBe(true);
      } else {
        expect.unreachable();
      }
    }
  });

  it("keeps $NAME$ substitution tokens as ordinary scalars", () => {
    const parsed = value("e = { [[X] $X$ = yes ] }");
    if (parsed.kind === "container" && parsed.items[0]!.kind === "param") {
      const inner = parsed.items[0]!.items[0]!;
      expect(inner.kind === "entry" && inner.key).toBe("$X$");
    } else {
      expect.unreachable();
    }
  });

  it("serializes param blocks multiline with the closing bracket at parent indent", () => {
    expect(emitted("e = { [[X] a = 1 ] }")).toBe("e = {\n\t[[X]\n\t\ta = 1\n\t]\n}\n");
  });

  it("rejects a parameter name the serializer could not write back", () => {
    expect(() => parse("e = { [[two words] a = 1 ] }", "claims.txt")).toThrow(
      /Invalid parameter name/
    );
  });

  it("throws on an unterminated parameter block, with file:line", () => {
    expect(() => parse("e = { [[X] a = 1", "claims.txt")).toThrow(/parameter block/);
    expect(() => parse("e = { [[X", "claims.txt")).toThrow(/claims\.txt:1/);
  });

  it("does not end a region at a `]` inside a quote, a comment, or inline math", () => {
    for (const body of ['"a]b"', "# a]b\n", "@[ x ]"]) {
      const parsed = value(`e = { [[X] k = ${body} ] }`);
      expect(parsed.kind === "container" && parsed.items).toHaveLength(1);
    }
  });

  it("nests regions: an inner opener's own `]` does not close the outer one", () => {
    const parsed = value("e = { [[X] [[Y] a = 1 ] b = 2 ] }");
    if (parsed.kind === "container" && parsed.items[0]!.kind === "param") {
      expect(parsed.items[0]!.items.map((item) => item.kind)).toEqual(["param", "entry"]);
    } else {
      expect.unreachable();
    }
  });

  it("numbers lines inside a region from the file, not from the region", () => {
    const document = clean("a = 1\ne = {\n\t[[X]\n\t\tb = 2\n\t]\n}");
    const region = (document.items[1] as PdxEntry).value;
    if (region.kind === "container" && region.items[0]!.kind === "param") {
      expect((region.items[0]!.items[0] as PdxEntry).line).toBe(4);
    } else {
      expect.unreachable();
    }
  });
});

/**
 * The construct is a preprocessor-level conditional *text* region: brace
 * balance need only hold after substitution, so a region whose body is not a
 * balanced item sequence has no tree and is kept as source. Gigastructural
 * Engineering ships this — a `{` opened in one region, closed in another —
 * and the game reads it.
 */
describe("parser: conditional text regions (corpus — Gigastructural Engineering)", () => {
  const BRACE_CROSSING =
    "e = {\n\t[[N]\n\t\tset_name = {\n\t\t\tkey = $N$\n\t\t]\n\t\t[[N]\n\t\t}\n\t]\n}";

  it("keeps a brace-crossing region as text instead of rejecting the file", () => {
    const parsed = value(BRACE_CROSSING);
    if (parsed.kind !== "container") {
      expect.unreachable();
      return;
    }
    expect(parsed.items.map((item) => item.kind)).toEqual(["param-text", "param-text"]);
    const open = parsed.items[0]!;
    const close = parsed.items[1]!;
    if (open.kind === "param-text" && close.kind === "param-text") {
      expect(open.name).toBe("N");
      expect(open.text).toContain("set_name = {");
      expect(close.text.trim()).toBe("}");
    } else {
      expect.unreachable();
    }
  });

  it("re-emits a region with no tree verbatim, and re-reads it identically", () => {
    expectFixpoint(BRACE_CROSSING);
    const once = emitted(BRACE_CROSSING);
    expect(serialize(parse(once, "claims.txt").items)).toBe(once);
  });

  it("keeps a body that only reads by repairing brace balance as text", () => {
    // `[[X] a = { ]` splices to a balanced `a = { ... }` only at the call
    // site; reading it here would need the unclosed-at-EOF repair.
    const parsed = value("e = { [[X] a = { ] }");
    expect(parsed.kind === "container" && parsed.items[0]!.kind).toBe("param-text");
  });

  it("reads a region with no tree flat, for consumers that need its names", () => {
    const parsed = value("e = { [[X] a = @dist { ] }");
    if (parsed.kind === "container" && parsed.items[0]!.kind === "param-text") {
      expect(regionItems(parsed.items[0]!)).toEqual([
        { kind: "str", value: "a", quoted: false },
        { kind: "var", name: "@dist" },
      ]);
    } else {
      expect.unreachable();
    }
  });

  it("reads that body through the lexer: comments are trivia, nested regions are regions", () => {
    const parsed = value("e = { [[X] a # @not_a_ref\n[[Y] b ] { ] }");
    if (parsed.kind === "container" && parsed.items[0]!.kind === "param-text") {
      expect(regionItems(parsed.items[0]!)).toEqual([
        { kind: "str", value: "a", quoted: false },
        { kind: "param-text", name: "Y", negated: false, text: " b " },
      ]);
    } else {
      expect.unreachable();
    }
  });

  it("still refuses absurd region nesting rather than falling back to text", () => {
    const nested = `${"[[X] ".repeat(1200)}a${" ]".repeat(1200)}`;
    expect(() => parse(nested, "claims.txt")).toThrow(/Nesting exceeds/);
  });
});

describe("parser: repair diagnostics", () => {
  it("skips a stray closing brace and records a diagnostic (jomini — EU4 verona.txt)", () => {
    const document = parse('color = { 121 163 114 } } army_names = { "Armata" }', "verona.txt");
    expect(keys(document)).toEqual(["color", "army_names"]);
    expect(document.diagnostics).toEqual([
      { kind: "stray-closing-brace", fileName: "verona.txt", line: 1, text: "}" },
    ]);
  });

  it("auto-closes unterminated containers at EOF with a diagnostic naming the opening line (jomini — HOI4)", () => {
    const document = parse("names = {\n\tordered = { 1 = { x = 1 } }", "division.txt");
    expect(document.items).toHaveLength(1);
    expect(document.diagnostics).toEqual([
      { kind: "unclosed-at-eof", fileName: "division.txt", line: 1, text: "{" },
    ]);
  });

  it("reads a top-level operator-less foo{...} as foo = {...} with a diagnostic (jomini)", () => {
    const document = parse("foo{bar=qux}", "old.txt");
    expect(withoutLines(document.items)).toEqual(
      withoutLines(parse("foo = { bar = qux }", "old.txt").items)
    );
    expect(document.diagnostics).toEqual([
      { kind: "operator-less-entry", fileName: "old.txt", line: 1, text: "foo" },
    ]);
  });

  it("repairs a nested operator-less entry with the same diagnostic (corpus)", () => {
    const document = parse("icons = { spriteType { name = GFX_checkmark_icon } }", "icons.gfx");
    expect(withoutLines(document.items)).toEqual(
      withoutLines(
        parse("icons = { spriteType = { name = GFX_checkmark_icon } }", "icons.gfx").items
      )
    );
    expect(document.diagnostics).toEqual([
      { kind: "operator-less-entry", fileName: "icons.gfx", line: 1, text: "spriteType" },
    ]);
    expectFixpoint("icons = { spriteType { name = GFX_checkmark_icon } }");
  });

  it("returns no diagnostics for well-formed input", () => {
    expect(parse("a = { b = 1 }", "ok.txt").diagnostics).toEqual([]);
  });
});

describe("serializer", () => {
  it("exports the canonical scalar spelling", () => {
    expect(scalarText(quoted("hello galaxy"))).toBe('"hello galaxy"');
    expect(scalarText(varRef("@cost"))).toBe("@cost");
  });
  it("renders an all-scalar container inline: { a b c }", () => {
    expect(serialize([list("category", [scalar("biology")])])).toBe("category = { biology }\n");
  });

  it("renders an entry container one per line, tab-indented", () => {
    expect(serialize([block("a", [kv("b", 1), kv("c", 2)])])).toBe("a = {\n\tb = 1\n\tc = 2\n}\n");
  });

  it("renders a mixed container multiline, bare items on their own lines", () => {
    expect(emitted("p = { tech_a OR = { x y } }")).toBe("p = {\n\ttech_a\n\tOR = { x y }\n}\n");
  });

  it("renders an empty container as {}", () => {
    expect(serialize([kv("a", container([]))])).toBe("a = {}\n");
  });

  it("separates top-level items with a blank line and ends with a newline", () => {
    expect(serialize([kv("a", 1), kv("b", 2)])).toBe("a = 1\n\nb = 2\n");
  });

  it("renders bools as yes/no", () => {
    expect(serialize([kv("a", true), kv("b", false)])).toBe("a = yes\n\nb = no\n");
  });

  it("writes out a number with no exponent spelling: 1e21, 1e-7", () => {
    expect(serialize([kv("a", 1e21)])).toBe("a = 1000000000000000000000\n");
    expect(serialize([kv("a", 1e-7)])).toBe("a = 0.0000001\n");
  });

  it("refuses a number no spelling can carry, at construction", () => {
    expect(() => scalar(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => scalar(Number.NaN)).toThrow(/finite/);
  });

  it("refuses a hand-assembled lexeme that is not a canonical numeral", () => {
    for (const lexeme of ["1 # injected", "+01.0", "1e21", ""]) {
      expect(() => serialize([kv("a", { kind: "num", lexeme })])).toThrow(/canonical numeral/);
    }
  });

  it("keeps explicit quoting; quotes strings that are not bare-safe", () => {
    expect(serialize([kv("a", quoted("biology"))])).toBe('a = "biology"\n');
    expect(serialize([kv("a", scalar("two words"))])).toBe('a = "two words"\n');
  });

  it("renders bare strings unquoted, including / paths and |: script values", () => {
    expect(serialize([kv("script", scalar("technologies/rare"))])).toBe(
      "script = technologies/rare\n"
    );
    expect(serialize([kv("mult", scalar("value:x|JOB|y|"))])).toBe("mult = value:x|JOB|y|\n");
  });

  it('quotes a str that would re-lex as another kind: "yes", "123", "@x", "+5"', () => {
    expect(serialize([kv("a", scalar("yes"))])).toBe('a = "yes"\n');
    expect(serialize([kv("a", scalar("123"))])).toBe('a = "123"\n');
    expect(serialize([kv("a", scalar("@x"))])).toBe('a = "@x"\n');
    expect(serialize([kv("a", scalar("+5"))])).toBe('a = "+5"\n');
  });

  it("re-emits escaped-quote content verbatim (raw round-trip) (jomini)", () => {
    const source = 'n = "a \\"b\\" c"\n';
    expect(emitted(source)).toBe(source);
  });

  it("refuses a string whose raw content would terminate its own quotes", () => {
    expect(() => scalar('say "hi"')).toThrow(/Cannot represent/);
    expect(() => quoted("trailing backslash \\")).toThrow(/Cannot represent/);
    expect(() => serialize([kv("a", { kind: "str", value: '"', quoted: true })])).toThrow(
      /read back as itself/
    );
  });

  it("renders var scalars as the bare @name", () => {
    expect(serialize([kv("cost", varRef("@t3cost"))])).toBe("cost = @t3cost\n");
  });

  it("renders math scalars verbatim", () => {
    expect(serialize([kv("pos", inlineMath("@[ 1 - x ]"))])).toBe("pos = @[ 1 - x ]\n");
  });

  it("refuses inline math that would read back as something else", () => {
    expect(() => inlineMath("hello")).toThrow(/Cannot represent/);
    expect(() => inlineMath("@[ a ] b")).toThrow(/Cannot represent/);
    expect(() => varRef("no_at_sign")).toThrow(/Cannot represent/);
  });

  it("counts the lines a multi-line inline math token spans", () => {
    expect(entryAt(clean("a = @[\n x\n]\nb = 1"), 1).line).toBe(4);
  });

  it("renders header containers as header { ... }", () => {
    expect(emitted("color = hsv { 0.63 0.13 0.5 }")).toBe("color = hsv { 0.63 0.13 0.5 }\n");
  });

  it("quotes a key that cannot be written bare, instead of refusing it", () => {
    expect(serialize([kv("two words", 1)])).toBe('"two words" = 1\n');
    expectFixpoint('"two words" = 1');
  });

  /**
   * The write side of the file boundary (SDK-318): `parse` reads a leading
   * U+FEFF as this document's encoding mark and removes it, so a document
   * that opened with one would come back a character short. Anywhere else
   * the character is ordinary and needs no guard.
   */
  it("refuses to emit a document that would open with a byte-order mark", () => {
    expect(() => serialize([scalar("﻿foo")])).toThrow(/byte-order mark/);
    expect(() => serialize([kv("a", 1), scalar("﻿foo")])).not.toThrow();
    expect(serialize([kv("a", 1), scalar("﻿foo")])).toBe("a = 1\n\n﻿foo\n");
  });

  /**
   * A quoted key keeps the mark through a parse, since the quotes shield it
   * from the strip — so this is a tree the parser can hand back, and refusing
   * to write it would leave accepted input with no round trip. Quoting is the
   * answer rather than a refusal: an entry records no `quoted` flag for its
   * key, so the tree is the same either way.
   */
  it("quotes a key holding a byte-order mark rather than refusing the document", () => {
    expect(serialize([kv("\uFEFFk", 1)])).toBe('"\uFEFFk" = 1\n');
    expectFixpoint('"\uFEFFkey" = 1');
    expect(emitted('"\uFEFFkey" = 1')).toBe('"\uFEFFkey" = 1\n');
    // Not the first item either: the rule is the key's, not the position's.
    expectFixpoint('a = 1\n"\uFEFFb" = 2');
  });
});

const NASTY_FIXTURE = `@tech_gene_forging_POINTS = 2

tech_gene_forging = {
	cost = @t3cost
	area = society
	category = { biology }
	prerequisites = {
		tech_stingers
		OR = {
			"tech_mauler_growth_1"
			"tech_weaver_growth_1"
		}
	}
	weight = @t3weight

	color = hsv { 0.63 0.13 0.5 }

	technology_swap = {
		name = tech_gene_forging_overtuned
		inherit_icon = yes
		trigger = {
			has_origin = origin_overtuned
		}
	}

	weight_modifier = {
		factor = 2.0	# needs to be a bit more common
		modifier = {
			factor = 1.25
			is_hive_empire = yes
		}
		modifier = {
			factor = @pp_boost
			has_ascension_perk = ap_engineered_evolution
		}
	}
}
`;

describe("round trip", () => {
  it("parse → serialize → parse yields an identical tree, lines ignored", () => {
    expectFixpoint("a = 1\nb = { c d }\ne = { f = 2 g { 1 2 } }");
  });

  it("serialize is byte-stable on its own output", () => {
    const once = emitted(NASTY_FIXTURE);
    expect(serialize(parse(once, "claims.txt").items)).toBe(once);
  });

  it("round-trips the nasty fixture: variables, swaps, six modifiers, OR-prerequisites", () => {
    expectFixpoint(NASTY_FIXTURE);
    expect(parse(NASTY_FIXTURE, "claims.txt").diagnostics).toEqual([]);
  });

  it("round-trips parameter blocks (corpus)", () => {
    expectFixpoint("e = { [[POP_GROUP] $POP_GROUP$ = { x = 1 } ] [[!POP_GROUP] y = 2 ] }");
  });

  it("round-trips repaired input in its repaired form (jomini)", () => {
    const repaired = parse("color = { 1 2 } } foo{bar=1}", "repair.txt");
    expect(repaired.diagnostics).toHaveLength(2);
    const reparsed = parse(serialize(repaired.items), "repair.txt");
    expect(reparsed.diagnostics).toEqual([]);
    expect(withoutLines(reparsed.items)).toEqual(withoutLines(repaired.items));
  });
});
