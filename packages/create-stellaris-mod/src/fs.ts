/**
 * The filesystem shell: check the target is safe to write into, then write.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Refuse a target that already exists.
 *
 * The tempting version of this tolerates "harmless" leftovers — a `.git`, a
 * README, a `.gitignore` — so you can scaffold into a freshly initialized
 * repository. That is exactly where it goes wrong: the scaffold *writes* a
 * README and a `.gitignore`, so the files it waves through are the ones it
 * then destroys, and silently.
 *
 * Refusing outright is the standard behavior and needs no list to keep correct.
 * A new directory is the only thing that cannot be somebody's work.
 */
export async function preflight(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return; // Does not exist, which is the only safe case.
  }
  const summary =
    entries.length === 0
      ? "it already exists"
      : `it already exists and holds ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  throw new Error(
    `Cannot scaffold into ${targetDir}: ${summary}.\n` +
      `Pick a path that does not exist yet — the scaffold writes a README, a .gitignore ` +
      `and a src/ tree, and will not overwrite anything to do it.`
  );
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
