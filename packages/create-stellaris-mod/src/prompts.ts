/**
 * The interactive half: flags and defaults in, a fully `Resolved` config out.
 *
 * Every question here has a flag, and the flag always wins — so the prompts are
 * a convenience over a scriptable CLI rather than the only way to drive it.
 * With `--yes`, or when stdin is not a TTY, `resolveNonInteractive` answers the
 * same questions from defaults and this module never runs.
 */

import { confirm, intro, isCancel, log, note, text } from "@clack/prompts";
import { resolveConfig, type ResolvedModConfig } from "@pdx-ts/sdk";

import { toDisplayName, toPrefix, toTags } from "./derive.ts";
import { detectInstall, isInstall, readGameVersion, supportedVersionFor } from "./detect.ts";
import { detectPackageManager } from "./exec.ts";
import {
  INSTALL_SENTINEL_PATH_SEGMENTS,
  VERIFIED_STELLARIS_BUILD,
  VERIFIED_SUPPORTED_VERSION,
} from "./generated/verified-build.ts";
import type { CliIo } from "./io.ts";
import type { ParsedArgv, Resolved } from "./options.ts";
import { CancelledError } from "./terminal.ts";

const INSTALL_SENTINEL = INSTALL_SENTINEL_PATH_SEGMENTS.join("/");

/** Reports why a mod name cannot be used by a generated SDK project. */
export function nameProblem(name: string): string | undefined {
  if (name.trim() === "") {
    return "A mod name cannot be empty.";
  }
  return sdkConfigProblem({ name });
}

/**
 * The launcher's `supported_version` grammar, said early.
 *
 * Detection derives this value and derives it correctly; the author-supplied
 * flag and prompt are the paths that can produce something else. Checking here
 * is what keeps init's promise that it never writes a Project Manifest
 * `generate` cannot read — `parseManifest` enforces the same grammar, and
 * without this the scaffold could write a file its own adapter refuses and the
 * launcher would silently reject.
 */
export function supportedVersionProblem(value: string): string | undefined {
  return sdkConfigProblem({ supportedVersion: value });
}

function prefixProblem(prefix: string): string | undefined {
  return sdkConfigProblem({ prefix });
}

