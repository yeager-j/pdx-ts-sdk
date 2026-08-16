/**
 * What the PDXScript grammar calls each token.
 *
 * Highlighting is presentation, so most of it does not deserve a gate. These
 * cases do, because each one is a decision that took measurement to get right
 * and would regress silently: nobody reviewing a diff notices that `1.5.2`
 * started colouring as a number, and the page would go on looking fine while
 * quietly teaching the wrong thing about the language.
 *
 * Scopes are asserted, not colours. A theme change is a taste change and
 * should not break a test; the grammar deciding that a version string is a
 * number is a correctness change and should.
 */

import { createHighlighter } from "shiki";
import { beforeAll, describe, expect, it } from "vitest";

import { GRAMMARS } from "../src/pdx-languages.ts";

/**
 * Shiki types `lang` as its own bundled-language union, which by construction
 * cannot name a grammar this repo just registered. The cast is at the one call
 * that needs it, and a wrong language name fails loudly at runtime rather than
 * quietly producing plain text — every assertion below would break at once.
 */
type Registered = "pdxscript" | "pdxloc";

let scopeOf: (code: string, lang: Registered) => Map<string, string>;

beforeAll(async () => {
  const highlighter = await createHighlighter({
    themes: ["catppuccin-latte"],
    langs: [GRAMMARS.pdxscript, GRAMMARS.pdxloc],
  });
  scopeOf = (code, lang) => {
    const { tokens } = highlighter.codeToTokens(code, {
      lang: lang as Parameters<typeof highlighter.codeToTokens>[1]["lang"],
      theme: "catppuccin-latte",
      includeExplanation: true,
    });
    // Walk the explanations, not the tokens. Shiki merges adjacent tokens that
    // resolve to the same colour, so token boundaries move when the theme
    // changes — which made an earlier version of this file fail on a theme
    // swap even though every scope was identical. The explanation entries are
    // the grammar's own matches and survive the merge.
    const found = new Map<string, string>();
    for (const line of tokens) {
      for (const token of line) {
        for (const part of token.explanation ?? []) {
          const text = part.content.trim();
          const scope = part.scopes.at(-1)?.scopeName;
          if (text !== "" && scope !== undefined && !found.has(text)) {
            found.set(text, scope);
          }
        }
      }
    }
    return found;
  };
});

/** The scope a given piece of text was given, as a short name. */
function scope(code: string, text: string, lang: Registered = "pdxscript"): string {
  return (scopeOf(code, lang).get(text) ?? "«not tokenized»").replace(/\.pdxscript$|\.pdxloc$/, "");
}

describe("keys are decided by position, not by shape", () => {
  it("colours whatever sits left of an operator", () => {
    expect(scope("category = negative", "category")).toBe("support.type.property-name");
  });

  it("includes keys that are not identifiers", () => {
    // An identifier-shaped rule drops all three of these, which leaves holes
    // at the starts of lines and reads as a broken highlighter.
    expect(scope("event_target:foo = yes", "event_target:foo")).toBe("support.type.property-name");
    expect(scope("owner.capital = yes", "owner.capital")).toBe("support.type.property-name");
    expect(scope('"quoted key" = yes', "quoted key")).toBe("support.type.property-name");
  });

  it("beats the boolean rule, so `yes = no` is a key and a value", () => {
    const line = "yes = no";
    expect(scope(line, "yes")).toBe("support.type.property-name");
    expect(scope(line, "no")).toBe("constant.language");
  });
});

describe("values", () => {
  it("colours unquoted values, which are most of a shipped file", () => {
    expect(scope("category = negative", "negative")).toBe("string.unquoted");
  });

  it("keeps quoted values a string, escapes included", () => {
    expect(scope('name = "Quiet Drift"', "Quiet Drift")).toBe("string.quoted.double");
    expect(scope('name = "a \\" b"', '\\"')).toBe("constant.character.escape");
  });

  it("marks system scopes", () => {
    expect(scope("scope = this.owner", "this")).toBe("variable.language");
  });

  it("splits a link prefix from what it resolves", () => {
    const line = "target = event_target:world";
    expect(scope(line, "event_target")).toBe("support.type");
    expect(scope(line, ":")).toBe("punctuation.separator");
  });
});

describe("numbers stop where the language stops them", () => {
  it("accepts a leading sign and a bare fraction", () => {
    expect(scope("weight = +0.5", "+0.5")).toBe("constant.numeric");
    expect(scope("weight = .5", ".5")).toBe("constant.numeric");
    expect(scope("base = 40", "40")).toBe("constant.numeric");
  });

  it("degrades a version string to a string rather than half-matching it", () => {
    // `1.5` is a number and `1.5.2` is not. Without the trailing-context rule
    // the leading `1.5` colours and `.2` is left bare, which looks like a bug
    // in the page rather than a fact about the language.
    expect(scope("version = 1.5.2", "1.5.2")).toBe("string.unquoted");
    expect(scope("size = 3.0k", "3.0k")).toBe("string.unquoted");
  });
});

describe("operators", () => {
  it("reads the two-character forms whole", () => {
    for (const operator of ["<=", ">=", "!=", "<>"]) {
      expect(scope(`count ${operator} 3`, operator), operator).toBe("keyword.operator");
    }
  });

  it("treats `==` as two operators rather than inventing a form", () => {
    // The language has no `==` — the lexer reads it as two `=` tokens. So the
    // grammar matches `=` twice and Shiki merges the pair into one span, which
    // is why a reader sees a fully coloured `==` regardless.
    expect(scope("count == 3", "=")).toBe("keyword.operator");
  });
});

describe("scripted variables and parameters", () => {
  it("tells a declaration from a reference", () => {
    expect(scope("@base = 10", "base")).toBe("entity.name.constant");
    expect(scope("x = @base", "base")).toBe("constant.other");
  });

  it("reads `$NAME|default$` as a parameter with an argument", () => {
    const line = "x = $SOME|fallback$";
    expect(scope(line, "SOME")).toBe("variable.parameter");
    expect(scope(line, "fallback")).toBe("string.unquoted.argument");
  });
});

describe("comments and colour literals", () => {
  it("takes a comment to end of line", () => {
    expect(scope("# a note", "# a note")).toBe("comment.line.number-sign");
  });

  it("marks the colour keyword and leaves its numbers alone", () => {
    const line = "colour = rgb { 255 0 0 }";
    expect(scope(line, "rgb")).toBe("support.function");
    expect(scope(line, "255")).toBe("constant.numeric");
  });
});

describe("localization is not YAML", () => {
  it("separates the generated key, the version, and the English text", () => {
    const line =
      'l_english:\n crystal_resonance_tech_resonance_theory:0 "Crystal Resonance Theory"';
    expect(scope(line, "crystal_resonance_tech_resonance_theory", "pdxloc")).toBe(
      "support.type.property-name"
    );
    expect(scope(line, ":0", "pdxloc")).toBe("keyword.operator");
    expect(scope(line, '"Crystal Resonance Theory"', "pdxloc")).toBe("string.quoted.double");
  });
});
