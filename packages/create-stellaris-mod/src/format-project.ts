/**
 * Post-publication formatting with the project's own Prettier.
 *
 * Recipe renderers emit well-formed, conventionally shaped source, but nothing
 * in this package reproduces Prettier's wrapping rules or depends on Prettier
 * at runtime. Instead, after the file is published, the project's own install
 * gets the last word: `init` offers Prettier as a devDependency, and if the
 * author kept it, the written file is handed to *that* Prettier — their
 * version, their configuration, their plugins — by spawning its own bin with
 * the project as the working directory. No install means no formatting: the
 * opt-out is the absence of the dependency, not a flag.
 *
 * Failure here never unpublishes. By the time this runs the file is the
 * author's, and a formatter that fails is an ordinary tooling fact about their
 * project — reported as a warning, never as a failed generation.
 */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Formats one written file with the Prettier resolved from `rootDir`, if any.
 * Returns a warning to print on stderr, or `undefined` when formatting
 * succeeded or there was no Prettier to run.
 */
export async function formatWithProjectPrettier(
  rootDir: string,
  filePath: string
): Promise<string | undefined> {
  let manifestPath: string;
  try {
    // Node's own resolution, from the project: hoisted, workspace, and linked
    // layouts all answer the same question the author's `npm run format` asks.
    manifestPath = createRequire(path.join(rootDir, "package.json")).resolve(
      "prettier/package.json"
    );
  } catch {
    return undefined;
  }

  try {
    const require = createRequire(manifestPath);
    const manifest = require(manifestPath) as { bin?: string | Record<string, string> };
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["prettier"];
    if (bin === undefined) {
      throw new Error(`${manifestPath} declares no "prettier" bin`);
    }
    // Their bin under this Node, from their root: the config and plugins that
    // apply are exactly the ones their own `prettier --write` would use.
    await run(process.execPath, [path.join(path.dirname(manifestPath), bin), "--write", filePath], {
      cwd: rootDir,
    });
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message.trim() : String(error);
    return (
      `the project's Prettier could not format ${filePath}; the file is written as generated.\n` +
      detail
    );
  }
}
