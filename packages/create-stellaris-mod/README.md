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
    ├── index.ts            config + the build
    ├── install.ts          build + drop it where the launcher looks
    ├── vanilla.ts          the parsed install, when one was found
    ├── flags.ts            shared values — outside content/, deliberately
    └── content/
        ├── example.ts      a technology, an event, and the hook that fires it
        └── example.test.ts colocated, and skipped by discovery
```

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

That writes `file:` dependencies, which npm materializes as symlinks — and the
symlink is load-bearing. Node **refuses to strip types from any file under
`node_modules`**, and the SDK's `exports` currently point at raw `.ts` sources;
a symlink's realpath escapes `node_modules`, so stripping applies and the
project builds. A registry install would produce a real directory and fail at
the first import. Making the SDK publishable — built JS plus `.d.ts` — is
tracked separately.

## Why this package has a build step

It is the only one in the workspace that does, and the reason is the same fact:
`npx` installs a CLI into a real `node_modules`, so a `.ts` entry point would
fail at load with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` — before any of
its own code could parse, let alone print something helpful. Compiling also
lets `engines` say `>=20` rather than `>=22.18`; only the *generated project*
still needs type stripping, and it declares that itself.

## Development

```bash
node packages/create-stellaris-mod/src/bin.ts --help
node packages/create-stellaris-mod/src/bin.ts --dry-run --yes /tmp/demo
npm test    # from the repo root
```

`src/plan.ts` is pure — a resolved config in, a path-to-contents map out,
deliberately the same shape as the SDK's own `render` — so most assertions run
against a `Map` rather than a directory. `tests/scaffold.test.ts` is the gate
that matters: it scaffolds into a temp directory, symlinks the dependency tree,
and then typechecks, builds and tests the result with the real toolchain,
because templates are strings and nothing else checks the code they produce.
