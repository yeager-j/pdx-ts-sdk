/**
 * `planProject(resolved)`: the whole scaffold as a value.
 *
 * A resolved config goes in and a path-to-entry map comes out, with no I/O, so
 * the interesting assertions can be made against a `Map` instead of a
 * directory. Everything impure (mkdir, symlink, spawn, prompts) lives in the
 * shell around it.
 */

import { toPackageName } from "./derive.ts";
import type { Resolved } from "./options.ts";
import {
  agentsMd,
  claudeAgent,
  codexAgent,
  pdxProjectStartupSkill,
  pdxSdkAuthoringSkill,
  pdxSdkDocsSkill,
} from "./templates/llm.ts";
import {
  MANIFEST_FILE,
  MANIFEST_SCHEMA_FILE,
  manifestJson,
  manifestSchema,
} from "./templates/manifest.ts";
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
  inspectTs,
  installTs,
  modTs,
  vanillaTs,
} from "./templates/source.ts";

export type ProjectEntry =
  | { readonly kind: "file"; readonly contents: string }
  | { readonly kind: "symlink"; readonly target: string };

export type ProjectPlan = ReadonlyMap<string, ProjectEntry>;

export function planProject(resolved: Resolved, packageName?: string): Map<string, ProjectEntry> {
  const entries = new Map<string, ProjectEntry>();
  const name = packageName ?? toPackageName(resolved.targetDir.split(/[\\/]/).pop() ?? "");

  const file = (relPath: string, contents: string): void => {
    entries.set(relPath, { kind: "file", contents });
  };
  const symlink = (relPath: string, target: string): void => {
    entries.set(relPath, { kind: "symlink", target });
  };

  file("package.json", packageJson(resolved, name));
  // The Project Manifest, and the schema `$schema` points at relatively. Both
  // are the author's from here on: `generate` reads the manifest and never
  // repairs or migrates it.
  file(MANIFEST_FILE, manifestJson(resolved));
  file(MANIFEST_SCHEMA_FILE, manifestSchema());
  file("tsconfig.json", tsconfigJson());
  file("vitest.config.ts", vitestConfig());
  file(".gitignore", gitignore());
  file("README.md", readme(resolved));

  if (resolved.prettier) {
    file(".prettierrc", prettierrc());
  }
  if (resolved.eslint) {
    file("eslint.config.js", eslintConfig());
  }

  file("src/mod.ts", modTs(resolved));
  file("src/index.ts", indexTs());
  file("src/inspect.ts", inspectTs());
  file("src/install.ts", installTs());
  file("src/flags.ts", flagsTs(resolved));
  file("src/content/example.ts", contentExampleTs(resolved));
  file("src/content/example.test.ts", contentExampleTestTs(resolved));

  // Only when an install was found: the module calls `stellaris.load()`, and
  // shipping it unconditionally would put a file in the project whose whole
  // purpose is unavailable.
  if (resolved.installPath !== undefined) {
    file("src/vanilla.ts", vanillaTs(resolved));
  }

  if (resolved.llmSupport) {
    file("AGENTS.md", agentsMd());
    symlink("CLAUDE.md", "AGENTS.md");
    file(".agents/skills/pdx-project-startup/SKILL.md", pdxProjectStartupSkill());
    file(".agents/skills/pdx-sdk-authoring/SKILL.md", pdxSdkAuthoringSkill());
    file(".agents/skills/pdx-sdk-docs/SKILL.md", pdxSdkDocsSkill());
    symlink(".claude/skills", "../.agents/skills");
    file(".claude/agents/pdx-docs-expert.md", claudeAgent());
    file(".codex/agents/pdx-docs-expert.toml", codexAgent());
  }

  // Sorted, so the scaffold is a function of the config and not of the order
  // this file happens to set keys in — the same property the SDK's emission
  // order has.
  return new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
