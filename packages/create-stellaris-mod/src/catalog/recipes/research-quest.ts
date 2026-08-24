/**
 * The `research-quest` recipe: one event chain, one starter event, one or two
 * special projects with their completion events, one on-action registration —
 * several coordinated items, one feature file. This is the catalog's
 * architecture-acceptance case: the whole topology is ordinary recipe-local
 * TypeScript, and the cross-item references in the emitted source are ordinary
 * `const` bindings flowing into typed SDK fields.
 *
 * The topology is curated from the reviewed subterranean-civilization evidence
 * — structure only, never its script body or text: an on-action fires the
 * starter, the starter begins the chain and enables the project(s), each
 * project's `onSuccess` fires its completion event, and completing ends the
 * chain. The `projects` question is the one Intent question because `two`
 * changes topology: a rival project, its completion event, and the
 * `sameOptionGroupAs` correlation that makes the pair a choice.
 *
 * Two deliberate decisions the acceptance review should see:
 *
 * - Bindings are fixed recipe words (`chain`, `started`, `completed`, ...)
 *   rather than derivations of the author's name. The name reaches code only
 *   as quoted literals (and line shape, where its length moves a Prettier
 *   flip), so with the title neutralized the code is byte-identical —
 *   `adversarial-names.test.ts` asserts exactly that — and the reserved-word
 *   guard in `names.ts` never interacts with this file.
 * - No forward-handle machinery. The country-scope topology is acyclic under
 *   declaration order, so the source demonstrates the two ordering regimes the
 *   Authoring API actually has — event closures run at define time (projects
 *   are declared before the starter that enables them), content callbacks run
 *   at build time (`onSuccess` names a completion event declared below it) —
 *   and `events.countryHandle` stays out because nothing here requires it.
 *
 * The renderer owns the source's content and structure — declaration order,
 * which object bodies are expanded, the comments — and nothing about line
 * width: the catalog runs the pinned Prettier over the render (`../format.ts`),
 * so a long author name reflows by the formatter's own judgment rather than by
 * arithmetic here.
 */

import { quoteTs } from "../../quote.ts";
import { defineRecipe } from "../catalog.ts";
import type { DerivedNames } from "../types.ts";

type Projects = "one" | "two";

export const researchQuestRecipe = defineRecipe({
  summary: {
    id: "research-quest",
    title: "Research quest",
    summary:
      "An event chain, the special projects that advance it, and the events that begin and end it.",
    kind: "feature",
    itemKinds: ["event_chain", "special_project", "event", "on_action"],
  },
  questions: [
    {
      key: "projects",
      prompt: "How many special projects advance the quest?",
      choices: [
        {
          value: "one",
          label: "One special project",
          help: "A single research project completes the quest.",
        },
        {
          value: "two",
          label: "Two rival projects",
          help: "Two projects share one option group, so starting either is a choice against the other.",
        },
      ],
      defaultValue: "one",
      help: "Both answers share the chain, starter event, and on-action wiring; `two` adds the rival project, its own completion event, and the option-group correlation between the pair.",
    },
  ],
  render: ({ names, answers }) => renderSource(names, answers.projects),
});

function renderSource(names: DerivedNames, projects: Projects): string {
  return [
    header(projects),
    "",
    'import { onActions } from "@pdx-ts/sdk/stellaris";',
    "",
    'import { mod } from "#mod";',
    "",
    chainCall(names),
    "",
    namespaceLines(names),
    "",
    ...projectCalls(names, projects),
    starterCall(names, projects),
    "",
    ...completionCalls(names, projects),
    ON_NEW_GAME,
    "",
    featureCall(names, projects),
    "",
  ].join("\n");
}

