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
 * `preflightFeatureList` looks and refuses; `appendFeatureDeclaration` runs only
 * after the module has been published, and the command that calls it removes
 * that module again when the append fails, so the project never holds a
 * feature module its list does not name.
 */

import type { Stats } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  appendedBytes,
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
}

/**
 * Look at the feature list without touching it.
 *
 * @throws FeatureListError - When the list is missing, a symbolic link, or
 * not a regular file.
 * @throws DeclarationConflictError - When it already declares the module or
 * exports the binding.
 */
export async function preflightFeatureList(
  rootDir: string,
  names: DeclarationNames,
  declaration: string
): Promise<FeatureListPreflight> {
  const listPath = path.join(rootDir, ...FEATURE_LIST_PATH.split("/"));
  const identity = await requireRegularFile(listPath);
  const contents = await readFile(listPath, "utf8");
  requireNoConflict(listPath, contents, names);
  return {
    listPath,
    identity,
    names,
    declaration,
    bytes: appendedBytes(contents, declaration),
  };
}

/**
 * Append the declaration, once, to the file the preflight saw.
 *
 * The file is re-read through the append handle and re-checked before the
 * write, so a declaration that arrived between the preflight and now is
 * refused rather than duplicated.
 */
export async function appendFeatureDeclaration(preflight: FeatureListPreflight): Promise<void> {
  const { listPath } = preflight;
  const handle = await open(listPath, "a+");
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
    const { bytesWritten } = await handle.write(bytes, null, "utf8");
    if (bytesWritten !== Buffer.byteLength(bytes, "utf8")) {
      throw new FeatureListError(
        `${listPath} took ${bytesWritten} of the ${Buffer.byteLength(bytes, "utf8")} bytes of ` +
          `the declaration, so it may now end mid-line. Check its last line.`
      );
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
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
    throw new DeclarationConflictError(conflictMessage(listPath, conflict, names));
  }
}

function conflictMessage(
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
