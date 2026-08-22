# Vanilla identifier package

`@pdx-ts/sdk` imports the five lookup tables in `src/tables.ts` and resolves every
vanilla reference through them (`packages/sdk/src/identifiers/contracts.ts`,
`packages/sdk/src/script/scripted.ts`), so a vanilla reference is checked at compile time or it
does not compile. There is no degraded unchecked-`string` mode and nothing to import in a project
to switch checking on. The SDK's `peerDependencies` range is `*` because the game version is the
project's to choose; projects supply the range below, which `create-stellaris-mod` always emits.

The SDK's own `vanilla.*` namespace (`src/generated/vanilla-refs.ts`, exported as
`export * as vanilla`) is emitted by the existing `@pdx-ts/codegen-cwt`, from `CONTENT_MANIFEST` plus
`VANILLA_REF_EXTRAS` (`packages/codegen-cwt/src/policy/manifest.ts`) — it is glue over the separate
package, not the package itself, and never reads an install.

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