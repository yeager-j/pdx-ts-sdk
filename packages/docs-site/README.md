# @pdx-ts/docs-site

The user-facing documentation site for `@pdx-ts/sdk`, built with
[Fumadocs](https://fumadocs.dev/) on Next.js, deployed to Vercel as a fully prerendered
build (every page is SSG; the only per-request code is `proxy.ts`).

```sh
npm run docs:dev      # serve at http://localhost:3000
npm run docs:build    # prerender into .next/
npm run docs:preview  # serve the built site (next start)
```

The sidebar has four sections under `content/docs/`, each ordered by its `meta.json`:

- `guides/` — hand-written workflow pages.
- `concepts/` — concepts that span content types.
- `scopes-and-effects/` — generated scope and script-method references.
- `reference/` — one page per content registry.

## LLM text export

The site also serves the docs as plain Markdown for AI consumption: `/llms.txt` (an index of
every page), `/llms-full.txt` (the complete docs in one file), and a Markdown twin of each
page at `/llms.mdx/<page path>/content.md`. On top of the explicit twin URLs, `proxy.ts`
content-negotiates: a request for a page URL whose `Accept` header prefers Markdown is
rewritten to the twin, with `Vary: Accept` on both representations. `/llms.txt` still links
the twins directly, because many fetchers never send a Markdown `Accept` header.

The pages' generated components would export as empty JSX tags, so `lib/source.ts` declares
them as placeholders and `lib/get-llm-text.ts` re-renders each one as Markdown from the same
derived model the page uses (`src/llm-markdown.ts`): field tables, paired examples, scope
method tables, and the coverage tables all appear in the text export with their full content.
The scope pages build their model from an MDX expression a placeholder cannot carry, so the
export derives the scope from the page's own slug instead.

## Why this package is outside the root TypeScript program

Every other workspace member typechecks in the repository's single `tsc --noEmit` program.
This one cannot: Next.js code resolves modules the way its bundler does
(`moduleResolution: "bundler"`, JSX, path aliases), not the root's NodeNext semantics. So the
root tsconfig excludes this directory and the package runs its own `tsc --noEmit` as its
`typecheck` script, which the root `npm run typecheck` calls through to.

## Source resolution

The site must build against the workspace packages' sources — the repo never builds `dist/`
during development, and CI proves it by deleting every `dist/` before `npm run docs:build`.
Three resolvers each spell the `pdx-source` export condition:

- webpack, via `src/pdx-source-resolution.mjs` plus `transpilePackages` in `next.config.mjs`
  (the pair is load-bearing: a server-external package would be resolved by Node, which never
  sees the condition). The build runs `next build --webpack` explicitly — Turbopack's support
  for custom resolve conditions is unverified, so the choice is pinned.
- TypeScript, via `customConditions` in `tsconfig.json`.
- Node, via `node --conditions=pdx-source` in the `examples:check` script.

`source.config.ts` is the one place that must never import `@pdx-ts/*`: fumadocs-mdx executes
it in a separate Node process whose resolver does not know the condition.

## Examples

Docs examples live in this package, colocated per page and referenced by name from the page
that uses them. They are pedagogy — separate from the calibration corpora in the repository's
root `examples/` directory.

An example is one complete, standalone `<name>.example.ts` file beside its page under
`content/docs/`, and its default export is the `PureMod` — the file performs the Fold with
`mod.compile`, because the Fold is part of the lesson. A page shows it with
`<PairedExample name="<name>" />`: the TypeScript tab is the whole source file, and the
PDXScript tab is every file `render()` produces, each under its logical path. Examples stay
hermetic — no `BuildOptions.vanilla` — because CI has no Stellaris install.

The same machinery is the site's drift gate, in three steps that `npm run docs:build` runs in
order:

1. `tsc -p tsconfig.examples.json` typechecks every example under the repository program's
   semantics.
2. `scripts/check-examples.ts` (run as `node --conditions=pdx-source`) enumerates every
   example from the filesystem — referenced by a page or not — imports it (a Fold failure
   throws there), renders it, and writes `.examples/paired-examples.json` for the
   `PairedExample` component to read.
3. `next build` renders every page; a missing example name, a coverage failure, or a
   field-table drift failure throws during prerender and fails the build.

An example that stops compiling — a type error, a Fold error, a render error — fails the docs
build, locally and in CI. In dev mode, re-run `npm run examples:check` after editing an
example; `npm run docs:dev` runs it once at startup.

## Registry coverage

Reference pages are keyed to the SDK's content registries, and the page list is derived rather
than kept: `src/registry-coverage.ts` reads the registries out of the SDK's generated
descriptor table, the pages out of the fumadocs source loader, and diffs both against the
install's own folder list (`@pdx-ts/stellaris-ids`'s committed `VANILLA_PATHS`).
`/reference/coverage/` is that derivation rendered — supported registries and the game folder
each writes to, the channels that are not registries, and the concepts the SDK cannot author
yet.

It is also a gate. Every registry must be documented by a page or excused by a line in
`UNDOCUMENTED_REGISTRIES`, and every page under `reference/` must declare which registries it
documents:

```yaml
---
title: Technology
registries: [technology]
---
```

A registry with neither, a page claiming a registry that does not exist, two pages claiming one
registry, or a skip line left behind after its page landed — each fails `next build`. Adding a
registry to the SDK therefore breaks the docs build until somebody writes its page or says in
one line which ticket will. Declare `registries: []` on a reference page that documents none,
such as the section index.
