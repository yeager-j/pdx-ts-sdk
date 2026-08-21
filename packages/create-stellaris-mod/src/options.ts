/**
 * The command table, the init flag table, and the resolved shape the rest of
 * the CLI consumes.
 *
 * One table feeds both `parseArgs` and `--help`, because two lists drift: a
 * flag added to the parser and forgotten in the help text is invisible, and one
 * documented but unparsed is worse. A test asserts they still agree.
 */

import { parseArgs, type ParseArgsConfig } from "node:util";

/**
 * The reserved first-position command names.
 *
 * Reserving them is a real, if tiny, breaking change: a directory literally
 * named `list` can no longer be scaffolded as bare `create-stellaris-mod list`,
 * and needs `create-stellaris-mod init list` instead. That is the price of
 * having commands at all, and the canonical spelling exists for exactly this.
 */
export const COMMANDS = {
  init: "Scaffold a new mod project (the default)",
  list: "List the recipes the catalog can generate",
  view: "Show one recipe's questions, flags, and defaults",
  generate: "Generate one feature source file into a project",
} as const;

export type CommandName = keyof typeof COMMANDS;

export interface SplitArgv {
  readonly command: CommandName;
  /** `argv` with the command name removed, when one was spelled out. */
  readonly rest: readonly string[];
}

/**
 * Which command this argv selects, before any flag is parsed.
 *
 * The command has to be the *first* argument rather than the first positional,
 * and that is not laziness: the flag table is per-command, so working out which
 * arguments are positionals already requires knowing the command. Every
 * command-shaped CLI takes the same route, and `--name init my-mod` — where
 * `init` is a value, not a command — is the case that rules the alternative out.
 */
export function splitCommand(argv: readonly string[]): SplitArgv {
  const first = argv[0];
  if (first !== undefined && Object.hasOwn(COMMANDS, first)) {
    return { command: first as CommandName, rest: argv.slice(1) };
  }
  return { command: "init", rest: argv };
}

export interface FlagSpec {
  readonly type: "string" | "boolean";
  readonly short?: string;
  /** Placeholder shown in `--help`, for flags that take a value. */
  readonly value?: string;
  readonly describe: string;
  /**
   * True when the flag is a `--no-x`-able boolean that defaults on. Recorded
   * so `--help` can print the useful half (`--no-git`) rather than the
   * redundant one (`--git`).
   */
  readonly negatable?: boolean;
}

export interface GenerateFlagSpec extends FlagSpec {
  /** A recipe question may not take over a command-owned flag name. */
  readonly reservedForRecipe: boolean;
}

export const FLAGS = {
  name: { type: "string", value: "<string>", describe: "Display name, as the launcher shows it" },
  prefix: {
    type: "string",
    value: "<snake_case>",
    describe: "Namespace for every id and file the mod emits",
  },
  "stellaris-path": {
    type: "string",
    value: "<path>",
    describe: "Game root, when it is not where the SDK looks",
  },
  "supported-version": {
    type: "string",
    value: "<v4.4.*>",
    describe: "Launcher compatibility; derived from the install when detected",
  },
  tags: { type: "string", value: "<a,b>", describe: "Launcher tags, comma separated" },
  local: {
    type: "string",
    value: "<path>",
    describe: "Depend on a local pdx-sdk checkout via file: links instead of the registry",
  },
  pm: {
    type: "string",
    value: "<npm|pnpm|yarn|bun>",
    describe: "Package manager to install with",
  },
  prettier: { type: "boolean", negatable: true, describe: "Prettier config (default: yes)" },
  eslint: { type: "boolean", negatable: true, describe: "ESLint config (default: yes)" },
  llm: {
    type: "boolean",
    negatable: true,
    describe: "Codex and Claude project support (default: yes)",
  },
  git: { type: "boolean", negatable: true, describe: "Initialize a git repository (default: yes)" },
  install: { type: "boolean", negatable: true, describe: "Install dependencies (default: yes)" },
  "dry-run": { type: "boolean", describe: "Print what would be written, write nothing" },
  yes: { type: "boolean", short: "y", describe: "Take every default; never prompt" },
  help: { type: "boolean", short: "h", describe: "Show this help" },
  version: { type: "boolean", short: "v", describe: "Show the version" },
} as const satisfies Record<string, FlagSpec>;

export type FlagName = keyof typeof FLAGS;

