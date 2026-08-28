# @pdx-ts/docs-site

`@pdx-ts/docs-site` is the documentation application for `@pdx-ts/sdk`. It
combines hand-written MDX, generated SDK metadata, executable examples, and
derived reference models in a Next.js site. The same content is available as
HTML and plain Markdown for people, search tools, and coding agents.

This workspace is private and is not published to npm.

## Local development

Repository development requires Node.js 24. Install and run commands from the
workspace root:

```bash
npm ci
npm run docs:dev
```

The development server starts at `http://localhost:3000`. Other root commands
are:

```bash
npm run docs:build    # validate examples and references, then run next build
npm run docs:preview  # serve the completed Next.js build
npm run docs:scopes:check
npm run docs:scopes:generate
```

`docs:dev` runs the executable-example check once before starting Next.js. Run
the package's `examples:check` script again after changing an example while the
development server is already open.

## Technology stack

The site uses:

- Next.js 16 and React 19
- Fumadocs and `fumadocs-mdx` for content, navigation, and search
- MDX for hand-written documentation
- Tailwind CSS and Fumadocs UI components
- Shiki for code highlighting
- unified, remark, and rehype for Markdown processing
- TanStack Table for interactive reference tables
- the SDK and identifier package as live documentation data sources

The production site is deployed to Vercel. Documentation pages are prerendered
during `next build`; `proxy.ts` is the only request-sensitive application code.

## Information architecture

Content lives under `content/docs/` and is ordered by the `meta.json` in each
directory:

```text
content/docs/
|-- guides/               task-oriented workflows
|-- tutorials/            complete features built step by step
|-- concepts/             ideas shared across registries
|-- scopes-and-effects/   generated scope and script-method reference
`-- reference/            registry-specific authoring reference
```

The reference section follows the SDK's generated registry inventory. It is not
a manually maintained list of whichever pages happen to exist.

## Writing a page

Create an `.mdx` file in the appropriate section and add its slug to that
section's `meta.json`. Start with frontmatter:

```mdx
---
title: Technology
description: Define researchable Stellaris technologies.
---

# Technology

Page content...
```

Reference pages also declare the registries they cover:

```yaml
---
title: Technology
registries: [technology]
---
```

Use `registries: []` for a reference page that intentionally documents no
registry, such as a section index. The build rejects an unknown registry,
duplicate ownership, a registry with no page or recorded exception, and a stale
exception left behind after its page is added.

Shared MDX components live under `components/`. Prefer derived components for
SDK facts such as field tables, scope methods, and paired output. Hand-copying a
generated list into prose creates a second source that can drift.

## Executable paired examples

Documentation examples are complete TypeScript programs colocated with their
page:

```text
content/docs/reference/technologies.mdx
content/docs/reference/technologies.example.ts
```

An example's default export is a `PureMod`. The source performs the Fold so the
page demonstrates the same boundary a real build uses:

```ts
const compiled = mod.compile([feature]);
export default compiled;
```

Render it in MDX by name:

```mdx
<PairedExample name="technologies" />
```

The TypeScript tab shows the complete source file. The PDXScript tab renders
every logical output path produced by `render()`.

Examples must be hermetic. They cannot load a local Stellaris installation
because CI and deployed builds do not have one. Examples that need vanilla ids
use the committed identifier package; examples that need parsed definitions or
patch plans belong in package tests instead.

## Example build pipeline

`npm run docs:build` validates examples before Next.js renders a page:

```text
tsc -p tsconfig.examples.json
  -> scripts/check-examples.ts
  -> import every .example.ts
  -> Fold and render each PureMod
  -> write .examples/paired-examples.json
  -> check generated scope pages
  -> next build --webpack
  -> scripts/check-built-docs.mjs
