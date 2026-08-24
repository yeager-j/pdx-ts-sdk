# create-stellaris-mod

Scaffold a Stellaris mod project that builds with [@pdx-ts/sdk](../sdk/README.md).

```bash
npx create-stellaris-mod my-mod
npx create-stellaris-mod init my-mod   # the same thing, spelled canonically
```

`init`, `list`, `view` and `generate` are reserved first-position command names;
anything else is the directory to scaffold into. The last three are the Recipe
Catalog: `list` shows what this release can generate, `view <recipe>` shows what
one recipe asks and how to answer it without prompting, and `generate` writes a
feature source file into a project that already exists.

It finds your Stellaris install, reads the build from `launcher-settings.json`,
and writes a project that typechecks, tests and builds on the first
`npm install` — including a `content/` directory already wired to the SDK's
project pipeline, a worked example that fires in game, and colocated tests.

```
my-mod/
├── AGENTS.md             shared Codex and Claude project guidance
├── CLAUDE.md -> AGENTS.md
├── .agents/skills/pdx-sdk-docs/SKILL.md
├── .claude/
│   ├── agents/pdx-docs-expert.md
│   └── skills -> ../.agents/skills
├── .codex/agents/pdx-docs-expert.toml
├── package.json  tsconfig.json  vitest.config.ts
├── stellaris-mod.json     the Project Manifest: mod identity and launcher metadata
├── stellaris-mod.schema.json  its schema, for your editor
├── .prettierrc            (--no-prettier to skip)
├── eslint.config.js       (--no-eslint to skip)
└── src/
    ├── mod.ts              declares the SDK project + buildTheMod()
    ├── index.ts            build: render the fold and write it to out/
    ├── install.ts          build + drop it where the launcher looks
    ├── vanilla.ts          the parsed install, when one was found
    ├── flags.ts            shared values — outside content/, deliberately
    └── content/
        ├── example.ts      named `feature`: a technology, event, and firing hook
        └── example.test.ts colocated, and skipped by discovery
```

`stellaris-mod.json` is the single author-owned source of truth for the mod's
identity, launcher metadata, and where generated feature source goes. Its sole
key under `mod` is the mod prefix; `createModProject` preserves that key as a
literal type and uses it to create the immutable capability. Its
`contentDirectory` is the single placement authority: the SDK discovers
features there and `generate` writes them there, so moving the directory in the
manifest moves both. The scaffolded package also declares
`"#mod": "./src/mod.ts"` in `package.json#imports`. Feature modules and the build
and install entrypoints import the mod module through it rather than computing a
relative path.

Importing `mod.ts` builds nothing — `mod` is an immutable capability — so
`index.ts` and `install.ts` each import its `buildTheMod()` and add their own
single disk-touching step (`write` vs `install`) on top. `project.build()` owns
the conventional discovery, Asset capture, and compile sequence. Pass
`discover` or `additionalFeatures` when that sequence needs a pre-compile
adjustment. A fundamentally different pipeline can still compose the public
`discoverFeatures`, `mod.assetTree`, and `mod.compile` interfaces directly.
With a vanilla install found, `buildTheMod()` also parses the game and may write
a cache under `node_modules/.cache`.

The generated ESLint configuration adds two authoring guardrails. It requires
one event namespace per feature module, and it reports a second direct
`.define()` call on the same local `CapabilityEventHandle`. The latter rule is
type-aware but deliberately local: aliases, helper-mediated calls, and
cross-module calls still rely on `mod.compile()`, the semantic authority for
duplicate event definitions; two direct calls report even when control flow
makes them mutually exclusive. Use `--no-eslint` only when another
configuration supplies equivalent checks.

## Options

Every prompt has a flag, so the CLI is scriptable. With `--yes`, or whenever
stdin is not a TTY, it takes the defaults and never asks — a CI run cannot hang
on a prompt nobody will see.

Codex and Claude support is enabled by default. The generated bundle stays
inside the project: shared instructions, the embedded `pdx-sdk-docs` skill, and
native project-scoped `pdx-docs-expert` definitions for both clients. Init does
not download the skill or modify user-level configuration. Use `--no-llm` to
omit the complete bundle. The shared instructions and skill use relative
symlinks where the platform permits them; if symlink creation returns `EPERM`,
init atomically publishes regular file and directory copies instead, so Windows
does not require Developer Mode or symbolic-link privileges.

