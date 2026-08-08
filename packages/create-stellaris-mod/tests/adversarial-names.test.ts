/**
 * Hostile names, and what the derivation and the renderer owe them.
 *
 * A generated file's name is the one input an author supplies freely, and it
 * reaches three places at once: a filename, a content id, and a TypeScript
 * binding. So every name in the corpus below has to do one of exactly two
 * things — be refused with a reason, or produce names that satisfy all three
 * contracts and source that compiles, builds, stays formatted, and shows no
 * injection.
 *
 * The corpus is a property harness rather than a set of goldens: what matters is
 * the contract each name meets, not the exact bytes it produces, and committing
 * a dozen near-identical goldens would obscure the one that is reviewed.
 */

import path from "node:path";
import { format, resolveConfig } from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FILE_STEM_PATTERN } from "../../sdk/src/authoring/feature.ts";
import { deriveNames, NameError, STEM_PATTERN } from "../src/catalog/names.ts";
import { technologyRecipe } from "../src/catalog/recipes/technology.ts";
import type { DerivedNames } from "../src/catalog/types.ts";
import { quoteTs } from "../src/quote.ts";
import { createGoldenProject, type GoldenProject } from "./helpers/golden-project.ts";

const COMPILER_TIMEOUT = 180_000;

/** The longest stem the derivation accepts, and one character more. */
const AT_LIMIT = "a".repeat(64);
const OVER_LIMIT = "a".repeat(65);

/** Names that must derive, with the stem each one has to produce. */
const ACCEPTED: readonly (readonly [string, string])[] = [
  ["Déjà Vu", "deja_vu"],
  ["Kessler's Syndrome", "kessler_s_syndrome"],
  ["class", "class"],
  ["await", "await"],
  ["new", "new"],
  ["3D Printing", "feature_3d_printing"],
  ["  padded  ", "padded"],
  ["Ω Particle", "particle"],
  ['Robert"); DROP TABLE', "robert_drop_table"],
  ['He said "it\'s fine"', "he_said_it_s_fine"],
  ["back\\slash conduit", "back_slash_conduit"],
  ["back`tick` array", "back_tick_array"],
  ["dollar ${brace} drive", "dollar_brace_drive"],
  ["end of comment */ escape", "end_of_comment_escape"],
  [AT_LIMIT, AT_LIMIT],
];

/** Names with nothing left to name a file, an id, or a binding after. */
const REFUSED: readonly string[] = ["", "   ", "___", "---", "名前", "🚀", OVER_LIMIT];

/**
 * The words a `const` cannot be. Kept here rather than imported so the test is
 * an independent statement about the identifier rather than a second reading of
 * the same table.
 */
const RESERVED = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function renderFor(names: DerivedNames): string {
  return technologyRecipe.render({ names, answers: {} });
}

/**
 * The source with every string literal and every comment replaced by a marker,
 * leaving only code. If any part of an author's name ever escaped its literal,
 * it would show up here.
 */
function codeOnly(source: string): string {
  return (
    source
      // Both delimiters in one pass, so whichever opens first wins: an apostrophe
      // inside a double-quoted string must not start a literal of its own.
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, "«string»")
      .replace(/\/\*[\s\S]*?\*\//g, "«block»")
      .replace(/\/\/[^\n]*/g, "«line»")
  );
}

async function prettier(source: string): Promise<string> {
  const filepath = path.resolve(import.meta.dirname, "../src/catalog/recipes/technology.ts");
  const config = (await resolveConfig(filepath)) ?? {};
  return format(source, { ...config, filepath });
}

describe("the stem grammar", () => {
  it("is the SDK's own, restated", () => {
    // `names.ts` restates it so the package needs no runtime dependency on the
    // SDK. This is what makes that restatement safe: tightening the SDK's
    // grammar breaks a test here rather than a stranger's generated file.
    expect(STEM_PATTERN.source).toBe(FILE_STEM_PATTERN.source);
  });
});

describe("names the derivation refuses", () => {
  it.each(REFUSED.map((name) => [JSON.stringify(name), name] as const))(
    "refuses %s with a reason",
    (_label, name) => {
      let caught: unknown;
      try {
        deriveNames(name);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NameError);
      // Never a fallback. A name that cannot become a file, an id, and a
      // binding is refused; it is not silently replaced by one that can.
      expect((caught as NameError).message.length).toBeGreaterThan(20);
    }
  );
});

describe("names the derivation accepts", () => {
  it.each(ACCEPTED.map(([name, stem]) => [JSON.stringify(name), name, stem] as const))(
    "derives %s",
    (_label, name, stem) => {
      const names = deriveNames(name);

      expect(names.stem).toBe(stem);
      expect(names.logicalName).toBe(stem);
      expect(names.basename).toBe(`${stem}.ts`);
      expect(FILE_STEM_PATTERN.test(names.stem)).toBe(true);
      expect(names.stem.length).toBeLessThanOrEqual(64);

      expect(RESERVED.has(names.identifier)).toBe(false);
      // The identifier has to bind, not merely look like it would.
      expect(
        () =>
          new Function(`"use strict"; const ${names.identifier} = 1; return ${names.identifier};`)
      ).not.toThrow();
    }
  );

  it.each(ACCEPTED.map(([name]) => [JSON.stringify(name), name] as const))(
    "renders %s without letting it out of its string literal",
    (_label, name) => {
      const names = deriveNames(name);
      const source = renderFor(names);

      // The author's text reaches source in one place, quoted.
      expect(source).toContain(`name: ${quoteTs(names.title)},`);

      // And the code around it is the same code any other name produces.
      expect(codeOnly(source)).toBe(codeOnly(renderFor({ ...names, title: "Benign" })));
      for (const stray of ['"', "'", "`", "$", "\\"]) {
        expect(codeOnly(source), stray).not.toContain(stray);
      }
    }
  );

  it.each(ACCEPTED.map(([name]) => [JSON.stringify(name), name] as const))(
    "renders %s already formatted",
    async (_label, name) => {
      const source = renderFor(deriveNames(name));
      expect(await prettier(source)).toBe(source);
    }
  );
});

/**
 * One project, every accepted name at once. Compiling and building a dozen-odd
 * separate projects would prove the same thing fourteen times over and cost a
 * minute each; the names are distinct, so they coexist.
 */
describe("every accepted name, in one real project", () => {
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
    for (const [name] of ACCEPTED) {
      const names = deriveNames(name);
      project.place(names.basename, renderFor(names));
    }
  }, COMPILER_TIMEOUT);

  afterAll(() => project?.dispose());

  it(
    "typechecks",
    () => {
      const result = project.typecheck();
      expect(result.output).toBe("");
      expect(result.status).toBe(0);
    },
    COMPILER_TIMEOUT
  );

  it(
    "builds one technology per name",
    () => {
      const result = project.build();
      expect(result.status, result.output).toBe(0);

      const emitted = project.outFiles();
      for (const [, stem] of ACCEPTED) {
        const technology = `common/technology/golden_mod_${stem}.txt`;
        expect(emitted, stem).toContain(technology);
        expect(project.readOut(technology)).toContain(`golden_mod_tech_${stem}`);
      }
    },
    COMPILER_TIMEOUT
  );
});