```

The checker enumerates all example files, including examples no page currently
references. Type errors, Fold failures, render failures, missing example names,
and unused broken examples therefore fail the docs build.

## Registry coverage

`src/registry-coverage.ts` joins three sources:

- registry descriptors generated into `@pdx-ts/sdk`
- reference-page frontmatter loaded by Fumadocs
- committed vanilla path data from `@pdx-ts/stellaris-ids`

The derived model powers `/reference/coverage/` and the build gate. It separates
supported registries, other output channels, and game concepts the SDK cannot
author yet.

`UNDOCUMENTED_REGISTRIES` is a temporary, explicit exception list. Each row must
name the missing page or tracked work. Adding a registry to the SDK breaks the
docs build until a page or current exception accounts for it.

Field tables also come from generated SDK descriptors. This keeps cardinality,
authored forms, required fields, localization slots, and references aligned with
the package being documented.

## Scope page generation

Canonical scope prose lives in `content/scope-pages/<scope>.md`. Each source has
a title, a short representation paragraph, and a `Common entry points` section.

Generate the MDX shells and alphabetical navigation after editing source prose
or changing the SDK scope inventory:

```bash
npm run docs:scopes:generate
```

Check committed output without rewriting it:

```bash
npm run docs:scopes:check
```

Generated scope pages combine this prose with live tables of legal effects,
triggers, event kinds, and outgoing scope links. Do not hand-edit the generated
MDX files.

## Markdown and LLM exports

The site publishes three plain-Markdown forms:

- `/llms.txt` indexes every documentation page.
- `/llms-full.txt` concatenates the complete documentation set.
- `/llms.mdx/<page path>/content.md` is the Markdown twin of one page.

`proxy.ts` also content-negotiates normal page URLs. A request whose `Accept`
header prefers Markdown is rewritten to the twin. The proxy declares
`Vary: Accept`, which reaches responses under `next start`; Vercel's serving
layer strips it from page responses. The rewrite still gives Vercel separate
cache keys. The index links direct twin URLs so automated fetchers and downstream
caches do not need negotiation.

Generated React components cannot be copied as empty JSX tags into the text
export. `lib/get-llm-text.ts` and `src/llm-markdown.ts` rebuild field tables,
paired examples, scope method tables, and coverage tables from the same derived
models used by the HTML pages.

## Why the site has its own TypeScript program

Most workspaces share the root NodeNext TypeScript program. The docs application
uses Next.js bundler resolution, JSX, and path aliases, so the root tsconfig
excludes it. The package owns separate checks for application code and examples:

```bash
npm run typecheck --workspace @pdx-ts/docs-site
```

The root `npm run typecheck` invokes this package script through npm workspaces.

## Workspace source resolution

The site builds against current workspace source without requiring `dist/`.
CI proves this by running `npm run clean` immediately before the docs build.

Three tools opt into the repository's `pdx-source` package-export condition:

1. TypeScript lists it in `customConditions`.
2. Node example checks run with `--conditions=pdx-source`.
3. webpack uses `src/pdx-source-resolution.mjs` with Next.js
   `transpilePackages`.

The build pins webpack with `next build --webpack` because custom export
condition support is not verified under Turbopack. Removing either the resolver
condition or `transpilePackages` can make server packages resolve through Node
to a missing or stale `dist/` tree.

`source.config.ts` must not import `@pdx-ts/*`. `fumadocs-mdx` executes that file
in a separate resolver context that does not know `pdx-source`.

Published package consumers never receive this condition. They resolve built
JavaScript and declaration files from `dist/`.

## Build and deployment

The production command is `npm run docs:build`. It generates the embedded SDK
source revision, checks both example and application TypeScript, builds every
derived data file, verifies generated scope pages, runs webpack-backed Next.js
prerendering, and inspects the completed output.

Vercel runs the same build. A documentation deployment therefore fails on a
broken example, undocumented registry, stale generated scope page, invalid MDX,
or missing Markdown representation before it can publish.

## Source layout

```text
app/                    Next.js routes, search, and Markdown endpoints
components/             MDX and reference UI
content/docs/           authored and generated documentation pages
content/scope-pages/    canonical hand-written scope prose
lib/                    Fumadocs source loading and text-export assembly
scripts/                examples, scopes, and built-output checks
src/                    derived registry, field, scope, and Markdown models
next.config.mjs         webpack and package source resolution
source.config.ts        fumadocs-mdx schema and collection setup
```

Run `npm run docs:build` before committing documentation infrastructure or
executable example changes. Ordinary prose-only edits should still run the
build when they change MDX structure, frontmatter, navigation, or generated
components.
