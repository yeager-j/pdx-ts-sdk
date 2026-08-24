/**
 * The generated project's TypeScript. Every call in here is copied from a
 * working call site in the SDK's own examples and tests, and the end-to-end
 * test typechecks, builds and runs the interpolated result — because a template
 * that merely looks right is a template that ships broken.
 */

import type { Resolved } from "../options.ts";
import { quoteTs } from "../quote.ts";

export function modTs(resolved: Resolved): string {
  const vanillaWiring =
    resolved.installPath === undefined ? "" : `import { loadVanilla } from "./vanilla.ts";\n`;
  const buildBody =
    resolved.installPath === undefined
      ? "  return project.build();"
      : "  return project.build({ vanilla: loadVanilla() });";

  return `/**
 * The mod project declared by \`stellaris-mod.json\`.
 *
 * \`createModProject\` validates the manifest and owns the conventional pipeline:
 * discover Feature modules, capture the optional Asset tree, then perform one
 * capability-owned Fold. Pass \`discover\` or \`additionalFeatures\` to
 * \`project.build()\` for a pre-compile customization. For a different pipeline,
 * compose \`discoverFeatures\`, \`mod.assetTree\`, and \`mod.compile\` directly.
 * Project declaration reads no source files; only \`buildTheMod()\` starts work.
 */

import { createModProject } from "@pdx-ts/sdk";
import manifest from "../stellaris-mod.json" with { type: "json" };
${vanillaWiring}
const project = createModProject(manifest, {
  projectRoot: new URL("../", import.meta.url),
});

export const { config, mod } = project;

export function buildTheMod() {
${buildBody}
}

`;
}

export function indexTs(): string {
  return `/**
 * The build. \`npm run build\` runs this file — Node executes TypeScript
 * directly, so nothing stands between this source and the emitted mod.
 *
 * The SDK's terminal runner owns rendering, writing, previews, and presentation,
 * so formatting improvements arrive with SDK upgrades rather than being copied
 * into this project.
 */

import { runBuild } from "@pdx-ts/sdk";

import { buildTheMod } from "#mod";

export const outDir = new URL("../out/", import.meta.url);
export const previewsDir = new URL("../previews/", import.meta.url);

await runBuild(buildTheMod(), { outDir, previewsDir });
`;
}

export function installTs(): string {
  return `/**
 * \`npm run install-mod\`: build, then put the result where the Stellaris
 * launcher looks for it.
 *
 * \`install\` writes the content into the launcher's mod directory and drops the
 * sibling \`<prefix>.mod\` descriptor beside it — the same fields as the mod's
 * own descriptor plus the \`path=\` line the launcher reads. Set
 * \`STELLARIS_MOD_DIR\` if your mod directory is somewhere non-standard, which
 * on Windows it can be when OneDrive has redirected Documents.
 *
 * This shares \`buildTheMod\` with \`src/index.ts\` rather than folding content a
 * second time, so the mod that gets installed is built with the same vanilla
 * view (id collision checks included) as the one \`npm run build\` writes to
 * \`out/\` — never a second, unchecked build. The SDK terminal runner owns
 * installation and presentation so existing projects receive formatting and
 * diagnostic improvements when they update the SDK.
 *
 * Enable the mod in a launcher playset afterwards; the launcher only rescans
 * this directory on startup, so restart it if the mod does not appear.
 */

import { runInstall } from "@pdx-ts/sdk";

import { buildTheMod } from "#mod";

await runInstall(buildTheMod());
`;
}

export function vanillaTs(resolved: Resolved): string {
  return `/**
 * The vanilla view: the installed game, parsed.
 *
 * Passing it to \`mod.compile\` enables checked vanilla references and gives
 * \`mod.patchTechnology\` the parsed definition it needs to re-emit a vanilla
 * definition faithfully. Own content ids are already minted from the mod prefix.
 *
 * Optional on purpose. A checkout on a machine without the game still builds —
 * it just builds unchecked — so a teammate or a CI runner is never blocked by
 * not owning Stellaris. Set \`STELLARIS_PATH\` if the install is somewhere the
 * SDK does not look, or \`PDX_NO_VANILLA=1\` to skip it deliberately.
 */

import * as stellaris from "@pdx-ts/sdk/installation";
import type { VanillaView } from "@pdx-ts/sdk/installation";
${fallbackConst(resolved)}
export function loadVanilla(): VanillaView | undefined {
  if (process.env["PDX_NO_VANILLA"] === "1") {
    return undefined;
  }
  try {
    return stellaris.load(${loadArgument(resolved)});
  } catch (error) {
    console.warn(
      \`Building without the vanilla view: \${error instanceof Error ? error.message : String(error)}\`
    );
    console.warn("Set STELLARIS_PATH to the game root to enable vanilla id checks and patches.");
    return undefined;
  }
}
`;
}

export function flagsTs(resolved: Resolved): string {
  return `/**
 * Flags this mod sets and reads.
 *
 * This module sits *outside* \`src/content/\` so content modules can import
 * shared values without giving them feature-placement responsibilities. Only a
 * module's named \`feature\` export is discovered; every other export is ordinary
 * ESM API.
 *
 * Declaring flag names by kind is what makes them checkable: \`hasCountryFlag\`
 * against a planet flag is a compile error rather than a condition that is
 * quietly never true.
 */

import { countryFlags } from "@pdx-ts/sdk/stellaris";

export const flags = countryFlags("${resolved.prefix}_welcomed");
`;
}

