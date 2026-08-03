/**
 * `planFiles(resolved)`: the whole scaffold as a value.
 *
 * Deliberately the same shape as the SDK's own `render` — a resolved config in,
 * a path-to-contents map out, no I/O — so the interesting assertions can be
 * made against a `Map` instead of a directory. Everything impure (mkdir, spawn,
 * prompts) lives in the shell around it.
 */

import { toPackageName } from "./derive.ts";
import type { Resolved } from "./options.ts";
import {
  eslintConfig,
  gitignore,
  packageJson,
  prettierrc,
  tsconfigJson,
  vitestConfig,
} from "./templates/project.ts";
import { readme } from "./templates/readme.ts";
import {
  contentExampleTestTs,
  contentExampleTs,
  flagsTs,
  indexTs,
  installTs,
  vanillaTs,
} from "./templates/source.ts";

export function planFiles(resolved: Resolved, packageName?: string): Map<string, string> {
  const files = new Map<string, string>();
  const name = packageName ?? toPackageName(resolved.targetDir.split(/[\\/]/).pop() ?? "");

  files.set("package.json", packageJson(resolved, name));
  files.set("tsconfig.json", tsconfigJson());
  files.set("vitest.config.ts", vitestConfig());
  files.set(".gitignore", gitignore());
  files.set("README.md", readme(resolved));

  if (resolved.prettier) {
    files.set(".prettierrc", prettierrc());
  }
  if (resolved.eslint) {
    files.set("eslint.config.js", eslintConfig());
  }

  files.set("src/index.ts", indexTs(resolved));
  files.set("src/install.ts", installTs());
  files.set("src/flags.ts", flagsTs(resolved));
  files.set("src/content/example.ts", contentExampleTs(resolved));
  files.set("src/content/example.test.ts", contentExampleTestTs(resolved));

  // Only when an install was found: the module calls `stellaris.load()`, and
  // shipping it unconditionally would put a file in the project whose whole
  // purpose is unavailable.
  if (resolved.installPath !== undefined) {
    files.set("src/vanilla.ts", vanillaTs(resolved));
  }

  // Sorted, so the scaffold is a function of the config and not of the order
  // this file happens to set keys in — the same property the SDK's emission
  // order has.
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
