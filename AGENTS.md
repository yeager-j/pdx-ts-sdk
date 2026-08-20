# Repository guidance

## Project purpose

`@pdx-ts/sdk` is a TypeScript SDK for generating Stellaris mods. Mod authors run ordinary
TypeScript at build time; the SDK records typed triggers, effects, content definitions, and file
layout, then serializes a launcher-ready mod in PDXScript.

The repository root is a private npm-workspaces root: it owns the shared inputs (`vendor/`,
`fixtures/`, `examples/`, the tsconfigs and the vitest config) and no source of its own.
Every package, generators included, is a workspace member: `packages/sdk` is the Stellaris-facing
SDK (`@pdx-ts/sdk`); `packages/pdxscript` is the standalone PDXScript parser/serializer used
underneath it; `packages/codegen-cwt` and `packages/codegen-vanilla` are the two private generators;
`packages/stellaris-ids` is the install-derived identifier package. Every gate below runs from
the repository root.

[CONTEXT-MAP.md](CONTEXT-MAP.md) is the vocabulary authority: it names this repo's six
bounded contexts and links each one's glossary. When a word here is load-bearing, that is
where it is defined — this file states process, not meaning. Decisions that would otherwise
look arbitrary are recorded in `docs/adr/`.

Read `README.md` before making architectural changes. `docs/` holds only the ADRs and
proposals that are not yet implemented — once something ships, the code and its gates are
the record, so a doc describing shipped behavior is deleted rather than updated.

`packages/docs-site` is the one exception, and only because it is not the same kind of
thing: it is a product surface for mod authors, not internal record. Describing shipped
behavior is its whole job, so the delete-when-shipped rule does not reach it. `docs/` keeps
that rule unchanged.

The exception costs something, so it is paid for rather than waived. Examples do not drift
because they are gated: every `<name>.example.ts` under `packages/docs-site/content/docs/`
typechecks against the workspace SDK, compiles through the Fold, and renders during
`npm run docs:build`, which CI runs against a deleted `packages/*/dist` so the site resolves
the SDK's sources rather than compiled output. Prose is defended by structure instead — keep
it thin and let the compiled example carry the meaning. A page section that restates behavior
in prose is a review smell: it is the part no gate can hold to the code.

## Repository conventions

- Use npm; `package-lock.json` is the lockfile.
- Keep the project strict TypeScript and ESM. Internal relative imports include the `.ts`
  extension.
- Run Prettier for touched TypeScript files. The pre-commit hook formats staged TypeScript, but do
  not rely on the hook as the first formatting pass.
- The package is private and has not been released, so breaking changes are allowed and encouraged over band-aids or migrations.
- Prefer data-driven additions to registry-specific branches. Shared runtime machinery belongs in
  `packages/sdk/src/`; source interpretation and emitted TypeScript belong in
  `packages/codegen-cwt/src/`;
  deliberate exceptions belong in the audited overlay.
- Keep changes focused. Do not update vendored game data, drift baselines, snapshots, or generated
  output unless the task requires the corresponding source change.

## Code generation

`packages/sdk/src/generated/` is committed generator output. Most files come from
`packages/codegen-cwt/` (`@pdx-ts/codegen-cwt`); `verified-build.ts` comes from the hermetic
`@pdx-ts/codegen-vanilla` verified-build projection. Never edit generated files by hand.

The main inputs are:

- `vendor/cwtools-stellaris-config/` for vendored CWT rules and Stellaris documentation dumps
- `packages/codegen-cwt/src/content-manifest.ts` for the content registries intentionally exposed by
  the SDK
- `packages/codegen-cwt/src/overlay.ts` for reviewed departures from a mechanical reading of the rules
- emitters and parsers under `packages/codegen-cwt/src/`

Use:

```sh
npm run codegen
```

After generation:

- Read the codegen report. Unsupported, omitted, or collapsed fields must remain visible; do not
  hide them with filters.
- Inspect the complete `packages/sdk/src/generated/` diff as a public-API change.
- Commit generated output together with the source change that produced it.
- Keep generated headers and formatting generator-owned.

