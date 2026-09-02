---
name: close-corpus-gap
description: Lower a field the game writes and no author can produce, retiring its corpus-gaps.ts row. Use when working a "Corpus Gap" Linear issue, when the presence-floor gate fails with "fix the lowering, or acknowledge it", or when acknowledging a field the emitter cannot yet lower.
---

# Closing a corpus gap

A gap row is a measurement, not a specification. It records that N shipped
definitions write a field no author can produce, and its `reason` is whoever
wrote it guessing at why — often from the CWT declaration alone, before anyone
counted what the game does with it. SDK-64's row and its Linear issue both
called `technology.prereqfor_desc` an enum-keyed **map**; vanilla writes the
same key three times inside one block, so a map was the one shape it could not
be. Treat the row as a hypothesis you are about to test.

The fix lands in `packages/codegen-cwt/src/emit/` and the shared runtime shapes,
never in a branch keyed on the registry or the field. Follow AGENTS.md's
"Code generation" ground rules throughout (read the report, review the
generated diff as public API, commit generated output with its source change).

## Steps

1. **Read the declaration at every site.** Grep the pinned `.cwt` files for the
   key: a field declared once at the type's top level and again inside a nested
   struct is two gap rows and one fix, and the corpus gate's struct descent
   makes the nested instance visible independently. Done when you can state,
   for each site, the key kinds inside the block, every cardinality, and any
   `## replace_scopes` / `## push_scope` the field or its container carries.

2. **Count the shape in the install.** The fixture records the block's key
   _set_ and nothing inside it: interior paths come from a descent, an unlowered
   field has no descent, so the interior is absent by construction and cannot
   be read from `packages/sdk/tests/fixtures/corpus/`. Read
   `common/<registry>/*.txt` in the install `corpus-fixture.ts` locates, and
   count what the rules leave open — which keys vanilla actually writes,
   whether a key repeats _inside_ one block, whether the block itself repeats
   in one definition. Done when every claim you are about to encode is backed
   by a count you ran.

3. **Choose the lowering.** Start from the `ContentFieldShape` union in
   `packages/codegen-cwt/src/overlay/fields.ts`: it is the catalogue, every arm
   documented with what it lowers and why, and a gap is sometimes a shape that
   already exists and was never requested. Past it, a new runtime shape brings
   a writer case in `packages/sdk/src/content/lower.ts` and a `DescentNode`
   mode with it, three things that then have to agree forever — SDK-64 lowered
   a block CWT declares with a computed key, at two nesting levels, and added
   none of the three. Three rules settle most of the rest:
   - **Look for a mixed block first.** `structShape` declines any block holding
     a key that is not a plain name, so a block mixing a computed or spliced
     declaration with ordinary named siblings arrives as a whole-field gap —
     `building.resources`, `technology.prereqfor_desc`,
     `building.ai_resource_production`, `megastructure.placement_rules`. Those
     named siblings are what a map-shaped lowering quietly drops, so a shape
     that reaches only the keyed part has not closed the gap.
   - **The key set decides the authoring surface.** A set the rules close —
     an `enum` — becomes one camelCase member per name, and inventing a wrapper
     member (`entries`, `categories`) to hold what the game wrote flat is the
     signal you picked the wrong shape. A set the rules leave open — `scalar`,
     `<resource>`, `value[tech_weight_group]` — stays a map keyed as far as the
     rules type it, because nothing can name a member for a key the mod
     invents.
   - **Ambiguity is what earns an overlay row.** `structMap` must be requested
     because CWT spells it identically to `repeatedStruct`. Where the rules are
     unambiguous, infer — and measure the blast radius first by grepping the
     whole vendored config for the declaration form, so "unambiguous" is a
     count rather than an impression.

   A gap that is a whole vanilla mechanism rather than one block's shape — the
   six `inline_script` rows are one field appearing in any definition body —
   is a design decision before it is a lowering, and it earns a proposal in
   `docs/` that names the authoring surface first.

   Done when the diff is one generic change plus its evidence, with no
   registry-name or field-name conditional anywhere in it.

