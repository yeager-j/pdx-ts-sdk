/**
 * The `building` recipe: one building, one feature, no questions.
 *
 * The second zero-question starter, and it earns its place the same way
 * `technology` does. What it installs is a *reviewed* shape — the fields a
 * working building actually sets, in the order they read in, with the two
 * optional ones worth knowing about shown commented and ready to uncomment.
 * Nothing here is a choice an author would want to be asked about: a building's
 * category and cost are leaf values, easier to edit in source than to answer at
 * a prompt, so this recipe asks nothing.
 *
 * The curated values are the conventional ones in the committed corpus
 * (`packages/sdk/tests/fixtures/corpus/building.json`): `research` as both the
 * category and the building set, `baseBuildtime: 240`, and a `resources` block
 * with the `category`/`cost`/`upkeep` shape that 458 shipped buildings write.
 * `desc` is the only required author text with nothing to derive it from, so it
 * ships as a greppable `PLACEHOLDER:` value that still typechecks and still
 * builds.
 *
 * Three things are deliberately absent. A `produces` arm, because a vanilla
 * building produces through the jobs and modifiers it grants rather than
 * directly, and an active `produces` here would teach the wrong idiom — a prose
 * comment says so instead. The modifier closures, which are a subject rather
 * than a starter line. And the documented exceptional building-set forms
 * (Overlord holdings, branch offices), which are exceptions and not the shape to
 * learn first.
 *
 * The item binds the derived identifier, the way `technology` does rather than
 * the way `research-quest` does. A Feature recipe's several items need role
 * names, so fixed recipe words are right there; one item has no role to
 * distinguish it from, and the author is better served by the name they typed —
 * which is also what `generate`'s own preview tells them the binding will be.
 * `adversarial-names.test.ts` proves that derivation against reserved words,
 * leading digits and injection attempts once, centrally.
 *
 * The renderer owns the source's content and structure — field order, which
 * bodies are expanded, the comments — and nothing about line width. Renderers
 * emit one conventional shape; after publication `generate` hands the written
 * file to the project's own Prettier when one is installed (`../../format-project.ts`),
 * so a long author name reflows by that formatter's judgment rather than by
 * arithmetic here.
 */

import { quoteTs } from "../../quote.ts";
import { defineRecipe } from "../catalog.ts";
import type { DerivedNames } from "../types.ts";

/**
 * The vanilla technology the `prerequisites` example cites, and the vanilla
 * building the `upgrades` example points at. Interpolated rather than written
 * into the comment text, so the id an author reads and the id the gate below
 * checks cannot become two different facts.
 */
const PREREQUISITE_EXAMPLE = "tech_basic_science_lab_1";
const UPGRADE_EXAMPLE = "building_research_lab_2";

/**
 * Every vanilla id this recipe's examples cite, keyed by the registry in
 * `@pdx-ts/stellaris-ids` that has to still carry it.
 *
 * Same trade `technology.ts` makes, and for the same reason: a vanilla id in a
 * curated example is a restated fact about the game, and a restated fact gets a
 * gate. `recipe-matrix.test.ts` reads the committed registry, so a regenerated
 * identifier package that drops either id fails there rather than in an author's
 * project.
 */
export const VANILLA_EXAMPLE_IDS = {
  technology: [PREREQUISITE_EXAMPLE],
  building: [UPGRADE_EXAMPLE],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export const buildingRecipe = defineRecipe({
  summary: {
    id: "building",
    title: "Building",
    summary: "One constructible planet building, plus the feature file that places it.",
    kind: "item",
    itemKinds: ["building"],
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
    buildingCall(names),
    "",
    featureCall(names),
    "",
  ].join("\n");
}

const HEADER = `/**
 * One building, and the feature that places it.
 *
 * Generated once by the \`building\` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * \`#mod\` is the project's own alias for \`src/mod.ts\` (see \`package.json#imports\`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the \`mod.feature(...)\` call at the
 * bottom is what names the emitted files.
 */`;

/**
 * The building's fields, as source lines at zero indent.
 *
 * Active fields first, then the note about `produces`, then the two optional
 * examples. Each example compiles as written the moment its `// ` is removed —
 * it names nothing this file does not already have — which is the whole test of
 * whether an example belongs in a starter at all, and which
 * `recipe-matrix.test.ts` uncomments and compiles rather than taking on trust.
 */
function fields(names: DerivedNames): readonly string[] {
  return [
    `name: ${quoteTs(names.title)},`,
    `desc: ${quoteTs("PLACEHOLDER: what this building does for the colony, in a sentence or two.")},`,
    `category: "research",`,
    "// Which planet classes' construction lists this appears in. A building needs",
    "// at least one set, and `research` groups it with the research buildings.",
    `buildingSets: ["research"],`,
    "baseBuildtime: 240,",
    "// What it costs to build, and what it costs to run every month. `amounts` is",
    "// the wrapper around the resource map — a bare `{ minerals: 300 }` is a",
    "// compile error rather than a block the game silently ignores.",
    "resources: [",
    "  {",
    `    category: "planet_buildings",`,
    "    cost: { amounts: { minerals: 300 } },",
    "    upkeep: { amounts: { energy: 2 } },",
    "  },",
    "],",
    "",
    "// There is no `produces` arm here on purpose. A building gives the colony",
    "// something back through the jobs and modifiers it grants — `planetModifier`,",
    "// `countryModifier`, a job of your own — rather than by producing directly.",
    "",
    "// Technologies that must be researched before this can be built. A vanilla",
    "// technology is a plain string, taken as given — nothing checks a bare",
    "// literal; `vanilla.technology(...)` from @pdx-ts/sdk/stellaris is the checked form,",
    "// against the real id set when @pdx-ts/stellaris-ids is installed. One of",
    "// your own is the binding another feature file exports, imported as usual.",
    `// prerequisites: [${quoteTs(PREREQUISITE_EXAMPLE)}],`,
    "",
    "// What the colony can replace this with once it is built. Same reference",
    "// either way: a vanilla building id, or an imported binding of your own.",
    `// upgrades: [${quoteTs(UPGRADE_EXAMPLE)}],`,
  ];
}

/**
 * `export const <identifier> = mod.building("<logical name>", { ... });` —
 * always the hugged shape. The body stays expanded because it is written across
 * lines; whether the opening line survives a long name is the formatter's
 * call, not this one.
 */
function buildingCall(names: DerivedNames): string {
  const open = `export const ${names.identifier} = mod.building(`;
  return [`${open}${quoteTs(names.logicalName)}, {`, ...indent(fields(names), "  "), "});"].join(
    "\n"
  );
}

/**
 * `export const feature = mod.feature("<stem>", [<identifier>]);` — written
 * flat; the formatter breaks it out when the line does not fit.
 */
function featureCall(names: DerivedNames): string {
  return `export const feature = mod.feature(${quoteTs(names.stem)}, [${names.identifier}]);`;
}

/** Blank lines stay blank: an indented empty line is trailing whitespace. */
function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map((line) => (line === "" ? "" : `${prefix}${line}`));
}
