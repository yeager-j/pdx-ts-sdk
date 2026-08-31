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

const EVENT_PICTURE = "GFX_evt_mysterious_signal";
const EVENT_SOUND = "event_alien_signal";

/** The event this project's `onSuccess` fires, and the file's payoff. */
interface QuestCompletion {
  /** The `const` the generated file binds it to. */
  readonly binding: string;
  /** Its number inside the feature's namespace. */
  readonly id: number;
  readonly comment: string;
  readonly title: string;
}

/** One special project, with everything the sections need in order to write it. */
interface QuestProject {
  /** The `const` the generated file binds it to. */
  readonly binding: string;
  /** The logical name it mints its id from. */
  readonly logicalName: string;
  /** The comment introducing the declaration. Hand-wrapped, so it is data. */
  readonly comment: readonly string[];
  readonly namePlaceholder: string;
  /** Body lines between `cost` and `onSuccess`: the option-group correlation. */
  readonly correlation: readonly string[];
  /** Body lines after `onSuccess`: the commented-out optional field. */
  readonly trailer: readonly string[];
  readonly completion: QuestCompletion;
}

/**
 * The `projects` answer, resolved.
 *
 * The one Intent question changes the shape of the whole file: how many
 * projects are declared, what each is called, which completion event each
 * fires, whether an option group correlates them, how the header and the
 * starter's comment read, and which bindings the Feature roster carries.
 * Deciding that once and handing every section the result is what keeps those
 * consistent. Asking `projects === "one"` in each section instead made a
 * topology change six edits that had to agree — and forgetting the roster, for
 * one, leaves a rendered declaration outside the Feature, which is a file that
 * compiles and ships a definition the build never sees.
 */
interface QuestTopology {
  readonly projects: readonly [QuestProject, ...QuestProject[]];
}

const DESC_PLACEHOLDER = "PLACEHOLDER: what researching it involves, in a sentence or two.";

/**
 * Days before an untouched project expires, shown once. It is a field worth
 * knowing about and not worth repeating, so it rides on the first project
 * whether or not there is a second.
 */
const TIMELIMIT_TRAILER = [
  "",
  "// Days before an untouched project expires. 3600 is ten game years.",
  "// timelimit: 3600,",
];

function topologyFor(names: DerivedNames, projects: Projects): QuestTopology {
  if (projects === "one") {
    return {
      projects: [
        {
          binding: "project",
          logicalName: names.stem,
          comment: [
            "// `onSuccess` runs in the owner's country scope when the research finishes. It",
            "// may name `completed`, declared further down, because content callbacks run",
            "// at build time rather than here.",
          ],
          namePlaceholder: "PLACEHOLDER: what the situation log calls this project.",
          correlation: [],
          trailer: TIMELIMIT_TRAILER,
          completion: {
            binding: "completed",
            id: 2,
            comment: "// The payoff; ending the chain closes the situation log entry.",
            title: "PLACEHOLDER: the discovery.",
          },
        },
      ],
    };
  }
  return {
    projects: [
      {
        binding: "firstProject",
        logicalName: `${names.stem}_1`,
        comment: [
          "// `onSuccess` runs in the owner's country scope when the research finishes. It",
          "// may name `firstCompleted`, declared further down, because content callbacks",
          "// run at build time rather than here.",
        ],
        namePlaceholder: "PLACEHOLDER: what the situation log calls this approach.",
        correlation: [],
        trailer: TIMELIMIT_TRAILER,
        completion: {
          binding: "firstCompleted",
          id: 2,
          comment:
            "// The first approach pays off; ending the chain closes the situation log entry.",
          title: "PLACEHOLDER: the discovery.",
        },
      },
      {
        binding: "secondProject",
        logicalName: `${names.stem}_2`,
        comment: [
          "// The rival approach. Sharing an option group makes starting one project the",
          "// choice against the other: completing either removes both from the log.",
        ],
        namePlaceholder: "PLACEHOLDER: what the situation log calls the rival approach.",
        correlation: ["sameOptionGroupAs: [firstProject],"],
        trailer: [],
        completion: {
          binding: "secondCompleted",
          id: 3,
          comment: "// The rival approach pays off instead.",
          title: "PLACEHOLDER: the rival discovery.",
        },
      },
    ],
  };
}

/** True when the quest coordinates exactly one project, for the prose that says so. */
function isSingle(topology: QuestTopology): boolean {
  return topology.projects.length === 1;
}

/** Vanilla media cited by the generated visible events. */
export const VANILLA_EXAMPLE_IDS = {
  spriteType: [EVENT_PICTURE],
  soundEffect: [EVENT_SOUND],
} as const satisfies Readonly<Record<string, readonly string[]>>;

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
  // The one place the answer is read. Everything below consumes the topology.
  const topology = topologyFor(names, projects);
  return [
    header(topology),
    "",
    'import { onActions, vanilla } from "@pdx-ts/sdk/stellaris";',
    "",
    'import { mod } from "#mod";',
    "",
    chainCall(names),
    "",
    namespaceLines(names),
    "",
    ...projectCalls(topology),
    starterCall(topology),
    "",
    ...completionCalls(topology),
    ON_NEW_GAME,
    "",
    featureCall(names, topology),
    "",
  ].join("\n");
}

