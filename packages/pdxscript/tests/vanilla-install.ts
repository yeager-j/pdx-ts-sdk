/**
 * The local Stellaris install, and what happens when there is not one.
 *
 * Two suites depend on it, and together they are this package's only external
 * evidence: the fixpoint over every file the game ships, and agreement with an
 * independent parser. The focused and property suites prove the package is
 * consistent with itself, which is a different claim — neither of them can
 * tell us we read a real file the way the game does.
 *
 * A CI runner has no game install, so `npm test` skips both. A skip that only
 * prints a warning is a green run that proved less than it looks like it did,
 * so the absence is made to fail somewhere:
 *
 * - `npm run test:vanilla` sets `PDX_REQUIRE_INSTALL`, which turns a missing
 *   install from a skip into a failure with the path it looked for.
 * - `npm run release:check` runs that script, and records a skipped run as a
 *   failed gate rather than a passing one — the same treatment the vanilla
 *   codegen drift gate already gets.
 *
 * Where the install is comes from `STELLARIS_PATH`, and the fallback below is
 * a convenience for one platform rather than a lookup. The real, sentinel-
 * checked, per-platform lookup is `locateInstall` in `@pdx-ts/sdk`, and
 * `scripts/test-vanilla.mjs` resolves it there and passes the answer down —
 * a repo-level script may reach for the SDK, while this package is meant to
 * stand on its own, so its tests do not import it.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

export const STELLARIS_DIR =
  process.env["STELLARIS_PATH"] ??
  join(process.env["HOME"] ?? "", "Library/Application Support/Steam/steamapps/common/Stellaris");

export const COMMON = join(STELLARIS_DIR, "common");

export const HAS_INSTALL = existsSync(COMMON);

/** Set by `npm run test:vanilla`: a missing install is a failure, not a skip. */
export const REQUIRE_INSTALL = process.env["PDX_REQUIRE_INSTALL"] === "1";

/**
 * True when the suites may stand aside, which is any ordinary run.
 *
 * There is no warning printed here. These files used to log one, and it never
 * reached a reader: vitest does not show console output from a file whose
 * tests all skipped, so the notice that the evidence had not been gathered was
 * itself invisible. What is visible is the reporter's own skipped count — and
 * what is reliable is the two commands above, which cannot skip.
 */
export const SKIP_WITHOUT_INSTALL = !HAS_INSTALL && !REQUIRE_INSTALL;

/**
 * Stops a required run that has nothing to read, rather than letting it report
 * success over zero files.
 */
export function requireInstall(): void {
  if (!HAS_INSTALL) {
    throw new Error(
      `PDX_REQUIRE_INSTALL is set but ${COMMON} does not exist. This suite is the package's ` +
        "external evidence and cannot be satisfied without a real install; set STELLARIS_PATH " +
        "to the Stellaris install root."
    );
  }
}

// Files under common/ that are not PDXScript at all (modding documentation
// shipped as .txt).
const NOT_PDXSCRIPT = new Set(["HOW_TO_MAKE_NEW_SHIPS.txt", "99_README_EDICTS.txt"]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (name.endsWith(".txt")) {
      files.push(path);
    }
  }
  return files;
}

/** Every PDXScript file under the install's `common/` tree. */
export function vanillaFiles(): string[] {
  return walk(COMMON).filter((path) => !NOT_PDXSCRIPT.has(basename(path)));
}

/**
 * A file's name as the suites report it: relative to `common/`, with forward
 * slashes on every platform.
 *
 * The separator is not cosmetic here. Both suites pin their known cases by
 * name — the two vanilla files the parser repairs, the files jomini cannot
 * read, the files jomini misreads — and every one of those lists is written
 * with forward slashes. `relative` answers with backslashes on Windows, so an
 * unnormalized name would fail all of those comparisons on that platform
 * alone, in a gate that is now required.
 */
export function vanillaName(path: string): string {
  return relative(COMMON, path).split(sep).join("/");
}