4. **Regenerate.** `npm run codegen`, then `npm run corpus:extract` whenever
   the lowering added or changed a descent — new nested paths are unmeasured
   until the fixture carries them, and `corpus:check` is the confirmation.
   Review both diffs as public-API changes. Done when `npm run codegen:check`
   and `npm run corpus:check` pass with the change staged (`codegen:check`
   compares against the git baseline, so it correctly fails while the generated
   diff is unstaged).

5. **Classify the shape rows the change added.** `invented` is reported rather
   than failed, so a new one is a prompt: is an emitted key with no precedent
   one the rules genuinely declare? `arity` and `literal` are not failures
   either — a list the game never repeats is legal breadth — but they are no
   longer free: each one needs a row in
   `packages/sdk/tests/codegen/corpus-observations.ts` naming its
   classification, the CWT declaration it is wider than, and why. The gate
   prints a paste-ready stub whose `classification` deliberately fails
   `typecheck` until you choose one. `form` and `scope` fail outright — fix the
   lowering, or acknowledge it in `ACKNOWLEDGED_MISMATCHES` in the same file.
   Done when every row the change introduced is classified, or gone.

6. **Retire every row the change closed.** Not only the one you started from:
   a mechanism carries rows across registries, and `inline_script` alone has
   six. The gate fails both ways, so a row left behind on a now-authorable
   field fails as loudly as a missing one — it names them for you. Authorable
   is the bar a row measures, and reproducing every shipped definition is a
   separate claim: where an `arity` assertion is what buys it, say so in the
   row's reason (reference below).

7. **Add the evidence** (reference below). Done when all four kinds are
   present and the full gates pass: `npm run typecheck`, `npm test`,
   `npm run build`.

## Acknowledging instead

Stopping is a real outcome: a field whose lowering needs machinery this change
should not carry belongs in `corpus-gaps.ts` with its count, the reason it is
deferred, and a Linear issue labelled "Corpus Gap" — filed first, since a row
without one is a hole nobody is sequenced to close. `CONTENT_DECLINED_FIELDS`
is a different instrument for a different claim: deliberately withholding a
shape the emitter _can_ lower.

## Overlay rows (step 3 reference)

A row states something the rules do not, so each needs evidence from step 2
rather than a reading of the declaration:

- `CONTENT_FIELD_OVERRIDES` with a `shape` — the lowering CWT cannot be read
  for on its own.
- `arity: "repeated"` — CWT says `0..1` and the fixture's own `repeated` count
  says otherwise. This is the widening that is hardest to see, because the gate
  reports an over-wide list and stays silent on a too-narrow one: a second
  block the game writes is not awkward to author, it is unwritable.
- `arity: "single"` — the reverse, for a `0..inf` on a field whose only
  sensible authoring is one value. This is what the `narrowing-deferred`
  classification in `corpus-observations.ts` promises: a row classified that
  way names the issue that will add this override, rather than accepting the
  list as legal breadth.
- `scope` — CWT annotates no scope and the mechanical fallback is wrong.
  Shape conformance's `scope` mismatch is the check that keeps it honest.
- `FIELD_WIDENINGS` — an input form the rules deny that vanilla writes anyway.

## The four kinds of evidence (step 7 reference)

- **Codegen coverage** in `packages/sdk/tests/codegen/content-snapshot.test.ts`:
  the emitted member and its metadata, plus the field named to the corpus gate
  at every path the reader records it under — a member that exists only on the
  interface leaves the nested path unexpressed and does not retire the row.
- **Corpus coverage**: the presence-floor and shape-conformance assertions in
  `corpus-conformance.test.ts`, against the fixture step 4 regenerated.
- **Compile-time safety** in `packages/sdk/tests/content.test-d.ts`: the member
  type, the closed set where the rules close one, a `@ts-expect-error` on the
  form the lowering rules out, and the patch member for a patch registry.
- **Runtime serialization** in the registry's own test (`tech.test.ts` and
  friends): a golden showing the block written the way the shipped files write
  it, including whatever repetition step 2 found.
