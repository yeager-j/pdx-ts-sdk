# Repository guidance

## Project purpose

`@pdx-ts/sdk` is a TypeScript SDK for generating Stellaris mods. Mod authors run ordinary
TypeScript at build time; the SDK records typed triggers, effects, content definitions, and file
layout, then serializes a launcher-ready mod in PDXScript.

The root package contains the Stellaris-facing SDK. `packages/pdxscript` is the standalone
PDXScript parser/serializer workspace package used underneath it.

Read `README.md` before making architectural changes. Files under `docs/` and `design/` preserve
handoffs, probes, and design evidence; check their status headers and the current implementation
before treating an older proposal as current behavior.

## Repository conventions

- Use npm; `package-lock.json` is the lockfile.
- Keep the project strict TypeScript and ESM. Internal relative imports include the `.ts`
  extension.
- Run Prettier for touched TypeScript files. The pre-commit hook formats staged TypeScript, but do
  not rely on the hook as the first formatting pass.
- The package is private and has not been released, so breaking changes are allowed and encouraged over band-aids or migrations.
- Prefer data-driven additions to registry-specific branches. Shared runtime machinery belongs in
  `src/`; source interpretation and emitted TypeScript belong in `tools/codegen/`; deliberate
  exceptions belong in the audited overlay.
- Keep changes focused. Do not update vendored game data, drift baselines, snapshots, or generated
  output unless the task requires the corresponding source change.

## Code generation

`src/generated/` is committed output from `tools/codegen/`. Never edit it by hand.

The main inputs are:

- `vendor/cwtools-stellaris-config/` for vendored CWT rules and Stellaris documentation dumps
- `tools/codegen/content-manifest.ts` for the content registries intentionally exposed by the SDK
- `tools/codegen/overlay.ts` for reviewed departures from a mechanical reading of the rules
- emitters and parsers under `tools/codegen/`

Use:

```sh
npm run codegen
```

After generation:

- Read the codegen report. Unsupported, omitted, or collapsed fields must remain visible; do not
  hide them with filters.
- Inspect the complete `src/generated/` diff as a public-API change.
- Commit generated output together with the source change that produced it.
- Keep generated headers and formatting generator-owned.

`npm run codegen:check` regenerates and then runs `git diff --exit-code src/generated`. It is the
CI-style drift gate. During an intentional uncommitted codegen change, use `npm run codegen` and
inspect the diff; the check will correctly fail until the generated diff is part of the comparison
baseline (for example, staged or committed).

Do not run `npm run codegen -- --rebaseline` reflexively. Rebaseline
`tools/codegen/drift-baseline.json` only after reviewing and intentionally accepting drift between
the vendored rule sources and documentation dumps.

## Adding a new content type

The content system is deliberately generic. Adding a registry such as `ascension_perk` should
generate `AscensionPerkDef`, `DefinedAscensionPerk`, and the `createAscensionPerks` collection
factory (with `AscensionPerkCollection`/`AscensionPerkItem` and its `defineAscensionPerk` definer)
without a new emitter, writer class, or type-name conditional.

Every field the emitter can lower is emitted automatically — there is no curated field allowlist to
maintain. A field being mechanically typeable is still not proof the SDK lowers it *correctly*, but
that risk is caught by evidence (the corpus conformance gate below and the tests you add), not by
pre-review of a list.

1. Find the CWT `type[...]` declaration and its source file under
   `vendor/cwtools-stellaris-config/config/`. Confirm the declared `path` is the Stellaris output
   directory you expect. If the rules mark the type `name_field = "..."`, the entries are keyed by a
   repeated top-level keyword rather than by id; work out that keyword (checking any
   `type_key_filter` the rules declare) — you will need it in the next step.
2. Add the type and source file to the explicit allowlist in `tools/codegen/content-manifest.ts`,
   with a `keyword` for `name_field` registries and the registry name in the `plural` (snake_case),
   which names the emitted collection factory — `technologies` gives `createTechnologies`. There is
   no pluralizer; write the correct English plural.
3. Run `npm run codegen` and read its report. Add overlay rows only where the emitted shape is
   actually wrong or the rules need help:
   - `REQUIRED_LOCALISATION` for localization the authoring API should require
   - `FIELD_WIDENINGS` for intentional ergonomic input forms
   - `CONTENT_FIELD_OVERRIDES` when the field shape cannot be inferred correctly — including a field
     the rules declare twice (once as a bare scalar, once as a `modifier_rule` block), where the
     generic picker silently keeps the bare form and drops the gated adjustments
   - nested-definition metadata only when the CWT field is genuinely a nested content definition
   - `CONTENT_DECLINED_FIELDS`, the only way to keep a field the emitter *can* lower out of the
     authoring surface. It should stay nearly empty and needs a real reason, not "not reviewed yet".