function sdkConfigProblem(
  fields: Partial<Pick<ResolvedModConfig, "name" | "prefix" | "supportedVersion">>
): string | undefined {
  try {
    resolveConfig({
      name: fields.name ?? "My Mod",
      prefix: fields.prefix ?? "my_mod",
      supportedVersion: fields.supportedVersion ?? "v4.4.*",
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function resolvedModConfig(
  name: string,
  prefix: string,
  supportedVersion: string,
  tags: readonly string[]
): ResolvedModConfig {
  const problem = nameProblem(name);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  return resolveConfig({ name, prefix, supportedVersion, tags });
}

/**
 * The flag, checked before it can reach the manifest. Returns `undefined` when
 * no flag was given, so the caller's `??` chain still falls through to
 * detection.
 */
function checkedSupportedVersionFlag(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const problem = supportedVersionProblem(value);
  if (problem !== undefined) {
    throw new Error(`${problem} (--supported-version ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Cancelling throws rather than exiting. `cli.ts` catches it once, writes
 * `Nothing was written.` and returns 130 — so this module can be driven
 * in-process by a test, and so ctrl-c means the same thing under every command.
 */
function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) {
    throw new CancelledError();
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
  const problem = nameProblem(name);
  if (problem !== undefined) {
    throw new Error(`${problem} (--name ${JSON.stringify(name)})`);
  }
  const explicitPath = flag(values, "stellaris-path");
  const detected = detectInstall(explicitPath);
  if (explicitPath !== undefined && explicitPath !== "" && detected === undefined) {
    throw new Error(
      `--stellaris-path ${JSON.stringify(explicitPath)} is not a Stellaris install — no ${INSTALL_SENTINEL} inside it.`
    );
  }
  const gameVersion = detected?.gameVersion;
  const supportedVersion =
    checkedSupportedVersionFlag(flag(values, "supported-version")) ??
    supportedVersionFor(gameVersion ?? VERIFIED_STELLARIS_BUILD) ??
    VERIFIED_SUPPORTED_VERSION;
  const config = resolvedModConfig(
    name,
    flag(values, "prefix") ?? toPrefix(name),
    supportedVersion,
    toTags(flag(values, "tags"))
  );

  return {
    targetDir,
    name: config.name,
    prefix: config.prefix,
    supportedVersion: config.supportedVersion,
    tags: config.tags ?? [],
    installPath: detected?.installPath,
    installPathIsExplicit: explicitPath !== undefined && explicitPath !== "",
    gameVersion,
    localSdk: flag(values, "local"),
    prettier: boolFlag(values, "prettier") ?? true,
    eslint: boolFlag(values, "eslint") ?? true,
    llmSupport: boolFlag(values, "llm") ?? true,
    git: boolFlag(values, "git") ?? true,
    install: boolFlag(values, "install") ?? true,
    packageManager: flag(values, "pm") ?? detectPackageManager(),
  };
}

export async function resolveInteractive(argv: ParsedArgv, io: CliIo): Promise<Resolved> {
  const { values, positionals } = argv;
  // Prompt chrome goes to stderr, so a scaffold's stdout stays the thing worth
  // piping — the same rule every other command in this CLI keeps.
  const streams = { input: io.stdin, output: io.stderr } as const;
  intro("create-stellaris-mod", streams);

  const targetDir =
    positionals[0] ??
    unwrap(
      await text({
        ...streams,
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
        ...streams,
        message: "What is the mod called?",
        placeholder: toDisplayName(dirName),
        defaultValue: toDisplayName(dirName),
        validate: (value = "") => nameProblem(value),
      })
    );

  const prefix =
    flag(values, "prefix") ??
    unwrap(
      await text({
        ...streams,
        message: "Mod prefix? Every id and filename starts with it.",
        placeholder: toPrefix(name),
        defaultValue: toPrefix(name),
        validate: (value = "") => prefixProblem(value),
      })
    );

  // Detection runs first so the question is a confirmation, not an interrogation.
  const install = await askInstall(flag(values, "stellaris-path"), streams);

  const supportedVersion =
    checkedSupportedVersionFlag(flag(values, "supported-version")) ??
    unwrap(
      await text({
        ...streams,
        message: "Which game versions does it support?",
        placeholder: supportedVersionFor(install?.gameVersion ?? VERIFIED_STELLARIS_BUILD),
        defaultValue:
          supportedVersionFor(install?.gameVersion ?? VERIFIED_STELLARIS_BUILD) ??
          VERIFIED_SUPPORTED_VERSION,
        // An empty submit means "take the offered default", which clack
        // substitutes after validation runs — and the default is derived, so it
        // is already a legal pattern. Only what the author types is checked.
        validate: (value = "") => (value === "" ? undefined : supportedVersionProblem(value)),
      })
    );

  const prettier =
    boolFlag(values, "prettier") ?? unwrap(await confirm({ ...streams, message: "Add Prettier?" }));
  const eslint =
    boolFlag(values, "eslint") ?? unwrap(await confirm({ ...streams, message: "Add ESLint?" }));
  const llmSupport =
    boolFlag(values, "llm") ??
    unwrap(
      await confirm({
        ...streams,
        message: "Add Codex and Claude support?",
        initialValue: true,
      })
    );
  const git =
    boolFlag(values, "git") ??
    unwrap(await confirm({ ...streams, message: "Initialize a git repository?" }));
  const packageManager = flag(values, "pm") ?? detectPackageManager();
  const shouldInstall =
    boolFlag(values, "install") ??
    unwrap(await confirm({ ...streams, message: `Install dependencies with ${packageManager}?` }));
  const config = resolvedModConfig(name, prefix, supportedVersion, toTags(flag(values, "tags")));

  return {
    targetDir,
    name: config.name,
    prefix: config.prefix,
    supportedVersion: config.supportedVersion,
    tags: config.tags ?? [],
    installPath: install?.installPath,
    installPathIsExplicit: install?.isExplicit ?? false,
    gameVersion: install?.gameVersion,
    localSdk: flag(values, "local"),
    prettier,
    eslint,
    llmSupport,
    git,
    install: shouldInstall,
    packageManager,
  };
}

/**
 * Confirm the detected install, or take a path. Declining is a supported
 * answer: without an install the scaffold drops `src/vanilla.ts` and uses the
 * verified build's identifier pin, so the mod still builds with checked ids.
 */
async function askInstall(
  explicit: string | undefined,
  streams: { readonly input: CliIo["stdin"]; readonly output: CliIo["stderr"] }
): Promise<
  { installPath: string; gameVersion: string | undefined; isExplicit: boolean } | undefined
> {
  const fromFlag = explicit !== undefined && explicit !== "";
  const detected = detectInstall(explicit);
  if (detected !== undefined) {
    const version = detected.gameVersion ?? "unknown build";
    const useIt = unwrap(
      await confirm({
        ...streams,
        message: `Found Stellaris ${version} at ${detected.installPath}. Use it?`,
      })
    );
    if (useIt) {
      return { ...detected, isExplicit: fromFlag };
    }
  } else {
    log.warn("No Stellaris install found where the SDK looks.", streams);
  }

  for (;;) {
    const typed = unwrap(
      await text({
        ...streams,
        message: "Path to your Stellaris install (blank to skip)",
        placeholder: "leave blank to use checked ids for the verified game build",
        defaultValue: "",
      })
    );
    if (typed === "") {
      note(
        "Without an install the mod still builds with vanilla ids checked against\n" +
          `the verified game build (${VERIFIED_STELLARIS_BUILD}). Patching is unavailable. Set\n` +
          "STELLARIS_PATH later to load your install for patching; it does not change\n" +
          "the identifier package.",
        "Building without vanilla",
        streams
      );
      return undefined;
    }
    if (isInstall(typed)) {
      // Typed by hand, so detection in the generated project would not find it.
      return { installPath: typed, gameVersion: readGameVersion(typed), isExplicit: true };
    }
    log.error(`${typed} is not a Stellaris install — no ${INSTALL_SENTINEL} inside it.`, streams);
  }
}
