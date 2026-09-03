/**
 * The `event` recipe: one event, one feature, two questions.
 *
 * Both questions change structure rather than a leaf value, which is the whole
 * test for whether something is an Intent question. `visibility` decides whether
 * the emitted event has a window at all — a visible event carries a title, a
 * description, picture, sound, and an option whose effects run when the player
 * picks it; a hidden one carries `hideWindow` and an `immediate` closure and has
 * no window fields to carry. `event-kind` decides which definer mints the event,
 * and the definer fixes the root scope of every callback in the file: `events.ship(...)`
 * hands its closures a ship, so `setShipFlag` is legal there and `setCountryFlag`
 * is not. Neither is a value an author could reasonably retype in source
 * afterwards; both are the shape of the file.
 *
 * The four kinds are a curated onboarding subset rather than a projection of
 * `EVENT_KINDS`. `country`, `planet`, `ship` and `fleet` are the scopes a first
 * event plausibly happens to. The kinds left out are either narrower scopes a
 * starter has no use for, or kinds whose useful fields are legal on exactly one
 * of them — `archaeology` only on `fleet`, `firstContact`, `espionageOperation`
 * and `astralRift` each only on their own — so offering them would put an author
 * one answer away from an event that compiles and never renders.
 *
 * The recipe cannot import the SDK to prove those four are still supported — the
 * CLI has no runtime SDK dependency, and a recipe module is pure. So it exports
 * the mapping as data ({@link EVENT_KIND_CHOICES}) and `recipe-matrix.test.ts`
 * does the cross-check against the SDK's own `EVENT_KINDS`. A kind the SDK
 * stopped supporting, or renamed, fails there rather than in an author's project.
 *
 * Both branches set `isTriggeredOnly`, because this recipe emits one Item and
 * therefore no hook: an event nothing fires is the honest starting point, and a
 * comment in the emitted source says what has to fire it. `research-quest` is
 * the recipe that generates the wiring.
 *
 * The event binds the derived identifier, the way `technology` does; the
 * namespace handle stays the fixed word `events`, the way `research-quest` does.
 * The difference is what each binding is for. The item is what another file
 * imports, so it is worth naming after the thing the author asked for — and it
 * is what `generate`'s own preview tells them the binding will be. The handle is
 * local, unexported, and one per Feature, so it has nothing to be named after.
 * `adversarial-names.test.ts` proves that derivation against reserved words,
 * leading digits and injection attempts once, centrally.
 *
 * The renderer owns the source's content and structure — declaration order,
 * which bodies are expanded, the comments — and nothing about line width.
 * Renderers emit one conventional shape; after publication `generate` hands the
 * written file to the project's own Prettier when one is installed
 * (`../../format-project.ts`), so a long author name reflows by that formatter's
 * judgment rather than by arithmetic here.
 */

import { quoteTs } from "../../quote.ts";
import { defineRecipe } from "../catalog.ts";
import type { DerivedNames } from "../types.ts";

type Visibility = "visible" | "hidden";
type EventKind = "country" | "planet" | "ship" | "fleet";

/**
 * Each `event-kind` answer and the script kind the definer it names emits.
 *
 * This is the recipe's half of a fact it shares with the SDK, exported so the
 * other half can be checked: `recipe-matrix.test.ts` reads `EVENT_KINDS` from
 * `@pdx-ts/sdk` and asserts that every value here is still a kind the game
 * declares, and that the kind's own scope is still the answer that selected it.
 * Data rather than an import, because a recipe module imports nothing but the
 * quoting helper and the catalog's types.
 */
export const EVENT_KIND_CHOICES = {
  country: "country_event",
  planet: "planet_event",
  ship: "ship_event",
  fleet: "fleet_event",
} as const satisfies Readonly<Record<EventKind, string>>;

/**
 * The vanilla media used by the visible event. Both are generic enough for a
 * starter event of any of the four kinds. Interpolation keeps the generated
 * source and the identifier gate on the same values.
 */
const PICTURE_EXAMPLE = "GFX_evt_mysterious_signal";
const SOUND_EXAMPLE = "event_alien_signal";

/**
 * Every vanilla id this recipe's examples cite, keyed by the registry in
 * `@pdx-ts/stellaris-ids` that has to still carry it.
 *
 * Same trade `technology.ts` makes, and for the same reason: a vanilla id in a
 * curated example is a restated fact about the game, and a restated fact gets a
 * gate. Only the visible branch cites one — a hidden event has no window to put
 * a picture in — so that is the variant the gate renders.
 */