`npm run codegen:check` regenerates and then runs `git diff --exit-code packages/sdk/src/generated`.
It is the CI-style drift gate. During an intentional uncommitted codegen change, use
`npm run codegen` and inspect the diff; the check will correctly fail until the generated diff is
part of the comparison baseline (for example, staged or committed).

Do not run `npm run codegen -- --rebaseline` reflexively. Rebaseline
`packages/codegen-cwt/src/drift-baseline.json` only after reviewing and intentionally accepting drift between
the vendored rule sources and documentation dumps.

## Vanilla identifier package

`packages/stellaris-ids` (`@pdx-ts/stellaris-ids`) is a separate, install-derived package
carrying every identifier vanilla Stellaris defines: content ids, scripted trigger/effect names
with their `$PARAM$` lists, event ids and namespaces, sprite and sound names, resource keys. It is
generated by `@pdx-ts/codegen-vanilla` (`packages/codegen-vanilla`), a generator separate from
`@pdx-ts/codegen-cwt`: install-derived
versus CWT-derived are different sources, with different regeneration triggers and different
failure modes. It is a hard peer dependency
([ADR-0006](docs/adr/0006-stellaris-ids-is-a-hard-dependency.md), reversing the optionality half of
ADR-0003): `@pdx-ts/sdk` imports the five lookup tables in `src/tables.ts` and resolves every
vanilla reference through them (`packages/sdk/src/identifiers/contracts.ts`,
`packages/sdk/src/script/scripted.ts`), so a vanilla reference is checked at compile time or it
does not compile. There is no degraded unchecked-`string` mode and nothing to import in a project
to switch checking on. The SDK's `peerDependencies` range is `*` because the game version is the
project's to choose; projects supply the range below, which `create-stellaris-mod` always emits.

The SDK's own `vanilla.*` namespace (`src/generated/vanilla-refs.ts`, exported as
`export * as vanilla`) is emitted by the existing `@pdx-ts/codegen-cwt`, from `CONTENT_MANIFEST` plus
`VANILLA_REF_EXTRAS` (`packages/codegen-cwt/src/content-manifest.ts`) — it is glue over the separate
package,
not the package itself, and never reads an install.

- `npm run codegen:vanilla` regenerates `packages/stellaris-ids/src` and its `package.json`
  version from a clean, pinned-version install. Read the report it prints (per-registry id counts,
  parameterized scripted trigger/effect counts, inferred-scope shares, binding renames, diagnostics,
  and any licensing-chokepoint rejections — there should be zero of the last). A collapse in the
  inferred-scope share is not a broken build — an unreadable body widens rather than narrowing — but
  it means the emitted types quietly got weaker and the analysis needs a look.
- Review the complete `packages/stellaris-ids/src` diff as a public-API change, the same way a
  `src/generated/` diff is reviewed. Commit the generated output together with the change that
  produced it (a game patch, a generator fix).
- The stamped version is the game version plus a `-r.<n>` revision (`4.4.6-r.1`), never a bare
  game version, because npm can never reuse a version number and this package needs more than one
  publish per game release. Consumers install by the range `>=4.4.6-0 <4.4.6`, which
  `create-stellaris-mod` emits and the SDK's mismatch message prints. Regenerating deliberately
  does _not_ move the revision — that would fail `codegen:vanilla:check`, which diffs
  `package.json` — so bump `-r.<n>` by hand when publishing a second time against one game build.
  `packages/stellaris-ids/PROVENANCE.md` ("Revisions") is the authority.
- Licensing boundary, enforced by the generator itself rather than left to convention: this package
  emits ids, definition names, scripted trigger/effect names and their `$PARAM$` lists, event
  ids/namespaces, and the scope each scripted definition is legal in — never script bodies,
  localized text, descriptions, or asset data. See `packages/stellaris-ids/PROVENANCE.md`.
- The scopes are the one thing derived from a body rather than read off one, so the boundary there
  is worth stating: `infer-scopes.ts` intersects the scopes cwtools' rules already declare for the
  keys a body evaluates and keeps a `scopes.cwt` scope name; the body reaches no emitter. The
  bindings are also the package's only runtime — `src/triggers.ts` and `src/effects.ts`, one
  `scriptedTrigger`/`scriptedEffect` call per definition — and `licensing.test.ts` pins that shape.
  The SDK's side is `packages/sdk/src/script/scripted.ts`, which imports the `VanillaScriptedTriggers` /
  `VanillaScriptedEffects` tables and supplies the hand-declared escape hatch.