4. Re-run codegen and inspect its report and generated files. Fix the generic model when a shape is
   reusable. Do not add `if (type === "...")` branches to the generic writer or emitter.
5. Export the new generated public types from `src/index.ts`.
6. Add all four kinds of evidence, all of them written through the factory:
   - codegen coverage in `tests/codegen/content-snapshot.test.ts`
   - corpus coverage in `tests/codegen/corpus-conformance.test.ts` — it parses the real installed
     game and measures the emitted interface against every shipped definition. A field the emitter
     invents with zero real precedent is worth verifying by hand against the vendored rules; a
     registry parsing to zero definitions means the path or keyword is wrong.
   - compile-time API and scope/reference safety in `tests/content.test-d.ts`: the definer preserves
     the literal id, the returned item flows into reference fields, and the collection's element
     type rejects another registry's content.
   - runtime serialization coverage and file snapshots in `tests/content.test.ts` and
     `tests/__snapshots__/content/`, built with
     `render(buildMod(config, [createAscensionPerks(), ...]))`
7. Add or update a README example when the new registry introduces an authoring pattern users
   would not infer from existing content types.

Use the generated naming rather than adding hand-written aliases: a snake-case type such as
`ascension_perk` becomes `AscensionPerk`, `defineAscensionPerk`, `createAscensionPerks`, and
`src/generated/ascension-perk.ts`.

`defineX` and `patchX` have different evidence requirements. A prefixed new definition cannot
collide with vanilla ids, but a vanilla patch is a whole-object override whose load order and
emission must be verified per registry. `patchX` is an overlay row
(`CONTENT_PATCH_REGISTRIES`), not a consequence of `defineX` existing — do not add
`patchAscensionPerk` merely because `defineAscensionPerk` exists.

## PDXScript parser

Parser work belongs in `packages/pdxscript/`. Read `packages/pdxscript/README.md` and
`packages/pdxscript/GRAMMAR.md` before changing it.

Keep the package syntax-only and game-semantics-free. It preserves order and duplicate keys,
reports repairs to malformed shipped input, and promises semantic rather than byte-identical
round trips. Parser changes should retain the per-claim tests, full-vanilla fixpoint, jomini
differential, and fast-check property gates described in that package.

## Important design boundaries

- Triggers are declarative expression trees. Effects are closures executed once at build time to
  record AST entries.
- Authoring is pure: registry-typed collection factories create content and register it in one
  act, and `buildMod(config, collections, { vanilla? })` folds collections into a `PureMod` value
  that `render`/`write` consume. There is no builder object. Diagnostics are throws or
  `mod.warnings` data — never console output.
- Emission order is a function of the content, never of source position or the order collections
  were passed: content sorts by registry declaration order, then emitted file path, then id;
  event files sort by path with numeric ids inside a file; on-action hook blocks, the
  contribution sink and the patch list sort by name or id. Arrays *inside* a definition
  (prerequisites, event options) are author data and are emitted as written. Moving a definition
  between files or reordering an argument list must not change a byte of output — the
  order-purity test in `tests/pure-api.test.ts` is the standing evidence.
- Runtime effect recording is scope-agnostic; generated interfaces enforce which effects and
  scope transitions are legal.
- Cross-content references should remain branded objects where the generated rules know the
  registry. Use raw strings only for intentional vanilla or third-party references supported by
  the API.
- Generated content ids and nested definition ids must use the mod prefix.
- Localization rides with definitions. Preserve duplicate-key checks and the BOM-prefixed
  Stellaris localization output.
- Testing helpers are whitelist-based. Unsupported game semantics should fail loudly rather than
  be guessed.

## Verification

For ordinary SDK changes, run:

```sh
npm run typecheck
npm test
npm run build
```

Also run `npm run codegen` whenever codegen inputs or implementation change, and inspect the
result. Use `npm run example` when changing synthesis behavior or the quickstart example.

Prefer focused Vitest runs while iterating, but finish with the full relevant gates. Snapshot
changes are review evidence: update them only when the serialized output change is intentional,
then inspect their contents rather than accepting them blindly.
