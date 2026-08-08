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
 * The renderer owns the source's content and structure — field order, which
 * bodies are expanded, the comments — and nothing about line width: the
 * catalog runs the pinned Prettier over the render (`../format.ts`), so a long
 * author name reflows by the formatter's own judgment rather than by
 * arithmetic here.
 */

import { quoteTs } from "../../quote.ts";
import { defineRecipe } from "../catalog.ts";
import type { DerivedNames } from "../types.ts";

/**
 * The vanilla technology the `prerequisites` example cites. Interpolated rather
 * than written into the comment text, so the id an author reads and the id the
 * gate below checks cannot become two different facts.
 */
const PREREQUISITE_EXAMPLE = "tech_basic_science_lab_1";

/**
 * Every vanilla id this recipe's examples cite, keyed by the registry in
 * `@pdx-ts/stellaris-ids` that has to still carry it.
 *
 * A vanilla id in a curated example is a restated fact about the game, and this
 * repository's rule for a restated fact is that something must break when it
 * stops being true — the same trade `PREFIX_PATTERN` and the manifest's
 * launcher-version grammar make. `recipe-matrix.test.ts` reads the committed
 * registry, so a regenerated identifier package that drops this id fails there
 * rather than in an author's project. The coupling is dev-time only: nothing
 * here imports the package, and `packaging.test.ts` is what pins the runtime
 * dependencies.
 */
export const VANILLA_EXAMPLE_IDS = {
  technology: [PREREQUISITE_EXAMPLE],
} as const satisfies Readonly<Record<string, readonly string[]>>;

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
 * Active fields first, then the two optional examples. Each example compiles as
 * written the moment its `// ` is removed — it names nothing this file does not
 * already have — which is the whole test of whether an example belongs in a
 * starter at all, and which `recipe-matrix.test.ts` uncomments and compiles
 * rather than taking on trust. So the cross-file idiom is prose: the example
 * itself uses a vanilla id, which is a plain string the SDK accepts.
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
    "// Technologies that must be researched first. A vanilla technology is a plain",
    "// string, taken as given — nothing checks a bare literal;",
    "// `vanilla.technology(...)` from @pdx-ts/sdk is the checked form, against the",
    "// real id set when @pdx-ts/stellaris-ids is installed. One of your own is the",
    "// binding another feature file exports, imported as usual.",
    `// prerequisites: [${quoteTs(PREREQUISITE_EXAMPLE)}],`,
    "",
    "// How likely the game is to offer this as a research option next to the",
    "// others in its category. 100 is the conventional starting weight.",
    "// weight: 100,",
  ];
}

/**
 * `const <identifier> = mod.technology("<logical name>", { ... });` — always
 * the hugged shape. The body stays expanded because it is written across
 * lines; whether the opening line survives a long name is the formatter's
 * call, not this one.
 */
function technologyCall(names: DerivedNames): string {
  const open = `export const ${names.identifier} = mod.technology(`;
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
