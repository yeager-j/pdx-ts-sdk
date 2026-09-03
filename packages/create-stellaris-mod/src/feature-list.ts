/**
 * Appending one declaration to the author's `src/features.ts`.
 *
 * The feature list is the author's file, and this is the only place the CLI
 * writes into a file it did not create. So the rules are narrower than for
 * publishing a new module: the list must already exist as a regular file, it
 * is never created or rewritten, and the one write is an append of one line
 * through a handle whose identity was checked against the preflight. The line
 * itself, and whether the list already says it, are decided by the pure
 * `./catalog/declaration.ts`.
 *
 * `preflightFeatureList` looks and reports; `appendFeatureDeclaration` runs only
 * after the module has been published. Its failures come in two kinds, and the
 * command that calls it acts on the difference: before any byte reaches the
 * list, the module is removed again, so the project never holds a feature
 * module its list does not name; after, the declaration is in the list and
 * the module stays, because a declaration pointing at nothing is the worse
 * state. `DeclarationWrittenError` is the second kind.
 */

import type { Stats } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  appendedBytes,
  appendedLineNumber,
  FEATURE_LIST_PATH,
  findDeclarationConflict,
  type DeclarationConflict,
  type DeclarationNames,
} from "./catalog/declaration.ts";
import { PublishError } from "./publish.ts";

/** The feature list is missing, is not a plain file, or changed underneath the append. */
export class FeatureListError extends PublishError {
  constructor(message: string) {
    super(message);
    this.name = "FeatureListError";
  }
}

/** The feature list already declares the module, or already exports its binding. */
export class DeclarationConflictError extends PublishError {
  constructor(message: string) {
    super(message);
    this.name = "DeclarationConflictError";
  }
}

/**
 * The declaration reached the list, and then the append failed: a short write,
 * or a flush that did not complete. The line is in the list, possibly cut
 * short, so the module it declares must be kept.
 */
export class DeclarationWrittenError extends PublishError {
  /** One-based line of the list the declaration starts on. */
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = "DeclarationWrittenError";
    this.line = line;
  }
}

/** What the preflight saw, and what the append will therefore check against. */
export interface FeatureListPreflight {
  /** Absolute path of the feature list. */
  readonly listPath: string;
  /** The file's identity at preflight; the append refuses a different file. */
  readonly identity: Stats;
  readonly names: DeclarationNames;
  /** The line being declared. */
  readonly declaration: string;
  /** The bytes a run would append, given the contents seen at preflight. */
  readonly bytes: string;
  /**
   * The existing line the declaration would repeat, when there is one. The
   * command decides what that means: a real run refuses, a dry run says so.
   */
  readonly conflict: DeclarationConflict | undefined;
}

/**
 * Look at the feature list without touching it.
 *
 * @throws FeatureListError - When the list is missing, a symbolic link, or
 * not a regular file.
 */
export async function preflightFeatureList(
  rootDir: string,
  names: DeclarationNames,
  declaration: string
): Promise<FeatureListPreflight> {
  const listPath = path.join(rootDir, ...FEATURE_LIST_PATH.split("/"));
  const identity = await requireRegularFile(listPath);
  const contents = await readFile(listPath, "utf8");
  return {
    listPath,
    identity,
    names,
    declaration,
    bytes: appendedBytes(contents, declaration),
    conflict: findDeclarationConflict(contents, names),
  };
}

/**
 * Append the declaration, once, to the file the preflight saw.
 *
 * The file is re-read through the append handle and re-checked before the
 * write, so a declaration that arrived between the preflight and now is
 * refused rather than duplicated.
 *
 * @throws FeatureListError - When the file is not the one the preflight saw.
 * @throws DeclarationConflictError - When the list gained the declaration
 * since the preflight. Nothing was written.
 * @throws DeclarationWrittenError - When the write was short, or the flush or
 * the close failed after it. The declaration is in the list, possibly cut short.
 */
