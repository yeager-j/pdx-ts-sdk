# Reference spike — outcome

**Verdict: the hypothesis holds.** Every acceptance claim in
[the design](../../docs/design/authoring-reference-spike.md) is met. Two pages
exist rather than the one the design asked for, the second was written by
somebody who did not build the machinery, and the whole evidence-to-page chain
runs under 187 hermetic gates.

The disposition is still yours. Passing means production boundaries get designed
separately; it does not mean this code moves anywhere. One decision cannot wait
for that, and is flagged under **A hook left in production** below.

## The hypothesis

> A Reference contribution derived from the real post-overlay authoring model,
> combined with dependency-checked curated guidance and a Verified example, can
> teach one difficult SDK capability without duplicating legality or hiding
> uncertainty.

It holds, with one qualification worth stating up front: **more of the hard
material turned out to be derivable than expected, and one important thing is
not derivable at all.**

The derivable half went further than the design assumed. The conditional
`picture` omission, the stage-colour contradiction, the two different emitted
layouts for `stages` and `approach`, and the fact that the progress-mode
discriminator is missing from the model are all _computed_ by comparing what the
rules declare against what the surface lowered. None of them is written down as
a sentence somebody has to maintain. Fix any of those in codegen and the page
stops making the claim, because the claim was never stored.

The non-derivable half is `targetScope`, and it is not a gap in the probe. A
hand-written contract exists precisely because the rules are silent, so there is
nothing in the post-overlay model to project. This matters more than it sounds:
`targetScope` looks exactly like a field, sits in the same object literal as the
fields, and emits nothing. A page that projected only what codegen knows would
either omit the SDK's most useful situation feature or — worse — present it as
though it had been derived. The spike declares those contracts, cites the source
file that implements each one, and a gate reads those files as text to check the
anchors still exist. That is the weakest link in the chain and this report says
so rather than hiding it.

## What exists

|                     | Situations     | Technologies                    |
| ------------------- | -------------- | ------------------------------- |
| Sections            | 12             | 15                              |
| Derived claims      | 14             | 16                              |
| Curated conventions | 5              | 4                               |
| Stories             | 8 hand-written | 6 hand-written, 1 from a Recipe |
| Fields projected    | 85             | 81                              |

187 gates across nine files, all hermetic, all inside the repository's ordinary
`npm test`. Roughly 8,700 lines, viewer and gates included.

## Acceptance, claim by claim

| Claim                                                                    | Where it is checked                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Facts derived from the real post-overlay model through the probe         | `tests/projection-parity.test.ts`                                        |
| Two stages and two approaches keep identity, localization, order, layout | `tests/stories.test.ts`                                                  |
| Every story typechecks, builds, synthesizes                              | root `npm run typecheck`; `tests/stories.test.ts`                        |
| The page distinguishes the claim statuses                                | `tests/honesty.test.ts`                                                  |
| `targetScope` is presented as an SDK-authored contract                   | `tests/honesty.test.ts`, `tests/citations.test.ts`                       |
| Search finds pages through SDK names and PDXScript terms                 | `tests/search.test.ts`; verified in the running app                      |
| A semantic contract change breaks projection parity                      | `tests/projection-parity.test.ts` — five negative controls               |
| A guidance-dependency change invalidates curated guidance                | `tests/guidance-freshness.test.ts` — five, plus two that must _not_ fire |
| Colour, `picture` and progress-mode problems stay visible                | `tests/honesty.test.ts`                                                  |
| The critical user flow verified in the running local app                 | Done; five defects found that way                                        |

One acceptance claim was met differently than written. The design says the page
must visibly distinguish all five claim statuses. It records all five, and
_marks_ three — the ones that cost a reader something. See **The page is mostly
unmarked** below.

## The format

The page was rewritten twice, and the third shape is the one worth carrying
forward. It began as one large example inside a page whose prose lived in
TypeScript template strings, organized around what the machinery could prove.
It ended as MDX — markdown, styled by shadcn/typeset — organized around a
reader's questions, with small stories written as fenced code blocks.

**The unit of contribution is a story, not a page.** One large example shows a
finished thing; small ones show the decisions, and a decision is what a reader
is stuck on. It also changes who can contribute: writing a registry's narrative
is a daunting, unowned task, while adding a fence that isolates one choice is
minutes. Coverage can accrete instead of being commissioned.

