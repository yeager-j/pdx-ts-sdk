import type { LanguageRegistration } from "shiki";

/**
 * A PDXScript grammar, written from the token taxonomy the Paradox Language
 * Support IntelliJ plugin uses.
 *
 * Shiki has no Paradox grammar, and the PDXScript tab of a paired example is
 * where a reader who knows TypeScript and not Stellaris learns what their code
 * becomes. Leaving it flat grey blunts the most useful thing on the page.
 *
 * The categories below follow that plugin's lexer — its notion of what a key
 * is, which operators exist, how scripted variables and parameters work. Its
 * grammar is MIT and it ships a TextMate file of its own; this is written from
 * the taxonomy rather than copied from that file, because the taxonomy is a
 * description of the language and the file is somebody's work.
 *
 * Still a highlighter, not a parser. `packages/pdxscript` is the parser, it
 * round-trips the whole language, and duplicating its knowledge here would be
 * a second grammar to keep in step.
 *
 * Two constructs are deliberately absent rather than overlooked: conditional
 * blocks (`[[PARAM] … ]`) and inline math (`@[ … ]`). Neither appears in any
 * paired example's output, both need nested states, and an unexercised rule is
 * an unverified one.
 */
const PDXSCRIPT: LanguageRegistration = {
  name: "pdxscript",
  scopeName: "source.pdxscript",
  patterns: [{ include: "#expression" }],
  repository: {
    expression: {
      patterns: [
        { include: "#comment" },
        { include: "#parameter" },
        { include: "#scriptedVariable" },
        // Before every value rule. A key is decided by position — whatever
        // sits left of an operator — so `yes = no` has to colour its `yes` as
        // a key and only its `no` as a boolean.
        { include: "#key" },
        { include: "#operator" },
        { include: "#colorLiteral" },
        { include: "#boolean" },
        { include: "#number" },
        { include: "#quotedString" },
        { include: "#systemScope" },
        { include: "#prefixedValue" },
        { include: "#unquotedString" },
        { include: "#braces" },
      ],
    },

    comment: { match: "#.*$", name: "comment.line.number-sign.pdxscript" },

    /** `$NAME$` or `$NAME|default$`, which may appear inside a key or a value. */
    parameter: {
      match: "(\\$)([A-Za-z_][A-Za-z0-9_]*)(?:(\\|)([^#$=<>!?{}\\[\\]\\s]+))?(\\$)",
      captures: {
        1: { name: "punctuation.definition.template-expression.pdxscript" },
        2: { name: "variable.parameter.pdxscript" },
        3: { name: "punctuation.separator.pdxscript" },
        4: { name: "string.unquoted.argument.pdxscript" },
        5: { name: "punctuation.definition.template-expression.pdxscript" },
      },
    },

    /**
     * `@base = 10` declares one; `x = @base` references it. The two are told
     * apart the same way a key is: by whether an operator follows.
     */
    scriptedVariable: {
      patterns: [
        {
          match: "(@)([A-Za-z_][A-Za-z0-9_]*)(?=\\s*=)",
          captures: {
            1: { name: "punctuation.definition.constant.pdxscript" },
            2: { name: "entity.name.constant.pdxscript" },
          },
        },
        {
          match: "(@)([A-Za-z_][A-Za-z0-9_]*)",
          captures: {
            1: { name: "punctuation.definition.constant.pdxscript" },
            2: { name: "constant.other.pdxscript" },
          },
        },
      ],
    },

    /**
     * Anything left of an operator, quoted or not.
     *
     * The character class is negated rather than an identifier shape, because
     * PDXScript keys are not identifiers: `event_target:foo`, `owner.capital`
     * and `some_value|arg|` are all keys. An identifier-shaped rule leaves
     * holes at the starts of lines, which reads as a broken highlighter.
     */
    key: {
      patterns: [
        {
          match: '(")([^"\\r\\n]*)(")(?=\\s*[=<>!?])',
          captures: {
            1: { name: "punctuation.definition.string.pdxscript" },
            2: { name: "support.type.property-name.pdxscript" },
            3: { name: "punctuation.definition.string.pdxscript" },
          },
        },
        {
          match: '[^@#$=<>!?{}\\[\\]\\s"][^#$=<>!?{}\\[\\]\\s"]*(?=\\s*[=<>!?])',
          name: "support.type.property-name.pdxscript",
        },
      ],
    },

    /**
     * Every operator the language has, two-character forms first so `>=` does
     * not colour as `>` followed by a stray `=`.
     *
     * `<>` is Paradox's spelling of `!=`. `?=` is CK3/Vic3/EU5 and `? =` is
     * Stellaris 4.4. There is deliberately no `==`: the lexer reads that as
     * two separate `=` tokens, and inventing it here would be inventing
     * syntax.
     */
    operator: { match: "(<=|>=|!=|<>|\\?=|\\?\\s+=|=|<|>)", name: "keyword.operator.pdxscript" },

    /** `rgb`, `hsv`, `hsv360` — the keyword only; the numbers inside keep theirs. */
    colorLiteral: {
      match: "(?<![\\w.])(rgb|hsv|hsv360)(?=\\s*\\{)",
      name: "support.function.pdxscript",
    },

    boolean: { match: "(?<![\\w.$])(yes|no)(?![\\w.$])", name: "constant.language.pdxscript" },

    /**
     * A number must end at whitespace, a brace, or a comment.
     *
     * Without that lookahead `1.5.2` would colour its leading `1.5` and leave
     * `.2` bare, and `3.0k` would do the same. Those are version strings and
     * suffixed tokens, not numbers, and the language treats them as strings —
     * the trailing context is what lets them fall through to the string rule.
     */
    number: {
      match: "[+-]?(\\d+\\.\\d+|\\.\\d+|\\d+)(?=[\\s{}#]|$)",
      name: "constant.numeric.pdxscript",
    },

    quotedString: {
      begin: '"',
      end: '"',
      name: "string.quoted.double.pdxscript",
      beginCaptures: { 0: { name: "punctuation.definition.string.begin.pdxscript" } },
      endCaptures: { 0: { name: "punctuation.definition.string.end.pdxscript" } },
      patterns: [
        { match: "\\\\.", name: "constant.character.escape.pdxscript" },
        { include: "#parameter" },
      ],
    },

    systemScope: {
      match:
        "(?<![\\w.:$])(this|root|prev|prevprev|prevprevprev|from|fromfrom|fromfromfrom)(?![\\w:$])",
      name: "variable.language.pdxscript",
    },

    /**
     * `event_target:foo` and friends: the prefix names how to resolve the rest.
     *
     * A hard-coded list, because resolving these properly means reading the
     * CWT link table, which is a rule database rather than a grammar. These
     * seven are the ones Stellaris script actually writes.
     */
    prefixedValue: {
      match: "(?<![\\w.])(event_target|var|value|parameter|flag|modifier|trigger)(:)",
      captures: {
        1: { name: "support.type.pdxscript" },
        2: { name: "punctuation.separator.pdxscript" },
      },
    },

    /**
     * Unquoted values, which are most of a Stellaris file by volume.
     *
     * `$` is excluded so a `$PARAM$` inside a value is matched by its own rule
     * rather than swallowed into the surrounding text.
     */
    unquotedString: {
      match: '[^@#$=<>!?{}\\[\\]\\s"][^#$=<>!?{}\\[\\]\\s"]*',
      name: "string.unquoted.pdxscript",
    },

    braces: { match: "[{}]", name: "punctuation.section.braces.pdxscript" },
  },
};

