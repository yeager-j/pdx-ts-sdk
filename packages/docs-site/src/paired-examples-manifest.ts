import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PairedExampleData } from "./paired-example-data.ts";

/**
 * Reads the manifest `scripts/check-examples.ts` writes. Shared by the
 * `PairedExample` component and the LLM text export so both present the same
 * rendered examples. Resolved at runtime from the package root (Next's cwd),
 * not via `import.meta.url`: webpack rewrites statically-analyzable file URLs
 * into bundled assets, and the manifest must be read fresh from disk so
 * `next dev` picks up a re-run of the script without a restart.
 */
const manifestPath = path.join(process.cwd(), ".examples", "paired-examples.json");

export async function pairedExample(name: string): Promise<PairedExampleData> {
  let manifest: Record<string, PairedExampleData>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `No paired-example manifest at ${manifestPath}. ` +
        `Run \`npm run examples:check\` (the build runs it for you).`,
      { cause: error }
    );
  }
  const example = manifest[name];
  if (example === undefined) {
    const available = Object.keys(manifest).sort().join(", ") || "(none)";
    throw new Error(`No paired example is named "${name}". Available examples: ${available}.`);
  }
  return example;
}