**Prose authored, components derived, stories executed.** The MDX holds writing.
`<Claim>` and `<FieldTable>` splice in material projected from the model. Every
fenced TypeScript block tagged `story="…"` is extracted to a committed module
that the repository's own `npm run typecheck` compiles and
`tests/stories.test.ts` synthesizes. That is what separates this from a
documentation site with code samples in it: a story that drifts from the real
surface fails the build. Storybook installations rot because a story is
decorative; these cannot be.

**The output panel is the canvas.** There is no live Stellaris to render into,
but the bytes the fold wrote are an exact artifact, and showing them beside the
source teaches the mapping between the two languages by repetition on small
cases. It is the thing on these pages that an editor's tooltips cannot do.
Syntax highlighting runs at build time through Shiki and never reaches the
committed snapshot — it is a derived viewer asset, and a snapshot diff full of
`<span style="…">` would stop being reviewable. Two grammars had to be written
because Shiki has neither: PDXScript, and Stellaris localization, which is not
YAML however much it looks like one. They follow the token taxonomy of the
Paradox Language Support IntelliJ plugin, written from its categories rather
than copied from the MIT-licensed TextMate file it ships.

**The page is mostly unmarked.** The first version put a badge, a coloured rail
and a status explanation on every claim, including the true ones — nineteen
callouts on one page. That is the truth model, which is a producer's concern,
leaking into the reader's view. A reader does not ask "is this a supported
contract or an observed example"; they ask whether they can rely on it, and for
anything that compiles the answer is yes. Only three statuses are marked now:
it will not work, nobody knows, this is a person's opinion. Observed examples
left the reading flow entirely — a corpus count is evidence _for_ a claim, not a
claim, so it renders inside that claim's evidence. The discipline behind all of
it is unchanged; only what the reader is asked to carry.

Two smaller things, both mechanism the design asked for and did not need. The
spike shipped a hand-written loopback file server per the launcher decision; it
was a reimplementation of `vite preview`, same job and same default port, and it
is gone. The launcher decision survives intact — loopback only, `strictPort`,
prints its URL — with no code behind it, and the open-in-browser behaviour the
design deferred is now a flag. Section anchors are slugged rather than authored,
because MDX parses `{` as an expression before any plugin can read a heading;
the ids are committed in the snapshot, so a reworded heading is a reviewable
diff rather than a silently broken link.

## The contributor experiment

The spike's original report named one thing it could not answer: whether
somebody who did not build the machinery could add a page with it. The
Technology page is that test. It was written by a fresh agent given the goal,
the constraints and the existing page — and deliberately _not_ given a
generalized pipeline, because pre-smoothing the path is the bias that would have
made the result worthless. Every finding below is theirs.

**Effort split:** understanding the format 20%, generalizing the pipeline 25%,
sourcing facts 15%, writing prose 20%, the Recipe example 10%, fixing gates 10%.

The pipeline quarter is the number that matters, and it is better than it looks:
most of it was _finding_ the page-specific bits rather than changing them, and a
third page would not pay it again. Sourcing facts was cheap because the probe
was already registry-parameterized and produced correct Technology facts on the
first call. So the coverage argument survives contact: once the pipeline is
general, the work is writing.

**Reader-first ordering held, but did not start on its own.** The contributor's
first outline was `registry → required → cost → weights → swaps → patch →
fields` — a field table with paragraphs between the rows. What broke the pull
was writing "what the player actually sees" before touching a field. That is the
same escape the Situation page found independently, which is two samples
converging on one technique.

**What fought them**, in their priority order:

1. **`mod.warnings` was invisible to the entire chain** — the finding that
   mattered most, described in its own section below.
2. **`src/search.ts` located the field table by a Situation claim id.** Silently
   wrong on any other page; field hits would land on section one. Found by
   reading unrelated code.
3. **The probe's localization owners could not be generalized** — see **The
   sharpest structural finding**.
4. **`localisation[].required` is pre-overlay** and disagrees with the shipped
   type: the facts say `name` is optional about a member the SDK refuses to
   omit. A fact channel that is post-overlay everywhere except one place is a
   trap.
5. **`EmittedField` carries no `locKey`,** so "this field is a key, do not write
   English in it" could only be prose — exactly the hand-typed surface statement
   the format exists to avoid.
6. **`Story.origin: "recipe"` existed and nothing else did.** Five modules had to
   change for a field already in the schema.
7. **`virtual:highlighted-stories` was keyed by story id alone.** Both pages have
   a `minimal`; the collision would have shown the wrong page's colours on the
   right text. Found by reasoning, not by a failure.

