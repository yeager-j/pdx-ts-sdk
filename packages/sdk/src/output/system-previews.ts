/**
 * The disk-touching step for solar-system previews: writes one interactive
 * SVG per initializer plus an `index.html` gallery, and reports what it
 * wrote. The pure half is `inspectSolarSystems`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PureMod } from "../compiler/model.ts";
import type { SolarSystemDiagnostic } from "../solar-system-inspect/diagnose.ts";
import { inspectSolarSystems } from "../solar-system-inspect/inspect-mod.ts";

/** One written preview. */
export interface SystemPreview {
  /** Full content id of the initializer. */
  readonly id: string;
  /** Path of the written SVG, relative to the previews directory. */
  readonly relPath: string;
  /** The layout findings for this system, advisory only. */
  readonly diagnostics: readonly SolarSystemDiagnostic[];
}

/** What {@link writeSystemPreviews} wrote. */
export interface SystemPreviewReport {
  /** One entry per solar-system initializer, in emission order. */
  readonly previews: readonly SystemPreview[];
  /** Path of the gallery page, relative to the previews directory. */
  readonly indexRelPath: string;
}

/**
 * Writes an interactive SVG preview for every solar-system initializer in a
 * compiled mod, plus an `index.html` gallery linking them, and returns the
 * findings so a build script can print them. Advisory only: findings never
 * reach `mod.warnings` and never fail a build. A mod with no solar systems
 * writes nothing and reports an empty list.
 *
 * Point `dir` outside the mod's output directory — previews are authoring
 * aids, not mod files.
 *
 * @example
 * ```ts
 * const report = await writeSystemPreviews(new URL("../previews/", import.meta.url), mod);
 * for (const preview of report.previews) {
 *   for (const finding of preview.diagnostics) {
 *     console.log(`layout (${finding.certainty}) ${finding.code}: ${finding.message}`);
 *   }
 * }
 * ```
 */
export async function writeSystemPreviews(
  dir: string | URL,
  mod: PureMod
): Promise<SystemPreviewReport> {
  const target = typeof dir === "string" ? dir : fileURLToPath(dir);
  const inspections = inspectSolarSystems(mod);
  const previews: SystemPreview[] = [];
  if (inspections.size === 0) {
    return Object.freeze({ previews: Object.freeze(previews), indexRelPath: "index.html" });
  }

  await mkdir(target, { recursive: true });
  for (const [id, inspection] of inspections) {
    const relPath = `${id}.svg`;
    await writeFile(path.join(target, relPath), inspection.svg);
    previews.push(Object.freeze({ id, relPath, diagnostics: inspection.diagnostics }));
  }
  await writeFile(path.join(target, "index.html"), galleryPage(mod.config.name, previews));
  return Object.freeze({ previews: Object.freeze(previews), indexRelPath: "index.html" });
}

function galleryPage(modName: string, previews: readonly SystemPreview[]): string {
  const cards = previews
    .map((preview) => {
      const warnings = preview.diagnostics.filter((d) => d.severity === "warning").length;
      const infos = preview.diagnostics.length - warnings;
      const counts = [
        warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
        infos > 0 ? `${infos} info` : "",
      ]
        .filter((part) => part !== "")
        .join(", ");
      return (
        `<a class="card" href="${escapeHtml(preview.relPath)}">` +
        `<img src="${escapeHtml(preview.relPath)}" alt="${escapeHtml(preview.id)}" loading="lazy"/>` +
        `<span class="name">${escapeHtml(preview.id)}</span>` +
        `<span class="findings">${counts === "" ? "no findings" : escapeHtml(counts)}</span>` +
        `</a>`
      );
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(modName)} solar systems</title>
<style>
  body { margin: 0; padding: 2rem; background: #0b0e1a; color: #aab4d4; font-family: ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 1.2rem; font-weight: 600; }
  p { color: #7f8cb0; max-width: 60ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .card { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.75rem; border: 1px solid #2c3654; border-radius: 8px; text-decoration: none; color: inherit; }
  .card:hover { border-color: #4a5578; }
  .card img { width: 100%; aspect-ratio: 1; border-radius: 4px; }
  .name { font-size: 0.85rem; overflow-wrap: anywhere; }
  .findings { font-size: 0.75rem; color: #7f8cb0; }
</style>
</head>
<body>
<h1>${escapeHtml(modName)} solar systems</h1>
<p>Cursor-space schematics, not game rendering. Open a card for the interactive preview: scroll to zoom, drag to pan, hover a body for its label.</p>
<div class="grid">
${cards}
</div>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
