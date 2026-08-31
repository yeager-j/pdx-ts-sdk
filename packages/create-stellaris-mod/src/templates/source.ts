/**
 * The generated project's TypeScript. Every call in here is copied from a
 * working call site in the SDK's own examples and tests, and the end-to-end
 * test typechecks, builds and runs the interpolated result — because a template
 * that merely looks right is a template that ships broken.
 */

import type { Resolved } from "../options.ts";
import { runScript } from "../package-manager.ts";
import { quoteTs } from "../quote.ts";

export function modTs(): string {
  return `/**
 * The mod project declared by \`stellaris-mod.json\`.
 *
 * \`createModProject\` validates the manifest and owns the conventional pipeline:
 * discover Feature modules, capture the optional Asset tree, then perform one
 * capability-owned Fold. Pass \`discover\` or \`additionalFeatures\` to
 * \`project.build()\` for a pre-compile customization. For a different pipeline,
 * compose \`discoverFeatures\`, \`mod.assetTree\`, and \`mod.compile\` directly.
 * Project declaration reads no source files; only \`buildTheMod()\` starts work.
 *
 * \`buildTheMod\` is \`async\` so that a refusal from \`loadVanilla()\` becomes a
 * rejected promise rather than a synchronous throw. The entry points call it as
 * \`runBuild(buildTheMod(), ...)\`, and a synchronous throw there would escape
 * the runner that exists to present failures.
 */

import { createModProject } from "@pdx-ts/sdk";
import manifest from "../stellaris-mod.json" with { type: "json" };
import { loadVanilla } from "./vanilla.ts";

const project = createModProject(manifest, {
  projectRoot: new URL("../", import.meta.url),
});

export const { config, mod } = project;

export async function buildTheMod() {
  return project.build({ vanilla: loadVanilla() });
}

`;
}

export function indexTs(resolved: Resolved): string {
  return `/**
 * The build. \`${runScript(resolved.packageManager, "build")}\` runs this file — Node executes
 * TypeScript directly, so nothing stands between this source and the emitted mod.
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

export function installTs(resolved: Resolved): string {
  const pm = resolved.packageManager;
  return `/**
 * \`${runScript(pm, "install-mod")}\`: build, then put the result where the Stellaris
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
 * view (id collision checks included) as the one \`${runScript(pm, "build")}\` writes to
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

/** Returns the generated project's YAML inspection entry point. */
export function inspectTs(resolved: Resolved): string {
  return `/**
 * \`${runScript(resolved.packageManager, "inspect")}\`: compile the project and print a deterministic YAML map
 * of its Features and Item ids, warnings, dependency versions, patch plans,
 * and vanilla evidence. It does not render or write the mod.
 */

import { runInspect } from "@pdx-ts/sdk";
import manifest from "../stellaris-mod.json" with { type: "json" };

import { buildTheMod } from "#mod";

await runInspect(buildTheMod(), {
  manifest,
  projectRoot: new URL("../", import.meta.url),
});
`;
}

export function vanillaTs(resolved: Resolved): string {
  return `/**
 * The vanilla view: the installed game, parsed.
 *
 * Passing it to \`mod.compile\` gives \`mod.patchTechnology\` the parsed
 * definition it needs to re-emit a vanilla definition faithfully. Vanilla
 * identifiers remain checked through the packaged identifier inventory.
 *
 * Optional on purpose. A checkout on a machine without the game still builds —
 * it only has no parsed vanilla view — so a teammate or a CI runner is never
 * blocked by not owning Stellaris. Set \`STELLARIS_PATH\` if the install is
 * somewhere the SDK does not look, or \`PDX_NO_VANILLA=1\` to skip it deliberately.
 *
 * There are exactly two ways to end up without the view, and both are stated
 * rather than inferred: the deliberate opt-out, and the SDK finding no install
 * on its own. Everything else a load can hit — an unreadable game directory, a
 * game whose shape the parser does not recognize, a corrupt archive — is
 * evidence that something is wrong, not evidence that there is no game. Those
 * propagate, and \`${runScript(resolved.packageManager, "build")}\` reports them, because a build that
 * silently drops id-collision checks, version evidence, and patch sources is
 * one you cannot tell apart from a build that kept them.
 *
 * A \`STELLARIS_PATH\` that is not a game root propagates too. It is not a
 * discovery miss: somebody set it on this machine and meant it, and a build
 * that quietly ignored it would be checking against nothing while its author
 * believed otherwise.
 */

import { InstallNotFoundError } from "@pdx-ts/sdk";
import * as stellaris from "@pdx-ts/sdk/installation";
import type { VanillaView } from "@pdx-ts/sdk/installation";
${fallbackConst(resolved)}
/**
 * Whether this machine was pointed at a particular install.
 *
 * The SDK reports a bad \`STELLARIS_PATH\` and a fruitless search of the
 * platform defaults with the same error, so telling them apart means asking
 * what was asked for. Empty counts as unset, which is what the SDK's own
 * lookup does with it.
 */
function namedAnInstall(): boolean {
  const named = process.env["STELLARIS_PATH"];
  return named !== undefined && named !== "";
}

export function loadVanilla(): VanillaView | undefined {
  if (process.env["PDX_NO_VANILLA"] === "1") {
    return undefined;
  }
  try {
    return stellaris.load(${loadArgument(resolved)});
  } catch (error) {
    // A discovery miss is an absence; a path somebody named is a mistake they
    // should hear about. \`${runScript(resolved.packageManager, "inspect")}\` reports whether a build had the
    // view, so the absence stays visible without a print.
    if (error instanceof InstallNotFoundError && !namedAnInstall()) {
      return undefined;
    }
    throw error;
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
 * Rename or move this file and the emitted paths stay the same while the
 * Feature stem and Items stay the same. Change the stem to change its
 * per-Feature filenames; add another module with its own named Feature to make
 * another output group.
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
  options: [{ name: { english: "Interesting.", key: "interesting" } }],
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
 *
 * This path is a record of one machine rather than a request from whoever is
 * building now, so a checkout where it does not resolve still builds — without
 * the vanilla view. That is the opposite of a \`STELLARIS_PATH\` somebody set
 * here, which is a request and fails loudly when it is wrong.
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