function header(projects: Projects): string {
  const what =
    projects === "one"
      ? "the special project that advances it"
      : "the special projects that advance it";
  const enabled = projects === "one" ? "the project" : "the projects";
  return `/**
 * A research quest: one event chain, ${what}, and
 * the country events that begin and end it — several coordinated items, one
 * feature file.
 *
 * Generated once by the \`research-quest\` recipe, and yours from here. Nothing
 * reads this file back: there is no marker in it, no version, and no upgrade —
 * so rename it, add to it, or delete it as the mod grows.
 *
 * Declaration order is load-bearing in two different ways, and this file shows
 * both. An event's closures run when the event is defined, so \`started\` must
 * come after ${enabled} its option enables. A content callback such as a
 * project's \`onSuccess\` runs later, at build time, so it may name a completion
 * event that is declared below it.
 *
 * \`#mod\` is the project's own alias for \`src/mod.ts\` (see \`package.json#imports\`),
 * so moving this file deeper inside the content directory never rewrites the
 * import. The filename decides nothing either: the \`mod.feature(...)\` call at the
 * bottom is what names the emitted files.
 */`;
}

function chainCall(names: DerivedNames): string {
  const body = [
    `title: ${quoteTs(names.title)},`,
    `desc: ${quoteTs("PLACEHOLDER: what the situation log says this quest is about.")},`,
  ];
  return [
    "// The situation-log entry the whole quest hangs off.",
    call("export const chain = mod.eventChain(", quoteTs(names.stem), body),
  ].join("\n");
}

function namespaceLines(names: DerivedNames): string {
  return [
    "// One event namespace per feature file; every event below is",
    `// \`<prefix>_${names.stem}.<n>\` from birth. The handle stays local — a`,
    "// namespace belongs to exactly one file and must not be exported.",
    `const events = mod.namespace(${quoteTs(names.stem)});`,
  ].join("\n");
}

/** One or both projects, each followed by a blank separator line. */
function projectCalls(names: DerivedNames, projects: Projects): readonly string[] {
  if (projects === "one") {
    const body = [
      `name: ${quoteTs("PLACEHOLDER: what the situation log calls this project.")},`,
      `desc: ${quoteTs("PLACEHOLDER: what researching it involves, in a sentence or two.")},`,
      "eventChain: chain,",
      `eventScope: "country_event",`,
      "cost: 1000,",
      "onSuccess: (country) => {",
      "  country.countryEvent({ id: completed });",
      "},",
      "",
      "// Days before an untouched project expires. 3600 is ten game years.",
      "// timelimit: 3600,",
    ];
    return [
      [
        "// `onSuccess` runs in the owner's country scope when the research finishes. It",
        "// may name `completed`, declared further down, because content callbacks run",
        "// at build time rather than here.",
        call("export const project = mod.specialProject(", quoteTs(names.stem), body),
      ].join("\n"),
      "",
    ];
  }
  const first = [
    `name: ${quoteTs("PLACEHOLDER: what the situation log calls this approach.")},`,
    `desc: ${quoteTs("PLACEHOLDER: what researching it involves, in a sentence or two.")},`,
    "eventChain: chain,",
    `eventScope: "country_event",`,
    "cost: 1000,",
    "onSuccess: (country) => {",
    "  country.countryEvent({ id: firstCompleted });",
    "},",
    "",
    "// Days before an untouched project expires. 3600 is ten game years.",
    "// timelimit: 3600,",
  ];
  const second = [
    `name: ${quoteTs("PLACEHOLDER: what the situation log calls the rival approach.")},`,
    `desc: ${quoteTs("PLACEHOLDER: what researching it involves, in a sentence or two.")},`,
    "eventChain: chain,",
    `eventScope: "country_event",`,
    "cost: 1000,",
    "sameOptionGroupAs: [firstProject],",
    "onSuccess: (country) => {",
    "  country.countryEvent({ id: secondCompleted });",
    "},",
  ];
  return [
    [
      "// `onSuccess` runs in the owner's country scope when the research finishes. It",
      "// may name `firstCompleted`, declared further down, because content callbacks",
      "// run at build time rather than here.",
      call("export const firstProject = mod.specialProject(", quoteTs(`${names.stem}_1`), first),
    ].join("\n"),
    "",
    [
      "// The rival approach. Sharing an option group makes starting one project the",
      "// choice against the other: completing either removes both from the log.",
      call("export const secondProject = mod.specialProject(", quoteTs(`${names.stem}_2`), second),
    ].join("\n"),
    "",
  ];
}

