/**
 * The Recipe Catalog: `list`, `view`, `generate`, and nothing else.
 *
 * It is a pure in-process module. No filesystem, no terminal, no environment,
 * no clock, no randomness — the same normalized request returns the same bytes
 * on every machine, which is what lets a committed golden file be evidence
 * rather than a snapshot of one afternoon.
 *
 * `generate` demands a *complete* request. Applying a question's Default answer
 * is the CLI's job, because "the author did not say" is a fact about an
 * invocation and not about a recipe; by the time a request arrives here there
 * is no such thing as an unanswered question. That split is what keeps this
 * module free of the flag table, the terminal, and `--yes`.
 *
 * `defineRecipe` is a type-inference helper and a protocol check. It is not a
 * template language: a recipe's renderer owns its whole source shape, and the
 * only thing the catalog knows about that source is that it is a string.
 *
 * Name derivation is the caller's too, and for the same reason defaults are:
 * the command has to derive before it can preview a path or a binding, so a
 * derivation here would be a second decision about one file. A request arrives
 * with its names already refined, or it is not a request yet.
 */

import { COMMON_GENERATE_FLAGS } from "../options.ts";
import { FEATURE_MODULE_SEGMENTS, featureDeclaration } from "./declaration.ts";
import type {
  AnswersOf,
  ChoiceQuestion,
  DerivedNames,
  GeneratedFeatureSource,
  GenerateRecipeRequest,
  RecipeSummary,
  RecipeView,
} from "./types.ts";

/**
 * Recipe ids and question keys share one grammar, and it is the one that
 * survives being typed into a shell and written after `--`.
 */
const KEBAB_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** What `view` shows in place of the names `generate` derives from a real one. */
const PLACEHOLDER_NAMES = {
  identifier: "<binding>",
  basename: "<derived_name>.ts",
} as const;

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

/**
 * A recipe id nothing in this release answers to. It carries the ids that *are*
 * answered rather than a finished sentence, because the command that catches it
 * is the one that knows how an author is reading it.
 */
export class UnknownRecipeError extends CatalogError {
  readonly recipeId: string;
  readonly available: readonly string[];

  constructor(recipeId: string, available: readonly string[]) {
    super(`There is no recipe called ${JSON.stringify(recipeId)}.`);
    this.name = "UnknownRecipeError";
    this.recipeId = recipeId;
    this.available = available;
  }
}

export interface RecipeRenderInput<Q extends readonly ChoiceQuestion[]> {
  readonly names: DerivedNames;
  readonly answers: AnswersOf<Q>;
}

/**
 * One baked recipe. `render` is a method rather than a property on purpose:
 * method parameters are checked bivariantly, which is what lets recipes with
 * different question tuples sit in one catalog array without a cast.
 */
export interface RecipeDefinition<Q extends readonly ChoiceQuestion[]> {
  readonly summary: RecipeSummary;
  readonly questions: Q;
  render(input: RecipeRenderInput<Q>): string;
}

/** A recipe with its question tuple widened, which is how a catalog holds one. */
export type AnyRecipe = RecipeDefinition<readonly ChoiceQuestion[]>;

/**
 * Infers a recipe's question tuple from the literal it is written as, so a
 * renderer's `answers.visibility` narrows to that question's own choices and a
 * typo in a `switch` arm is a compile error rather than a dead branch.
 */
export function defineRecipe<const Q extends readonly ChoiceQuestion[]>(
  definition: RecipeDefinition<Q>
): RecipeDefinition<Q> {
  return definition;
}

export interface RecipeCatalog {
  list(): readonly RecipeSummary[];
  view(id: string): RecipeView;
  generate(request: GenerateRecipeRequest): GeneratedFeatureSource;
}

export function createCatalog(recipes: readonly AnyRecipe[]): RecipeCatalog {
  const byId = new Map<string, AnyRecipe>();
  for (const recipe of recipes) {
    validateRecipe(recipe);
    if (byId.has(recipe.summary.id)) {
      throw new CatalogError(
        `Two recipes are called ${JSON.stringify(recipe.summary.id)}. A recipe id is what an ` +
          `author types after \`generate\`, so it has to name exactly one recipe.`
      );
    }
    byId.set(recipe.summary.id, recipe);
  }

  // Sorted, so `list` output is a function of which recipes exist and not of
  // the order somebody happened to write them in the array.
  const ordered = [...byId.values()].sort((a, b) => (a.summary.id < b.summary.id ? -1 : 1));
  const ids = ordered.map((recipe) => recipe.summary.id);

  function resolveRecipe(id: string): AnyRecipe {
    const recipe = byId.get(id);
    if (recipe === undefined) {
      throw new UnknownRecipeError(id, ids);
    }
    return recipe;
  }

  return {
    list: () => ordered.map((recipe) => recipe.summary),

    view(id) {
      const recipe = resolveRecipe(id);
      return {
        summary: recipe.summary,
        questions: recipe.questions,
        // `view` needs no name, so the two derived names stay placeholders. The
        // declaration comes from the same function `generate` uses, so what
        // `view` shows and what `generate` appends cannot drift apart.
        outputPattern: `${FEATURE_MODULE_SEGMENTS.join("/")}/${PLACEHOLDER_NAMES.basename}`,
        declarationPattern: featureDeclaration(PLACEHOLDER_NAMES),
        command: nonInteractiveCommand(recipe),
      };
    },

    generate(request) {
      const recipe = resolveRecipe(request.recipeId);
      const answers = validateAnswers(recipe, request.answers);
      const { names } = request;
      return {
        stem: names.stem,
        basename: names.basename,
        contents: recipe.render({ names, answers }),
        declaration: featureDeclaration(names),
      };
    },
  };
}

