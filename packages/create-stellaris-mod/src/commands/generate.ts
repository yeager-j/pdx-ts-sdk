/**
 * `create-stellaris-mod generate [recipe] [name]` — one feature file, into an
 * existing project.
 *
 * The order below is the whole design, and it is fixed rather than incidental:
 *
 *   1. resolve the command and the recipe;
 *   2. discover and validate the Project Manifest;
 *   3. validate `#mod`, `contentDirectory` and SDK compatibility;
 *   4. resolve or prompt for the name, and derive every name once;
 *   5. show the target and the derived facts (interactive only);
 *   6. resolve each question — a flag wins, `--yes` and non-TTY take Defaults,
 *      otherwise prompt;
 *   7. call the pure catalog once;
 *   8. preflight the target without touching anything;
 *   9. confirm the exact path (interactive only);
 *  10. print the dry run, or create the directories and publish exclusively.
 *
 * Everything that can refuse comes before anything an author has to answer, and
 * everything an author answers comes before anything is created. A command that
 * asks four questions and *then* says the project has no manifest has wasted
 * somebody's time; one that creates directories before the confirmation has
 * changed a project the author then declined to change.
 *
 * stdout carries exactly one thing on a successful run: the path that was
 * written, plus a newline. Previews, echoes, prompts and confirmations are all
 * stderr, so `generate ... | xargs code` opens the file rather than a page of
 * prose.
 */

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { UnknownRecipeError } from "../catalog/catalog.ts";
import { CATALOG } from "../catalog/index.ts";
import { deriveNames, NameError } from "../catalog/names.ts";
import type { ChoiceQuestion, DerivedNames, RecipeView } from "../catalog/types.ts";
import type { CliIo } from "../io.ts";
import { findManifest, MANIFEST_BASENAME, ManifestError } from "../manifest.ts";
import { helpText, OptionsError, parseGenerateArgv, parseRecipeFlags } from "../options.ts";
import {
  collisionMessage,
  preflightTarget,
  PublishError,
  publishExclusive,
  validateContentDirectory,
} from "../publish.ts";
import { checkSdkCompatibility, SDK_PACKAGE } from "../sdk-range.ts";
import { CancelledError, type Terminal } from "../terminal.ts";
import { VERSION } from "../version.ts";
import { kindLabel } from "./list.ts";

