# Framework viewer — outcome

**Verdict: use the framework, and not for the reason it was proposed.** Both
pages render under Astro Starlight from the unmodified prose and the unmodified
data, every gate still passes, and the hand-written viewer still works. What did
not happen is the saving. The framework shell is **1,082 lines against the
hand-written viewer's 1,157** — a 6% difference, which is noise.

The case for it is what those lines buy, not how many there are.

## The question

The follow-up spike asked whether a documentation framework could replace the
hand-written viewer from [the first outcome](./OUTCOME.md). The framing to test
was that the viewer is the disposable part, so it should not have been written
by hand.

The measurement that mattered was decided before building: port an existing
page, keep the 187 gates as the acceptance criteria, and see what breaks. Both
pages were ported. Nothing in `content/`, `data/`, or `src/example/generated/`
was edited to make it work.

## What it cost and what it saved

Only the viewer changed, so the two are directly comparable. Shared code — the
probe, the snapshot build, the claims, the stories, the search index, and the
components that render derived material — is **1,205 lines** and the port did
not touch it.

| | Hand-written | Starlight |
| --- | ---: | ---: |
| Stylesheet | 634 | 145 |
| App shell, routing, page registry | 257 | — |
| Binding layer (route, collection, remark, builds) | — | 307 |
| Component wrappers | — | 348 |
| Build config | 152 | 109 |
| Search UI | 114 | 173 |
| **Total** | **1,157** | **1,082** |

The shape of that table is the finding. **The framework deleted 489 lines of
stylesheet and spent 393 lines re-solving a problem React solved with a
closure.**

`typeset.css` is gone outright — 490 lines of shadcn/typeset replaced by
Starlight's markdown stylesheet, and the remaining 145 are a token bridge that
defines the shadcn names the shared components use *as* Starlight's own, so they
inherit its palette and its theme toggle without knowing it happened. That is
the clean win, and it is the largest single file either viewer had.

Against it: in the React viewer, `App` receives one page and closes over it, so
`<Claim id="registry" />` resolves because the component already knows which
page it is on. Astro has no closure — components reach MDX through a
`components` prop, and an `.astro` file takes only the attributes the MDX wrote.
So page identity had to become data: a third remark plugin stamps `page="…"`
onto every derived element, and each component resolves its own build. That is
`remark.ts`, `builds.ts`, `content.config.ts`, the route, and eight `.astro`
wrappers — 655 lines that exist for no other reason.

It is not wasted work. Data-addressed components are what let both pages share
one frame, and they fixed a collision the first report caught by reasoning
rather than by a failure: both pages have a story called `minimal`, and a lookup
keyed by story id alone shows the wrong page's code. But it is not a saving, and
anyone proposing a framework to write less code should see this table first.

## What the framework actually delivered

None of this was written, and all of it works:

- a sidebar, a per-page table of contents, breadcrumbs, and prev/next
- a **theme toggle** with light, dark and system — the first viewer had no
  toggle at all, only `prefers-color-scheme`
- responsive layout, a mobile menu, a print stylesheet, and skip links
- heading anchors, and Shiki wired into the markdown pipeline by config

The theme toggle is worth singling out. The first report's hardest-won bug was
that Tailwind v4 hoists every `@theme` block onto `:root` and discards the
at-rule around it, so an `@theme` nested in a media query emits unconditionally
— the page was dark in both colour schemes for most of the spike. Keying the
status colours off Starlight's `[data-theme="dark"]` instead of a media query
makes that class of bug structurally impossible, because the values are ordinary
custom properties and only the selector is conditional.

And the output is **HTML**. The React viewer's `dist/index.html` is 412 bytes
and a 785 KB script; nothing renders without JavaScript. Starlight ships 553 KB
of rendered HTML per page and **484 KB of client JavaScript — 300 KB less** —
with `client:visible` on the two components that actually hold state. A reference
that is readable as text, not as a program, is the better artifact for something
whose product boundary is "offline and read-only".

## Where the framework lost

**Search did not survive, and it was measured before being replaced.**

Starlight ships Pagefind, offline and on by default. It finds every term this
reference needs — `colour` and `color`, `monthly_progress` and `monthlyProgress`,
`startSituation` and `start_situation` — because the prose and the
server-rendered field table both reach the HTML it indexes. Two things stop it:

- **A result is a page**, with heading-level sub-results. `section_weight` lands
  on "What will bite you", not on the field-table row that defines it.
