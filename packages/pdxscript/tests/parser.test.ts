/**
 * The per-claim suite: one `it` per grammatical claim from GRAMMAR.md, each
 * with a one-line input. This file was committed as an `it.todo` plan before
 * the implementation existed; the claims are the reviewed spec.
 *
 * Claims marked (jomini) were mined from the jomini crate's test suite and
 * the pdx.tools syntax-tour post — battle-tested corners from shipped game
 * files, adapted for this API (jomini is MIT; inputs are quirk-shaped, not
 * copied text).
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
  kv,
  list,
  parse,
  PdxSyntaxError,
  quoted,
  scalar,
  serialize,
  varRef,
  withoutLines,
  type PdxDocument,
  type PdxEntry,
  type PdxValue,
} from "../src/index.ts";

function clean(source: string): PdxDocument {
  const document = parse(source, "claims.txt");
  expect(document.diagnostics).toEqual([]);
  return document;
}

function first(source: string): PdxEntry {
  return clean(source).entries[0]!;
}

function value(source: string): PdxValue {
  return first(source).value;
}

/** Round trip: parse, serialize, return the text. */
function emitted(source: string): string {
  return serialize(parse(source, "claims.txt").entries);
}

/** Semantic fixpoint: the re-parse of the emission equals the original tree. */
function expectFixpoint(source: string): void {
  const original = parse(source, "claims.txt");
  const reparsed = parse(serialize(original.entries), "claims.txt");
  expect(withoutLines(reparsed.entries)).toEqual(withoutLines(original.entries));
}

