/**
 * The catalog protocol, on synthetic recipes.
 *
 * Every rule here is checked when a catalog is *constructed*, which means a
 * malformed recipe fails on `import`, in this package's own test run, rather
 * than in an author's terminal. The recipes below are deliberately broken in one
 * way each; several are shapes the types already refuse at authoring time, and
 * the casts say so — the runtime check exists because a recipe reaches the
 * catalog through a widened array, and "the compiler would have caught it" is
 * not the same statement as "it cannot happen".
 *
 * The purity claim gets its own test at the bottom. It is a claim about the
 * whole directory rather than about one module, so it is checked by reading the
 * directory.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CatalogError,
  createCatalog,
  defineRecipe,
  UnknownRecipeError,
  type AnyRecipe,
} from "../src/catalog/catalog.ts";
import { CATALOG } from "../src/catalog/index.ts";
import { deriveNames } from "../src/catalog/names.ts";
import type { ChoiceQuestion, DerivedNames, RecipeSummary } from "../src/catalog/types.ts";
import { COMMON_GENERATE_FLAGS } from "../src/options.ts";

const CATALOG_DIR = path.resolve(import.meta.dirname, "../src/catalog");

const NAMES: DerivedNames = {
  logicalName: "some_name",
  stem: "some_name",
  basename: "some_name.ts",
  identifier: "someName",
  title: "Some Name",
};

function summary(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: "synthetic",
    title: "Synthetic",
    summary: "A recipe that exists to be rejected.",
    kind: "item",
    itemKinds: ["technology"],
    ...overrides,
  };
}

function question(overrides: Partial<ChoiceQuestion> = {}): ChoiceQuestion {
  return {
    key: "shape",
    prompt: "Which shape?",
    choices: [
      { value: "round", label: "Round" },
      { value: "square", label: "Square" },
    ],
    defaultValue: "round",
    help: "Chooses the topology.",
    ...overrides,
  } as ChoiceQuestion;
}

function recipe(overrides: {
  summary?: RecipeSummary;
  questions?: readonly ChoiceQuestion[];
  render?: () => string;
}): AnyRecipe {
  return {
    summary: overrides.summary ?? summary(),
    questions: overrides.questions ?? [],
    render: overrides.render ?? (() => "// generated\n"),
  };
}

describe("constructing a catalog", () => {
  it("takes a well-formed recipe", () => {
    expect(createCatalog([recipe({})]).list()).toHaveLength(1);
  });

  it("refuses two recipes with the same id", () => {
    expect(() => createCatalog([recipe({}), recipe({})])).toThrow(CatalogError);
    expect(() => createCatalog([recipe({}), recipe({})])).toThrow(/"synthetic"/);
  });

  it.each(["Technology", "tech_nology", "-technology", "technology-", "tech--nology", ""])(
    "refuses the recipe id %o, which is not kebab-case",
    (id) => {
      expect(() => createCatalog([recipe({ summary: summary({ id }) })])).toThrow(CatalogError);
    }
  );

  it("refuses a recipe with nothing for `list` to print", () => {
    expect(() => createCatalog([recipe({ summary: summary({ title: "  " }) })])).toThrow(
      /empty title/
    );
    expect(() => createCatalog([recipe({ summary: summary({ summary: "" }) })])).toThrow(
      /empty summary/
    );
    expect(() => createCatalog([recipe({ summary: summary({ itemKinds: [] }) })])).toThrow(
      /no item kinds/
    );
  });

  it("refuses a question asked twice", () => {
    expect(() => createCatalog([recipe({ questions: [question(), question()] })])).toThrow(
      /asks "shape" twice/
    );
  });

  it.each(["Shape", "shape_kind", "-shape", ""])(
    "refuses the question key %o, which is not kebab-case",
    (key) => {
      expect(() => createCatalog([recipe({ questions: [question({ key })] })])).toThrow(
        /must be kebab-case/
      );
    }
  );

  it("refuses a reserved command flag as a recipe question", () => {
    expect(() => createCatalog([recipe({ questions: [question({ key: "cwd" })] })])).toThrow(
      /--cwd/
    );
  });

  it("accepts a deliberately non-common recipe flag", () => {
    expect(() =>
      createCatalog([recipe({ questions: [question({ key: "terrain-choice" })] })])
    ).not.toThrow();
  });

  it("refuses an empty choice set", () => {
    // The tuple type already refuses this where a recipe is written; the cast
    // is the widened path a recipe actually reaches the catalog by.
    const empty = question({ choices: [] as unknown as ChoiceQuestion["choices"] });
    expect(() => createCatalog([recipe({ questions: [empty] })])).toThrow(/offers no choices/);
  });

  it("refuses the same choice value twice", () => {
    const twice = question({
      choices: [
        { value: "round", label: "Round" },
        { value: "round", label: "Also round" },
      ],
    });
    expect(() => createCatalog([recipe({ questions: [twice] })])).toThrow(/offers "round" twice/);
  });

  it("refuses a default that is not one of the choices", () => {
    expect(() =>
      createCatalog([recipe({ questions: [question({ defaultValue: "triangular" })] })])
    ).toThrow(/"triangular" is not one of its choices/);
  });

  it("refuses a question with nothing for `view` to print", () => {
    expect(() => createCatalog([recipe({ questions: [question({ help: "" })] })])).toThrow(
      /empty prompt or help/
    );
  });
});

describe("generate", () => {
  const guided = createCatalog([recipe({ questions: [question()], render: () => "// guided\n" })]);
  const request = { recipeId: "synthetic", name: "Some Name" };

  it("refuses a recipe it does not carry, and carries the ids that exist", () => {
    let caught: unknown;
    try {
      guided.generate({ ...request, recipeId: "nope", answers: { shape: "round" } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnknownRecipeError);
    expect((caught as UnknownRecipeError).available).toEqual(["synthetic"]);
  });

  it("refuses an answer to a question the recipe never asks", () => {
    expect(() =>
      guided.generate({ ...request, answers: { shape: "round", colour: "blue" } })
    ).toThrow(/"colour", which it never asks/);
  });

  it("refuses an answer that is not one of the question's choices", () => {
    expect(() => guided.generate({ ...request, answers: { shape: "triangular" } })).toThrow(
      /"triangular" is not a choice/
    );
  });

  it("refuses a missing answer rather than applying the default itself", () => {
    // The Default answer belongs to the invocation, not to the recipe: `--yes`
    // and a non-TTY resolve it, and by the time a request is here there is no
    // such thing as an unanswered question.
    expect(() => guided.generate({ ...request, answers: {} })).toThrow(/applies no defaults/);
  });

  it("demands exactly {} from a recipe that asks nothing", () => {
    const silent = createCatalog([recipe({})]);
    expect(silent.generate({ ...request, answers: {} }).basename).toBe("some_name.ts");
    expect(() => silent.generate({ ...request, answers: { shape: "round" } })).toThrow(
      /it asks nothing at all/
    );
  });

  it("returns the same bytes for the same request, twice", () => {
    const once = CATALOG.generate({
      recipeId: "technology",
      name: "Resonance Theory",
      answers: {},
    });
    const twice = CATALOG.generate({
      recipeId: "technology",
      name: "Resonance Theory",
      answers: {},
    });
    expect(twice.contents).toBe(once.contents);
    expect(twice.stem).toBe(once.stem);
    expect(twice.basename).toBe(once.basename);
  });
});

describe("the baked recipes", () => {
  it("carry the reviewed classifications, and nothing else is registered", () => {
    // The declared classification and the reviewed output contract are two
    // statements about one recipe; `recipe-matrix.test.ts` builds the output
    // that proves the second.
    const [building, event, researchQuest, technology, ...rest] = CATALOG.list();
    expect(rest).toEqual([]);
    expect(building).toMatchObject({ id: "building", kind: "item", itemKinds: ["building"] });
    expect(event).toMatchObject({ id: "event", kind: "item", itemKinds: ["event"] });
    expect(researchQuest).toMatchObject({
      id: "research-quest",
      kind: "feature",
      itemKinds: ["event_chain", "special_project", "event", "on_action"],
    });
    expect(technology).toMatchObject({ id: "technology", kind: "item", itemKinds: ["technology"] });
  });

  /**
   * `generate`'s preview promises an Item recipe's binding by name, and `view`
   * says the binding is derived from the name. Both are claims about source
   * neither command has rendered, so they are held to it here: an Item recipe
   * binds the derived identifier, and a Feature recipe — whose items carry
   * recipe-chosen role words — does not, which is the condition both commands
   * branch on. Without this, the preview would drift back into describing a file
   * the author is not about to get.
   */
  it.each(CATALOG.list().map((summary) => [summary.id, summary.kind] as const))(
    "%s binds what the Item/Feature axis says it binds",
    (id, kind) => {
      // Derived rather than restated: the identifier the commands print comes
      // from `deriveNames`, so the expectation has to come from there too.
      const name = "Some Name";
      const { identifier } = deriveNames(name);
      for (const answers of variants(CATALOG.view(id).questions)) {
        const { contents } = CATALOG.generate({ recipeId: id, name, answers });
        expect(
          contents.includes(`export const ${identifier} =`),
          `${id} (${kind}) with ${JSON.stringify(answers)}`
        ).toBe(kind === "item");
      }
    }
  );
});

