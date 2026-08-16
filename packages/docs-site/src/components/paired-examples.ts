import { render, type PureMod } from "@pdx-ts/sdk";

/**
 * The registry behind `PairedExample.astro`, and the execution half of the
 * docs compile gate. Every `<name>.example.ts` under `src/content/docs/` is a
 * complete, standalone lesson whose default export is the `PureMod` — the file
 * itself performs the Fold with `mod.compile`, because the Fold is part of the
 * lesson. This module runs `render()`, which is pure: the serialized files
 * exist only as values, and nothing is materialized to disk.
 *
 * Both globs are eager, so a Fold failure in any example throws at import time
 * and fails `astro build` — that is the gate, not a side effect of it.
 */

export interface PairedExampleFile {
  readonly path: string;
  readonly text: string;
  readonly lang: string;
}

export interface PairedExampleData {
  readonly source: string;
  readonly files: readonly PairedExampleFile[];
}

const compiled = import.meta.glob<PureMod>("../content/docs/**/*.example.ts", {
  eager: true,
  import: "default",
});

const sources = import.meta.glob<string>("../content/docs/**/*.example.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});

function exampleName(modulePath: string): string {
  const basename = modulePath.split("/").at(-1) ?? modulePath;
  return basename.slice(0, -".example.ts".length);
}

const modulePaths = new Map<string, string>();
for (const modulePath of Object.keys(compiled)) {
  const name = exampleName(modulePath);
  const existing = modulePaths.get(name);
  if (existing !== undefined) {
    throw new Error(
      `Two paired examples share the name "${name}": ${existing} and ${modulePath}. ` +
        `Example names are the file's basename, so each must be unique across the site.`
    );
  }
  modulePaths.set(name, modulePath);
}

function displayLang(path: string): string {
  return path.endsWith(".yml") ? "yaml" : "txt";
}

export function pairedExample(name: string): PairedExampleData {
  const modulePath = modulePaths.get(name);
  if (modulePath === undefined) {
    const available = [...modulePaths.keys()].sort().join(", ") || "(none)";
    throw new Error(`No paired example is named "${name}". Available examples: ${available}.`);
  }
  const mod = compiled[modulePath];
  const source = sources[modulePath];
  if (mod === undefined || source === undefined) {
    throw new Error(`The paired example "${name}" resolved inconsistently at ${modulePath}.`);
  }
  const files = [...render(mod)].map(([path, file]) => ({
    path: path as string,
    // Localization text is BOM-prefixed on purpose; strip it for display only.
    text: (file.text ?? "").replace(/^﻿/, ""),
    lang: displayLang(path),
  }));
  return { source: source.trimEnd(), files };
}