describe("lexer", () => {
  it("strips a leading UTF-8 BOM", () => {
    expect(first("﻿a = 1").key).toBe("a");
  });

  it("drops # comments to end of line, including inline after a value", () => {
    const document = clean("a = 1 # trailing\n# whole line\nb = 2");
    expect(document.entries.map((entry) => entry.key)).toEqual(["a", "b"]);
  });

  it("drops a comment adjacent to a token without whitespace: foo=abc#def (jomini)", () => {
    const document = clean("foo=abc#def\nbar=qux");
    expect(document.entries[0]!.value).toEqual({ kind: "str", value: "abc", quoted: false });
    expect(document.entries[1]!.key).toBe("bar");
  });

  it("drops a comment that ends the file with no trailing newline (jomini)", () => {
    expect(clean("foo = a\n# bee").entries).toHaveLength(1);
  });

  it("lexes a BOM followed by only a comment as an empty document (jomini)", () => {
    expect(clean("﻿#hello").entries).toEqual([]);
  });

  it("treats semicolons as trivia: a = 1;; b = 2; (jomini — vanilla gfx files)", () => {
    const document = clean("a = 1;; b = 2;");
    expect(document.entries.map((entry) => entry.value)).toEqual([
      { kind: "num", value: 1 },
      { kind: "num", value: 2 },
    ]);
  });

  it("lexes CRLF sources identically to LF", () => {
    const lf = clean("a = 1\nb = {\n\tc = 2\n}\n");
    const crlf = clean("a = 1\r\nb = {\r\n\tc = 2\r\n}\r\n");
    expect(withoutLines(crlf.entries)).toEqual(withoutLines(lf.entries));
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
    expect(first('a = "x\ny"\nb = 2')).toBeDefined();
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

  it("splits braces adjacent to tokens: a={b}", () => {
    expect(value("a={b}")).toEqual({
      kind: "container",
      items: [{ kind: "str", value: "b", quoted: false }],
    });
  });

  it('starts a token immediately after a closing quote: "foo"="bar"3="x" (jomini)', () => {
    const document = clean('"foo"="bar"3="1444.11.11"');
    expect(document.entries.map((entry) => entry.key)).toEqual(["foo", "3"]);
    expect(document.entries[1]!.value).toEqual({ kind: "str", value: "1444.11.11", quoted: true });
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
});

describe("parser: entries", () => {
  it("parses a file as a sequence of entries, order preserved", () => {
    expect(clean("b = 1\n\na = 2").entries.map((entry) => entry.key)).toEqual(["b", "a"]);
  });

  it("preserves duplicate keys in order", () => {
    const document = clean("m = 1\nm = 2\nm = 3");
    expect(document.entries.map((entry) => entry.value)).toEqual([
      { kind: "num", value: 1 },
      { kind: "num", value: 2 },
      { kind: "num", value: 3 },
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
    expect(entry.value).toEqual({ kind: "num", value: 4000 });
  });

  it("accepts quoted keys as their text (deferral documented) (jomini)", () => {
    expect(first('"key" = 1').key).toBe("key");
  });

  it("records the 1-based source line on every entry", () => {
    const document = clean("a = 1\nb = {\n\tc = 2\n}");
    expect(document.entries[0]!.line).toBe(1);
    expect(document.entries[1]!.line).toBe(2);
    const body = document.entries[1]!.value;
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
    expect(value("a = 3")).toEqual({ kind: "num", value: 3 });
    expect(value("a = 0.25")).toEqual({ kind: "num", value: 0.25 });
    expect(value("a = -1.5")).toEqual({ kind: "num", value: -1.5 });
    expect(value("a = .5")).toEqual({ kind: "num", value: 0.5 });
  });

  it("classifies plus-signed numbers as num: +0.10 (jomini — Stellaris)", () => {
    expect(value("pop_happiness = +0.10")).toEqual({ kind: "num", value: 0.1 });
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
    const parsed = value("h = { {} {} }");
    expect(parsed).toEqual({
      kind: "container",
      items: [
        { kind: "container", items: [] },
        { kind: "container", items: [] },
      ],
    });
  });

  it("parses nested containers to arbitrary depth (within the guard)", () => {
    const document = clean("a = { b = { c = { d = 1 } } }");
    expect(serialize(document.entries)).toBe(
      "a = {\n\tb = {\n\t\tc = {\n\t\t\td = 1\n\t\t}\n\t}\n}\n"
    );
  });

  it("parses bare container items: { { 0 1 } { 2 3 } }", () => {
    const parsed = value("p = { { 0 1 } { 2 3 } }");
    expect(parsed).toEqual({
      kind: "container",
      items: [
        {
          kind: "container",
          items: [
            { kind: "num", value: 0 },
            { kind: "num", value: 1 },
          ],
        },
        {
          kind: "container",
          items: [
            { kind: "num", value: 2 },
            { kind: "num", value: 3 },
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
    expect(document.entries[0]!.value).toEqual({ kind: "str", value: "rgb", quoted: false });
    expect(document.entries[1]!.key).toBe("type");
  });

  it("keeps scalar-then-container at item position as two bare items", () => {
    const parsed = value("m = { foo { 1 2 } }");
    expect(parsed.kind).toBe("container");
    if (parsed.kind === "container") {
      expect(parsed.items.map((item) => item.kind)).toEqual(["str", "container"]);
    }
  });
});

describe("parser: repair diagnostics", () => {
  it("skips a stray closing brace and records a diagnostic (jomini — EU4 verona.txt)", () => {
    const document = parse('color = { 121 163 114 } } army_names = { "Armata" }', "verona.txt");
    expect(document.entries.map((entry) => entry.key)).toEqual(["color", "army_names"]);
    expect(document.diagnostics).toEqual([
      { kind: "stray-closing-brace", fileName: "verona.txt", line: 1, text: "}" },
    ]);
  });

  it("auto-closes unterminated containers at EOF with a diagnostic naming the opening line (jomini — HOI4)", () => {
    const document = parse("names = {\n\tordered = { 1 = { x = 1 } }", "division.txt");
    expect(document.entries).toHaveLength(1);
    expect(document.diagnostics).toEqual([
      { kind: "unclosed-at-eof", fileName: "division.txt", line: 1, text: "{" },
    ]);
  });

  it("reads a top-level operator-less foo{...} as foo = {...} with a diagnostic (jomini)", () => {
    const document = parse("foo{bar=qux}", "old.txt");
    expect(withoutLines(document.entries)).toEqual(
      withoutLines(parse("foo = { bar = qux }", "old.txt").entries)
    );
    expect(document.diagnostics).toEqual([
      { kind: "operator-less-entry", fileName: "old.txt", line: 1, text: "foo" },
    ]);
  });

  it("returns no diagnostics for well-formed input", () => {
    expect(parse("a = { b = 1 }", "ok.txt").diagnostics).toEqual([]);
  });
});

describe("serializer", () => {
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

  it("separates top-level entries with a blank line and ends with a newline", () => {
    expect(serialize([kv("a", 1), kv("b", 2)])).toBe("a = 1\n\nb = 2\n");
  });

  it("renders bools as yes/no", () => {
    expect(serialize([kv("a", true), kv("b", false)])).toBe("a = yes\n\nb = no\n");
  });

  it("throws on exponent-notation numbers", () => {
    expect(() => serialize([kv("a", 1e21)])).toThrow(/exponent/);
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

  it("renders var scalars as the bare @name", () => {
    expect(serialize([kv("cost", varRef("@t3cost"))])).toBe("cost = @t3cost\n");
  });

  it("renders math scalars verbatim", () => {
    expect(serialize([kv("pos", inlineMath("@[ 1 - x ]"))])).toBe("pos = @[ 1 - x ]\n");
  });

  it("renders header containers as header { ... }", () => {
    expect(emitted("color = hsv { 0.63 0.13 0.5 }")).toBe("color = hsv { 0.63 0.13 0.5 }\n");
  });

  it("throws on a key that would need quoting (deferred by name)", () => {
    expect(() => serialize([kv("two words", 1)])).toThrow(/key/);
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
    expect(serialize(parse(once, "claims.txt").entries)).toBe(once);
  });

  it("round-trips the nasty fixture: variables, swaps, six modifiers, OR-prerequisites", () => {
    expectFixpoint(NASTY_FIXTURE);
    expect(parse(NASTY_FIXTURE, "claims.txt").diagnostics).toEqual([]);
  });

  it("round-trips repaired input in its repaired form (jomini)", () => {
    const repaired = parse("color = { 1 2 } } foo{bar=1}", "repair.txt");
    expect(repaired.diagnostics).toHaveLength(2);
    const reparsed = parse(serialize(repaired.entries), "repair.txt");
    expect(reparsed.diagnostics).toEqual([]);
    expect(withoutLines(reparsed.entries)).toEqual(withoutLines(repaired.entries));
  });
});