/**
 * The flags `generate` owns whatever recipe is selected.
 *
 * `--cwd` is generate's own; the rest are shared with `init` and reuse its
 * specs, because `--dry-run` promising one thing under one command and another
 * under the next is exactly the drift a second table invites.
 */
export const GENERATE_FLAGS = {
  cwd: {
    type: "string",
    value: "<path>",
    describe: "Start the manifest search here, not in the current directory",
    reservedForRecipe: true,
  },
  yes: { ...FLAGS.yes, reservedForRecipe: true },
  "dry-run": { ...FLAGS["dry-run"], reservedForRecipe: true },
  "allow-unsupported-sdk": {
    type: "boolean",
    describe: "Generate even when the SDK range cannot be proved supported",
    reservedForRecipe: true,
  },
  help: { ...FLAGS.help, reservedForRecipe: true },
  version: { ...FLAGS.version, reservedForRecipe: true },
} as const satisfies Record<string, GenerateFlagSpec>;

export type GenerateFlagName = keyof typeof GENERATE_FLAGS;

/**
 * A derived projection of the command-owned names, for the one consumer that
 * needs names alone: a recipe's question key becomes `--<key>`, so a question called
 * `dry-run` would silently shadow the flag that decides whether anything is
 * written. The catalog rejects that collision when it is constructed rather
 * than when somebody runs the recipe, and this is the list it checks against.
 *
 * `help` and `version` are in it even though they are not generate-specific:
 * `--help` must keep meaning help under every command.
 *
 * The reserved policy is declared beside each canonical flag, so a new command
 * flag cannot accidentally become a recipe question merely because somebody
 * forgot a second handwritten list.
 */
export const COMMON_GENERATE_FLAGS = Object.keys(GENERATE_FLAGS).filter(
  (name): name is GenerateFlagName => GENERATE_FLAGS[name as GenerateFlagName].reservedForRecipe
);

/** A fault in what an author typed, as opposed to a fault in their project. */
export class OptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionsError";
  }
}

/** Everything the scaffold needs, with every question already answered. */
export interface Resolved {
  readonly targetDir: string;
  readonly name: string;
  readonly prefix: string;
  readonly supportedVersion: string;
  readonly tags: readonly string[];
  /** Absent when no install was found or the author declined to name one. */
  readonly installPath: string | undefined;
  /**
   * True when the author named the path rather than detection finding it at a
   * platform default. The generated project bakes it in only in that case:
   * otherwise its own detection will find the same install, and an absolute
   * machine path in a committed file is noise a teammate has to delete.
   */
  readonly installPathIsExplicit: boolean;
  /** The detected build, used to pin `@pdx-ts/stellaris-ids`. */
  readonly gameVersion: string | undefined;
  /** A local pdx-sdk checkout to depend on via `file:`, when given. */
  readonly localSdk: string | undefined;
  readonly prettier: boolean;
  readonly eslint: boolean;
  readonly llmSupport: boolean;
  readonly git: boolean;
  readonly install: boolean;
  readonly packageManager: string;
}

export interface ParsedArgv {
  readonly values: Partial<Record<FlagName, string | boolean>>;
  readonly positionals: readonly string[];
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const config: ParseArgsConfig = {
    args: [...argv],
    options: FLAGS as unknown as ParseArgsConfig["options"],
    // `allowNegative` is what gives every boolean its `--no-` form without a
    // second table entry each.
    allowNegative: true,
    allowPositionals: true,
    strict: true,
  };
  const { values, positionals } = parseArgs(config);
  return { values: values as ParsedArgv["values"], positionals };
}

/** What `generate`'s first parsing phase resolves, before a recipe is known. */
export interface GenerateArgv {
  readonly recipeId: string | undefined;
  readonly name: string | undefined;
  readonly cwd: string | undefined;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly allowUnsupportedSdk: boolean;
  readonly help: boolean;
  readonly version: boolean;
  /**
   * Everything phase one did not consume, in the order it was written. These
   * are the recipe's own flags, and they cannot be checked until the recipe is
   * resolved — which is the whole reason parsing is two phases.
   */
  readonly rest: readonly string[];
}

function isFlag(arg: string): boolean {
  return arg.length > 1 && arg.startsWith("-");
}

