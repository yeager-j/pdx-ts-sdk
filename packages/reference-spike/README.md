# `@pdx-ts/reference-spike`

A bounded experiment, quarantined on purpose. **This is not a product, not a
package, and not the beginning of one.** It exists to answer one question about
the Authoring Reference described in
[`docs/design/authoring-reference-spike.md`](../../docs/design/authoring-reference-spike.md),
and then to be deleted or left behind.

The hypothesis it tests:

> A Reference contribution derived from the real post-overlay authoring model,
> combined with dependency-checked curated guidance and a Verified example, can
> teach one difficult SDK capability without duplicating legality or hiding
> uncertainty.

[`OUTCOME.md`](./OUTCOME.md) is the verdict and the findings. Read that first.

## Running it

```sh
npm run start -w @pdx-ts/reference-spike
```

That builds the viewer and serves it on `http://127.0.0.1:4173/` with
`vite preview`. The page is static, offline, read-only, and never looks at your
project. Loopback only, and `strictPort`, so the URL above is always the URL.

There are two pages, and they are ordinary links apart: `/` is Situations and
`/?page=technology` is Technologies. A query parameter rather than a fragment,
because every section heading already owns a fragment.

To write rather than read, use the dev server:

```sh
npm run dev -w @pdx-ts/reference-spike
```

Editing any page's `.mdx` hot-reloads the prose, and a Vite plugin
re-extracts the stories and rebuilds the snapshots on save — so a story panel
never shows code that has stopped matching its fence. It runs the same two
scripts the gates run, and it leaves the regenerated files on disk, because
they are committed artifacts that had to be rebuilt anyway.

Other package-local scripts:

| Script                   | What it does                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| `npm run stories`        | Re-extracts every page's stories into `src/example/generated/<page>/`          |
| `npm run stories:check`  | Fails if a committed story module no longer matches its source                 |
| `npm run snapshot`       | Re-derives every page's `data/*.json` from the rules, corpus, MDX and curation |
| `npm run snapshot:check` | Fails if a committed snapshot is stale                                         |
| `npm run build:viewer`   | Builds `dist/` only                                                            |
| `npm run typecheck`      | Typechecks the browser half (the rest is in the root program)                  |
| `npm run audit`          | Install audit — maintainer-local, prints counts, writes nothing                |

Editing a page means editing its `.mdx`, then re-running `stories` and
`snapshot`. Both are committed and both have a `:check` gate, so a stale
extraction is a reviewable diff rather than a page showing code nothing ran.

Adding a page means: a row in `src/build/pages.ts`, a row in
`src/app/pages.tsx`, a claim builder beside `src/build/curation.ts`, its
conventions in `content/conventions.ts`, and the `.mdx`. `tests/pages.test.ts`
fails if the first two disagree.

The gates run in the repository's ordinary `npm test` and `npm run typecheck`.
Nothing was added to the root scripts; the package's `build` script is
deliberately named `build:viewer` so the release build does not pick it up.

## Shape

```
content/*.mdx                the pages: prose, conventions, and the fenced stories
content/conventions.ts       each convention's dependencies (its prose is in the MDX)
src/build/pages.ts           the page registry: paths, aliases, curation, Recipe stories
src/app/pages.tsx            the viewer's half of it, because a bundler needs literal imports
src/probe/codegen-probe.ts   the one deliberate boundary violation
src/facts.ts                 what the probe refines codegen's answer into
src/build/                   MDX parsing, story extraction, evidence, fingerprints, assembly
src/build/recipes.ts         the Recipe Catalog's own `generate`, for the Recipe story
src/build/highlight.ts       build-time Shiki, plus grammars for PDXScript and Stellaris loc
src/example/recipe-mod.ts    the module behind `#mod`, which is what a Recipe's output imports
src/example/generated/       the extracted stories, committed so the compiler sees them
src/app/                     the viewer
data/                        the committed, provenance-bearing snapshots
tests/                       the gates, including the demonstrated negative controls
audit/                       the install audit (Situations only)
```

Three kinds of content, kept apart on purpose:

- **Prose is authored** — markdown in the MDX, styled by shadcn/typeset.
- **Components are derived** — `<Claim>`, `<FieldTable>`, `<EvidenceSummary>`
  render material projected from the authoring model, never written by hand.
- **Stories are executed** — every fenced TypeScript block tagged `story="…"` is extracted
  to a real module, typechecked by the repository's own `npm run typecheck`,
  and compiled and synthesized by `tests/stories.test.ts`. A page may also
  place a story the Recipe Catalog rendered rather than one it wrote: the
  Technology page's `recipe-starter` is `create-stellaris-mod`'s own output,
  committed and run through the identical path, and marked on the page as
  coming from a Recipe rather than from the page's author.

A `<Convention>` is the one thing that spans two of those: a maintainer's prose,
wrapped in the machine half that invalidates it when a depended-on contract
moves.

## The one violation

`src/probe/codegen-probe.ts` imports CWT Codegen internals. That is a real
information-hiding violation, and it is not a design. It is proportionate only
because one named module owns it, it refines what it reads into spike-owned
values immediately, `tests/quarantine.test.ts` fails if anything else imports
codegen or if any production package imports the spike, and deleting this
directory deletes the exception.

If the spike passes, CWT Codegen gets a producer-owned Reference contribution
interface designed on that context's terms. **The probe is not copied.**

## Disposition

Per the design, the outcome needs an explicit decision:

- **Fail** — delete `packages/reference-spike`, keep `OUTCOME.md`'s reasoning.
- **Inconclusive** — delete it, or authorize a separately scoped experiment.
- **Pass** — design and implement production boundaries separately. Do not
  rename, move, publish, or promote this code.

ADR-0007 is written only after a pass **and** a decision to build the
production feature.
