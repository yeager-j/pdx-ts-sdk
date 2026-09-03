import type { Resolved } from "../options.ts";
import { addDependency, runScript } from "../package-manager.ts";
import { idsGameVersion, idsRange } from "./project.ts";

/**
 * The command block at the top, aligned to whichever manager was selected.
 *
 * The padding is computed rather than typed, because `pnpm run install-mod` is
 * three characters longer than `npm run install-mod` and a column that was
 * aligned by hand for npm is a ragged one everywhere else.
 */
function commandBlock(packageManager: string): string[] {
  const commands = [
    ["build", "write the mod into ./out/"],
    ["inspect", "print a YAML map of the compiled project"],
    ["install-mod", "build, then install it where the launcher looks"],
    ["test", "run mod logic without launching the game"],
    ["typecheck", "tsc --noEmit"],
    ["lint", "report a feature module the feature list does not name"],
  ].map(([script, what]) => [runScript(packageManager, script!), what!] as const);
  const width = Math.max(...commands.map(([command]) => command.length));
  return commands.map(([command, what]) => `${command.padEnd(width)}  # ${what}`);
}

export function readme(resolved: Resolved): string {
  const p = resolved.prefix;
  const pm = resolved.packageManager;
  const lines = [
    `# ${resolved.name}`,
    "",
    "A Stellaris mod written in TypeScript with [@pdx-ts/sdk](https://github.com/yeager-j/pdx-ts-sdk).",
    "Your code runs once, at build time, and produces an ordinary mod folder — the",
    "game never sees anything but normal PDXScript.",
    "",
    "```bash",
    ...commandBlock(pm),
    "```",
    "",
    "## Layout",
    "",
    "```",
    "stellaris-mod.json      mod identity and launcher metadata — this file is the config",
    "knip.json               the dead-file check behind `lint`",
    "assets/                 files mirrored unchanged into the mod root; create as needed",
    "src/",
    "├── mod.ts              declares the SDK project: project, config, and mod",
    "├── build.ts            buildTheMod(): the one Fold every command shares",
    "├── features.ts         the feature list: one line per Feature in the mod",
    "├── index.ts            build: render the fold and write it to out/",
    "├── inspect.ts          compile and describe the project as YAML",
    "├── install.ts          build + drop it in the launcher's mod directory",
  ];
  if (resolved.installPath !== undefined) {
    lines.push("├── vanilla.ts          the parsed game install, for id checks and patches");
  }
  lines.push(
    "├── flags.ts            shared values — deliberately outside features/",
    "└── features/",
    "    ├── example.ts      a technology, an event, and the hook that fires it",
    "    └── example.test.ts tests, colocated with what they test",
    "```",
    "",
    "`stellaris-mod.json` is the configuration; `src/mod.ts` passes it to",
    "`createModProject` rather than copying its fields. The single key under",
    "`mod` is the mod prefix, which the SDK preserves as a literal type. Edit",
    "the manifest to rename the mod or change its launcher metadata. The schema",
    "beside it is there for your editor.",
    "",
    "The manifest's `assetsDirectory` defaults to `assets`. Put each opaque file",
    "under that directory at the path Stellaris expects: for example,",
    "`assets/gfx/interface/icon.dds` becomes `gfx/interface/icon.dds` in the built",
    "mod. A missing or empty directory is valid, so the directory only needs to",
    "exist after you add the first Asset.",
    "",
    "Feature modules import the mod as `#mod` — the project's own alias for",
    "`src/mod.ts`, declared in `package.json#imports` — so moving a module",
    "inside `features/` never rewrites an import.",
    "",
    "`src/features.ts` is the feature list. Each line re-exports one module's",
    "`feature`, and that line is what puts the module in the mod. Add a Feature",
    "by writing a module under `features/` and adding its line;",
    "`npx create-stellaris-mod generate` does both. A module no line names is",
    "dead code that still compiles, which is why `lint` runs knip and reports it",
    "by path. knip checks that a file is reached, not that it is declared, so a",
    "Feature the mod created that the list does not name is refused by the build",
    "itself, by name.",
    "",
    "Importing `mod.ts` builds nothing — `config` is a plain value, so a test",
    "importing it to read the mod's prefix never triggers a build as a side",
    "effect. `build.ts` owns `buildTheMod()`: it imports the feature list as a",
    "namespace and hands it to `project.build()`, which compiles exactly those",
    "Features plus the Asset tree in one Fold. `index.ts`, `inspect.ts` and",
    "`install.ts` each import that one function and add their own final step,",
    "so a build with a vanilla view (id collision checks included) never quietly",
    "runs twice, once checked and once not. Compose `mod.assetTree` and",
    "`mod.compile` directly for a fundamentally different pipeline.",
    "",
    `\`${runScript(pm, "inspect")}\` performs that same Fold without rendering or writing`,
    "the mod. Its deterministic YAML report lists the manifest layout, installed and",
    "requested SDK and identifier-package versions, vanilla-checking evidence,",
    "Feature stems, Item counts and ids, patch plans, and warnings. Use it to",
    "review what the project will ship or give a coding agent a compact map.",
    "",
    "Source layout is not output layout. The build reads each Feature the list",
    "declares, and one feature module fans out across every registry it defines",
    "into:",
    "",
    "```",
    `features/example.ts  →  common/technology/${p}_example.txt`,
    `                     →  events/${p}_example.txt`,
    "```",
    "",
    "Moving a definition to another module changes which file it lands in and",
    "nothing else — ids are authored, never derived from layout.",
    "",
    "## Two rules worth knowing early",
    "",
    "**One feature export per declared module.** Every module named in",
    "`src/features.ts` exports exactly one `feature = mod.feature(...)`. Its other",
    "named and default exports are ordinary ESM API, so definitions and helpers",
    "can be shared without placing them twice. The Item input can be one module",
    "namespace, or a shallow array that mixes Items and module namespaces.",
    "",
    "**One namespace per Feature.** A namespace belongs to exactly one Feature, so",
    "its events are all written in that Feature's own files and the",
    "`mod.namespace(...)` handle is never exported: not from `src/features.ts`,",
    "and not to another Feature.",
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
      addDependency(pm, `"@pdx-ts/stellaris-ids@${idsRange("<your game version>")}"`),
      "```"
    );
  } else {
    lines.push("", "After a game update, install the matching version.");
  }
  lines.push("");

  lines.push(
    "## Testing",
    "",
    "`src/features/example.test.ts` runs the event chain through the SDK's",
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