function validateRecipe(recipe: AnyRecipe): void {
  const { id, title, summary, itemKinds } = recipe.summary;
  if (!KEBAB_PATTERN.test(id)) {
    throw new CatalogError(
      `Recipe id ${JSON.stringify(id)} must be kebab-case (${String(KEBAB_PATTERN)}). It is ` +
        `typed on a command line, so it carries no spaces, capitals, or punctuation.`
    );
  }
  for (const [field, value] of [
    ["title", title],
    ["summary", summary],
  ] as const) {
    if (value.trim() === "") {
      throw new CatalogError(
        `Recipe ${JSON.stringify(id)} has an empty ${field}, which \`list\` prints.`
      );
    }
  }
  if (itemKinds.length === 0) {
    throw new CatalogError(
      `Recipe ${JSON.stringify(id)} declares no item kinds, so \`list\` cannot say what it creates.`
    );
  }

  const seen = new Set<string>();
  for (const question of recipe.questions) {
    validateQuestion(id, question);
    if (seen.has(question.key)) {
      throw new CatalogError(
        `Recipe ${JSON.stringify(id)} asks ${JSON.stringify(question.key)} twice. Each key is a ` +
          `flag and an answers field, and neither can mean two questions.`
      );
    }
    seen.add(question.key);
  }
}

function validateQuestion(id: string, question: ChoiceQuestion): void {
  const at = `Recipe ${JSON.stringify(id)}, question ${JSON.stringify(question.key)}`;
  if (!KEBAB_PATTERN.test(question.key)) {
    throw new CatalogError(
      `${at}: a question key must be kebab-case (${String(KEBAB_PATTERN)}), because it becomes ` +
        `\`--\${key}\`.`
    );
  }
  if ((COMMON_GENERATE_FLAGS as readonly string[]).includes(question.key)) {
    throw new CatalogError(
      `${at} collides with \`generate\`'s own \`--${question.key}\`. A recipe cannot take over a ` +
        `flag the command needs to mean one thing everywhere.`
    );
  }
  if (question.choices.length === 0) {
    throw new CatalogError(`${at} offers no choices, so no answer to it could ever be valid.`);
  }

  const values = new Set<string>();
  for (const choice of question.choices) {
    if (values.has(choice.value)) {
      throw new CatalogError(
        `${at} offers ${JSON.stringify(choice.value)} twice, so an answer of it would be ambiguous.`
      );
    }
    values.add(choice.value);
  }
  if (!values.has(question.defaultValue)) {
    throw new CatalogError(
      `${at}: the default ${JSON.stringify(question.defaultValue)} is not one of its choices ` +
        `(${[...values].map((value) => JSON.stringify(value)).join(", ")}). \`--yes\` would ` +
        `answer it with something the recipe rejects.`
    );
  }
  if (question.prompt.trim() === "" || question.help.trim() === "") {
    throw new CatalogError(`${at} has an empty prompt or help, which \`view\` prints.`);
  }
}

/**
 * Every declared question answered, with a declared choice, and nothing else.
 *
 * All four faults are the same fault from different directions — a request that
 * does not correspond to this recipe — and all four are a caller's bug rather
 * than an author's typo, because the CLI validates flags against the same
 * questions before it ever builds a request.
 */
function validateAnswers(
  recipe: AnyRecipe,
  answers: Readonly<Record<string, string>>
): Record<string, string> {
  const at = `Recipe ${JSON.stringify(recipe.summary.id)}`;
  const declared = new Map(recipe.questions.map((question) => [question.key, question]));

  for (const key of Object.keys(answers)) {
    if (!declared.has(key)) {
      throw new CatalogError(
        `${at} was answered ${JSON.stringify(key)}, which it never asks` +
          `${declared.size === 0 ? " — it asks nothing at all" : ""}.`
      );
    }
  }

  const validated: Record<string, string> = {};
  for (const [key, question] of declared) {
    if (!Object.hasOwn(answers, key)) {
      throw new CatalogError(
        `${at} was not answered ${JSON.stringify(key)}. The catalog applies no defaults: a ` +
          `request reaching it has every question answered, or it is not a request yet.`
      );
    }
    const value = answers[key]!;
    if (!question.choices.some((choice) => choice.value === value)) {
      throw new CatalogError(
        `${at}: ${JSON.stringify(value)} is not a choice for ${JSON.stringify(key)} ` +
          `(${question.choices.map((choice) => JSON.stringify(choice.value)).join(", ")}).`
      );
    }
    validated[key] = value;
  }
  return validated;
}

/**
 * The command `view` prints for copying: the recipe, a name to replace, and
 * every question answered with its Default, so pasting it prompts for nothing.
 */
function nonInteractiveCommand(recipe: AnyRecipe): string {
  const flags = recipe.questions.map((question) => ` --${question.key} ${question.defaultValue}`);
  return `npx create-stellaris-mod generate ${recipe.summary.id} "<name>"${flags.join("")}`;
}
