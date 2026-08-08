/**
 * `create-stellaris-mod list` — what this release can generate.
 *
 * It needs no project, reads no disk, and prints the same bytes on every
 * machine: the catalog is baked into the package, so listing it is a pure
 * function of which release is running. Everything goes to stdout, because the
 * listing *is* the result.
 */

import { CATALOG } from "../catalog/index.ts";
import type { RecipeSummary } from "../catalog/types.ts";
import type { CliIo } from "../io.ts";
import { helpText } from "../options.ts";

export function runList(argv: readonly string[], io: CliIo): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout.write(helpText("list"));
    return 0;
  }
  if (argv.length > 0) {
    io.stderr.write(
      `\`create-stellaris-mod list\` takes no arguments, and got ${JSON.stringify(argv[0])}.\n`
    );
    return 1;
  }

  io.stdout.write(listing(CATALOG.list()));
  return 0;
}

/** The Item/Feature axis, spelled the way the glossary spells it. */
export function kindLabel(summary: RecipeSummary): string {
  return summary.kind === "item" ? "Item recipe" : "Feature recipe";
}

function listing(recipes: readonly RecipeSummary[]): string {
  const idWidth = Math.max(...recipes.map((recipe) => recipe.id.length));
  const titleWidth = Math.max(...recipes.map((recipe) => recipe.title.length));
  // The summary hangs under the title rather than beside it, so a longer
  // recipe id later never pushes the prose off the right edge.
  const hang = " ".repeat(2 + idWidth + 2);

  const entries = recipes.map((recipe) =>
    [
      `  ${recipe.id.padEnd(idWidth)}  ${recipe.title.padEnd(titleWidth)}  ${kindLabel(recipe)}`,
      `${hang}${recipe.summary}`,
    ].join("\n")
  );

  return [
    "Recipes:",
    "",
    entries.join("\n\n"),
    "",
    "See what a recipe asks, and the flags that answer it without prompting:",
    "",
    "  npx create-stellaris-mod view <recipe>",
    "",
  ].join("\n");
}