/** `--cwd=/tmp` and `-y` both land here as a name and an optional inline value. */
function splitFlag(arg: string): { name: string; inlineValue: string | undefined } {
  if (arg.startsWith("--")) {
    const equals = arg.indexOf("=");
    return equals === -1
      ? { name: arg.slice(2), inlineValue: undefined }
      : { name: arg.slice(2, equals), inlineValue: arg.slice(equals + 1) };
  }
  // An unrecognized short flag keeps its own spelling, so the message an author
  // reads says `-x` rather than `x`.
  return { name: SHORT_FLAGS.get(arg.slice(1)) ?? arg, inlineValue: undefined };
}

const SHORT_FLAGS = new Map(
  (Object.entries(GENERATE_FLAGS) as [GenerateFlagName, FlagSpec][])
    .filter(([, spec]) => spec.short !== undefined)
    .map(([name, spec]) => [spec.short!, name as string])
);

/**
 * Phase one: the command's own flags and its two positionals, with everything
 * else kept for phase two.
 *
 * The retention rule is the only subtle part. An unrecognized `--area` might
 * take a value or might not, and phase one cannot know which — only the recipe
 * does. So an unrecognized flag keeps the token after it as well, unless that
 * token is itself a flag. That is what makes both orderings work:
 * `generate technology "Name" --area particles` and
 * `generate technology --area particles "Name"` produce the same two
 * positionals and the same leftovers.
 */
export function parseGenerateArgv(argv: readonly string[]): GenerateArgv {
  const values = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const rest: string[] = [];
  let endOfFlags = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (endOfFlags || !isFlag(arg)) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      endOfFlags = true;
      continue;
    }

    const { name, inlineValue } = splitFlag(arg);
    const spec: FlagSpec | undefined = (GENERATE_FLAGS as Record<string, FlagSpec>)[name];
    if (spec === undefined) {
      rest.push(arg);
      const next = argv[index + 1];
      if (inlineValue === undefined && next !== undefined && next !== "--" && !isFlag(next)) {
        rest.push(next);
        index += 1;
      }
      continue;
    }

    if (values.has(name)) {
      throw new OptionsError(
        `--${name} was given twice. Each flag answers one question, so a second one would ` +
          `silently win over the first.`
      );
    }
    if (spec.type === "boolean") {
      if (inlineValue !== undefined) {
        throw new OptionsError(`--${name} takes no value, and was given ${quote(inlineValue)}.`);
      }
      values.set(name, true);
      continue;
    }
    const value = inlineValue ?? argv[++index];
    if (value === undefined) {
      throw new OptionsError(`--${name} needs a value ${spec.value ?? "<value>"}.`);
    }
    values.set(name, value);
  }

  if (positionals.length > 2) {
    throw new OptionsError(
      `\`generate\` takes a recipe and a name, and got ${positionals.length} arguments ` +
        `(${positionals.map(quote).join(", ")}). A name with spaces in it needs quoting.`
    );
  }

  const cwd = values.get("cwd");
  return {
    recipeId: positionals[0],
    name: positionals[1],
    cwd: typeof cwd === "string" ? cwd : undefined,
    yes: values.get("yes") === true,
    dryRun: values.get("dry-run") === true,
    allowUnsupportedSdk: values.get("allow-unsupported-sdk") === true,
    help: values.get("help") === true,
    version: values.get("version") === true,
    rest,
  };
}

/**
 * Phase two: the leftovers, against the questions the resolved recipe asks.
 *
 * Strict in every direction — an unknown flag, a flag twice, a flag without a
 * value, a value the question does not offer, and a bare leftover word are all
 * refused rather than ignored. Only the answers an author actually supplied
 * come back; Default answers belong to the invocation and are applied by the
 * command, which is what lets it say where each answer came from.
 */
