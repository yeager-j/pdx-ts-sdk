/**
 * `create-stellaris-mod view <recipe>` — everything one recipe will ask, and
 * the flags that answer it.
 *
 * Like `list`, it needs no project and no name. That is why the output file
 * and the declaration line are stated as patterns: both hang off a name the
 * author has not typed yet.
 *
 * The copyable command at the bottom is the point of the whole page. An author
 * reading this is deciding whether to run `generate`, and the fastest honest
 * answer to "what would that do" is a line they can paste.
 */

import { UnknownRecipeError } from "../catalog/catalog.ts";
import { CATALOG } from "../catalog/index.ts";
import type { ChoiceQuestion, RecipeSummary, RecipeView } from "../catalog/types.ts";
import type { CliIo } from "../io.ts";
import { helpText } from "../options.ts";
import { kindLabel } from "./list.ts";

export function runView(argv: readonly string[], io: CliIo): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout.write(helpText("view"));
    return 0;
  }

  const recipeId = argv[0];
  if (recipeId === undefined) {
    io.stderr.write(
      `\`create-stellaris-mod view\` needs a recipe id.\n\n${available(CATALOG.list().map((recipe) => recipe.id))}`
    );
    return 1;
  }
  if (argv.length > 1) {
    io.stderr.write(
      `\`create-stellaris-mod view\` takes one recipe id, and got ${argv.length}: ` +
        `${argv.map((arg) => JSON.stringify(arg)).join(", ")}.\n`
    );
    return 1;
  }

  let view: RecipeView;
  try {
    view = CATALOG.view(recipeId);
  } catch (error) {
    if (!(error instanceof UnknownRecipeError)) {
      throw error;
    }
    io.stderr.write(`${error.message}\n\n${available(error.available)}`);
    return 1;
  }

  io.stdout.write(page(view));
  return 0;
}

/** The ids that do exist, plus where to read about them. */
function available(ids: readonly string[]): string {
  return [
    "This release carries:",
    "",
    ...ids.map((id) => `  ${id}`),
    "",
    "Run `npx create-stellaris-mod list` to see what each one does.",
    "",
  ].join("\n");
}

function page(view: RecipeView): string {
  const { summary } = view;
  const facts: readonly (readonly [string, string])[] = [
    [
      "Kind",
      summary.kind === "item"
        ? "Item recipe — one feature file holding one item"
        : "Feature recipe — one feature file holding several coordinated items",
    ],
    ["Creates", summary.itemKinds.join(", ")],
    ["Writes", view.outputPattern],
    ["Declares", view.declarationPattern],
  ];
  const labelWidth = Math.max(...facts.map(([label]) => label.length));

  return [
    `${summary.id} — ${summary.title}`,
    "",
    `  ${summary.summary}`,
    "",
    ...facts.map(([label, value]) => `  ${label.padEnd(labelWidth)}  ${value}`),
    "",
    "Questions:",
    "",
    ...questions(view.questions),
    "",
    "Generate it:",
    "",
    `  ${view.command}`,
    "",
    ...derivation(summary),
    "",
  ].join("\n");
}

/**
 * What the name the author types goes on to decide.
 *
 * Split by Item/Feature because the last clause is only true of one of them. An
 * Item recipe's file exports one item, bound to the identifier derived from the
 * name. A Feature recipe's file exports several under recipe-chosen role words —
 * `chain`, `started`, `completed` — which the name has no say in, so claiming
 * otherwise would describe a file the author is not about to get.
 */
function derivation(summary: RecipeSummary): string[] {
  return summary.kind === "item"
    ? [
        "The name is the display name. The filename, the content id, and the",
        "TypeScript binding are all derived from it.",
      ]
    : [
        "The name is the display name. The filename and the content ids are",
        "derived from it; the items inside are bound to names this recipe chooses.",
      ];
}

function questions(asked: readonly ChoiceQuestion[]): string[] {
  if (asked.length === 0) {
    return ["  This recipe asks nothing, so it takes no recipe flags."];
  }

  const lines = ["  Asked in this order. Each one has a flag, so a scripted run never prompts."];
  for (const question of asked) {
    const values = question.choices.map((choice) => choice.value);
    const valueWidth = Math.max(...values.map((value) => value.length));
    lines.push(
      "",
      `  --${question.key} <${values.join("|")}>`,
      `      ${question.help} (default: ${question.defaultValue})`,
      ...question.choices.map((choice) => {
        const help = choice.help === undefined ? "" : ` — ${choice.help}`;
        return `        ${choice.value.padEnd(valueWidth)}  ${choice.label}${help}`;
      })
    );
  }
  return lines;
}