Before the docs expert answers, it compares the exact `@pdx-ts/sdk` dependency
in the generated project's `package.json` with the `SDK version` declared by
the fetched documentation index. It also compares the index's SDK source
revision with the revision embedded by this scaffold, so an unversioned docs
deployment cannot silently move to a different API while retaining the same
package version. A local `file:` checkout, a dependency range, missing
provenance, or a different deployed version or revision produces a concise
mismatch report instead of advice for the wrong SDK surface.

```
--name <string>              --prefix <snake_case>     --stellaris-path <path>
--supported-version <v4.4.*> --tags <a,b>              --local <path-to-pdx-sdk>
--pm <npm|pnpm|yarn|bun>     --dry-run                 -y, --yes
--no-prettier  --no-eslint  --no-llm  --no-git  --no-install
```

A missing Stellaris install is not fatal: the scaffold drops `src/vanilla.ts`,
and the mod still builds. It still pins `@pdx-ts/stellaris-ids` — to the game
build this scaffolder was verified against, since the SDK reads that package's
id tables and a project without it does not typecheck.

An explicit `--stellaris-path` is different: if it is not a game root, init
fails before writing instead of treating a typo as permission to drop checking.
Immediately after a game patch, the matching `@pdx-ts/stellaris-ids` release may
not exist yet. If dependency installation reports that case, init says so and
names the two ways forward — wait for the release, or repin the project to a
build that has one.

## Generating a feature

```bash
npx create-stellaris-mod list                                  # what this release carries
npx create-stellaris-mod view technology                       # what it asks, and the flags
npx create-stellaris-mod generate technology "Resonance Theory"
```

`generate` writes one file into an existing project and never touches anything
else. It searches upward from the current directory for `stellaris-mod.json`
(`--cwd <path>` starts the search elsewhere), checks that the project maps
`#mod` and depends on an SDK range this release verified its recipes against,
and then writes `<contentDirectory>/<derived_name>.ts`. The name you type
becomes the filename, the content ids and the TypeScript binding.

```
--cwd <path>   --yes   --dry-run   --allow-unsupported-sdk
```

Plus `--<question>` for every question the chosen recipe asks; `view <recipe>`
lists those. With `--yes`, or when stdin is not a TTY, the recipe id and the
name are both required and every question takes its default.

The file is never written over anything: an existing file, directory or symlink
of that name is a refusal, not an overwrite, and `--dry-run` prints the exact
bytes a real run would publish without creating so much as a directory. A
successful run puts the written path — and nothing else — on stdout.

`--allow-unsupported-sdk` downgrades the compatibility refusal to a warning. It
changes only that decision: it does not load the SDK, weaken what is generated,
or make a later build succeed.

## `--local`, and why it exists

The default registry ranges resolve from npm. To develop against an unreleased
checkout of the SDK instead — testing an SDK change against a real scaffold —
point the CLI at it:

```bash
npx create-stellaris-mod my-mod --local ~/code/pdx-sdk
```

That writes `file:` dependencies pointing at the checkout. **Build it first** —
`npm run build` in the pdx-sdk root — because a scaffolded project consumes
those packages through their published `exports`, which resolve to `dist/`. The
repo skips that internally with a `pdx-source` export condition it passes to
tsc, Node and Vite; a scaffolded project is an ordinary consumer and does not.
The CLI checks, and names the command if the checkout is unbuilt.

## Why this package has a build step

Every publishable package here builds now, for one shared reason: Node refuses
to strip types from anything under `node_modules`, so a package shipping raw
`.ts` dies at a consumer's first import. For this package the consequence is
sharper still — `npx` installs a CLI into exactly that directory, so a `.ts`
entry point would fail at _load_, before any of its own code could parse, let
alone print something helpful. Compiling also lets `engines` say `>=20` rather
than `>=22.18`; only the _generated project_ still needs type stripping, and it
declares that itself.

## Development

```bash
npm run scaffold -- --help                    # from the repo root
npm run scaffold -- --dry-run --yes /tmp/demo
npm test
```

The `scaffold` script exists because running `src/bin.ts` directly needs
`node --conditions=pdx-source`, the condition that resolves workspace packages
to their sources rather than the `dist/` they publish.

`src/plan.ts` is pure — a resolved config in, a map of regular-file and
relative-symlink entries out — so most assertions run against a `Map` rather
than a directory. `tests/scaffold.test.ts` is the gate
that matters: it scaffolds into a temp directory, symlinks the dependency tree,
and then typechecks, builds and tests the result with the real toolchain,
because templates are strings and nothing else checks the code they produce.

## Vocabulary

This package introduces no vocabulary of its own; it borrows the [Authoring](../sdk/CONTEXT.md)
context's. The [context map](../../CONTEXT-MAP.md) lists every context in the repo.
