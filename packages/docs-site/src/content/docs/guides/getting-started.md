---
title: Getting started
description: Create, build, install, and run your first Stellaris mod.
sidebar:
  order: 1
---

You need Node.js 22.18 or later and, to run the result, Stellaris itself.
Start in the directory that should contain your project:

```sh
npx create-stellaris-mod my-first-mod
cd my-first-mod
```

The scaffolder finds the game at its usual Steam location, asks for the mod's
name and prefix, installs the project dependencies, and initializes Git when
the project is not already inside a repository. Use `--stellaris-path <path>`
if the game is elsewhere.

## The project layout

The files you will use first are:

```text
my-first-mod/
├── package.json
├── stellaris-mod.json
├── assets/                 create this when the mod needs an Asset file
└── src/
    ├── mod.ts
    ├── vanilla.ts          written when the scaffolder found an install
    ├── index.ts
    ├── install.ts
    ├── flags.ts
    └── content/
        ├── example.ts
        └── example.test.ts
```

`stellaris-mod.json` is the project configuration. The single key under `mod`
is the mod prefix. The manifest also says where feature source and Asset
files live. Change these facts here, not in `src/mod.ts`.

```json
{
  "$schema": "./stellaris-mod.schema.json",
  "mod": {
    "my_first_mod": {
      "name": "My First Mod",
      "version": "0.1.0",
      "supportedVersion": "v4.4.*",
      "tags": []
    }
  },
  "contentDirectory": "src/content",
  "assetsDirectory": "assets"
}
```

The `assets/` path is ready for files that Stellaris reads without parsing as
PDXScript, such as textures. The directory is allowed to be missing or empty,
so the scaffold does not create it; add it when you need the first
[Asset file](/concepts/assets/). Files under `assets/` are copied to the same
path in the built mod.

`src/mod.ts` creates the mod from the manifest and captures `assets/`.
`src/vanilla.ts` loads the Stellaris install and passes the view to
`mod.compile`, which enables vanilla file-collision checks, patching, and the
identifier-package check; the scaffolder writes it only when it found the
game. Set `STELLARIS_PATH` when the install is somewhere the SDK does not
look, or `PDX_NO_VANILLA=1` to skip the install deliberately — the mod still
builds without one. `src/index.ts` is the build entry point,
`src/install.ts` backs `npm run install-mod`, and `src/flags.ts` declares the
country flags the example event sets.

`src/content/example.ts` is a working feature. It contains a technology, a
game-start event, and the hook that fires that event. Each content item is
placed in the exported `feature`; the build then writes it to the directory
Stellaris expects. `src/content/example.test.ts` is the test `npm test` runs.
Start by editing the technology's `name` and `desc`. Then rewrite the event
and its effects. That is enough to turn the scaffold into your own mod.

The scaffolder can also add feature modules later:
`npx create-stellaris-mod list` shows the built-in recipes (a technology, a
building, an event, a research quest), `view <recipe>` shows one recipe's
questions and defaults, and `generate <recipe> <name>` writes a new module
into `src/content/`.

## Build the mod

```sh
npm run typecheck
npm test
npm run build
```

`npm run typecheck` checks the source, `npm test` runs the scaffolded test —
see [Testing your mod](/guides/testing-your-mod/) — and `npm run build`
produces the mod.

The build prints every file it writes and creates `out/`. Open that directory
to see the ordinary Stellaris files: the example produces files under
`common/technology/`, `common/on_actions/`, `events/`, and `localisation/`,
plus `descriptor.mod` and the SDK's `.pdx-sdk-manifest.json` ownership record
(see [The pipeline](/guides/the-pipeline/)). The game never loads the
TypeScript source.

## See it in the launcher

Close the Stellaris launcher if it is open, then run:

```sh
npm run install-mod
```

The command builds the mod, copies it into the launcher mod directory, and
prints the paths to the installed content and its launcher descriptor. Start
the launcher, add **My First Mod** to a playset, enable it, and start the game
with that playset. If the mod does not appear, restart the launcher so it
rescans the directory. When the launcher's mod directory is not at the
platform default — on Windows, OneDrive can move `Documents` — set
`STELLARIS_MOD_DIR` to the real location before running `npm run install-mod`.

The scaffolded event fires when a country starts the game. It shows **A New
Signal** and grants 50 influence the first time it runs. Seeing that event
confirms that the TypeScript source was built, installed, enabled, and loaded
by Stellaris.

## About the Stellaris IDs version

The SDK treats `@pdx-ts/stellaris-ids` as a peer dependency because your
project, not the SDK, chooses its Stellaris version. The project's
`package.json` installs it with a range such as `>=4.4.6-0 <4.4.6`. The
`4.4.6` part is the game build whose vanilla IDs the SDK checks. Packages for
that build have revision suffixes such as `4.4.6-r.1`, and revisions sort
below the plain version, so the range means: any revision published for the
4.4.6 game build, and nothing from another build.

After a Stellaris update, change the range in `package.json` to the new build
(for example `>=4.5.0-0 <4.5.0`) and run `npm install`. When the installed
IDs package and the game install disagree, the build stops with a mismatch
error. If no IDs release exists yet for a brand-new game patch, set
`acceptGameVersion` in `stellaris-mod.json` to that game version to proceed
deliberately — see [Warnings and diagnostics](/guides/warnings-and-diagnostics/).

## Where to go next

Read [Features and discovery](/guides/features-and-discovery/) for how
`src/content/` becomes the mod, [The pipeline](/guides/the-pipeline/) for what
`npm run build` does, and the [Coverage](/reference/coverage/) page for what
the SDK can author.
