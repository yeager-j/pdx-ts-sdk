/**
 * The build the matrix harness executes.
 *
 * Same three steps as the scaffolded `src/index.ts` — discover, compile,
 * render, write — with the output directory taken from argv so a test can point
 * each run at its own temporary directory. Compiling is what proves a generated
 * file is more than syntactically legal: discovery imports it, the fold reads
 * the items it exported, and the emitted files carry the ids it minted.
 */

import { render, write } from "@pdx-ts/sdk";

import { buildTheMod } from "./mod.ts";

const outDir = process.argv[2];
if (outDir === undefined) {
  throw new Error("usage: node --conditions=pdx-source src/build-check.ts <outDir>");
}

const mod = await buildTheMod();
const files = render(mod);
await write(outDir, files);

for (const warning of mod.warnings) {
  console.warn(`warning (${warning.code}): ${warning.message}`);
}
for (const relPath of files.keys()) {
  console.log(`wrote ${relPath}`);
}