**What was smooth:** the probe needed no changes to serve a second registry;
`fingerprintOf`'s subject vocabulary covered all four new conventions without a
new subject kind; assembly's four refusals caught a `<Claim>` typo and an
unplaced story immediately, with messages that said what to do; and extraction →
typecheck → synthesize worked first time for all seven stories, the Recipe one
included.

## The warnings gap

The single worst thing either page had, and both pages had it.

The SDK reports diagnostics as `mod.warnings` data rather than console output —
correct, and a documented repository rule. Nothing in the spike read that list.
`synthesizeStories` called `compile()` and kept only the rendered files. So a
story could compile, synthesize, render, and teach something the build had
already diagnosed, with the diagnosis sitting in a list no part of the package
looked at.

The Technology page hit it first: English written into `prereqforDesc.custom.title`,
which is a localization key, would have shown the sentence verbatim in game. The
Situation page — mine — had been shipping two warnings since the day it was
written:

```

unstable-desc-key: Modifier desc on "verge_situation_type_collapse" (monthly_progress)
has no descKey; its localisation key is a hash of the desc text and will change if
that text is edited, silently orphaning any existing translation.

```

That is not pedantry. A stage or an approach has an id to hang its key off; a
`monthlyProgress` row does not, so the build derives one from a hash of the
sentence, and rewording the sentence later orphans every translation of it. The
page that exists to teach people to write those rows was demonstrating the wrong
pattern and saying nothing.

Now closed three ways: the stories pin `descKey` and emit readable keys, a gate
holds every page at zero warnings, and the Situation page teaches the trap with
the fix beside it. Held at zero rather than pinned to a reviewed set — a
documentation page is the wrong place to demonstrate a pattern the SDK complains
about. Prose can describe the mistake; the code a reader copies should be code
the build is happy with.

## The sharpest structural finding

`localisationOf` in the probe hard-codes `["stages", "approach"]`. Deriving
those owners generically from `repeatedStructs` produces the same pair **in the
other order** — and the Situation page's `nested-localisation` claim renders
that array's order inside a sentence. The correct generalization would have
silently reworded a shipped page.

That is the one place "prose authored, components derived" bit back: a derived
detail string made an internal ordering load-bearing, invisibly. The literal was
left in place with a comment saying why.

The fix it implies is not a better derivation. It is a **per-claim golden**: a
committed list of claim id to statement, so an accidental reword is a one-line
diff. Whole-snapshot parity does not catch this — it catches that _something_
moved, inside a large file, which is not the same as catching what.

## A hook left in production

`packages/create-stellaris-mod/package.json` gained a `./catalog` export so the
Recipe story could reach the Catalog's `generate`. It is `pdx-source`-only, so
nothing ships to consumers, and the alternative was a relative import into
another package's `src/` that slips past `tests/quarantine.test.ts`'s regex while
doing exactly what that check forbids. The reasoning is sound and the change is
small.

It is still a production change made for a disposable experiment, and it is the
one thing in this handback that a **fail** disposition does not clean up: delete
the spike and that export dangles. It needs an explicit decision either way.

## What the chain caught

Ten defects. Two are in the SDK and outlive the spike; the rest were in the
spike itself. What they have in common is that none came from reading code.

**In the SDK, and worth fixing regardless of the verdict:**

1. **The stage-colour doc comment is wrong in the shipped SDK.**
   `SituationStageFields.color` is typed `NamedColorRef | string`, and the doc
   comment above it — inherited from the CWT declaration whose arm did _not_
   lower — tells the reader a numeric RGBA vector is accepted. It is live in
   `packages/sdk/src/generated/situation-type.ts` today. The generated comment
   should come from the arm that survived.
2. **`stages.targetModifier` and `stages.triggeredTargetModifier` widen to any
   scope** while the identical members on the type and on an approach pin to
   `planet`. A faithful reading of the rules, and it means nothing checks a
   stage's target-modifier keys. Possibly worth an upstream rule annotation, the
   way five other scope gaps already were.

**Found by writing a story**, which is the argument for executable examples in
one line: **`potential` is country-scoped** and the first draft of the Situation
example used a situation trigger there — it did not compile. **English written
into a localization-key field** on the Technology page compiled and rendered,
and only `mod.warnings` knew.