- **`data-pagefind-filter` gives it facets**, and two attributes were enough to
  expose `status` and `registry`. But a filter selects *pages*: asking for
  `status:known-omission` returns both pages with no sub-results, because every
  page has an omission somewhere in it. On a reference with forty registries
  that answers no question anybody has.

The truth model is the product. A reader asking what the SDK cannot do needs the
omissions, not the pages containing one. So `src/search.ts` — all 292 lines —
survives unchanged, rendered through a `Search` component override, and Pagefind
is switched off rather than left in the bundle answering nothing. The index did
get better in the process: it is global now rather than per-page, so the game's
spelling typed on one page finds the SDK's member on the other.

**The bundle no longer opens from a file path.** The first viewer built with
Vite's `base: "./"`, so `dist/` worked from a loopback root, a subdirectory, or
a `file://` open. Astro resolves `base` into absolute URLs and has no relative
setting, because its routing assumes it owns an origin. Still inside the product
boundary as written — a local launcher on a loopback address is a root — but
strictly less than the first viewer could do.

**Dependencies.** 21 MB of `astro` and `@astrojs/*` in `node_modules`, against
Vite and React. For a package that is deleted on a fail verdict this is free;
for a shipped product it is a supply chain to keep current.

## What fought the port

In the order the time went.

1. **Starlight's route does not take a `components` prop.** `routes/common.astro`
   renders `<Content frontmatter={…} />` with nothing to inject through, and
   overriding `MarkdownContent` is too late — it receives already-rendered HTML.
   The fix is a file-based `src/pages/[...slug].astro`, which takes priority over
   an integration's injected route, wrapping `<StarlightPage>`. Forty lines, and
   Astro logs a "conflicts with higher priority route" warning on every build
   that is the mechanism working.
2. **`docsLoader()` hard-codes `src/content/docs/`.** Using it would have meant
   copying two MDX files into a framework-shaped directory, and two copies of a
   page drift. A plain `glob({ base: "../content" })` carrying Starlight's schema
   is a supported composition and is why neither page needed an edit.
3. **Sharing the remark plugins cost three rounds of type surgery.** The Vite MDX
   plugin accepted a loosely-typed transformer; Astro's `unified()` checks that a
   plugin accepts a real `Root`. mdast's node types are closed interfaces, so an
   index signature makes `Root` unassignable; hast's `Properties` admits numbers
   and `null`, so `Record<string, string>` fails; and directives have an
   `attributes` that is an object rather than an array. It ends at `unknown` and
   one cast, and the alternative was a dependency on `@types/mdast` for a walk
   that reads four fields.
4. **Astro 7 deprecated `markdown.remarkPlugins`** in favour of
   `processor: unified({…})`, which the build says once and then works.
5. **`astro preview` is a detached daemon that mis-resolves a relative `--root`.**
   `--root starlight` from the package becomes `starlight/starlight`, and the
   daemon dies reporting it only to `starlight/.astro/preview.log`. Running it
   from inside the directory is the fix. Worth knowing because the product
   boundary includes a launcher.

**What was smooth:** the custom PDXScript and localization grammars needed no
work at all — Shiki is Astro's own highlighter, so `shikiConfig.langs` took the
two `LanguageRegistration` objects unchanged. Build-time highlighting got
*simpler*: the first viewer needed a Vite virtual module to get Node output into
a browser bundle, and an `.astro` component just awaits it. The claim components
needed no port either, because none of them needs JavaScript — the evidence
disclosure is a `<details>`.

## What running it caught

Four defects, none from reading code. The first two are the argument for
building the thing rather than evaluating it.

**A 9.4 MB client bundle, and a runtime error on every page load.** `coloursOf`
sat beside `BUILDS` — one module, everything a page needs about a page. But
`ReferenceSearch.tsx` is a hydrated island, `builds.ts` was in its import graph,
and a bundler follows imports rather than intentions. Shiki came with it and
brought every TextMate grammar it ships: emacs-lisp, wolfram, angular-ts, wasm,
on a page that renders three languages. It also *ran* — throwing
`Theme catppuccin-latte is not included in this bundle` twice on load, in a
console nobody had looked at.

The first viewer could not make this mistake. Its highlighting lived behind a
Vite virtual module whose `load` hook runs in Node and returns a JSON string, so
there was no import edge to follow. **Astro removed the need for that bridge and
the wall went with it.** Splitting `highlighting.ts` out took the bundle to
1.5 MB and client JavaScript to 484 KB; a gate now holds the boundary that used
to be structural.