export async function appendFeatureDeclaration(preflight: FeatureListPreflight): Promise<void> {
  const { listPath } = preflight;
  const handle = await open(listPath, "a+");
  // Set the moment `write` returns: from then on the list holds some or all of
  // the declaration, and every later failure, the flush and the close
  // included, is one the module has to survive.
  let written: { readonly line: number } | undefined;
  let failure: unknown;
  try {
    const observed = await handle.stat();
    if (observed.dev !== preflight.identity.dev || observed.ino !== preflight.identity.ino) {
      throw new FeatureListError(
        `${listPath} changed identity between the preflight and the append, so the ` +
          `declaration was not written.`
      );
    }
    const contents = await handle.readFile("utf8");
    requireNoConflict(listPath, contents, preflight.names);

    const bytes = appendedBytes(contents, preflight.declaration);
    const line = appendedLineNumber(contents);
    const expected = Buffer.byteLength(bytes, "utf8");
    const { bytesWritten } = await handle.write(bytes, null, "utf8");
    written = { line };
    if (bytesWritten !== expected) {
      throw new DeclarationWrittenError(
        `${listPath} took ${bytesWritten} of the ${expected} bytes of the declaration, so ` +
          `line ${line} may end early.`,
        line
      );
    }
    try {
      await handle.sync();
    } catch (error) {
      throw new DeclarationWrittenError(
        `${listPath} took the declaration on line ${line}, but flushing it to disk failed ` +
          `(${errnoCode(error)}), so the line may not have reached the disk in full.`,
        line
      );
    }
  } catch (error) {
    failure = error;
  }

  // The close is not in a `finally`, because a `finally` that throws would
  // replace the error above, and a close that fails after the write is itself
  // a post-write failure rather than a reason to remove the module.
  try {
    await handle.close();
  } catch (error) {
    failure ??=
      written === undefined
        ? error
        : new DeclarationWrittenError(
            `${listPath} took the declaration on line ${written.line}, but closing the file ` +
              `failed (${errnoCode(error)}), so the line may not have reached the disk in full.`,
            written.line
          );
  }
  if (failure !== undefined) {
    throw failure;
  }
}

function errnoCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | undefined)?.code ?? "unknown error";
}

async function requireRegularFile(listPath: string): Promise<Stats> {
  let stats: Stats;
  try {
    stats = await lstat(listPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw error;
    }
    throw new FeatureListError(
      `${listPath} does not exist. \`generate\` declares each feature there with one line, ` +
        `\`export { feature as <binding> } from "./features/<file>.ts";\`, and never creates ` +
        `or rewrites that file. Create it (empty is fine) and run this again.`
    );
  }
  if (stats.isSymbolicLink()) {
    throw new FeatureListError(
      `${listPath} is a symbolic link, and a declaration is only ever appended to the real ` +
        `file inside the project. Replace the link with the file it points at and run this again.`
    );
  }
  if (!stats.isFile()) {
    throw new FeatureListError(
      `${listPath} is not a regular file, so nothing can be appended to it. The feature list ` +
        `is a TypeScript module; make it one and run this again.`
    );
  }
  return stats;
}

function requireNoConflict(listPath: string, contents: string, names: DeclarationNames): void {
  const conflict = findDeclarationConflict(contents, names);
  if (conflict !== undefined) {
    throw new DeclarationConflictError(declarationConflictMessage(listPath, conflict, names));
  }
}

/** Why a real run refuses the declaration, naming the line and the fix. */
export function declarationConflictMessage(
  listPath: string,
  conflict: DeclarationConflict,
  names: DeclarationNames
): string {
  if (conflict.kind === "path") {
    return (
      `${listPath} already declares "./features/${names.basename}" on line ${conflict.line}, so ` +
      `that module is already in the mod. Generate under a different name, or remove the ` +
      `line first.`
    );
  }
  return (
    `${listPath} already exports "${names.identifier}" on line ${conflict.line}, and two ` +
    `Features cannot share one export name. Generate under a different name, or rename that ` +
    `export first.`
  );
}
