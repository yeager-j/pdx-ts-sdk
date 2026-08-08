/**
 * Hostile names, and what the derivation and the renderer owe them.
 *
 * A generated file's name is the one input an author supplies freely, and it
 * reaches three places at once: a filename, a content id, and a TypeScript
 * binding. So every name in the corpus below has to do one of exactly two
 * things — be refused with a reason, or produce names that satisfy all three
 * contracts and source that compiles, builds, and shows no injection.
 *
 * The corpus is a property harness rather than a set of goldens: what matters is
 * the contract each name meets, not the exact bytes it produces, and committing
 * a dozen near-identical goldens would obscure the one that is reviewed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FILE_STEM_PATTERN } from "../../sdk/src/authoring/feature.ts";
import { deriveNames, NameError, STEM_PATTERN } from "../src/catalog/names.ts";
import { researchQuestRecipe } from "../src/catalog/recipes/research-quest.ts";
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

const QUEST_VARIANTS = ["one", "two"] as const;

function renderQuestFor(names: DerivedNames, projects: "one" | "two"): string {
  return researchQuestRecipe.render({ names, answers: { projects } });
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
    "derives %s to the same names a second time, from its own title",
    (_label, name) => {
      // `generate` derives once to show the target path and the logical-name
      // facts, and then hands the *normalized title* to the catalog, which
      // derives again to produce the basename it publishes. Those two
      // derivations have to agree or the file lands somewhere other than the
      // path an author confirmed — so idempotence over the title is a property
      // this corpus pins rather than a claim the command makes about itself.
      const once = deriveNames(name);
      expect(deriveNames(once.title)).toEqual(once);
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

  // There is deliberately no per-name "already formatted" gate. A renderer
  // emits one conventional shape and never reproduces Prettier's wrapping
  // rules, so an unusual name length may wrap differently than Prettier would;
  // the project's own Prettier — run by `generate` after publication when it
  // is installed — settles the difference. `recipe-matrix.test.ts` still holds
  // each reviewed golden to the repository configuration at the canonical
  // name, which is what keeps the committed evidence readable.

  it.each(ACCEPTED.map(([name]) => [JSON.stringify(name), name] as const))(
    "renders %s into both research-quest variants without letting it out of its literal",
    (_label, name) => {
      const names = deriveNames(name);
      for (const projects of QUEST_VARIANTS) {
        const source = renderQuestFor(names, projects);

        // The author's text reaches source in one place, quoted: the chain's
        // title. Every other string in the file is recipe-authored.
        expect(source).toContain(`title: ${quoteTs(names.title)},`);

        // The bindings are fixed recipe words, so with the title neutralized
        // the code is not merely injection-free but byte-identical.
        expect(codeOnly(source)).toBe(
          codeOnly(renderQuestFor({ ...names, title: "Benign" }, projects))
        );
        for (const stray of ['"', "'", "`", "$", "\\"]) {
          expect(codeOnly(source), stray).not.toContain(stray);
        }
      }
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

/**
 * The same shared-project economy for the feature recipe, with the structural
 * superset variant: every accepted name renders `projects=two`, so every
 * correlated symbol and logical id — the chain, both projects, all three
 * events, the option-group link, and the merged on-action registration — is
 * proved per name against the real compiler and the real build. A quest per
 * name also means every feature registers the same `on_game_start_country`
 * hook, so the one `<prefix>_on_actions.txt` merging them all is itself under
 * test.
 */
describe("every accepted name, as a two-project research quest, in one real project", () => {
  let project: GoldenProject;

  beforeAll(() => {
    project = createGoldenProject();
    for (const [name] of ACCEPTED) {
      const names = deriveNames(name);
      project.place(names.basename, renderQuestFor(names, "two"));
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
    "builds every correlated id per name",
    () => {
      const result = project.build();
      expect(result.status, result.output).toBe(0);

      const emitted = project.outFiles();
      const onActions = project.readOut("common/on_actions/golden_mod_on_actions.txt");
      for (const [, stem] of ACCEPTED) {
        const chain = `common/event_chains/golden_mod_${stem}.txt`;
        const specialProjects = `common/special_projects/golden_mod_${stem}.txt`;
        const events = `events/golden_mod_${stem}.txt`;
        expect(emitted, stem).toContain(chain);
        expect(emitted, stem).toContain(specialProjects);
        expect(emitted, stem).toContain(events);

        expect(project.readOut(chain)).toContain(`golden_mod_event_chain_${stem}`);

        const projectsOut = project.readOut(specialProjects);
        expect(projectsOut).toContain(`key = golden_mod_special_project_${stem}_1`);
        expect(projectsOut).toContain(`key = golden_mod_special_project_${stem}_2`);
        expect(projectsOut).toContain(
          `same_option_group_as = { golden_mod_special_project_${stem}_1 }`
        );

        const eventsOut = project.readOut(events);
        expect(eventsOut).toContain(`namespace = golden_mod_${stem}`);
        for (const id of [1, 2, 3]) {
          expect(eventsOut, `${stem}.${id}`).toContain(`id = golden_mod_${stem}.${id}`);
        }

        expect(onActions, stem).toContain(`golden_mod_${stem}.1`);
      }
    },
    COMPILER_TIMEOUT
  );
});
