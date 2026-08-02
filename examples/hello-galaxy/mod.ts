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
 * exports into a collection named after the file, so both `technology.ts`
 * modules feed `common/technology/hello_galaxy_technology.txt` and
 * `events.ts` feeds `events/hello_galaxy_events.txt`. Moving a definition
 * between feature folders cannot change a byte of the output: emission order
 * is a function of the content, and the file name comes from the basename.
 *
 * `buildMod` is the fold: collections in, an assembled value out. Nothing is
 * written and nothing is serialized until `render`/`write`.
 */
export async function defineHelloGalaxy(): Promise<PureMod> {
  return buildMod(config, await discoverContent(new URL("./content/", import.meta.url)));
}
