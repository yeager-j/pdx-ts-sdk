---
title: Getting started
description: Create, build, install, and run your first Stellaris mod.
sidebar:
  order: 1
---

You need Stellaris and Node.js 22.18 or later. Start in the directory that
should contain your project:

```sh
npx create-stellaris-mod my-first-mod
cd my-first-mod
```

The scaffolder finds the game at its usual Steam location, asks for the mod's
name and prefix, installs the project dependencies, and initializes Git when
the project is not already inside a repository. Use `--stellaris-path <path>`
if the game is elsewhere.

## What the scaffolder creates

The files you will use first are:

```text
my-first-mod/
├── stellaris-mod.json
├── assets/                 create this when the mod needs an Asset file
└── src/
    ├── mod.ts
    ├── index.ts
    ├── install.ts
    └── content/
        ├── example.ts
        └── example.test.ts
```

`stellaris-mod.json` is the project configuration. Its single key under `mod`
is the mod prefix; the value holds the name, version, supported game version,
and launcher tags. The manifest also says where feature source and Asset files
live. Change these facts here, not in `src/mod.ts`.

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
so the scaffold does not create it; add it when you need the first Asset file.
A file at `assets/gfx/interface/icon.dds` is copied byte-for-byte to
`gfx/interface/icon.dds` in the built mod.

`src/content/example.ts` is a working feature. It contains a technology, a
game-start event, and the hook that fires that event. Each content item is
placed in the exported `feature`; the build then writes it to the directory
Stellaris expects. Start by changing the technology's `name` and `desc`, or
change the event and its effects to begin shaping the scaffold into your mod.

## Build the mod

```sh
npm run typecheck
npm test
npm run build
```

The build prints every logical path it writes and creates `out/`. Open that
directory to see the ordinary Stellaris files: the example produces files
under `common/technology/`, `events/`, and `localisation/`, plus
`descriptor.mod`. The game never loads the TypeScript source.

## About the Stellaris IDs version

The SDK treats `@pdx-ts/stellaris-ids` as a peer dependency because your project,
not the SDK, chooses its Stellaris version. The generated `package.json` installs
it with a range such as `>=4.4.6-0 <4.4.6`. The `4.4.6` part is the game build
whose vanilla IDs the SDK checks. Packages for that build have revision suffixes
such as `4.4.6-r.1`; the range selects the newest revision for exactly that game
build and does not move to the IDs for another patch. After Stellaris updates,
install the range for the new game version.

## See it in the launcher

Close the Stellaris launcher if it is open, then run:

```sh
npm run install-mod
```

The command builds the mod, copies it into the launcher mod directory, and
prints the paths to the installed content and its launcher descriptor. Start
the launcher, add **My First Mod** to a playset, enable it, and start the game
with that playset. If the mod does not appear, restart the launcher so it
rescans the directory.

The scaffolded event fires when a country starts the game. It shows **A New
Signal** and grants 50 influence the first time it runs. Seeing that event
confirms that the TypeScript source was built, installed, enabled, and loaded
by Stellaris.
