/**
 * The `technology` recipe: one technology, one feature, no questions.
 *
 * A zero-question recipe still earns its place. What it installs is a *reviewed*
 * shape — the fields a working technology actually sets, in the order they read
 * in, with the two optional ones worth knowing about shown commented and ready
 * to uncomment. An author who has never opened `common/technology/` gets a file
 * that builds, and one who has gets a head start rather than a form to fill in.
 *
 * The curated values follow the conventions in the reviewed vanilla evidence and
 * in this repository's own example content: `physics`/`particles` as the
 * starting area and category, `tier: 1`, and a scalar `cost` rather than a
 * weight block. `desc` is the only required author text with nothing to derive
 * it from, so it ships as a greppable `PLACEHOLDER:` value that still typechecks
 * and still builds.
 *
 * The renderer owns the whole source shape, including where the lines break.
 * That is not decoration: the package promises every generated file is already
 * Prettier-formatted, and Prettier's own choice of shape depends on how long the
 * author's name turned out to be. `recipe-matrix.test.ts` and
 * `adversarial-names.test.ts` hold this to real Prettier across the whole
 * accepted length range.
 */

import { quoteTs } from "../../quote.ts";
import { defineRecipe } from "../catalog.ts";
import type { DerivedNames } from "../types.ts";

/** The repository's Prettier `printWidth`, which the emitted source must respect. */
const PRINT_WIDTH = 100;

export const technologyRecipe = defineRecipe({
  summary: {
    id: "technology",
    title: "Technology",
    summary: "One researchable technology, plus the feature file that places it.",
    kind: "item",
    itemKinds: ["technology"],
  },
  questions: [],
  render: ({ names }) => renderSource(names),
});

function renderSource(names: DerivedNames): string {
  return [
    HEADER,
    "",
    'import { mod } from "#mod";',
    "",
    technologyCall(names),
    "",
    featureCall(names),
    "",
  ].join("\n");
}

const HEADER = `/**
 * One technology, and the feature that places it.
 *
 * Generated once by the \`technology\` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * \`#mod\` is the project's own alias for \`src/mod.ts\` (see \`package.json#imports\`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the \`mod.feature(...)\` call at the
 * bottom is what names the emitted files.
 */`;

/**
 * The technology's fields, as source lines at zero indent.
 *
 * Active fields first, then the two optional examples. Each example is
 * uncomment-ready against the imports and names this file already has, which is
 * the whole test of whether an example belongs in a starter at all.
 */
function fields(names: DerivedNames): readonly string[] {
  return [
    `name: ${quoteTs(names.title)},`,
    `desc: ${quoteTs("PLACEHOLDER: what researching this unlocks, in a sentence or two.")},`,
    `area: "physics",`,
    `category: "particles",`,
    `tier: 1,`,
    `cost: 2000,`,
    "",
    "// Technologies that have to be researched first. Every feature file exports",
    "// its items, so import one and list it here:",
    "//",
    '//   import { plasmaWeapons } from "./plasma_weapons.ts";',
    "//   prerequisites: [plasmaWeapons],",
    "",
    "// How likely the game is to offer this as a research option next to the",
    "// others in its category. 100 is the conventional starting weight.",
    "// weight: 100,",
  ];
}

/**
 * `const <identifier> = mod.technology("<logical name>", { ... });`
 *
 * Prettier hugs the object argument as long as the line that opens it fits, and
 * breaks every argument out once it does not. Both shapes are spelled here
 * because the renderer returns finished source: emitting the hugged shape for a
 * long name would be emitting source Prettier disagrees with.
 */
function technologyCall(names: DerivedNames): string {
  const open = `export const ${names.identifier} = mod.technology(`;
  const logicalName = quoteTs(names.logicalName);
  const body = fields(names);
  if (`${open}${logicalName}, {`.length <= PRINT_WIDTH) {
    return [`${open}${logicalName}, {`, ...indent(body, "  "), "});"].join("\n");
  }
  return [open, `  ${logicalName},`, "  {", ...indent(body, "    "), "  }", ");"].join("\n");
}

/**
 * `export const feature = mod.feature("<stem>", [<identifier>]);`
 *
 * Three shapes, for the same reason: flat while it fits, then the array broken
 * out, then every argument broken out once even the opening line is too long.
 */
function featureCall(names: DerivedNames): string {
  const stem = quoteTs(names.stem);
  const flat = `export const feature = mod.feature(${stem}, [${names.identifier}]);`;
  if (flat.length <= PRINT_WIDTH) {
    return flat;
  }
  const open = `export const feature = mod.feature(${stem}, [`;
  if (open.length <= PRINT_WIDTH) {
    return [open, `  ${names.identifier},`, "]);"].join("\n");
  }
  return [
    "export const feature = mod.feature(",
    `  ${stem},`,
    `  [${names.identifier}]`,
    ");",
  ].join("\n");
}

/** Blank lines stay blank: an indented empty line is trailing whitespace. */
function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map((line) => (line === "" ? "" : `${prefix}${line}`));
}
