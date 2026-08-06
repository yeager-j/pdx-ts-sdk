---
name: add-patch-registry
description: Make a registry patchable — mod.patch<Type>, whole-object overrides of vanilla definitions with a provably-winning filename. Use when adding patchX for a registry, when a mod needs to override a vanilla definition in a registry that has no patch surface, or when upgrading an assumed/refused rule-table cell toward patchability.
---

# Adding a patch registry

A patch registry is an overlay row plus the evidence behind it: the row is the
permission, and regeneration produces the entire surface — `XPatch`,
`PatchedX`, `XPatchItem`, `mod.patchX` — with zero emitter changes. Everything
below exists to earn that row. The one step no code can supply is the oracle
evidence.

## Preconditions (check before any step)

- The registry has a `CONTENT_MANIFEST` row and a generated descriptor
  (`packages/sdk/src/generated/content-registry.ts`). Without one there is
  nothing to derive the patch surface from — run the `add-registry` skill
  first.
- The motive is a **vanilla** override. Overriding a third-party mod's
  definition is unsupported: the enumeration is vanilla + this mod only, and
  every emitted patch header says so. That work is parked on the
  consumer-codegen decision (`docs/design/design-consumer-codegen.md`, open
  question 2) — do not try to reach it through a bigger filename.

## Steps

1. **Oracle-backed rule row** in
   `packages/sdk/src/stellaris/vanilla/override-rules.ts`, keyed by the
   manifest spelling (its `dir` derives from the descriptor — a manifest row
   cannot store one). Both cells need evidence: `verified` cites run ids from
   stellaris-docs' `resolver-evaluation.md`; `assumed` needs a named judgment
   with a paper trail; a cell you cannot settle stays `refused` and blocks the
   engine loudly. Oracle runs batch well — one game session can settle several
   registries (r1, r8 each covered more than one) — so calibrate the next few
   candidates together. Done when the `rules.test.ts` shape gates pass: the
   row is in the pinned list, build-pinned, every non-refused cell citing runs.
2. **Parse row**: add the registry to `PARSED_REGISTRIES` and the
   `ParsedRegistries` interface in
   `packages/sdk/src/stellaris/vanilla/view.ts`. Verify `knownSubdirs`
   against a real install — an unknown subdirectory is a loud load error, not
   a guess. If the registry carries nested swap identities, they are a
   `SWAP_IDENTITIES` row in `packages/sdk/src/content/swaps.ts`. Add fixture
   definitions to `packages/sdk/tests/fixtures/vanilla-fixture.ts` and
   `fixtures/fake-install/` exercising the registry's distinctive shapes
   (duals, repeated blocks, triggers). Done when the install-gated load tests
   parse the registry from a real install.
3. **The permission**: add the registry to `CONTENT_PATCH_REGISTRIES`
   (`packages/codegen-cwt/src/overlay.ts`) with a reason citing the rule
   row's evidence, then `npm run codegen`. Done when the row alone produced
   the whole surface — an emitter change means the generic model is wrong;
   fix the model, never fork it per registry. Read the report's patch
   section: every excluded field carries a mechanical reason, and the loc
   members are listed. Review the generated diff as a public-API change.
4. **Evidence**, mirroring the technology/building precedent:
   - `patches.test.ts`: hermetic end-to-end — emitted file-key list, a
     full-file golden under `__snapshots__/patches/`, and full `WinAssertion`
     equality including `beats`.
   - `surface.test.ts`: parse + patch fixpoint over the fixture.
   - `content.test-d.ts`: another registry's parsed definition is rejected by
     this registry's `patchX`, and vice versa.
   - Existing registries' goldens stay byte-identical.
   The derived guards (the patch-set assertion and the export-triple check in
   `content-snapshot.test.ts` and `public-surface.test-d.ts`) pass without
   edits — if one fails, the surface is incomplete, not the guard wrong.

## What rides along free

- **Localization**: renames emit vanilla's slot keys to `localisation/replace/`
  (layer-ordered — no win assertion involved), and minted keys on patched
  members are prefix-derived. Nothing per registry — unless a shape hits the
  one remaining refusal (`repeatedStruct` with nested localisation), in which
  case stop and design rather than hand-carving an exception.
- **`PATCH_WIDENINGS`**: only for an input form vanilla actually writes that
  the descriptors cannot state (the `AnyOf` prerequisites row is the
  precedent), with evidence from shipped bodies.