export function contentExampleTs(resolved: Resolved): string {
  const p = resolved.prefix;
  return `/**
 * One feature, one module.
 *
 * Stellaris wants technologies in \`common/technology/\` and events in
 * \`events/\`; a feature wants them next to each other. Both happen: this module
 * is the feature, and the build fans its single stem out across every registry
 * it touches, so this one file emits
 * \`common/technology/${p}_example.txt\` *and*
 * \`events/${p}_example.txt\`.
 *
 * Rename this file and the emitted filenames follow. Add \`weapons.ts\` beside it
 * and you get another pair — with no directory in your source tree shaped like
 * the output tree.
 *
 * \`#mod\` is the project's own import alias for \`src/mod.ts\` (see
 * \`package.json#imports\`), so moving this module deeper never rewrites it.
 */

import { hasCountryFlag, not, onActions, vanilla } from "@pdx-ts/sdk/stellaris";

import { mod } from "#mod";

import { flags } from "../flags.ts";

export const firstSteps = mod.technology("first_steps", {
  name: "First Steps",
  desc: "The first technology this mod adds.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

// A namespace belongs to exactly one feature file, so the handle stays local.
// This root namespace preserves the scaffold's stable <prefix>.<number> ids.
const events = mod.namespace();

export const welcome = events.country(1, {
  title: "A New Signal",
  desc: "Something in the data does not belong.",
  picture: vanilla.spriteType.eventpictures.GFX_evt_mysterious_signal,
  showSound: vanilla.soundEffect.gui.gui_sound_effects.event_alien_signal,
  isTriggeredOnly: true,
  immediate: (country) => {
    // The closure receives a country scope object, so only country-legal
    // effects exist on it — a planet effect here would not compile.
    country.if(not(hasCountryFlag(flags.${p}_welcomed)), () => {
      country.setCountryFlag(flags.${p}_welcomed);
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "Interesting.", key: "interesting" }],
});

// Without a hook nothing fires this. It belongs in the feature with its event.
export const gameStart = mod.on(onActions.onGameStartCountry, [welcome]);

export const feature = mod.feature("example", [firstSteps, welcome, gameStart]);
`;
}

export function contentExampleTestTs(resolved: Resolved): string {
  const p = resolved.prefix;
  return `/**
 * Tests, colocated with the feature they test.
 *
 * \`discoverFeatures\` imports selected modules under \`src/content/\` and reads
 * their named \`feature\` exports. It skips \`*.test.ts\`, so this file can live
 * beside the feature it tests; see \`DEFAULT_CONTENT_PATTERN\` in the SDK if you
 * want to change what counts.
 *
 * \`fixture\` is not the game. It interprets the triggers and effects you
 * recorded, so it runs in milliseconds and needs no launcher — but it models
 * only semantics somebody deliberately verified, and throws on anything else
 * rather than guessing. A passing test means the logic you wrote does what you
 * meant, not that the game agrees about everything around it.
 */

import { fixture } from "@pdx-ts/sdk-testing";
import { describe, expect, it } from "vitest";

import { flags } from "../flags.ts";
import { welcome } from "./example.ts";

describe("the welcome event", () => {
  it("flags the country and pays out the first time", () => {
    const world = fixture({ countries: [{ name: "Player" }] }, { events: [welcome] });
    const player = world.country(0);

    world.fire(welcome, player);

    expect(player.hasFlag(flags.${p}_welcomed)).toBe(true);
    expect(player.resource("influence")).toBe(50);
  });

  it("pays out only once, because the flag gates it", () => {
    const world = fixture(
      { countries: [{ name: "Player", flags: [flags.${p}_welcomed] }] },
      { events: [welcome] }
    );

    world.fire(welcome, world.country(0));

    expect(world.country(0).resource("influence")).toBe(0);
  });
});
`;
}

/**
 * Where the game was when this project was scaffolded — emitted only when the
 * author named the path, since that is exactly the case the SDK's own detection
 * would miss. A path found at a platform default is left out: detection will
 * find it again, and an absolute machine path in a committed file is noise
 * every teammate has to delete.
 */
function fallbackConst(resolved: Resolved): string {
  if (!resolved.installPathIsExplicit || resolved.installPath === undefined) {
    return "";
  }
  return `
/**
 * The install this project was scaffolded against. Machine-specific: set
 * \`STELLARIS_PATH\` instead if you share this repository, which wins over it.
 */
const SCAFFOLDED_INSTALL = ${quoteTs(resolved.installPath)};
`;
}

/**
 * `stellaris.load({ installPath })` outranks `STELLARIS_PATH`, so the baked-in
 * path is passed only when the environment has nothing to say. Otherwise a
 * teammate could not override a path that is not on their machine.
 */
function loadArgument(resolved: Resolved): string {
  if (!resolved.installPathIsExplicit || resolved.installPath === undefined) {
    return "";
  }
  return `process.env["STELLARIS_PATH"] ? {} : { installPath: SCAFFOLDED_INSTALL }`;
}