- `packages/codegen-vanilla/tests/callsites.test.ts` is the standing falsification gate for the
  inference: it measures the emitted scopes against ~4,800 real vanilla call sites and fails on any
  contradiction. Install-gated, so run it before committing a regeneration.
- `npm run codegen:vanilla:check` is maintainer-local, inherently install-gated — CI has no
  Stellaris install to regenerate against, so this check cannot run there and is never made to pass
  vacuously in its absence.

## Adding a registry, adding a patch registry, closing a corpus gap

All three are recipes rather than ground rules, so they live as skills and load
only when the task fires them:

- `add-registry` (`.claude/skills/add-registry/`) — a new content registry:
  `mod.<type>`, its `Def`/`Item` types, the overlay rows, and the four kinds of
  evidence, from one manifest row.
- `add-patch-registry` (`.claude/skills/add-patch-registry/`) — whole-object
  patching for a registry: the oracle-backed rule row, the parse row, and the
  `CONTENT_PATCH_REGISTRIES` overlay row that generates the whole `patchX`
  surface.
- `close-corpus-gap` (`.claude/skills/close-corpus-gap/`) — lowering a field
  the game writes and no author can produce, retiring its `corpus-gaps.ts`
  row: measuring the real shape against the install before encoding it, and
  where the generic model absorbs it.

`patchX` is not a consequence of `mod.x` existing: a patch is a whole-object
override whose load order and emission are verified per registry, and the
overlay row is the permission. Do not add `mod.patchAscensionPerk` merely
because `mod.ascensionPerk` exists.

## PDXScript parser

Parser work belongs in `packages/pdxscript/`. Read `packages/pdxscript/README.md` and
`packages/pdxscript/GRAMMAR.md` before changing it.

Keep the package syntax-only and game-semantics-free. It preserves order and duplicate keys,
reports repairs to malformed shipped input, and promises semantic rather than byte-identical
round trips. Parser changes should retain the per-claim tests, full-vanilla fixpoint, jomini
differential, and fast-check property gates described in that package.

## Important design boundaries

The decisions a reader would otherwise wonder about are recorded as ADRs, and the words
are defined in the glossaries. Both are short:

- [ADR-0001](docs/adr/0001-triggers-are-trees-effects-are-closures.md) — triggers are
  declarative trees, effects are build-time closures, and runtime effect recording is
  scope-agnostic (the generated interfaces enforce legality, not the recorder).
- [ADR-0002](docs/adr/0002-pdxscript-is-syntax-only.md) — the parser knows no game semantics.
- [ADR-0003](docs/adr/0003-install-derived-split-from-rules-derived.md) — install-derived
  identifiers are a separate package and generator from the rules-derived surface.
- [ADR-0004](docs/adr/0004-no-mutable-builder.md) — there is no mutable builder and no
  alternate public authoring surface.
- [ADR-0005](docs/adr/0005-emission-order-is-content-not-position.md) — emission order is a
  function of content, never of source position.
- [ADR-0006](docs/adr/0006-stellaris-ids-is-a-hard-dependency.md) — `@pdx-ts/stellaris-ids` is a
  hard dependency; the unchecked degraded mode is removed.

What remains here are working rules rather than definitions:

- Diagnostics are throws or `mod.warnings` data — never console output.
- `discoverFeatures(dir)` (`packages/sdk/src/authoring/discover.ts`) is the impure shell, and
  it reads only a feature module's named `feature` export. Source layout is not identity.
- Cross-content references should remain branded objects where the generated rules know the
  registry. Use raw strings only for intentional vanilla or third-party references supported by
  the API.
- Generated content ids and nested definition ids must use the mod prefix.
- Preserve the localization duplicate-key checks and the BOM-prefixed Stellaris localization
  output.
- Unsupported game semantics should fail loudly rather than be guessed.

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

## Filing Linear Tickets

When filing Linear tickets, make sure to include Labels, a Priority, and an Estimate (T-shirt sizing). Fetch the
available Labels from Linear before filing. Use AskUserQuestion for Priority and Estimate, providing a recommendation.