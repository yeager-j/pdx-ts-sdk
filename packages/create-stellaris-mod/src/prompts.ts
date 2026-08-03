/**
 * The interactive half: flags and defaults in, a fully `Resolved` config out.
 *
 * Every question here has a flag, and the flag always wins — so the prompts are
 * a convenience over a scriptable CLI rather than the only way to drive it.
 * With `--yes`, or when stdin is not a TTY, `resolveNonInteractive` answers the
 * same questions from defaults and this module never runs.
 */

import { cancel, confirm, intro, isCancel, log, note, text } from "@clack/prompts";

import { isValidPrefix, toDisplayName, toPrefix, toTags } from "./derive.ts";
import { detectInstall, isInstall, readGameVersion, supportedVersionFor } from "./detect.ts";
import { detectPackageManager } from "./exec.ts";
import type { ParsedArgv, Resolved } from "./options.ts";

/** The build the SDK's rule table is verified against — the no-install fallback. */
export const FALLBACK_GAME_VERSION = "4.4.6";

function stop(): never {
  cancel("Nothing was written.");
  process.exit(130);
}

function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) {
    stop();
  }
  return value as T;
}

function flag(values: ParsedArgv["values"], name: keyof ParsedArgv["values"]): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

function boolFlag(
  values: ParsedArgv["values"],
  name: keyof ParsedArgv["values"]
): boolean | undefined {
  const value = values[name];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The answers that need no author, used by `--yes` and whenever stdin is not a
 * TTY. Kept beside the interactive path so the two cannot disagree about what a
 * default *is*.
 */
export function resolveNonInteractive(argv: ParsedArgv, targetDir: string): Resolved {
  const { values } = argv;
  const dirName = targetDir.split(/[\\/]/).pop() ?? "my-stellaris-mod";
  const name = flag(values, "name") ?? toDisplayName(dirName);
  const detected = detectInstall(flag(values, "stellaris-path"));
  const gameVersion = detected?.gameVersion;

  return {
    targetDir,
    name,
    prefix: flag(values, "prefix") ?? toPrefix(name),
    supportedVersion:
      flag(values, "supported-version") ??
      supportedVersionFor(gameVersion ?? FALLBACK_GAME_VERSION) ??
      "v4.4.*",
    tags: toTags(flag(values, "tags")),
    installPath: detected?.installPath,
    gameVersion,
    localSdk: flag(values, "local"),
    prettier: boolFlag(values, "prettier") ?? true,
    eslint: boolFlag(values, "eslint") ?? true,
    git: boolFlag(values, "git") ?? true,
    install: boolFlag(values, "install") ?? true,
    packageManager: flag(values, "pm") ?? detectPackageManager(),
  };
}

export async function resolveInteractive(argv: ParsedArgv): Promise<Resolved> {
  const { values, positionals } = argv;
  intro("create-stellaris-mod");

  const targetDir =
    positionals[0] ??
    unwrap(
      await text({
        message: "Where should the project go?",
        placeholder: "my-stellaris-mod",
        defaultValue: "my-stellaris-mod",
      })
    );

  const dirName = targetDir.split(/[\\/]/).pop() ?? "my-stellaris-mod";
  const name =
    flag(values, "name") ??
    unwrap(
      await text({
        message: "What is the mod called?",
        placeholder: toDisplayName(dirName),
        defaultValue: toDisplayName(dirName),
        validate: (value = "") =>
          value.includes('"')
            ? // It lands unescaped in descriptor.mod, and PDXScript has no
              // quote escaping to save it.
              "A mod name cannot contain a double quote — the launcher descriptor has no way to escape it."
            : undefined,
      })
    );

  const prefix =
    flag(values, "prefix") ??
    unwrap(
      await text({
        message: "Mod prefix? Every id and filename starts with it.",
        placeholder: toPrefix(name),
        defaultValue: toPrefix(name),
        validate: (value = "") =>
          isValidPrefix(value)
            ? undefined
            : `"${value}" must be lowercase snake_case, starting with a letter ([a-z][a-z0-9_]*).`,
      })
    );

  // Detection runs first so the question is a confirmation, not an interrogation.
  const install = await askInstall(flag(values, "stellaris-path"));

  const supportedVersion =
    flag(values, "supported-version") ??
    unwrap(
      await text({
        message: "Which game versions does it support?",
        placeholder: supportedVersionFor(install?.gameVersion ?? FALLBACK_GAME_VERSION),
        defaultValue:
          supportedVersionFor(install?.gameVersion ?? FALLBACK_GAME_VERSION) ?? "v4.4.*",
      })
    );

  const prettier =
    boolFlag(values, "prettier") ?? unwrap(await confirm({ message: "Add Prettier?" }));
  const eslint = boolFlag(values, "eslint") ?? unwrap(await confirm({ message: "Add ESLint?" }));
  const git =
    boolFlag(values, "git") ?? unwrap(await confirm({ message: "Initialize a git repository?" }));
  const packageManager = flag(values, "pm") ?? detectPackageManager();
  const shouldInstall =
    boolFlag(values, "install") ??
    unwrap(await confirm({ message: `Install dependencies with ${packageManager}?` }));

  return {
    targetDir,
    name,
    prefix,
    supportedVersion,
    tags: toTags(flag(values, "tags")),
    installPath: install?.installPath,
    gameVersion: install?.gameVersion,
    localSdk: flag(values, "local"),
    prettier,
    eslint,
    git,
    install: shouldInstall,
    packageManager,
  };
}

/**
 * Confirm the detected install, or take a path. Declining is a supported
 * answer: without an install the scaffold simply drops `src/vanilla.ts` and the
 * identifier pin, and the mod still builds.
 */
async function askInstall(
  explicit: string | undefined
): Promise<{ installPath: string; gameVersion: string | undefined } | undefined> {
  const detected = detectInstall(explicit);
  if (detected !== undefined) {
    const version = detected.gameVersion ?? "unknown build";
    const useIt = unwrap(
      await confirm({ message: `Found Stellaris ${version} at ${detected.installPath}. Use it?` })
    );
    if (useIt) {
      return detected;
    }
  } else {
    log.warn("No Stellaris install found where the SDK looks.");
  }

  for (;;) {
    const typed = unwrap(
      await text({
        message: "Path to your Stellaris install (blank to skip)",
        placeholder: "leave blank to build without vanilla checks",
        defaultValue: "",
      })
    );
    if (typed === "") {
      note(
        "Without an install the mod still builds — vanilla ids stay unchecked\n" +
          "strings and patching is unavailable. Set STELLARIS_PATH later to\n" +
          "turn both on.",
        "Building without vanilla"
      );
      return undefined;
    }
    if (isInstall(typed)) {
      return { installPath: typed, gameVersion: readGameVersion(typed) };
    }
    log.error(`${typed} is not a Stellaris install — no common/technology inside it.`);
  }
}