export async function runGenerate(
  argv: readonly string[],
  io: CliIo,
  terminal: Terminal
): Promise<number> {
  const fail = (message: string): number => {
    io.stderr.write(`${message}\n`);
    return 1;
  };

  // 1. The command, its flags, and the recipe.
  let parsed;
  try {
    parsed = parseGenerateArgv(argv);
  } catch (error) {
    if (!(error instanceof OptionsError)) {
      throw error;
    }
    io.stderr.write(`${error.message}\n\n`);
    io.stderr.write(helpText("generate"));
    return 1;
  }

  if (parsed.help) {
    io.stdout.write(helpText("generate"));
    return 0;
  }
  if (parsed.version) {
    // `--version` means the version under every command, which is the reason
    // it is one of the flags a recipe question may not take over.
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  // Nobody to ask means every answer has to be on the command line already. A
  // CI run must fail here rather than hang on a prompt no one will see.
  const interactive = !parsed.yes && io.stdin.isTTY === true;
  if (!interactive) {
    const missing = [
      parsed.recipeId === undefined ? "a recipe id" : undefined,
      parsed.name === undefined ? "a name" : undefined,
    ].filter((item): item is string => item !== undefined);
    if (missing.length > 0) {
      return fail(
        `\`create-stellaris-mod generate\` needs ${missing.join(" and ")} here: ` +
          `${parsed.yes ? "--yes was given" : "stdin is not a terminal"}, so there is nobody ` +
          `to ask.\n\n  npx create-stellaris-mod generate <recipe> "<name>"\n\n` +
          "Run `npx create-stellaris-mod list` to see what this release carries."
      );
    }
  }

  try {
    const recipeId = parsed.recipeId ?? (await pickRecipe(terminal));

    let view: RecipeView;
    try {
      view = CATALOG.view(recipeId);
    } catch (error) {
      if (!(error instanceof UnknownRecipeError)) {
        throw error;
      }
      return fail(
        `${error.message}\n\nThis release carries:\n\n` +
          `${error.available.map((id) => `  ${id}`).join("\n")}\n\n` +
          "Run `npx create-stellaris-mod list` to see what each one does."
      );
    }

    let supplied: ReadonlyMap<string, string>;
    try {
      supplied = parseRecipeFlags(parsed.rest, recipeId, view.questions);
    } catch (error) {
      if (!(error instanceof OptionsError)) {
        throw error;
      }
      return fail(error.message);
    }

    // 2. The Project Manifest. Never created, repaired, or migrated here.
    const startDir = path.resolve(io.cwd, parsed.cwd ?? ".");
    const found = await findManifest(startDir);
    if (found === undefined) {
      return fail(
        `There is no ${MANIFEST_BASENAME} in ${startDir}, or in any directory above it.\n\n` +
          "`generate` writes into a project that already exists: the manifest is what names the " +
          "mod prefix\nand says where feature source goes. Scaffold one with " +
          "`npx create-stellaris-mod init`, or run\nthis inside a project — `--cwd <path>` " +
          "starts the search somewhere else."
      );
    }

    // 3. `#mod`, `contentDirectory`, and the SDK range.
    const project = await readProjectPackage(found.rootDir);
    const modImport = project.imports?.["#mod"];
    if (typeof modImport !== "string") {
      return fail(
        `${path.join(found.rootDir, "package.json")} does not map "#mod" to a module, and every ` +
          `generated feature file imports\n\`{ mod } from "#mod"\`. Add it:\n\n` +
          `  "imports": {\n    "#mod": "./src/mod.ts"\n  }`
      );
    }

    const segments = validateContentDirectory(found.manifest.contentDirectory);

    const compatibility = checkSdkCompatibility({
      declaredSpecifier:
        project.dependencies?.[SDK_PACKAGE] ?? project.devDependencies?.[SDK_PACKAGE],
      installedVersion: await readInstalledSdkVersion(found.rootDir),
    });
    if (!compatibility.supported) {
      if (!parsed.allowUnsupportedSdk) {
        return fail(
          `${compatibility.detail}\n\nGenerate anyway with --allow-unsupported-sdk. It changes ` +
            "only this check: it does not load\nthe SDK, weaken what is generated, or make a " +
            "later build succeed."
        );
      }
      io.stderr.write(`warning: ${compatibility.detail}\n`);
      io.stderr.write("warning: generating anyway, because --allow-unsupported-sdk was given.\n");
    }

    // 4. The name, derived exactly once.
    const names = await resolveNames(parsed.name, interactive, terminal);

    // 5. What is about to happen, for somebody watching it happen.
    const targetPath = path.join(found.rootDir, ...segments, names.basename);
    if (interactive) {
      terminal.note(
        [
          `Recipe    ${view.summary.id} — ${kindLabel(view.summary)}`,
          `Name      ${names.title}`,
          `File      ${path.relative(found.rootDir, targetPath)}`,
          `Ids       from "${names.logicalName}", under the ${found.manifest.prefix} prefix`,
          `Binding   ${names.identifier}`,
        ].join("\n"),
        "About to generate"
      );
    }

    // 6. Every question, in the order the recipe asks them.
    const answers = await resolveAnswers({
      questions: view.questions,
      supplied,
      interactive,
      terminal,
    });

    // 7. The pure catalog, once. This same value feeds the dry run and the
    //    publisher, so what an author previews is what an author gets. The
    //    normalized title goes in rather than the raw argument, and the catalog
    //    derives its own names from it — so the path shown at step 5 and the
    //    basename published at step 10 agree only if the derivation is
    //    idempotent over its own title. That is an invariant rather than a
    //    construction, and `adversarial-names.test.ts` pins it across the
    //    hostile-name corpus.
    const generated = CATALOG.generate({ recipeId, name: names.title, answers });

    // 8. A look at the target, which creates nothing.
    const preflight = await preflightTarget(
      await realpath(found.rootDir),
      segments,
      generated.basename
    );

    if (parsed.dryRun) {
      // 10 (dry). No confirmation: a dry run changes nothing, so there is
      //     nothing to ask permission for.
      io.stdout.write(`would write ${preflight.targetPath}\n`);
      io.stdout.write(generated.contents);
      if (preflight.target !== "absent") {
        io.stderr.write(`A real run would refuse: ${collisionMessage(preflight.targetPath)}\n`);
      }
      return 0;
    }

    if (preflight.target !== "absent") {
      // Said before the confirmation rather than discovered by the publisher,
      // so nobody is asked to approve a write that cannot happen.
      return fail(collisionMessage(preflight.targetPath));
    }

    // 9. The exact path, confirmed.
    if (interactive && !(await terminal.confirm({ message: `Write ${preflight.targetPath}?` }))) {
      throw new CancelledError();
    }

    // 10. Directories, then the bytes, then the one line stdout carries.
    const written = await publishExclusive(preflight, generated.contents);
    io.stdout.write(`${written}\n`);
    return 0;
  } catch (error) {
    if (
      error instanceof ManifestError ||
      error instanceof PublishError ||
      error instanceof NameError
    ) {
      return fail(error.message);
    }
    throw error;
  }
}

/** Bare `generate`, with a terminal: the catalog as a filterable list. */
async function pickRecipe(terminal: Terminal): Promise<string> {
  return terminal.select({
    message: "Which recipe?",
    filter: true,
    options: CATALOG.list().map((summary) => ({
      value: summary.id,
      label: `${summary.title} — ${kindLabel(summary)}`,
      hint: summary.summary,
    })),
  });
}

/**
 * The name, from the positional or from a prompt, derived once.
 *
 * The prompt validates with the same derivation the generation uses, so a name
 * that cannot become a file, an id and a binding is rejected while the author
 * is still standing at the keyboard rather than after the file exists.
 */
async function resolveNames(
  supplied: string | undefined,
  interactive: boolean,
  terminal: Terminal
): Promise<DerivedNames> {
  if (supplied !== undefined) {
    return deriveNames(supplied);
  }
  const typed = await terminal.text({
    message: "What is it called?",
    placeholder: "Resonance Theory",
    validate: (value) => {
      try {
        deriveNames(value);
        return undefined;
      } catch (error) {
        return error instanceof NameError ? error.message : String(error);
      }
    },
  });
  return deriveNames(typed);
}

export interface AnswerResolution {
  readonly questions: readonly ChoiceQuestion[];
  readonly supplied: ReadonlyMap<string, string>;
  readonly interactive: boolean;
  readonly terminal: Terminal;
}

/**
 * Each question answered, in order, by whichever of the three sources applies.
 *
 * A supplied flag always wins, and says so: an author who passed `--visibility
 * hidden` and then watched the command not ask about visibility deserves to see
 * why. Non-interactive runs take the Default answer, which is the recipe's own
 * curated judgment rather than a fallback.
 */
export async function resolveAnswers(input: AnswerResolution): Promise<Record<string, string>> {
  const { questions, supplied, interactive, terminal } = input;
  const answers: Record<string, string> = {};

  for (const question of questions) {
    const fromFlag = supplied.get(question.key);
    if (fromFlag !== undefined) {
      if (interactive) {
        terminal.info(`${question.key}: ${fromFlag} — from --${question.key}`);
      }
      answers[question.key] = fromFlag;
      continue;
    }
    if (!interactive) {
      answers[question.key] = question.defaultValue;
      continue;
    }
    answers[question.key] = await terminal.select({
      message: question.prompt,
      initialValue: question.defaultValue,
      options: question.choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        ...(choice.help === undefined ? {} : { hint: choice.help }),
      })),
    });
  }

  return answers;
}

interface ProjectPackage {
  readonly imports?: Record<string, unknown>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

async function readProjectPackage(rootDir: string): Promise<ProjectPackage> {
  const file = path.join(rootDir, "package.json");
  let bytes: string;
  try {
    bytes = await readFile(file, "utf8");
  } catch {
    throw new ManifestError(
      `${rootDir} holds a ${MANIFEST_BASENAME} but no package.json, so it is not a project this ` +
        `can generate into.`
    );
  }
  try {
    return JSON.parse(bytes) as ProjectPackage;
  } catch (error) {
    throw new ManifestError(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * The installed SDK's version, when there is one to read. Its absence is not a
 * fault — a declared range that is provably inside the verified one is evidence
 * on its own, and an author may reasonably generate before installing.
 */
async function readInstalledSdkVersion(rootDir: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(
      path.join(rootDir, "node_modules", ...SDK_PACKAGE.split("/"), "package.json"),
      "utf8"
    );
    const version = (JSON.parse(bytes) as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
