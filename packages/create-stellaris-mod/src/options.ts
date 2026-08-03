/**
 * The flag table, and the resolved shape the rest of the CLI consumes.
 *
 * One table feeds both `parseArgs` and `--help`, because two lists drift: a
 * flag added to the parser and forgotten in the help text is invisible, and one
 * documented but unparsed is worse. A test asserts they still agree.
 */

import { parseArgs, type ParseArgsConfig } from "node:util";

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

export function helpText(): string {
  const lines = [
    "Scaffold a Stellaris mod project that builds with @pdx-ts/sdk.",
    "",
    "  npx create-stellaris-mod [directory]",
    "",
    "Options:",
  ];
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
