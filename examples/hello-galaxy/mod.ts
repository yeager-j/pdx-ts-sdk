import { buildMod, discoverContent, type PureMod } from "../../src/index.ts";

const config = {
  name: "Hello Galaxy",
  prefix: "hello_galaxy",
  version: "0.1.0",
  supportedVersion: "4.0.*",
  tags: ["Technologies"],
};

/**
 * The whole mod, from a directory of feature modules.
 *
 * `content/` is organized the way the mod is thought about — a `resonance`
 * feature and an `amplifiers` feature — not the way Stellaris stores files.
 * `discoverContent` imports every `.ts` module under it and turns each one's
 * exports into a collection named after the file, and the build fans that one
 * stem across every registry the module touched:
 *
 *   content/amplifiers.ts → common/technology/hello_galaxy_amplifiers.txt
 *   content/resonance.ts  → common/technology/hello_galaxy_resonance.txt
 *                         → events/hello_galaxy_resonance.txt
 *
 * `resonance.ts` holds technologies *and* events, so it emits into two registry
 * directories; nothing in the source tree is shaped like `common/technology/`.
 * Moving a definition between feature modules changes which file it lands in
 * but never the bytes of a definition or its identity: emission order is a
 * function of the content, and ids are authored.
 *
 * `buildMod` is the fold: collections in, an assembled value out. Nothing is
 * written and nothing is serialized until `render`/`write`.
 */
export async function defineHelloGalaxy(): Promise<PureMod> {
  return buildMod(config, await discoverContent(new URL("./content/", import.meta.url)));
}
