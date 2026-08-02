/**
 * `render(mod)` and `write(dir, files)` — the last two steps of the pure
 * pipeline (SDK-22). Emission grouping (collections' file hints, the patch
 * plan) happened in `buildMod`; render serializes the value. Localization
 * stays a single file regardless of hints — splitting it is a separate
 * decision for the standalone-localization work. `write` is the only impure
 * step, and it is nine lines.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { block, list, scalar, serialize } from "@pdx-ts/pdxscript";

import type { PureMod } from "./build.ts";
import { VanillaPathCollisionError } from "./errors.ts";
import { normalizeLogicalPath } from "./resolver/path-order.ts";

export function render(mod: PureMod): Map<string, string> {
  const { prefix } = mod.config;
  const files = new Map<string, string>();
  files.set("descriptor.mod", renderDescriptor(mod));
  for (const file of mod.contentFiles) {
    files.set(file.relPath, serialize(file.entries));
  }
  for (const file of mod.eventFiles) {
    files.set(file.relPath, serialize(file.entries));
  }
  if (mod.shipOfSizeLimits.size > 0) {
    files.set(
      `common/country_limits/ownership_limits/${prefix}_ownership_limits.txt`,
      serialize([
        block("default", [
          list(
            "ship_of_size_limits",
            [...mod.shipOfSizeLimits].map((id) => scalar(id))
          ),
        ]),
      ])
    );
  }
  const renderedOnActions = mod.onActions.render();
  if (renderedOnActions !== undefined) {
    files.set(`common/on_actions/${prefix}_on_actions.txt`, renderedOnActions);
  }
  files.set(`localisation/english/${prefix}_l_english.yml`, renderLocalization(mod));

  if (mod.patchPlan !== undefined) {
    files.set(mod.patchPlan.relPath, mod.patchPlan.content);
    const vanillaPaths = mod.vanillaPaths ?? new Set<string>();
    for (const relPath of files.keys()) {
      if (relPath !== "descriptor.mod" && vanillaPaths.has(normalizeLogicalPath(relPath))) {
        throw new VanillaPathCollisionError(
          `this mod would emit ${relPath}, a path vanilla already occupies — a same-path ` +
            `collision silently replaces the entire vanilla file`
        );
      }
    }
  }
  return files;
}

export async function write(
  outDir: string | URL,
  files: ReadonlyMap<string, string>
): Promise<void> {
  const root = outDir instanceof URL ? fileURLToPath(outDir) : outDir;
  for (const [relPath, content] of files) {
    const target = path.join(root, relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

function renderDescriptor(mod: PureMod): string {
  const { name, version, tags, supportedVersion } = mod.config;
  const lines = [`name="${name}"`];
  if (version !== undefined) {
    lines.push(`version="${version}"`);
  }
  if (tags !== undefined && tags.length > 0) {
    lines.push("tags={", ...tags.map((tag) => `\t"${tag}"`), "}");
  }
  lines.push(`supported_version="${supportedVersion}"`);
  return lines.join("\n") + "\n";
}

function renderLocalization(mod: PureMod): string {
  // The BOM is mandatory: Stellaris silently ignores localization files without it.
  const lines = [...mod.loc].map(([key, text]) => ` ${key}:0 "${text}"`);
  return "\uFEFF" + ["l_english:", ...lines].join("\n") + "\n";
}