export const VANILLA_EXAMPLE_IDS = {
  spriteType: [PICTURE_EXAMPLE],
  soundEffect: [SOUND_EXAMPLE],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** What one `event-kind` answer changes about the emitted source. */
interface KindWords {
  /** How prose names the thing the event happens to. */
  readonly subject: string;
  /** The flag effect this root scope carries and the other three do not. */
  readonly flagEffect: string;
  /** The effect another event would reach this one through. */
  readonly fire: string;
}

/**
 * The kind-specific words, as a table.
 *
 * The answer value is also the definer's method name and the closure
 * parameter's name — `events.fleet(1, ...)` hands its callbacks a `fleet` —
 * so those two are interpolated from the answer rather than restated here.
 * What the table holds is the part that genuinely differs.
 */
const KIND_WORDS = {
  country: { subject: "a country", flagEffect: "setCountryFlag", fire: "countryEvent" },
  planet: { subject: "a planet", flagEffect: "setPlanetFlag", fire: "planetEvent" },
  ship: { subject: "a ship", flagEffect: "setShipFlag", fire: "shipEvent" },
  fleet: { subject: "a fleet", flagEffect: "setFleetFlag", fire: "fleetEvent" },
} as const satisfies Readonly<Record<EventKind, KindWords>>;

export const eventRecipe = defineRecipe({
  summary: {
    id: "event",
    title: "Event",
    summary: "One event, visible or hidden, in the scope you choose.",
    kind: "item",
    itemKinds: ["event"],
  },
  questions: [
    {
      key: "visibility",
      prompt: "Does the event show a window?",
      choices: [
        {
          value: "visible",
          label: "Visible",
          help: "A window with a title, a description, and one option the player picks.",
        },
        {
          value: "hidden",
          label: "Hidden",
          help: "No window: the effects run the moment the event fires.",
        },
      ],
      defaultValue: "visible",
      help: "A visible event carries the window fields and does its work in an option's effects; a hidden one carries `hideWindow` and does its work in `immediate`, with no window fields at all.",
    },
    {
      key: "event-kind",
      prompt: "What does the event happen to?",
      choices: [
        {
          value: "country",
          label: "A country",
          help: "The empire itself — the kind most events are.",
        },
        { value: "planet", label: "A planet", help: "One planet, colonized or not." },
        { value: "ship", label: "A ship", help: "A single ship, such as a science ship." },
        { value: "fleet", label: "A fleet", help: "A whole fleet, including a one-ship fleet." },
      ],
      defaultValue: "country",
      help: "The kind picks the definer, and the definer fixes the scope every callback in the file receives: a ship event's callbacks take a ship, so only ship-scope effects are legal in them.",
    },
  ],
  render: ({ names, answers }) => renderSource(names, answers.visibility, answers["event-kind"]),
});

function renderSource(names: DerivedNames, visibility: Visibility, kind: EventKind): string {
  return [
    header(visibility, kind),
    "",
    ...(visibility === "visible" ? ['import { vanilla } from "@pdx-ts/sdk/stellaris";', ""] : []),
    'import { mod } from "#mod";',
    "",
    namespaceLines(names),
    "",
    eventCall(names, visibility, kind),
    "",
    featureCall(names),
    "",
  ].join("\n");
}

function header(visibility: Visibility, kind: EventKind): string {
  const { subject, fire } = KIND_WORDS[kind];
  const window =
    visibility === "visible"
      ? ` * It shows a window. \`title\`, \`desc\` and the option's \`name\` are English text
 * here and localization keys in the emitted mod. \`picture\` and \`showSound\`
 * select checked vanilla media. The option's \`effects\` run when the player
 * picks it.`
      : ` * It shows no window. \`hideWindow\` makes the event run its \`immediate\` effects
 * and finish without the player being shown anything, which is the ordinary
 * shape for the bookkeeping an on-action or another event sets off.`;
  return `/**
 * One ${kind} event, and the feature that places it.
 *
 * Generated once by the \`event\` recipe, and yours from here. Nothing reads
 * this file back: there is no marker in it, no version, and no upgrade — so
 * rename it, add to it, or delete it as the mod grows.
 *
 * The definer is what makes this a \`${EVENT_KIND_CHOICES[kind]}\`. There is no \`type\`
 * field to set: \`events.${kind}(...)\` decides both the kind the game reads and the
 * scope every callback below is handed, so the event happens to ${subject} and the
 * effects legal inside it are ${kind}-scope effects. Firing it from elsewhere goes
 * through \`${fire}\`.
 *
${window}
 *
 * \`#mod\` is the project's own alias for \`src/mod.ts\` (see \`package.json#imports\`),
 * so this import never changes when the file moves. The filename decides
 * nothing either: the \`mod.feature(...)\` call at the bottom is what names the
 * emitted files, and what puts it in the mod is its line in \`src/features.ts\`.
 */`;
}

function namespaceLines(names: DerivedNames): string {
  return [
    "// A namespace belongs to exactly one Feature; the event below is",
    `// \`<prefix>_${names.stem}.1\` from birth. Keep the handle inside this Feature's`,
    "// own files, and never export it.",
    `const events = mod.namespace(${quoteTs(names.stem)});`,
  ].join("\n");
}

/**
 * `export const <identifier> = events.<kind>(1, { ... });`, preceded by the note
 * about what has to fire it.
 *
 * The two branches share the definer line, the flag effect and the
 * `fireOnlyOnce` example; they differ in everything the window implies, and the
 * hidden branch omits the window fields structurally rather than commenting them
 * out. A commented `title:` would be an example that cannot be taken up.
 */
function eventCall(names: DerivedNames, visibility: Visibility, kind: EventKind): string {
  const { fire } = KIND_WORDS[kind];
  return [
    "// Nothing fires this on its own: `isTriggeredOnly` tells the game never to",
    `// schedule it. Give it a hook — \`mod.on(onActions.<action>, [${names.identifier}])\` —`,
    "// or fire it from another event's effects, where the fire operation is a",
    `// method on the scope you are in: \`<scope>.${fire}({ id: ${names.identifier} })\`.`,
    "// The `research-quest` recipe generates one wired end to end.",
    `export const ${names.identifier} = events.${kind}(1, {`,
    ...indent(
      visibility === "visible" ? visibleFields(names, kind) : hiddenFields(names, kind),
      "  "
    ),
    "});",
  ].join("\n");
}

function visibleFields(names: DerivedNames, kind: EventKind): readonly string[] {
  return [
    `title: ${quoteTs("PLACEHOLDER: the headline the event window shows.")},`,
    `desc: ${quoteTs("PLACEHOLDER: what happened, in a paragraph.")},`,
    "isTriggeredOnly: true,",
    "options: [",
    "  {",
    `    name: { english: ${quoteTs("PLACEHOLDER: acknowledge it.")}, key: "acknowledge" },`,
    `    effects: (${kind}) => {`,
    ...indent(flagLines(names, kind), "      "),
    "    },",
    "  },",
    "],",
    "",
    `picture: vanilla.spriteType.eventpictures.${PICTURE_EXAMPLE},`,
    `showSound: vanilla.soundEffect.gui.gui_sound_effects.${SOUND_EXAMPLE},`,
    ...FIRE_ONLY_ONCE_EXAMPLE,
  ];
}

function hiddenFields(names: DerivedNames, kind: EventKind): readonly string[] {
  return [
    "// No window at all: `immediate` runs the moment the event fires and the",
    "// player is shown nothing, so the fields a window would need have nothing",
    "// to say here.",
    "hideWindow: true,",
    "isTriggeredOnly: true,",
    `immediate: (${kind}) => {`,
    ...indent(flagLines(names, kind), "  "),
    "},",
    "",
    ...FIRE_ONLY_ONCE_EXAMPLE,
  ];
}

/**
 * The kind-scoped work both branches do, at zero indent.
 *
 * A flag is the ordinary way one piece of script tells another that something
 * happened, and each root scope has its own — which is exactly the fact the
 * `event-kind` question exists to teach, so the starter demonstrates it rather
 * than describing it.
 */
function flagLines(names: DerivedNames, kind: EventKind): readonly string[] {
  const { flagEffect } = KIND_WORDS[kind];
  return [
    `// \`${kind}\` is this event's root scope, and the kind is what fixed it.`,
    `// \`${flagEffect}\` is in scope here; the other three scopes' flag`,
    "// effects are not. Flags are how the rest of your script learns this ran.",
    "//",
    "// Flag names are shared with every other mod the player has loaded, so this",
    "// one carries the mod prefix the way the scaffolded example does. Reading it",
    "// back — `hasCountryFlag` and its siblings — takes the same string.",
    `${kind}.${flagEffect}(\`\${mod.config.prefix}_${names.stem}_fired\`);`,
  ];
}

const FIRE_ONLY_ONCE_EXAMPLE: readonly string[] = [
  "// Fires at most once per game, no matter how often its hook runs.",
  "// fireOnlyOnce: true,",
];

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