/**
 * Stellaris localization, which is not YAML however much it looks like it.
 *
 * `crystal_resonance_tech_resonance_theory:0 "Crystal Resonance Theory"` has a
 * version number between the key and the value, and YAML's grammar cannot see
 * past it — it reads the whole line as one key and colours the English text
 * the same as the generated id. That is exactly the distinction the PDXScript
 * tab exists to show, since the lesson is that you write the text and the SDK
 * produces the key.
 */
const PDXLOC: LanguageRegistration = {
  name: "pdxloc",
  scopeName: "source.pdxloc",
  patterns: [
    { match: "#.*$", name: "comment.line.number-sign.pdxloc" },
    { match: '"[^"]*"', name: "string.quoted.double.pdxloc" },
    { match: "[\\w.@$-]+(?=:)", name: "support.type.property-name.pdxloc" },
    { match: ":\\d*", name: "keyword.operator.pdxloc" },
  ],
  repository: {},
};

/** Exported for `tests/highlighting.test.ts`, which pins their token scopes. */
export const GRAMMARS = { pdxscript: PDXSCRIPT, pdxloc: PDXLOC } as const;

/** Which grammar a rendered file gets, by extension. */
export function languageOf(path: string): string {
  if (path.endsWith(".yml")) {
    return "pdxloc";
  }
  return path.endsWith(".mod") || path.endsWith(".txt") ? "pdxscript" : "text";
}
