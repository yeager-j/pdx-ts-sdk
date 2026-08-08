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

// The manifest is the single placement authority: `generate` writes into
// `contentDirectory` and discovery reads the same field, so a project that moves
// it moves both. Project-relative, and this file is `src/mod.ts`, hence the `../`.
const contentDir = new URL(`../${manifest.contentDirectory}/`, import.meta.url);

export async function buildTheMod(): Promise<PureMod> {
  const features = await discoverFeatures<typeof mod.config.prefix>(contentDir);
  return mod.compile(features);
}