function starterCall(names: DerivedNames, projects: Projects): string {
  const enable =
    projects === "one"
      ? ["        country.enableSpecialProject({ name: project });"]
      : [
          "        country.enableSpecialProject({ name: firstProject });",
          "        country.enableSpecialProject({ name: secondProject });",
        ];
  const comment =
    projects === "one"
      ? [
          "// Opens the quest: begins the chain, and its option puts the project in the",
          "// situation log. `enableSpecialProject` records when this event is defined,",
          "// which is why the project is declared above it.",
        ]
      : [
          "// Opens the quest: begins the chain, and its option puts both projects in the",
          "// situation log. `enableSpecialProject` records when this event is defined,",
          "// which is why the projects are declared above it.",
        ];
  return [
    ...comment,
    "export const started = events.country(1, {",
    `  title: ${quoteTs("PLACEHOLDER: the sighting that starts the quest.")},`,
    `  desc: ${quoteTs("PLACEHOLDER: what happened, in a paragraph.")},`,
    "  eventChain: chain,",
    "  isTriggeredOnly: true,",
    "  immediate: (country) => {",
    "    country.beginEventChain({ eventChain: chain });",
    "  },",
    "  options: [",
    "    {",
    `      name: ${quoteTs("PLACEHOLDER: the option that takes the quest on.")},`,
    '      key: "accept_quest",',
    "      effects: (country) => {",
    ...enable,
    "      },",
    "    },",
    "  ],",
    "});",
  ].join("\n");
}

/** The completion event(s), each followed by a blank separator line. */
function completionCalls(names: DerivedNames, projects: Projects): readonly string[] {
  const completion = (binding: string, id: number, comment: string, title: string): string =>
    [
      comment,
      `export const ${binding} = events.country(${id}, {`,
      `  title: ${quoteTs(title)},`,
      `  desc: ${quoteTs("PLACEHOLDER: what was found, in a paragraph.")},`,
      "  eventChain: chain,",
      "  isTriggeredOnly: true,",
      "  immediate: (country) => {",
      "    country.endEventChain(chain);",
      "  },",
      `  options: [{ name: ${quoteTs("PLACEHOLDER: acknowledge it.")}, key: "acknowledge" }],`,
      "});",
    ].join("\n");
  if (projects === "one") {
    return [
      completion(
        "completed",
        2,
        "// The payoff; ending the chain closes the situation log entry.",
        "PLACEHOLDER: the discovery."
      ),
      "",
    ];
  }
  return [
    completion(
      "firstCompleted",
      2,
      "// The first approach pays off; ending the chain closes the situation log entry.",
      "PLACEHOLDER: the discovery."
    ),
    "",
    completion(
      "secondCompleted",
      3,
      "// The rival approach pays off instead.",
      "PLACEHOLDER: the rival discovery."
    ),
    "",
  ];
}

const ON_NEW_GAME = [
  "// Without a hook nothing fires `started`; this fires it for every country when",
  "// a new game begins.",
  "export const onNewGame = mod.on(onActions.onGameStartCountry, [started]);",
].join("\n");

function items(projects: Projects): string {
  return projects === "one"
    ? "chain, project, started, completed, onNewGame"
    : "chain, firstProject, secondProject, started, firstCompleted, secondCompleted, onNewGame";
}

/**
 * `mod.<definer>("<logical name>", { ... });` — always the hugged shape. The
 * body stays expanded because it is written across lines; whether the opening
 * line survives an author's long name is the formatter's call, not this one.
 */
function call(open: string, logicalName: string, body: readonly string[]): string {
  return [`${open}${logicalName}, {`, ...indent(body, "  "), "});"].join("\n");
}

/**
 * `export const feature = mod.feature("<stem>", [ ... ]);` — one item per
 * line, always: a coordinated Feature's roster reads as a list, and this is
 * the shape Prettier keeps for it at any conventional name length.
 */
function featureCall(names: DerivedNames, projects: Projects): string {
  return [
    `export const feature = mod.feature(${quoteTs(names.stem)}, [`,
    ...items(projects)
      .split(", ")
      .map((item) => `  ${item},`),
    "]);",
  ].join("\n");
}

/** Blank lines stay blank: an indented empty line is trailing whitespace. */
function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map((line) => (line === "" ? "" : `${prefix}${line}`));
}
