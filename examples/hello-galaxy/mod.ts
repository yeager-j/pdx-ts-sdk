import { createMod, discoverFeatures, type PureMod } from "@pdx-ts/sdk";

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
 * The whole mod, from a directory of feature modules.
 *
 * `content/` is organized the way the mod is thought about — a `resonance`
 * feature and an `amplifiers` feature — not the way Stellaris stores files.
 * `discoverFeatures` imports every selected module and reads its named
 * `feature` export. Each feature authors its own stem, and the build fans that
 * stem across every registry it touched:
 *
 *   content/amplifiers.ts → common/technology/hello_galaxy_amplifiers.txt
 *   content/resonance.ts  → common/technology/hello_galaxy_resonance.txt
 *                         → events/hello_galaxy_resonance.txt
 *
 * `resonance.ts` holds technologies *and* events, so it emits into two registry
 * directories; nothing in the source tree is shaped like `common/technology/`.
 * The other named and default exports are ordinary ESM API, so modules can
 * share definitions without registering them twice. Moving or renaming a
 * source module changes neither output identity nor bytes unless its authored
 * feature stem changes.
 *
 * `mod.compile` is the fold: capability-owned features in, an assembled value
 * out. Nothing is written and nothing is serialized until `render`/`write`.
 */
export const mod = createMod(config);

export async function defineHelloGalaxy(): Promise<PureMod> {
  return mod.compile(
    await discoverFeatures<typeof mod.config.prefix>(new URL("./content/", import.meta.url))
  );
}
