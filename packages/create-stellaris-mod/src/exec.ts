/**
 * The side effects that run commands: `git init` and the dependency install.
 *
 * Both are best-effort. A scaffold whose files are all correctly written but
 * whose `npm install` hit a network blip should tell the author to run it
 * again, not delete their project and exit non-zero.
 */

import { spawn } from "node:child_process";

export interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

export function run(command: Command, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command.command, [...command.args], { cwd, stdio: "inherit" });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
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
  return { command: packageManager, args: ["install"] };
}

export function gitInitCommands(): Command[] {
  return [
    { command: "git", args: ["init"] },
    { command: "git", args: ["add", "-A"] },
    { command: "git", args: ["commit", "-m", "Scaffold with create-stellaris-mod"] },
  ];
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
