/**
 * The golden fixture's mod wiring.
 *
 * Hand-written, and deliberately the same shape `templates/source.ts` emits:
 * the manifest is the configuration, the sole key under `mod` is the prefix,
 * and `prefix` goes last in the spread so a stray `prefix` field inside the
 * entry cannot rename every id. Kept minimal — no vanilla view, no identifier
 * package — because this project exists to compile and build generated feature
 * source, not to demonstrate the scaffold.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMod, discoverFeatures, type PureMod } from "@pdx-ts/sdk";

import manifest from "../stellaris-mod.json" with { type: "json" };

const prefixes = Object.keys(manifest.mod);
if (prefixes.length !== 1) {
  throw new Error(
    `stellaris-mod.json must declare exactly one mod, and declares ${prefixes.length}.`
  );
}

const prefix = prefixes[0] as keyof typeof manifest.mod;

export const config = { ...manifest.mod[prefix], prefix };

export const mod = createMod(config);

const contentDirectoryPattern = /^src(?:\/(?!\.{1,2}(?:\/|$))[^\/#?%\\\u0000]+)+$/;
if (!contentDirectoryPattern.test(manifest.contentDirectory)) {
  throw new Error(
    `stellaris-mod.json contentDirectory ${JSON.stringify(manifest.contentDirectory)} is not a ` +
      `normalized directory below src.`
  );
}
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const contentDir = path.join(projectRoot, ...manifest.contentDirectory.split("/"));

export async function buildTheMod(): Promise<PureMod> {
  const features = await discoverFeatures<typeof mod.config.prefix>(contentDir);
  return mod.compile(features);
}
