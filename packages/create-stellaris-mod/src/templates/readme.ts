import type { Resolved } from "../options.ts";
import { idsGameVersion, idsRange } from "./project.ts";

export function readme(resolved: Resolved): string {
  const p = resolved.prefix;
  const lines = [
    `# ${resolved.name}`,
    "",
    "A Stellaris mod written in TypeScript with [@pdx-ts/sdk](https://github.com/yeager-j/pdx-ts-sdk).",
    "Your code runs once, at build time, and produces an ordinary mod folder — the",
    "game never sees anything but normal PDXScript.",
    "",
    "```bash",
    "npm run build        # write the mod into ./out/",
    "npm run install-mod  # build, then install it where the launcher looks",
    "npm test             # run mod logic without launching the game",
    "npm run typecheck    # tsc --noEmit",
    "```",
    "",
    "## Layout",
    "",
    "```",
    "stellaris-mod.json      mod identity and launcher metadata — this file is the config",
    "src/",
    "├── mod.ts              wires stellaris-mod.json to createMod, + buildTheMod()",
    "├── index.ts            build: render the fold and write it to out/",
    "├── install.ts          build + drop it in the launcher's mod directory",
  ];
  if (resolved.installPath !== undefined) {
    lines.push("├── vanilla.ts          the parsed game install, for id checks and patches");
  }
  lines.push(
    "├── flags.ts            shared values — deliberately outside content/",
    "└── content/",
    "    ├── example.ts      a technology, an event, and the hook that fires it",
    "    └── example.test.ts tests, colocated with what they test",
    "```",
    "",
    "`stellaris-mod.json` is the configuration; `src/mod.ts` is wiring, not a",
    "second copy of it. The single key under `mod` is the mod prefix, which is",
    "what lets TypeScript recover it as a literal type. Edit the manifest to",
    "rename the mod or change its launcher metadata. The schema beside it is",
    "there for your editor.",
    "",
    "Feature modules import the mod as `#mod` — the project's own alias for",
    "`src/mod.ts`, declared in `package.json#imports` — so moving a module",
    "inside `content/` never rewrites an import.",
    "",
    "Importing `mod.ts` builds nothing — `config` is a plain value, so a test",
    "importing it to read the mod's prefix never triggers a build as a side",
    "effect. `index.ts` and `install.ts` each import its `buildTheMod()` and add",
    "their own single disk-touching step on top, so a build with a vanilla view",
    "(id collision checks included) never quietly runs twice, once checked and",
    "once not. `buildTheMod()` itself is the impure discovery shell around the",
    "SDK's pure fold, not a pure function on its own — calling it walks",
    "`content/` and imports every module in it.",
    "",
    "Source layout is not output layout. `discoverFeatures` imports each selected",
    "module under `content/` and reads its named `feature` export, so one feature",
    "module fans out across every registry it defines into:",
    "",
    "```",
    `content/example.ts  →  common/technology/${p}_example.txt`,
    `                    →  events/${p}_example.txt`,
    "```",
    "",
    "Moving a definition to another module changes which file it lands in and",
    "nothing else — ids are authored, never derived from layout.",
    "",
    "## Two rules worth knowing early",
    "",
    "**One explicit feature export.** Every selected module under `content/` exports",
    "exactly one `feature = mod.feature(...)`. Its other named and default exports",
    "are ordinary ESM API, so definitions and helpers can be shared without placing",
    "them twice.",
    "",
    "**One namespace, one file.** An event namespace and an event file are in",
    "bijection, so a namespace's events are all written in one module and the",
    "`mod.namespace(...)` handle is never exported.",
    "",
    "## Vanilla references",
    ""
  );

  const pinned = idsGameVersion(resolved);
  lines.push(
    "`@pdx-ts/stellaris-ids` carries every identifier vanilla Stellaris defines,",
    "and `@pdx-ts/sdk` reads its tables to check every vanilla reference. That is",
    'what makes `vanilla.technology("tech_lasers_1")` compile and',
    '`vanilla.technology("tech_lazers_1")` an error.',
    "",
    `It is pinned to game build ${pinned} through \`${idsRange(pinned)}\`; published`,
    "versions append an `-r.<n>` revision to the game version, and the range selects",
    "the newest revision of that build."
  );
  if (resolved.gameVersion === undefined) {
    lines.push(
      "",
      "That build is the one this scaffolder was verified against, because no",
      "Stellaris install was detected when the project was created. If your game is",
      "a different build, install the matching identifier package:",
      "",
      "```bash",
      `npm install "@pdx-ts/stellaris-ids@${idsRange("<your game version>")}"`,
      "```"
    );
  } else {
    lines.push("", "After a game update, install the matching version.");
  }
  lines.push("");

  lines.push(
    "## Testing",
    "",
    "`src/content/example.test.ts` runs the event chain through the SDK's",
    "interpreter — no game launch, no console. The interpreter models only",
    "semantics somebody deliberately verified and throws on anything else rather",
    "than guessing, so a passing test means the logic does what you meant.",
    "",
    "Richer assertions are available as an opt-in matcher pack. Add a setup file:",
    "",
    "```ts",
    "// vitest.setup.ts",
    'import { installMatchers } from "@pdx-ts/sdk-testing/matchers";',
    "",
    "installMatchers();",
    "```",
    "",
    'and point `vitest.config.ts` at it with `setupFiles: ["./vitest.setup.ts"]`.',
    "You then get `expect(world.fired).toContainEvent(...)` and",
    "`expect(trigger).toHoldFor(scope)`, whose failure message names the failing",
    "subcondition.",
    ""
  );

  return lines.join("\n");
}
