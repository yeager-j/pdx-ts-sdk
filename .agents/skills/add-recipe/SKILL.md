---
name: add-recipe
description: Add a built-in create-stellaris-mod Recipe — classify its output, curate structural questions and source, register it in the Catalog, and prove every reachable variant. Use when adding or changing an Item recipe or Feature recipe under packages/create-stellaris-mod.
---

# Adding a Recipe Catalog entry

A Recipe installs one author-owned TypeScript Feature file. The recipe module
owns that file's imports, declarations, callbacks, references, explanations,
and final Feature assembly. Shared catalog code owns discovery, validated name
derivation, interaction, compatibility preflight, and safe publication.

Read `packages/create-stellaris-mod/CONTEXT.md` before choosing names or
structure. Read the existing recipe nearest to the proposed output and its
matrix and transcript cases before editing.

## Bare-invocation calibration

When the invocation supplies no proposed recipe, treat it as a calibration run
rather than a shipping request. Work on a `trial/` branch, select one simple SDK
content kind that is absent from the current Catalog, and build a zero-question
standalone Item recipe that demonstrates its smallest useful working shape.
Label the recipe module as trial-only. Complete every step below, commit the
trial so its evidence is inspectable, and report that merging it requires a
separate curation decision. The calibration choice is disposable and does not
add a new built-in starter to the shipping branch.

## Steps

1. **Classify the output.** Use an Item recipe when the file contains one SDK
   Item inside one Feature. Use a Feature recipe when several Items coordinate
   through references or control flow inside one Feature. Record the matching
   `kind` and complete `itemKinds` in the recipe summary. This step is complete
   when the classification describes the emitted Feature rather than how many
   questions the command asks.
2. **Curate the starter.** Choose a short working pattern that teaches the
   conventional structure. Keep required and idiom-defining fields active;
   use type-correct `PLACEHOLDER: <label>` text where author prose is required;
   include an optional commented example only when it materially teaches the
   idiom and can be uncommented with the existing imports and names. Cite the
   evidence for non-obvious choices in maintainer-facing source prose. This
   step is complete when untouched output compiles and synthesizes a useful
   mod, without mirroring every SDK field.
3. **Choose Intent questions.** Add a question only when its answer changes
   Item topology, authoring kind, scope contract, block structure, control
   flow, or cross-Item references. Keep questions as a static ordered tuple of
   finite choices, each with a unique kebab-case key, prompt, help, and
   reviewed Default answer. Leaf values stay editable in the generated source.
   This step is complete when every question selects a visible structural
   branch and every structural branch is reachable by one answer set.
4. **Author the recipe module.** Add one private module under
   `packages/create-stellaris-mod/src/catalog/recipes/` using `defineRecipe`.
   Fill every discovery field: stable kebab-case id, title, short summary,
   Item/Feature kind, complete item kinds, ordered questions, and the renderer.
   Keep imports, branching, loops, local helpers, source assembly, and
   ownership header in this module. Add a small shared lexical helper only when
   multiple accepted recipes need the identical operation.
5. **Close every source input.** Consume names only through `DerivedNames`.
   Put author text into TypeScript literals through `quoteTs`; put finite
   recipe answers through exhaustive recipe-owned branches; keep all other
   emitted text package-authored. Generated source ends with one newline. This
   step is complete when the adversarial-name corpus compiles and builds the
   recipe without changing executable source outside quoted text.
6. **Register the recipe.** Import it in
   `packages/create-stellaris-mod/src/catalog/index.ts` and add it to `CATALOG`.
   Run the catalog protocol tests. This step is complete when `list`, `view`,
   and `generate` all reach exactly one validated entry and deterministic list
   ordering is unchanged except for the new id.
7. **Enumerate the reachable matrix.** Extend
   `packages/create-stellaris-mod/tests/recipe-matrix.test.ts` with the full
   Cartesian product of the recipe's choices and increase the asserted catalog
   and total counts. For every variant, use `describeSource`, add a reviewed
   golden under `tests/goldens/recipes/<id>/`, and prove the real fixture
   project typechecks, builds, and emits the expected registry files and ids.
   Add a focused negative control when the new source relies on a compiler
   contract the existing controls do not exercise. This step is complete when
   the asserted count equals the number of committed variant goldens and every
   variant passes deterministic, Prettier-fixpoint, compiler, and synthesis
   checks.
8. **Cover hostile names.** Extend
   `packages/create-stellaris-mod/tests/adversarial-names.test.ts` so accepted
   names render, compile, and build through the new recipe. Add a recipe-local
   collision name when its fixed local identifiers create a new risk. This
   step is complete when accepted punctuation, apostrophes, reserved words,
   leading digits, Unicode boundaries, and the length limit remain closed
   inside validated names and quoted text.
9. **Capture the command surface.** Extend the golden transcript suite with
   `view`; the Default path; every explicit-answer path; interactive question
   order for a guided recipe; flag-source echo; and invalid answers. Add `list`
   changes only as the new discovery row requires. This step is complete when
   a reviewer can read every new command path from committed transcripts and
   the corresponding tests assert exit status and filesystem result.
10. **Run the release proof.** Run the focused catalog, matrix,
    adversarial-name, transcript, filesystem, compatibility, and binary-smoke
    suites, then `npm run typecheck`, `npm test`, and `npm run build`. Inspect
    every golden and transcript change rather than accepting it from a bulk
    update. The Recipe is complete only when all focused and repository gates
    pass and the working diff contains no unrelated generated or vendored
    changes.
