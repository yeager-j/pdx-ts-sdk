import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { render, type PureMod } from "@pdx-ts/sdk";

import type { PairedExampleData } from "../src/paired-example-data.ts";
import { languageOf } from "../src/pdx-languages.ts";

/**
 * The execution half of the docs compile gate, and the producer of the
 * paired-example manifest.
 *
 * Every `<name>.example.ts` under `content/docs/` is a complete, standalone
 * lesson whose default export is the `PureMod` — the file itself performs the
 * Fold with `mod.compile`, because the Fold is part of the lesson. This script
 * enumerates them all from the filesystem, so the gate covers every example,
 * referenced by a page or not; it imports each one (a Fold failure throws
 * there) and runs `render()`, which is pure. A failure anywhere exits
 * non-zero, which fails `npm run build` — that is the gate, not a side effect
 * of it.
 *
 * It runs as `node --conditions=pdx-source`, so the examples execute against
 * the SDK's sources with no bundler involved, the same way the repo's codegen
 * scripts do. The rendered output lands in `.examples/paired-examples.json`,
 * which the `PairedExample` component reads at page render.
 */

const packageRoot = new URL("..", import.meta.url);
const contentRoot = new URL("content/docs/", packageRoot);

function exampleName(modulePath: string): string {
  const basename = modulePath.split("/").at(-1) ?? modulePath;
  return basename.slice(0, -".example.ts".length);
}

const examples = new Map<string, PairedExampleData>();
const paths: string[] = [];
for await (const entry of glob("**/*.example.ts", {
  cwd: contentRoot.pathname,
})) {
  paths.push(entry);
}
paths.sort();

for (const relative of paths) {
  const absolute = path.join(contentRoot.pathname, relative);
  const name = exampleName(relative);
  if (examples.has(name)) {
    throw new Error(
      `Two paired examples share the name "${name}"; one is ${relative}. ` +
        `Example names are the file's basename, so each must be unique across the site.`
    );
  }
  const mod = (await import(pathToFileURL(absolute).href)) as {
    default?: PureMod;
  };
  if (mod.default === undefined) {
    throw new Error(
      `The paired example "${name}" has no default export at ${relative}. ` +
        `An example's default export is its compiled PureMod.`
    );
  }
  const source = await readFile(absolute, "utf8");
  const files = [...render(mod.default)].map(([filePath, file]) => {
    // The component shows text. An example that emits a byte artifact needs a
    // presentation this component does not have, so refuse it loudly rather
    // than labelling an empty block with the asset's path.
    if (file.text === undefined) {
      throw new Error(
        `The paired example "${name}" renders bytes at ${filePath}. ` +
          `The paired-example component shows text files only.`
      );
    }
    return {
      path: filePath as string,
      // Localization text is BOM-prefixed on purpose; strip it for display only.
      text: file.text.replace(/^﻿/, ""),
      lang: languageOf(filePath),
    };
  });
  examples.set(name, { source: source.trimEnd(), files });
}

const manifestDir = new URL(".examples/", packageRoot);
await mkdir(manifestDir, { recursive: true });
await writeFile(
  new URL("paired-examples.json", manifestDir),
  JSON.stringify(Object.fromEntries(examples), null, 2)
);

console.log(`Checked and rendered ${examples.size} paired examples.`);
