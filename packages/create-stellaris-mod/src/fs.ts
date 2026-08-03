/**
 * The filesystem shell: check the target is safe to write into, then write.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Files that may already sit in the target directory without it counting as
 * occupied — what `git init` and a fresh repo checkout leave behind. Anything
 * else and we stop: overwriting somebody's work is not recoverable, and a
 * scaffolder is the last tool that should do it.
 */
const HARMLESS = new Set([".git", ".gitignore", "LICENSE", "LICENSE.md", "README.md", ".DS_Store"]);

export async function preflight(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return; // Does not exist yet, which is the common case.
  }
  const blocking = entries.filter((entry) => !HARMLESS.has(entry));
  if (blocking.length > 0) {
    throw new Error(
      `${targetDir} is not empty, so scaffolding into it could overwrite work:\n` +
        blocking
          .slice(0, 10)
          .map((entry) => `  - ${entry}`)
          .join("\n") +
        (blocking.length > 10 ? `\n  ... and ${blocking.length - 10} more` : "") +
        `\nPick an empty directory, or clear this one first.`
    );
  }
}

export async function writeTree(
  targetDir: string,
  files: ReadonlyMap<string, string>
): Promise<void> {
  for (const [relPath, contents] of files) {
    const target = path.join(targetDir, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
}
