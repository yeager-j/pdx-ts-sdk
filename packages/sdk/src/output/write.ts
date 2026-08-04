/** Materialize rendered output beneath an explicitly chosen directory. */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function write(
  outDir: string | URL,
  files: ReadonlyMap<string, string>
): Promise<void> {
  const root = path.resolve(outDir instanceof URL ? fileURLToPath(outDir) : outDir);
  for (const [relPath, content] of files) {
    // Every key must land strictly under the root. `render` only ever produces
    // relative paths, but `write` is exported and takes any map, and
    // `path.join` would happily resolve `../..` or an absolute key to
    // somewhere the caller never named.
    //
    // Compared by `path.relative` rather than a string prefix: a prefix test
    // has to append a separator to stop `/out` matching `/output`, and that
    // appended separator is wrong precisely when the root already ends in one.
    // `path.relative` is separator-correct at a filesystem root, and on
    // Windows returns an absolute path for a different drive, which is exactly
    // the "not contained" answer.
    const target = path.resolve(root, relPath);
    const relative = path.relative(root, target);
    // An empty result means the target is the root itself: a directory, not a
    // file in it, so it is refused with the escapes rather than allowed.
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Refusing to write "${relPath}": it resolves to ${target}, which is not a file inside ` +
          `the output directory ${root}. A path that escapes the output directory would ` +
          `overwrite a file the caller never named. Pass paths relative to the output ` +
          `directory, without ".." segments and without a leading "/".`
      );
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}