**Tailwind scanned the wrong tree.** Tailwind v4 detects sources from the
stylesheet's own project root outward, so it saw `starlight/` and not the shared
components a directory up. The failure is quiet and nasty: classes that also
appear in the `.astro` files still work, so the page renders *almost* right.
What broke was `gap-1.5`, `px-2.5` and `py-1` — used only in `primitives.tsx` —
which turned the story panel's tab row into three unpadded buttons jammed
together. Nothing errored. One `@source` line fixes it.

**Starlight's prose margins leaked into the toolbars.** Its markdown stylesheet
puts `margin-top` between adjacent children anywhere in `.sl-markdown-content`,
which is right for prose and wrong inside a tab row. Its own opt-out is the
`not-content` class, and the Astro wrappers carry it — the same job `not-typeset`
does for the first viewer, spelled in the framework's vocabulary. The one place
it is deliberately absent is the slot in `Shell.astro`, because a curated
convention's paragraphs *should* be set like the paragraphs around them.

**Tailwind preflight and Starlight's stylesheet fight over headings and lists.**
Tailwind is imported second and wins, flattening what Starlight styles. Four
`revert` declarations restore it. This is the standing cost of reusing components
written against another design system, and it would not exist in a viewer built
on Starlight from the start.

## The gates

**215, up from 187**, all hermetic, all in the repository's ordinary `npm test`.
The 187 are unchanged and still the acceptance criteria — `honesty.test.ts`,
`projection-parity.test.ts` and the rest are written against the committed
snapshots rather than against a viewer, which is why a second viewer inherited
them for free. That property was not designed for this and it is the reason the
port could be judged at all.

The 28 new ones are all in `tests/pages.test.ts`, and each holds something the
port made possible to get wrong:

| What it holds | Why it can go wrong |
| --- | --- |
| The framework registry names every page and imports every snapshot | A third hand-maintained list; a bundler cannot follow a path out of a data structure |
| It does *not* import the pages' MDX | An `.mdx` import means the content collection was bypassed and the viewers have stopped rendering the same file |
| Both viewers map every component the prose calls | A component missing from a map renders as nothing, silently, in both |
| The framework gives every derived component its page | A component missing from the remark set gets `page: undefined` |
| No browser-reachable module imports the highlighter | The 9.4 MB bundle above |

Every one was checked by breaking it. Four negative controls fire, one failure
each.

## What this does not prove

- **Two pages, not forty.** The sidebar argument — that a hand-written frame
  stops scaling somewhere past two pages — is the strongest reason to adopt a
  framework and is the one thing two pages cannot demonstrate.
- **One framework.** Docusaurus and Fumadocs were rejected on paper: Docusaurus
  defaults to Prism and Algolia, and both of those are the two integrations that
  cost real time here. That reasoning was not tested by building.
- **No human has read either page in this viewer.** Same limit as the first
  report.
- **The shared components are still shadcn-flavoured.** They work, and the four
  `revert` rules are the price. A viewer built on Starlight from the start would
  use its tokens directly and neither the bridge nor the reverts would exist.

## Recommendation

**Build the production viewer on Starlight, and expect it to save stylesheet
rather than code.**

The honest summary is that the framework is a wash on volume and a clear win on
everything a reader touches: rendered HTML instead of a script, a theme toggle,
navigation that scales past two pages, and a whole class of CSS bug removed by
construction. The cost is a binding layer that exists because Astro components
cannot be closures, and it is a fixed cost — a third page does not pay it again.

Three things to carry over, in order:

1. **Keep `src/search.ts`.** Pagefind was measured and cannot address a claim.
   Render the index through a `Search` override, as here.
2. **Keep the boundary that stops Node modules reaching islands.** The virtual
   module used to make it structural; under Astro it is a convention with a test
   behind it, which is weaker. If the production viewer has one architectural
   rule, this is it.
3. **Do not reuse the shadcn-flavoured components.** They were right for the
   spike, which had them already. A production viewer should write its
   components against `--sl-color-*` and delete both the token bridge and the
   preflight reverts.

One thing to settle separately: the `./catalog` export in
`create-stellaris-mod` flagged in the first report is still dangling, and this
spike did not touch it.

## Running it

```bash
npm run start:starlight -w @pdx-ts/reference-spike
```

Builds and serves on `http://127.0.0.1:4174/`. `npm run dev:starlight` for the
authoring loop, `npm run build:starlight` and `npm run typecheck:starlight` for
the gates. The first viewer is unchanged: `npm run start -w @pdx-ts/reference-spike`.
