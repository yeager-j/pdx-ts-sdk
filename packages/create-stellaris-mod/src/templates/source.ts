/**
 * The generated project's TypeScript. Every call in here is copied from a
 * working call site in the SDK's own examples and tests, and the end-to-end
 * test typechecks, builds and runs the interpolated result — because a template
 * that merely looks right is a template that ships broken.
 */

import type { Resolved } from "../options.ts";

/** A TS string literal, so a mod name with an apostrophe cannot break the file. */
function quote(value: string): string {
  return JSON.stringify(value);
}

export function indexTs(resolved: Resolved): string {
  const idsImport =
    resolved.gameVersion === undefined
      ? ""
      : `// One line, for its type-level side effect: it merges the real game's id\n` +
        `// unions into the SDK, so \`vanilla.technology("tech_lazers_1")\` stops being\n` +
        `// a string and starts being a compile error.\nimport "@pdx-ts/stellaris-ids";\n`;

  const vanillaWiring =
    resolved.installPath === undefined ? "" : `import { loadVanilla } from "./vanilla.ts";\n`;
  const vanillaUse =
    resolved.installPath === undefined
      ? `const mod = buildMod(config, collections);`
      : `// With a vanilla view, an id colliding with a real one is a hard error\n` +
        `// rather than a silent override, and \`patchTechnology\` becomes available.\n` +
        `const vanilla = loadVanilla();\n` +
        `const mod = buildMod(config, collections, vanilla === undefined ? {} : { vanilla });`;

  return `/**
 * The build. \`npm run build\` runs this file — Node executes TypeScript
 * directly, so nothing stands between this source and the emitted mod.
 *
 * The pipeline is the SDK's: \`discoverContent\` imports every module under
 * \`src/content/\` and turns each one's exports into a collection named after the
 * file, \`buildMod\` folds those into a value, \`render\` serializes that value to
 * a path-to-contents map, and \`write\` is the only step that touches the disk.
 */

import { buildMod, discoverContent, render, write, type ModConfig } from "@pdx-ts/sdk";
${idsImport}${vanillaWiring}
export const config: ModConfig = {
  name: ${quote(resolved.name)},
  // Every id and every emitted filename starts with this. It is what makes the
  // mod structurally incapable of overwriting someone else's content.
  prefix: ${quote(resolved.prefix)},
  version: "0.1.0",
  supportedVersion: ${quote(resolved.supportedVersion)},
  tags: ${JSON.stringify(resolved.tags)},
};

export const outDir = new URL("../out/", import.meta.url);

const collections = await discoverContent(new URL("./content/", import.meta.url));
${vanillaUse}

const files = render(mod);
await write(outDir, files);

for (const warning of mod.warnings) {
  console.warn(\`warning (\${warning.code}): \${warning.message}\`);
}
for (const relPath of files.keys()) {
  console.log(\`wrote \${relPath}\`);
}
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
 * Enable the mod in a launcher playset afterwards; the launcher only rescans
 * this directory on startup, so restart it if the mod does not appear.
 */

import { buildMod, discoverContent, install } from "@pdx-ts/sdk";

import { config } from "./index.ts";

const mod = buildMod(config, await discoverContent(new URL("./content/", import.meta.url)));
const { contentDir, descriptorPath } = await install(mod);

console.log(\`Installed \${config.name} for the launcher:\`);
console.log(\`  content:    \${contentDir}\`);
console.log(\`  descriptor: \${descriptorPath}\`);
`;
}

export function vanillaTs(): string {
  return `/**
 * The vanilla view: the installed game, parsed.
 *
 * Passing it to \`buildMod\` turns a content id that collides with a real vanilla
 * id into a hard error instead of a silent override, and it is what
 * \`patchTechnology\` needs in order to re-emit a vanilla definition faithfully.
 *
 * Optional on purpose. A checkout on a machine without the game still builds —
 * it just builds unchecked — so a teammate or a CI runner is never blocked by
 * not owning Stellaris. Set \`STELLARIS_PATH\` if the install is somewhere the
 * SDK does not look, or \`PDX_NO_VANILLA=1\` to skip it deliberately.
 */

import { stellaris, type VanillaView } from "@pdx-ts/sdk";

export function loadVanilla(): VanillaView | undefined {
  if (process.env["PDX_NO_VANILLA"] === "1") {
    return undefined;
  }
  try {
    return stellaris.load();
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
 * This module sits *outside* \`src/content/\` deliberately, and that is the one
 * rule worth learning early: in a discovered module, export is registration, so
 * everything \`src/content/\` exports has to be something a definer returned.
 * Shared values that are not definitions live out here. Importing a value is
 * not exporting it, so content modules can use these freely.
 *
 * Declaring flag names by kind is what makes them checkable: \`hasCountryFlag\`
 * against a planet flag is a compile error rather than a condition that is
 * quietly never true.
 */

import { countryFlags } from "@pdx-ts/sdk";

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
 */

import { defineTechnology, hasCountryFlag, namespace, not, on, onActions } from "@pdx-ts/sdk";

import { flags } from "../flags.ts";

export const firstSteps = defineTechnology({
  id: "${p}_tech_first_steps",
  name: "First Steps",
  desc: "The first technology this mod adds.",
  cost: 2000,
  area: "physics",
  tier: 1,
  category: "particles",
  weight: 100,
});

// A namespace belongs to exactly one file, so the handle stays local and is
// never exported: what lands in the mod is the events its definers returned.
const events = namespace("${p}");

export const welcome = events.defineCountryEvent({
  id: 1,
  title: "A New Signal",
  desc: "Something in the data does not belong.",
  isTriggeredOnly: true,
  immediate: (country) => {
    // The closure receives a country scope object, so only country-legal
    // effects exist on it — a planet effect here would not compile.
    country.if(not(hasCountryFlag(flags.${p}_welcomed)), (scoped) => {
      scoped.setCountryFlag(flags.${p}_welcomed);
      scoped.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "Interesting." }],
});

// Without a hook nothing fires this. Exporting the binding registers it, the
// same way exporting a definition does.
export const gameStart = on(onActions.onGameStartCountry, [welcome]);
`;
}

export function contentExampleTestTs(resolved: Resolved): string {
  const p = resolved.prefix;
  return `/**
 * Tests, colocated with the feature they test.
 *
 * \`discoverContent\` imports every module under \`src/content/\` to build the mod,
 * and skips \`*.test.ts\` while doing it — so this file can live here without
 * becoming part of the mod. That is the whole reason colocation works; see
 * \`DEFAULT_CONTENT_PATTERN\` in the SDK if you want to change what counts.
 *
 * \`fixture\` is not the game. It interprets the triggers and effects you
 * recorded, so it runs in milliseconds and needs no launcher — but it models
 * only semantics somebody deliberately verified, and throws on anything else
 * rather than guessing. A passing test means the logic you wrote does what you
 * meant, not that the game agrees about everything around it.
 */

import { fixture } from "@pdx-ts/sdk/testing";
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
