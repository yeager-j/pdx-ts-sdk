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
 *  10. print the dry run, or create the directories, publish exclusively, and
 *      hand the written file to the project's own Prettier when one is
 *      installed (`../format-project.ts`).
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
import { formatWithProjectPrettier } from "../format-project.ts";
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
    //
    // The search start is resolved to its real path first, because the walk
    // upward is lexical: from a symlinked `--cwd` the lexical parents are the
    // link's, not the project's, and the manifest one directory above the real
    // location would go unseen while some unrelated ancestor's was found.
    const given = path.resolve(io.cwd, parsed.cwd ?? ".");
    let startDir: string;
    try {
      startDir = await realpath(given);
    } catch {
      return fail(
        parsed.cwd === undefined
          ? `The current directory (${given}) no longer exists, so there is nowhere to search ` +
              `for a project.`
          : `--cwd ${JSON.stringify(parsed.cwd)} is not a directory that exists (${given}).`
      );
    }

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
    if (typeof project.modImport !== "string") {
      return fail(
        `${path.join(found.rootDir, "package.json")} does not map "#mod" to a module, and every ` +
          `generated feature file imports\n\`{ mod } from "#mod"\`. Add it:\n\n` +
          `  "imports": {\n    "#mod": "./src/mod.ts"\n  }`
      );
    }

    const segments = validateContentDirectory(found.manifest.contentDirectory);

    const compatibility = checkSdkCompatibility({
      declaredSpecifier: project.declaredSpecifier,
      installedVersion: await findInstalledSdkVersion(found.rootDir),
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
          // Only an Item recipe has one binding to name. A Feature recipe's file
          // exports several items under recipe-chosen role words, so there is no
          // single derived name to promise — and promising one anyway was the
          // preview telling an author something the file would not honour.
          // `catalog.test.ts` holds both arms of this condition to the source.
          ...(view.summary.kind === "item" ? [`Binding   ${names.identifier}`] : []),
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

    // 10. Directories, then the bytes, then the project's own formatter, then
    //     the one line stdout carries. Formatting failure is a warning rather
    //     than a failure: the file is already the author's.
    const written = await publishExclusive(preflight, generated.contents);
    const formatWarning = await formatWithProjectPrettier(found.rootDir, written);
    if (formatWarning !== undefined) {
      io.stderr.write(`warning: ${formatWarning}\n`);
    }
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
    // A refused stat, a read-only directory, a full disk. These are ordinary
    // facts about a machine rather than defects in this program, and a stack
    // trace is the wrong way to tell somebody their content directory is not
    // writable. Node's own message already names the code, the call and the
    // path, so it is quoted rather than paraphrased.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (error instanceof Error && typeof code === "string") {
      return fail(
        `${error.message}\n\nThe filesystem refused an operation this generation needed ` +
          `(${code}), so nothing was published.`
      );
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
  /** The `#mod` entry, still unchecked: only its presence and type matter here. */
  readonly modImport: unknown;
  /** What either dependency block asks for, from whichever declares it. */
  readonly declaredSpecifier: string | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The two facts `generate` needs out of the project's `package.json`, read with
 * the shape checked rather than asserted.
 *
 * A `package.json` is a file people edit, and `JSON.parse(...) as Package` is a
 * promise the parser cannot keep: `null`, an array, or a dependency block whose
 * values are objects would all sail through the cast and fail much later as a
 * TypeError with a stack trace. Every fault here is an ordinary message about
 * somebody's file instead.
 */
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

  let root: unknown;
  try {
    root = JSON.parse(bytes);
  } catch (error) {
    throw new ManifestError(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isPlainObject(root)) {
    throw new ManifestError(`${file} must be a JSON object, and is not one.`);
  }

  const imports = root["imports"];
  if (imports !== undefined && !isPlainObject(imports)) {
    throw new ManifestError(`${file}: "imports" must be a JSON object, and is not one.`);
  }

  let declaredSpecifier: string | undefined;
  for (const block of ["dependencies", "devDependencies"] as const) {
    const declared = root[block];
    if (declared === undefined) {
      continue;
    }
    if (!isPlainObject(declared)) {
      throw new ManifestError(`${file}: "${block}" must be a JSON object, and is not one.`);
    }
    const specifier = declared[SDK_PACKAGE];
    if (specifier === undefined || declaredSpecifier !== undefined) {
      continue;
    }
    if (typeof specifier !== "string") {
      throw new ManifestError(
        `${file}: "${block}"."${SDK_PACKAGE}" must be a version range written as a string, and ` +
          `is not one. Nothing can be proved about a dependency that is not spelled out.`
      );
    }
    declaredSpecifier = specifier;
  }

  return { modImport: imports?.["#mod"], declaredSpecifier };
}

/**
 * The installed SDK's version, when there is one to read.
 *
 * The walk upward is Node's own lookup, not thoroughness for its own sake: in a
 * workspace the SDK is installed once at the root and the project resolves it
 * from there, so checking only `<project>/node_modules` would find nothing and
 * silently skip the version check on exactly the layout where a stale hoisted
 * copy is most likely.
 *
 * `createRequire(...).resolve` would be the obvious spelling and does not work:
 * the SDK's `exports` map does not expose `package.json`, so resolution of the
 * one file that carries the version fails.
 *
 * An absent install is not a fault — a declared range provably inside the
 * verified one is evidence on its own, and authors generate before installing.
 */
export async function findInstalledSdkVersion(startDir: string): Promise<string | undefined> {
  let dir = path.resolve(startDir);
  for (;;) {
    const file = path.join(dir, "node_modules", ...SDK_PACKAGE.split("/"), "package.json");
    let installed: unknown;
    let isInstalled = false;
    try {
      installed = JSON.parse(await readFile(file, "utf8"));
      isInstalled = true;
    } catch {
      // Not installed at this level; keep walking, the way Node would.
    }
    if (isInstalled) {
      // The first installation found is the one that would be resolved, so its
      // version is the answer even when that turns out to be no answer at all.
      const version = isPlainObject(installed) ? installed["version"] : undefined;
      return typeof version === "string" ? version : undefined;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
