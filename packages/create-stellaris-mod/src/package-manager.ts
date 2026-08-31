/**
 * How the selected package manager spells the commands the scaffold prints.
 *
 * One authority, because the selection reaches three separate consumers — the
 * terminal next steps, the generated README, and the generated agent guidance —
 * and a project initialized with pnpm that is then told to run `npm install`
 * gets a second lockfile and a dependency graph nobody resolved.
 *
 * `--pm` is a free string, so every function here has to answer for a name this
 * release has never heard of. The npm spelling is the fallback: it is the one
 * an unfamiliar manager is likeliest to copy, and it is what an author reading
 * the line will recognize as something to adjust.
 */

/** The managers `detectPackageManager` returns and `--pm` documents. */
const ADD_SPELLS_ADD = new Set(["pnpm", "yarn", "bun"]);

/**
 * Running a package script.
 *
 * Always the explicit `run` form, including for `test`. The bare `npm test`
 * shorthand is idiomatic but does not survive the translation: `bun test` runs
 * Bun's own test runner rather than the project's `test` script, so the
 * shorthand would silently mean something else in a Bun project. `run` means
 * one thing under all four.
 */
export function runScript(packageManager: string, script: string): string {
  return `${packageManager} run ${script}`;
}

/** Installing everything the project already declares. */
export function installDependencies(packageManager: string): string {
  return `${packageManager} install`;
}

/**
 * Adding one dependency.
 *
 * The one place the four managers genuinely disagree. `yarn install <package>`
 * is not an add at all under Yarn Berry, so this cannot be spelled uniformly
 * the way `run` can.
 */
export function addDependency(packageManager: string, specifier: string): string {
  const verb = ADD_SPELLS_ADD.has(packageManager) ? "add" : "install";
  return `${packageManager} ${verb} ${specifier}`;
}
