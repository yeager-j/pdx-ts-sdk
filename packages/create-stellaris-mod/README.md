# create-stellaris-mod

Scaffold a Stellaris mod project that builds with [@pdx-ts/sdk](../sdk/README.md).

```bash
npx create-stellaris-mod my-mod
```

It finds your Stellaris install, reads the build from `launcher-settings.json`,
and writes a project that typechecks, tests and builds on the first
`npm install` — including a `content/` directory already wired to
`discoverContent`, a worked example that fires in game, and colocated tests.

```
my-mod/
├── package.json  tsconfig.json  vitest.config.ts
├── .prettierrc            (--no-prettier to skip)
├── eslint.config.js       (--no-eslint to skip)
└── src/
    ├── mod.ts              config + the pure fold from content/ to a built mod
    ├── index.ts            build: render the fold and write it to out/
    ├── install.ts          build + drop it where the launcher looks
    ├── vanilla.ts          the parsed install, when one was found
    ├── flags.ts            shared values — outside content/, deliberately
    └── content/
        ├── example.ts      a technology, an event, and the hook that fires it
        └── example.test.ts colocated, and skipped by discovery
```

Importing `mod.ts` only reads — building the mod value touches no disk — so
`index.ts` and `install.ts` each import its `buildTheMod()` and add their own
single disk-touching step (`write` vs `install`) on top, rather than each
folding `content/` a second time. That is what keeps a build with a vanilla
view (id collision checks included) from quietly running twice, once checked
and once not.

## Options

Every prompt has a flag, so the CLI is scriptable. With `--yes`, or whenever
stdin is not a TTY, it takes the defaults and never asks — a CI run cannot hang
on a prompt nobody will see.

```
--name <string>              --prefix <snake_case>     --stellaris-path <path>
--supported-version <v4.4.*> --tags <a,b>              --local <path-to-pdx-sdk>
--pm <npm|pnpm|yarn|bun>     --dry-run                 -y, --yes
--no-prettier  --no-eslint  --no-git  --no-install
```

A missing Stellaris install is not fatal: the scaffold drops `src/vanilla.ts`
and the identifier-package pin, and the mod still builds — it just builds with
vanilla ids as unchecked strings.

## `--local`, and why it exists

`@pdx-ts/sdk` is not published to npm yet, so the default registry ranges will
404. Point the CLI at a checkout instead:

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
entry point would fail at *load*, before any of its own code could parse, let
alone print something helpful. Compiling also lets `engines` say `>=20` rather
than `>=22.18`; only the *generated project* still needs type stripping, and it
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

`src/plan.ts` is pure — a resolved config in, a path-to-contents map out,
deliberately the same shape as the SDK's own `render` — so most assertions run
against a `Map` rather than a directory. `tests/scaffold.test.ts` is the gate
that matters: it scaffolds into a temp directory, symlinks the dependency tree,
and then typechecks, builds and tests the result with the real toolchain,
because templates are strings and nothing else checks the code they produce.
