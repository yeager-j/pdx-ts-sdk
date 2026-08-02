/**
 * What the generated files look like on disk.
 *
 * `generateVanillaPackage` is sync and pure, so it emits TypeScript without
 * caring how it is laid out; Prettier is async and reads config off the
 * filesystem. Splitting them keeps the core testable, but it leaves two
 * candidate answers to "what are the bytes" — and the committed-output gate
 * compares regenerated text against a file the pre-commit hook has formatted.
 * So the formatting step is named once, here, and both the writer and the gate
 * go through it.
 */

import path from "node:path";
import { format, resolveConfig } from "prettier";

export async function formatEmitted(
  files: ReadonlyMap<string, string>,
  outDir: string
): Promise<Map<string, string>> {
  const formatted = new Map<string, string>();
  for (const [relative, contents] of files) {
    const target = path.join(outDir, relative);
    const options = await resolveConfig(target);
    formatted.set(relative, await format(contents, { ...options, filepath: target }));
  }
  return formatted;
}
