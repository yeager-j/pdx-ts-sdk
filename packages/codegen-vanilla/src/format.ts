/**
 * What the generated files look like on disk.
 *
 * `emitVanillaPackage` is sync and pure, so it emits TypeScript without caring
 * how it is laid out; Prettier is async and reads config off the filesystem.
 * Splitting them keeps the core testable, but it leaves two candidate answers
 * to "what are the bytes" — and the committed-output gate compares regenerated
 * text against a file the pre-commit hook has formatted. So the formatting step
 * is named once, here, and both the writer and the gate go through it.
 *
 * This is the other impure step, alongside `read-facts.ts`: it reads Prettier
 * config off disk, which is why it is not part of the core it formats.
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
