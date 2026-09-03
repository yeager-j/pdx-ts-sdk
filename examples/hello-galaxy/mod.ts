import { createMod } from "@pdx-ts/sdk";

const config = {
  name: "Hello Galaxy",
  prefix: "hello_galaxy" as const,
  version: "0.1.0",
  // The `v` is the form every shipped mod's descriptor uses, and the form
  // `stellaris.supportedVersionFor` derives; the launcher reads it verbatim.
  supportedVersion: "v4.0.*",
  tags: ["Technologies"],
};

/**
 * The authoring capability every feature module imports.
 *
 * `features/` is organized the way the mod is thought about — a `resonance`
 * feature and an `amplifiers` feature — not the way Stellaris stores files.
 * `features.ts` declares which of those modules are in the mod, one line
 * each, and `index.ts` compiles that list. Each feature authors its own stem,
 * and the build fans that stem across every registry it touched:
 *
 *   features/amplifiers.ts → common/technology/hello_galaxy_amplifiers.txt
 *   features/resonance.ts  → common/technology/hello_galaxy_resonance.txt
 *                          → events/hello_galaxy_resonance.txt
 *
 * `resonance.ts` holds technologies *and* events, so it emits into two registry
 * directories; nothing in the source tree is shaped like `common/technology/`.
 * A feature module's other exports are ordinary ESM API, so modules can share
 * definitions without registering them twice. Moving or renaming a source
 * module changes neither output identity nor bytes unless its authored feature
 * stem changes; only its line in `features.ts` has to follow.
 */
export const mod = createMod(config);
