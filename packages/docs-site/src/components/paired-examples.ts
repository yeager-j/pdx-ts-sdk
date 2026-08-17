import { render, type PureMod } from "@pdx-ts/sdk";

import { languageOf } from "../pdx-languages.ts";

/**
 * The registry behind `PairedExample.astro`, and the execution half of the
 * docs compile gate. Every `<name>.example.ts` under `src/content/docs/` is a
 * complete, standalone lesson whose default export is the `PureMod` — the file
 * itself performs the Fold with `mod.compile`, because the Fold is part of the
 * lesson. This module runs `render()`, which is pure: the serialized files
 * exist only as values, and nothing is materialized to disk.
 *
 * Everything happens at module scope, so the gate covers every discovered
 * example, referenced by a page or not: the eager globs import each one (a
 * Fold failure throws there), and the loop below renders each one. A failure
 * anywhere fails `astro build` — that is the gate, not a side effect of it.
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

const examples = new Map<string, PairedExampleData>();
for (const [modulePath, mod] of Object.entries(compiled)) {
  const name = exampleName(modulePath);
  if (examples.has(name)) {
    throw new Error(
      `Two paired examples share the name "${name}"; one is ${modulePath}. ` +
        `Example names are the file's basename, so each must be unique across the site.`
    );
  }
  const source = sources[modulePath];
  if (source === undefined) {
    throw new Error(`The paired example "${name}" has no raw source at ${modulePath}.`);
  }
  const files = [...render(mod)].map(([path, file]) => {
    // The component shows text. An example that emits a byte artifact needs a
    // presentation this component does not have, so refuse it loudly rather
    // than labelling an empty block with the asset's path.
    if (file.text === undefined) {
      throw new Error(
        `The paired example "${name}" renders bytes at ${path}. ` +
          `The paired-example component shows text files only.`
      );
    }
    return {
      path: path as string,
      // Localization text is BOM-prefixed on purpose; strip it for display only.
      text: file.text.replace(/^﻿/, ""),
      lang: languageOf(path),
    };
  });
  examples.set(name, { source: source.trimEnd(), files });
}

export function pairedExample(name: string): PairedExampleData {
  const example = examples.get(name);
  if (example === undefined) {
    const available = [...examples.keys()].sort().join(", ") || "(none)";
    throw new Error(`No paired example is named "${name}". Available examples: ${available}.`);
  }
  return example;
}