function header(topology: QuestTopology): string {
  const single = isSingle(topology);
  const what = single
    ? "the special project that advances it"
    : "the special projects that advance it";
  const enabled = single ? "the project" : "the projects";
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

/** Every project the topology carries, each followed by a blank separator line. */
function projectCalls(topology: QuestTopology): readonly string[] {
  return topology.projects.flatMap((project) => [
    [
      ...project.comment,
      call(`export const ${project.binding} = mod.specialProject(`, quoteTs(project.logicalName), [
        `name: ${quoteTs(project.namePlaceholder)},`,
        `desc: ${quoteTs(DESC_PLACEHOLDER)},`,
        "eventChain: chain,",
        `eventScope: "country_event",`,
        "cost: 1000,",
        ...project.correlation,
        "onSuccess: (country) => {",
        `  country.countryEvent({ id: ${project.completion.binding} });`,
        "},",
        ...project.trailer,
      ]),
    ].join("\n"),
    "",
  ]);
}

function starterCall(topology: QuestTopology): string {
  const single = isSingle(topology);
  const enable = topology.projects.map(
    (project) => `        country.enableSpecialProject({ name: ${project.binding} });`
  );
  const comment = [
    `// Opens the quest: begins the chain, and its option puts ${single ? "the project" : "both projects"} in the`,
    "// situation log. `enableSpecialProject` records when this event is defined,",
    `// which is why ${single ? "the project is" : "the projects are"} declared above it.`,
  ];
  return [
    ...comment,
    "export const started = events.country(1, {",
    `  title: ${quoteTs("PLACEHOLDER: the sighting that starts the quest.")},`,
    `  desc: ${quoteTs("PLACEHOLDER: what happened, in a paragraph.")},`,
    `  picture: vanilla.spriteType.eventpictures.${EVENT_PICTURE},`,
    `  showSound: vanilla.soundEffect.gui.gui_sound_effects.${EVENT_SOUND},`,
    "  eventChain: chain,",
    "  isTriggeredOnly: true,",
    "  immediate: (country) => {",
    "    country.beginEventChain({ eventChain: chain });",
    "  },",
    "  options: [",
    "    {",
    "      name: {",
    `        english: ${quoteTs("PLACEHOLDER: the option that takes the quest on.")},`,
    '        key: "accept_quest",',
    "      },",
    "      effects: (country) => {",
    ...enable,
    "      },",
    "    },",
    "  ],",
    "});",
  ].join("\n");
}

/** One completion event per project, each followed by a blank separator line. */
function completionCalls(topology: QuestTopology): readonly string[] {
  return topology.projects.flatMap(({ completion }) => [
    [
      completion.comment,
      `export const ${completion.binding} = events.country(${completion.id}, {`,
      `  title: ${quoteTs(completion.title)},`,
      `  desc: ${quoteTs("PLACEHOLDER: what was found, in a paragraph.")},`,
      `  picture: vanilla.spriteType.eventpictures.${EVENT_PICTURE},`,
      `  showSound: vanilla.soundEffect.gui.gui_sound_effects.${EVENT_SOUND},`,
      "  eventChain: chain,",
      "  isTriggeredOnly: true,",
      "  immediate: (country) => {",
      "    country.endEventChain(chain);",
      "  },",
      `  options: [{ name: { english: ${quoteTs("PLACEHOLDER: acknowledge it.")}, key: "acknowledge" } }],`,
      "});",
    ].join("\n"),
    "",
  ]);
}

const ON_NEW_GAME = [
  "// Without a hook nothing fires `started`; this fires it for every country when",
  "// a new game begins.",
  "export const onNewGame = mod.on(onActions.onGameStartCountry, [started]);",
].join("\n");

/**
 * Every item the file declares, in declaration order.
 *
 * Derived from the topology rather than restated beside it. A roster written
 * out by hand is the branch most easily forgotten when the topology changes,
 * and forgetting it leaves a rendered declaration outside the Feature: a file
 * that compiles, and a definition the build never emits.
 */
function roster(topology: QuestTopology): string[] {
  return [
    "chain",
    ...topology.projects.map((project) => project.binding),
    "started",
    ...topology.projects.map((project) => project.completion.binding),
    "onNewGame",
  ];
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
function featureCall(names: DerivedNames, topology: QuestTopology): string {
  return [
    `export const feature = mod.feature(${quoteTs(names.stem)}, [`,
    ...roster(topology).map((item) => `  ${item},`),
    "]);",
  ].join("\n");
}

/** Blank lines stay blank: an indented empty line is trailing whitespace. */
function indent(lines: readonly string[], prefix: string): string[] {
  return lines.map((line) => (line === "" ? "" : `${prefix}${line}`));
}
