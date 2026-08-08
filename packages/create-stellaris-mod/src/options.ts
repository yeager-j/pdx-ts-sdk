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

/**
 * The flags `generate` owns whatever recipe is selected.
 *
 * A recipe's question key becomes `--<key>`, so a question called `dry-run`
 * would silently shadow the flag that decides whether anything is written. The
 * catalog rejects that collision when it is constructed rather than when
 * somebody runs the recipe, and this is the list it checks against — stated
 * once, here, beside the command table it belongs to.
 *
 * `help` and `version` are in it for the same reason even though they are not
 * generate-specific: `--help` must keep meaning help.
 */
export const COMMON_GENERATE_FLAGS = [
  "cwd",
  "yes",
  "dry-run",
  "allow-unsupported-sdk",
  "help",
  "version",
] as const;

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
  git: { type: "boolean", negatable: true, describe: "Initialize a git repository (default: yes)" },
  install: { type: "boolean", negatable: true, describe: "Install dependencies (default: yes)" },
  "dry-run": { type: "boolean", describe: "Print what would be written, write nothing" },
  yes: { type: "boolean", short: "y", describe: "Take every default; never prompt" },
  help: { type: "boolean", short: "h", describe: "Show this help" },
  version: { type: "boolean", short: "v", describe: "Show the version" },
} as const satisfies Record<string, FlagSpec>;

export type FlagName = keyof typeof FLAGS;

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

/** The one-line usage each command answers `--help` with. */
const USAGE: Record<CommandName, readonly string[]> = {
  init: ["npx create-stellaris-mod [directory]", "npx create-stellaris-mod init [directory]"],
  list: ["npx create-stellaris-mod list"],
  view: ["npx create-stellaris-mod view <recipe>"],
  generate: ["npx create-stellaris-mod generate [recipe] [name]"],
};

/**
 * The one sentence each catalog command's help ends on: the thing worth knowing
 * that its usage line does not already say. `generate` has no flag table yet, so
 * what it has to say is that it does not exist.
 */
const CLOSING_NOTE: Record<Exclude<CommandName, "init">, () => string> = {
  list: () => "It needs no project: the catalog is baked into this release.",
  view: () => "Run `npx create-stellaris-mod list` for the recipe ids.",
  generate: () => catalogPending("generate"),
};

/**
 * `--help`, per command. `init` gets the flag table, because its flags are the
 * ones a help-drift test can hold to the parser; the catalog commands take no
 * flags of their own, and `view` documents each recipe's flags on its own page.
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

  if (command !== "init") {
    lines.push(
      "Options:",
      `  ${"-h, --help".padEnd(30)} ${FLAGS.help.describe}`,
      "",
      CLOSING_NOTE[command](),
      ""
    );
    return lines.join("\n");
  }

  lines.push("Commands:");
  for (const [name, describe] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(30)} ${describe}`);
  }
  lines.push("", "Options:");
  for (const [name, spec] of Object.entries(FLAGS) as [FlagName, FlagSpec][]) {
    const flag = spec.negatable === true ? `--no-${name}` : `--${name}`;
    const short = spec.short === undefined ? "" : `-${spec.short}, `;
    const value = spec.value === undefined ? "" : ` ${spec.value}`;
    lines.push(`  ${`${short}${flag}${value}`.padEnd(30)} ${spec.describe}`);
  }
  lines.push(
    "",
    "Every prompt has a flag, so the CLI is scriptable; with --yes, or when",
    "stdin is not a TTY, it never asks anything."
  );
  return lines.join("\n") + "\n";
}

/**
 * What a reserved-but-unimplemented command says. One sentence, on stderr, with
 * a nonzero exit: reserving the name early is what keeps `init` from ever being
 * ambiguous, but a reserved name that silently succeeds would be worse than one
 * that does not exist.
 */
export function catalogPending(command: CommandName): string {
  return (
    `\`create-stellaris-mod ${command}\` arrives with the Recipe Catalog, which this ` +
    `release does not carry yet.`
  );
}