export function parseRecipeFlags(
  rest: readonly string[],
  recipeId: string,
  questions: readonly QuestionShape[]
): ReadonlyMap<string, string> {
  const asked = new Map(questions.map((question) => [question.key, question]));
  const answers = new Map<string, string>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!isFlag(arg)) {
      throw new OptionsError(
        `\`generate ${recipeId}\` got ${quote(arg)}, which is neither a flag nor one of the two ` +
          `arguments it takes (a recipe and a name).`
      );
    }

    const { name, inlineValue } = splitFlag(arg);
    const question = asked.get(name);
    if (question === undefined) {
      throw new OptionsError(
        `\`generate ${recipeId}\` has no ${arg.startsWith("--") ? `--${name}` : name} flag.\n\n` +
          `${recipeFlagList(recipeId, questions)}`
      );
    }
    if (answers.has(name)) {
      throw new OptionsError(
        `--${name} was given twice. Each flag answers one question, so a second one would ` +
          `silently win over the first.`
      );
    }

    const value = inlineValue ?? rest[++index];
    if (value === undefined) {
      throw new OptionsError(
        `--${name} needs a value: ${question.choices.map((choice) => choice.value).join(", ")}.`
      );
    }
    if (!question.choices.some((choice) => choice.value === value)) {
      throw new OptionsError(
        `--${name} ${quote(value)} is not one of ${recipeId}'s answers ` +
          `(${question.choices.map((choice) => choice.value).join(", ")}).`
      );
    }
    answers.set(name, value);
  }

  return answers;
}

/**
 * The question shape phase two needs, restated structurally so `options.ts`
 * does not import the catalog that imports it.
 */
export interface QuestionShape {
  readonly key: string;
  readonly choices: readonly { readonly value: string }[];
}

function recipeFlagList(recipeId: string, questions: readonly QuestionShape[]): string {
  const own =
    questions.length === 0
      ? `\`${recipeId}\` asks nothing, so it takes no recipe flags of its own.`
      : `\`${recipeId}\` takes ${questions.map((question) => `--${question.key}`).join(", ")}.`;
  return `${own}\n\`generate\` itself takes ${COMMON_GENERATE_FLAGS.map((flag) => `--${flag}`).join(", ")}.`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** The one-line usage each command answers `--help` with. */
const USAGE: Record<CommandName, readonly string[]> = {
  init: ["npx create-stellaris-mod [directory]", "npx create-stellaris-mod init [directory]"],
  list: ["npx create-stellaris-mod list"],
  view: ["npx create-stellaris-mod view <recipe>"],
  generate: ["npx create-stellaris-mod generate [recipe] [name]"],
};

/**
 * The flag table each command's `--help` prints. `list` and `view` take no
 * flags of their own; `view` documents each recipe's flags on its own page.
 */
const COMMAND_FLAGS: Record<CommandName, Record<string, FlagSpec>> = {
  init: FLAGS,
  list: { help: FLAGS.help },
  view: { help: FLAGS.help },
  generate: GENERATE_FLAGS,
};

/**
 * What each catalog command's help ends on: the thing worth knowing that its
 * usage line does not already say.
 */
const CLOSING_NOTE: Record<Exclude<CommandName, "init">, string> = {
  list: "It needs no project: the catalog is baked into this release.",
  view: "Run `npx create-stellaris-mod list` for the recipe ids.",
  generate: [
    "A recipe's own questions become flags of their own, so a scripted run never",
    "prompts: `npx create-stellaris-mod view <recipe>` lists them. Without --yes,",
    "and with a terminal to ask in, anything not given as a flag is prompted for.",
  ].join("\n"),
};

/**
 * `--help`, per command. Each command's own flag table is what a help-drift
 * test can hold to its parser, so each one prints its own.
 */
export function helpText(command: CommandName = "init"): string {
  const lines = [
    command === "init"
      ? "Scaffold a Stellaris mod project that builds with @pdx-ts/sdk."
      : `create-stellaris-mod ${command} — ${COMMANDS[command]}.`,
    "",
    ...USAGE[command].map((usage) => `  ${usage}`),
    "",
  ];

  if (command === "init") {
    lines.push("Commands:");
    for (const [name, describe] of Object.entries(COMMANDS)) {
      lines.push(`  ${name.padEnd(30)} ${describe}`);
    }
    lines.push("");
  }

  lines.push("Options:");
  for (const [name, spec] of Object.entries(COMMAND_FLAGS[command])) {
    const flag = spec.negatable === true ? `--no-${name}` : `--${name}`;
    const short = spec.short === undefined ? "" : `-${spec.short}, `;
    const value = spec.value === undefined ? "" : ` ${spec.value}`;
    lines.push(`  ${`${short}${flag}${value}`.padEnd(30)} ${spec.describe}`);
  }

  if (command !== "init") {
    lines.push("", CLOSING_NOTE[command], "");
    return lines.join("\n");
  }
  lines.push(
    "",
    "Every prompt has a flag, so the CLI is scriptable; with --yes, or when",
    "stdin is not a TTY, it never asks anything."
  );
  return lines.join("\n") + "\n";
}