**Found by running the page:** search could not find a field by the spelling the
game uses (the placeholder itself suggested "colour", which returned nothing);
eleven field-table rows printed duplicate member names; every story's output
file name was doubled; and `scroll-behavior: smooth` was unguarded against
`prefers-reduced-motion` while a `backdrop-filter` promoted the whole document
to its own compositing layer.

**Found by building a second implementation of the same idea:** the page was
dark in _both_ colour schemes, from the first CSS written, unnoticed for most of
the spike. Tailwind v4 hoists every `@theme` declaration onto `:root` and
discards the at-rule around it, so a `@theme` nested inside a
`prefers-color-scheme` query emits unconditionally. Nothing surfaced it until
build-time syntax highlighting went in, because Shiki _does_ respect the query —
a light-scheme reader got light code tokens on a permanently dark page. Neither
implementation was wrong in isolation.

**Found by a second author:** the warnings gap, the search field-table lookup,
and the highlight-cache key collision, all above.

## What the corpus and the install say

The committed fixture and a matching 4.4.6 install agree exactly on every count
the pages use. The audit adds evidence the fixture does not carry:

- 90 situation types in 20 files; 60 declare more than one stage, range 1 to 8;
  76 declare more than one approach
- `picture`: 86 definitions — 82 plain sprite, 4 the conditional block the SDK
  cannot author
- `total_progress`: 1 definition. `stages.section_weight`: 1. `stages.color`: 1

That last line is why the progress mode stays Unresolved behavior. Almost
nothing to read, the rules gate the two members behind a subtype whose
discriminator the codegen model discards, and the rules' own prose says the game
logs an error if you mix them. Three sources, none of which settles it.

## What this does not prove

- **Not the production interface.** The probe is an information-hiding
  violation. It proves the facts are _derivable_; it says nothing about how CWT
  Codegen should expose them. A producer-owned contribution gets designed on
  that context's terms, and the probe is not copied.
- **Two registries, not the surface.** Situation and Technology between them
  exercised nested definitions, two emitted layouts, localization, scopes,
  subtypes, dropped declaration arms, hand-written contracts, patchability and a
  Recipe. They did not exercise scope parameters, inline splices, or events.
- **No human has read either page.** The contributor test used an agent. A
  better proxy than nothing, and not a mod author. The pages' best sections were
  written from their authors' own confusion, which is a sample of two, both of
  whom have now read the CWT rules and are therefore the least representative
  readers available.
- **The viewer is disposable.** React, Vite, Tailwind, shadcn/typeset and four
  hand-written primitives, chosen to spend no time on mechanism. It is not a
  design system and should not be treated as a starting point for one.

**One concern the second page retracted.** The original report worried that
Situation had _flattered_ the result by being unusually rich in derivable
difficulty, and that a scalar-heavy registry would produce a thin page.
Technology produced **more** derived claims than Situation — 16 against 14 —
including two arity claims computed by comparing a declared arm's cardinality
against the lowered member's repetition, a derivation that did not exist before.
The worry was wrong.

## If this proceeds

In the order a second author asked for them, which is better evidence than the
order the first author would have picked.

1. **Surface `mod.warnings`** — in the contribution, on the page, and as a gate.
   It is the only place the build knew more than the page and said nothing, and
   it is closed here only for this spike's own stories.
2. **Put `locKey` in the facts.** One boolean on the lowered member. It converts
   "you must not write English here" from prose into a derived claim, and the
   same gap exists on every registry with tooltips.
3. **A per-claim golden, not just whole-snapshot parity.** See **The sharpest
   structural finding**.
4. **Make the localization facts post-overlay,** or drop `required` from them. A
   field that is right everywhere except one place is worse than a missing one.
5. **Derive the difficult claims; do not write them down.** The hardest facts on
   both pages are computed from a declared-versus-lowered comparison. That
   comparison — arms declared, arms kept, what dropped — deserves to be part of
   whatever CWT Codegen emits.
6. **Keep the story as the unit, and keep it executable.** The extraction step is
   about 150 lines and it is what separates this from a docs site with snippets
   in it. A code block a compiler never sees should not be allowed on a page
   that claims to be checked.
7. **Hand-written contracts need a first-class channel.** Citation by text anchor
   works and is honest, and it is the weakest link here.
8. **Contract dependencies should fail; evidence dependencies should review.**
   Both are implemented and demonstrated. The formatting negative controls exist
   to prove the gate does not fire on noise, which is what makes it worth
   reading.

```

```