/** Every combination of every question's choices, in question order. */
function variants(questions: readonly ChoiceQuestion[]): Record<string, string>[] {
  return questions.reduce<Record<string, string>[]>(
    (answers, question) =>
      answers.flatMap((answer) =>
        question.choices.map((choice) => ({ ...answer, [question.key]: choice.value }))
      ),
    [{}]
  );
}

describe("defineRecipe", () => {
  it("narrows a renderer's answers to its own question's choices", () => {
    // This is the whole reason the helper exists. `answers.shape` is
    // `"round" | "square"` here rather than `string`, so a renderer's switch is
    // exhaustive and a typo in an arm is a compile error, not a dead branch.
    const inferred = defineRecipe({
      summary: summary(),
      questions: [
        {
          key: "shape",
          prompt: "Which shape?",
          choices: [
            { value: "round", label: "Round" },
            { value: "square", label: "Square" },
          ],
          defaultValue: "round",
          help: "Chooses the topology.",
        },
      ],
      render: ({ answers }) => answers.shape,
    });
    expect(inferred.render({ names: NAMES, answers: { shape: "square" } })).toBe("square");
  });
});

describe("the catalog's purity", () => {
  it("imports nothing from node:, anywhere under src/catalog/", () => {
    // The catalog promises no filesystem, terminal, environment, clock, or
    // randomness. That promise is what makes a committed golden evidence, and
    // the cheapest honest way to hold it is to read what the modules import.
    const modules = readdirSync(CATALOG_DIR, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => path.join(entry.parentPath, entry.name));
    expect(modules.length).toBeGreaterThanOrEqual(5);

    for (const module of modules) {
      const source = readFileSync(module, "utf8");
      const specifiers = [
        ...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g),
      ].map((match) => match[1]!);
      expect(
        specifiers.filter((specifier) => specifier.startsWith("node:")),
        path.relative(CATALOG_DIR, module)
      ).toEqual([]);
    }
  });
});
