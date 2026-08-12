---
name: add-registry
description: Add a content registry to the SDK — mod.<type>, <Type>Def, <Type>Item, generated from its CWT type declaration. Use when exposing a new game content type for authoring, when a corpus gap needs a new registry, or when the user asks for any new mod.<x> content method.
---

# Adding a content registry

The content system is deliberately generic: one manifest row generates the
definition type, the capability method, and the item union — no new emitter, no
writer class, no type-name conditional. Every field the emitter can lower is
emitted automatically; there is no curated field allowlist. A field being
mechanically typeable is still not proof the SDK lowers it _correctly_ — that
risk is caught by evidence (the corpus gate and the tests you add), never by
pre-review of a list.

Follow AGENTS.md's "Code generation" ground rules throughout (read the report,
review the generated diff as public API, commit generated output with its
source change).

## Steps

1. Find the CWT `type[...]` declaration and its source file under
   `vendor/cwtools-stellaris-config/config/`. Confirm the declared `path` is
   the Stellaris output directory you expect. If the rules mark the type
   `name_field = "..."`, the entries are keyed by a repeated top-level keyword
   rather than by id; work out that keyword (checking any `type_key_filter`
   the rules declare) — you will need it in the next step.
2. Add the type and source file to the allowlist in
   `packages/codegen-cwt/src/content-manifest.ts`, with a `keyword` for
   `name_field` registries. The capability method's name follows from the type
   name; the entry carries no plural or placement metadata — nothing about the
   registry is spelled twice.
3. Run `npm run codegen` and read its report. Add overlay rows only where the
   emitted shape is actually wrong or the rules need help (reference below).
4. Re-run codegen and inspect its report and generated files. Fix the generic
   model when a shape is reusable; a per-type branch in the writer or emitter
   means the model is wrong.
5. Export the new generated public types from `packages/sdk/src/index.ts`.
6. The manifest also drives the install-derived id package: run
   `npm run codegen:vanilla` (install-gated), read its report, and review the
   `packages/stellaris-ids/src` diff as a public-API change, per AGENTS.md's
   "Vanilla identifier package" rules.
7. Add all four kinds of evidence, all written through the capability
   (reference below). Done when: every kind is present, the corpus gate
   records a non-zero definition count for the registry, every presence gap is
   either fixed or acknowledged in `corpus-gaps.ts` with a reason and a Linear
   issue, every `form` or `scope` mismatch is fixed, and every `arity` or
   `literal` observation the registry introduces is classified in
   `corpus-observations.ts`.
8. Add or update a README example only when the registry introduces an
   authoring pattern users would not infer from existing registries.

Use the generated naming, never hand-written aliases: snake-case
`ascension_perk` becomes `AscensionPerk`, `mod.ascensionPerk`,
`AscensionPerkItem`, `packages/sdk/src/generated/ascension-perk.ts`.

`mod.patchX` is not a consequence of `mod.x` existing — a patch is a
whole-object override whose load order and emission are verified per registry.
That is the `add-patch-registry` skill.

## Overlay rows (step 3 reference)

- `REQUIRED_LOCALISATION` — localization the authoring API should require.
- `FIELD_WIDENINGS` — intentional ergonomic input forms.
- `CONTENT_FIELD_OVERRIDES` — when the field shape cannot be inferred
  correctly. A field the rules declare twice, once scalar and once block,
  needs no row: it lowers to a `dual` of both arms on its own. Requesting a
  `shape` suppresses that, so only pin an arm when you mean to make the other
  unauthorable.
- Nested-definition metadata — only when the CWT field is genuinely a nested
  content definition.
- A `scope`/`arity` assertion on `CONTENT_FIELD_OVERRIDES` when CWT states
  game semantics wrongly rather than incompletely, or a
  `CONTENT_SCOPE_PARAMETERS` row when CWT scopes a body `any` and is _right_ —
  the scope is then a property of each definition, declared by a `scope`
  member the definer strips. All three need evidence, and shape conformance is
  where that evidence comes from — never assert one from a reading of the
  rules alone.
- `CONTENT_DECLINED_FIELDS` — the only way to keep a lowerable field out of
  the authoring surface, and it should stay nearly empty: a field whose
  lowered shape is wrong is better measured and fixed than withheld. The bar a
  row must clear: a genuine second spelling of a capability the SDK already
  emits correctly, where the author loses nothing — see the `change_orbit`
  row's comment (SDK-30) for the one precedent.

## The four kinds of evidence (step 6 reference)

- **Codegen coverage** in `packages/sdk/tests/codegen/content-snapshot.test.ts`.
- **Corpus coverage** in `packages/sdk/tests/codegen/corpus-conformance.test.ts` —
  hermetic: it measures the emitted interface against the committed corpus
  fixture under `packages/sdk/tests/fixtures/corpus/` (derived observations of
  every shipped definition — field names, forms, counts), for presence and for
  shape, so it runs in plain `npm test` and CI. Adding a registry means
  regenerating the fixture: `npm run corpus:extract` (install-gated), read its
  report, review and commit the fixture diff with the change. Zero recorded
  definitions means the path or keyword is wrong. A field the game writes at
  the presence floor that no author can produce fails — fix the lowering, or
  acknowledge it in `corpus-gaps.ts` with a reason and a "Corpus Gap" Linear
  issue (measurement for review, not acceptance). A `form` or `scope` mismatch
  fails the same way: fix the lowering, or acknowledge it in
  `ACKNOWLEDGED_MISMATCHES` (`corpus-observations.ts`). An `arity` or `literal`
  mismatch is legal rather than broken, but a new registry's are still new: each
  needs a classified row in the `OBSERVATIONS` baseline in that same file,
  citing the CWT declaration it is wider than. A field the emitter invents with
  zero real precedent is worth verifying by hand against the vendored rules.
  `npm run corpus:check` re-extracts and diffs (maintainer-local,
  install-gated); the version canary warns, never fails, when the local
  install has patched past the fixture.
- **Compile-time safety** in `packages/sdk/tests/content.test-d.ts`: the
  capability preserves the literal id, the returned item flows into its own
  registry's reference fields, and another registry's item does not.
- **Runtime serialization** and file snapshots in
  `packages/sdk/tests/content.test.ts` and
  `packages/sdk/tests/__snapshots__/content/`, built with
  `render(mod.compile([mod.feature(undefined, [mod.ascensionPerk("example", { ... })])]))`.
