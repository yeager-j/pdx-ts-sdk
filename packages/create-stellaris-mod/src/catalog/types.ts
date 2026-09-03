/**
 * The Recipe Catalog's vocabulary, as types.
 *
 * These are private package implementation — `list`, `view` and `generate` are
 * the public interface, and nothing here is exported from the package. They are
 * split out from `catalog.ts` only so a recipe module can name them without
 * importing the catalog that will hold it.
 *
 * The `RecipeView` metadata is descriptive. It tells an author what a recipe
 * will ask; it does not drive a generic renderer and never claims to enumerate
 * the SDK's authoring surface, which the SDK's own types already do.
 */

/** One selectable answer to an Intent question. */
export interface Choice {
  readonly value: string;
  /** What the picker shows beside the value. */
  readonly label: string;
  /** One clause of extra detail, when the label alone is too terse. */
  readonly help?: string;
}

/**
 * A finite-choice generator question. Static: there is no `askWhen`, no
 * predicate algebra, and no conditional prompting — a question that changes
 * Item topology is worth asking every time, and a leaf value that is easier to
 * edit in source is not a question at all.
 */
export interface ChoiceQuestion {
  /** Kebab-case, and the command-line flag is `--<key>`. */
  readonly key: string;
  readonly prompt: string;
  readonly choices: readonly [Choice, ...Choice[]];
  /** The Default answer: what `--yes` and non-TTY operation resolve to. */
  readonly defaultValue: string;
  readonly help: string;
}

/**
 * The answers a recipe's own question tuple admits. Over a `const` tuple this
 * narrows to the literal choice values, so a renderer's `switch` is exhaustive
 * and a typo in an arm is a compile error rather than a dead branch.
 */
export type AnswersOf<Q extends readonly ChoiceQuestion[]> = {
  readonly [K in Q[number]["key"]]: Extract<Q[number], { key: K }>["choices"][number]["value"];
};

/** What `list` shows, and the head of what `view` shows. */
export interface RecipeSummary {
  /** Kebab-case, and the id an author types after `generate`. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /**
   * Output composition, not interaction: an Item recipe emits one Feature
   * holding one Item, a Feature recipe emits one Feature holding several
   * coordinated Items. Both write exactly one file.
   */
  readonly kind: "item" | "feature";
  /** The SDK content kinds the recipe creates, for example `["technology"]`. */
  readonly itemKinds: readonly string[];
}

/** Everything `view <recipe>` prints. */
export interface RecipeView {
  readonly summary: RecipeSummary;
  /** In the order `generate` asks them. */
  readonly questions: readonly ChoiceQuestion[];
  /**
   * Where the file lands, with the derived name left as a placeholder: `view`
   * requires no name, so it cannot spell the real one.
   */
  readonly outputPattern: string;
  /** The line `generate` appends to `src/features.ts`, with the same placeholders. */
  readonly declarationPattern: string;
  /** A non-interactive command an author can paste. */
  readonly command: string;
}

/** One normalized, complete request. The catalog demands nothing less. */
export interface GenerateRecipeRequest {
  readonly recipeId: string;
  /**
   * Every name the render needs, already derived and already validated.
   *
   * The refined value crosses the boundary rather than the raw text, because
   * the command has to derive before it can preview a target path or a binding,
   * and a second derivation inside the catalog would be a second decision
   * governing the same file. Two decisions agree only while the derivation
   * happens to be idempotent over its own output — a property nothing in the
   * design guarantees, and one nobody would notice breaking until an author
   * confirmed one path and received another.
   */
  readonly names: DerivedNames;
  /**
   * Every declared question answered with a declared choice. Defaults are the
   * CLI's business: by the time a request reaches the catalog there is no such
   * thing as an unanswered question.
   */
  readonly answers: Readonly<Record<string, string>>;
}

/** What a renderer produces, before dry-run presentation or publication. */
export interface GeneratedFeatureSource {
  readonly stem: string;
  readonly basename: `${string}.ts`;
  readonly contents: string;
  /** The line that declares the module in `src/features.ts`. */
  readonly declaration: string;
}

/** One validated derivation of everything a renderer needs to name things. */
export interface DerivedNames {
  /** The content name `mod.technology(...)` mints an id from. */
  readonly logicalName: string;
  /** The Feature stem, which is the same snake_case word. */
  readonly stem: string;
  readonly basename: `${string}.ts`;
  /** A TypeScript binding: camelCase, never a reserved word. */
  readonly identifier: string;
  /** The author's own text, for prose and localization. */
  readonly title: string;
}
