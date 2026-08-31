/**
 * The side effects that run commands: `git init` and the dependency install.
 *
 * Both are best-effort. A scaffold whose files are all correctly written but
 * whose `npm install` hit a network blip should tell the author to run it
 * again, not delete their project and exit non-zero.
 */

import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface Command {
  readonly command: string;
  readonly args: readonly string[];
  /** Whether this command requires a shell to resolve a platform shim. */
  readonly shell?: boolean;
}

export interface CommandResult {
  readonly code: number;
  readonly output: string;
}

/** Keep the failure tail useful without retaining an unbounded dependency-install transcript. */
const DIAGNOSTIC_LIMIT = 64 * 1024;
const WINDOWS_PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export function teeCommandOutput(
  source: Readable,
  destination: Writable,
  observe: (chunk: Buffer) => void
): void {
  source.on("data", observe);
  source.pipe(destination, { end: false });
}

export function run(command: Command, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command.command, [...command.args], {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      shell: command.shell ?? false,
    });
    let output = "";
    const observe = (chunk: Buffer): void => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-DIAGNOSTIC_LIMIT);
    };
    teeCommandOutput(child.stdout, process.stdout, observe);
    teeCommandOutput(child.stderr, process.stderr, observe);
    child.on("error", () => resolve({ code: -1, output }));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

/**
 * The package manager that invoked us, from npm's own `npm_config_user_agent`.
 * Someone running `pnpm create stellaris-mod` should get a pnpm lockfile.
 */
export function detectPackageManager(userAgent = process.env["npm_config_user_agent"]): string {
  if (userAgent === undefined) {
    return "npm";
  }
  const name = userAgent.split(" ")[0]?.split("/")[0];
  return name === "pnpm" || name === "yarn" || name === "bun" ? name : "npm";
}

export function installCommand(packageManager: string): Command {
  return {
    command: packageManager,
    args: ["install"],
    // npm and the other supported package managers are .cmd shims on Windows.
    shell:
      process.platform === "win32" &&
      WINDOWS_PACKAGE_MANAGERS.some((manager) => manager === packageManager),
  };
}

export function gitInitCommands(): Command[] {
  return [
    { command: "git", args: ["init"] },
    { command: "git", args: ["add", "-A"] },
    { command: "git", args: ["commit", "-m", "Scaffold with create-stellaris-mod"] },
  ];
}

/**
 * One command as a line somebody could paste into this platform's shell.
 *
 * For the dry run, so that what a preview promises and what a run performs are
 * the same value read two ways rather than two lists maintained in parallel.
 *
 * The quoting is display quoting — nothing here is fed back to a shell, and
 * `run` passes argv directly — but it still has to be the quoting of the shell
 * the reader is looking at. `cmd.exe` does not group an argument with single
 * quotes, so a POSIX-quoted `git commit -m 'Scaffold with …'` pasted there
 * becomes four arguments and a commit message of `'Scaffold`. A preview that
 * cannot be pasted on the platform it is printed on is not a preview.
 *
 * @param command The command as it would be spawned.
 * @param platform The shell family to quote for. Injected so both spellings
 *   are testable from either platform, the way `platformDefaultsFor` and
 *   `modDirFor` take theirs.
 * @returns The command and its arguments as one line.
 */
export function describeCommand(
  { command, args }: Command,
  platform: NodeJS.Platform = process.platform
): string {
  const quote = platform === "win32" ? quoteForCmd : quoteForPosix;
  return [command, ...args].map(quote).join(" ");
}

/** Arguments needing no quotes anywhere: no whitespace, no metacharacters. */
const BARE_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** POSIX single quotes, with the standard `'\''` break for an embedded quote. */
function quoteForPosix(value: string): string {
  return BARE_ARGUMENT.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `cmd.exe` double quotes, with `""` for an embedded quote.
 *
 * This is the grouping `CommandLineToArgvW` undoes, which is how the
 * `.cmd` package-manager shims and `git` read their arguments.
 */
function quoteForCmd(value: string): string {
  return BARE_ARGUMENT.test(value) ? value : `"${value.replace(/"/g, `""`)}"`;
}

/** True when `cwd` is already inside a git work tree, so `git init` would nest. */
export function insideGitWorkTree(cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
