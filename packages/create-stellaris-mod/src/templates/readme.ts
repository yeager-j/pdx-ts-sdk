import type { Resolved } from "../options.ts";

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
    "src/",
    "├── mod.ts              config + the pure fold from content/ to a built mod",
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
    "`mod.ts` only reads — importing it, the way a test importing `config` does,",
    "never writes to disk. `index.ts` and `install.ts` each import its",
    "`buildTheMod()` and add their own single disk-touching step on top, so a",
    "build with a vanilla view (id collision checks included) never quietly runs",
    "twice, once checked and once not.",
    "",
    "Source layout is not output layout. `discoverContent` imports every module",
    "under `content/` and names each collection after the file, so one feature",
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
    "**Export is registration.** Everything a module under `content/` exports has",
    "to be something a definer returned. Shared values that are not definitions —",
    "flags, constants, trigger fragments — live outside that directory, which is",
    "why `flags.ts` sits where it does. Importing a value is not exporting it.",
    "",
    "**One namespace, one file.** An event namespace and an event file are in",
    "bijection, so a namespace's events are all written in one module and the",
    "`namespace(...)` handle is never exported.",
    "",
    "## Vanilla references",
    ""
  );

  if (resolved.gameVersion === undefined) {
    lines.push(
      "This project was scaffolded without a detected Stellaris install, so vanilla",
      "ids are unchecked strings. To turn checking on, install the identifier",
      "package matching your game build and import it once in `src/mod.ts`:",
      "",
      "```bash",
      "npm install @pdx-ts/stellaris-ids@<your game version>",
      "```",
      "",
      "```ts",
      'import "@pdx-ts/stellaris-ids";',
      "```",
      ""
    );
  } else {
    lines.push(
      `\`@pdx-ts/stellaris-ids\` is pinned to ${resolved.gameVersion} — the package's version`,
      "*is* the game version — and imported once in `src/mod.ts` for its type-level",
      'side effect. That is what makes `vanilla.technology("tech_lasers_1")` compile',
      'and `vanilla.technology("tech_lazers_1")` an error. After a game update,',
      "install the matching version.",
      ""
    );
  }

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
