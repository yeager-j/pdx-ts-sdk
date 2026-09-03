# @pdx-ts/corpus

`@pdx-ts/corpus` holds the install-derived evidence about the authoring surface
that `@pdx-ts/codegen-cwt` generates into `@pdx-ts/sdk`. It is a private
workspace tool. The SDK never imports it, and it is never published.

The package has four parts:

- `fixtures/` — the committed corpus fixture: what every shipped definition of
  each manifested registry writes, recorded as observations per registry.
- `src/extract.ts` and `src/check.ts` — the install-gated commands that write
  the fixture and detect drift from it.
- `src/gaps.ts` and `src/observations.ts` — the ledgers. A gap row acknowledges
  a field the game writes that no author can produce yet, with a reason and a
  Linear issue. An observation row classifies a legal shape difference.
- `tests/conformance.test.ts` — the hermetic conformance gate. It measures the
  emitted interfaces against the fixture and never needs a game.

## Commands

Run every command from the repository root.

```bash
npm run corpus:extract   # rewrite fixtures/ from the local Stellaris install
npm run corpus:check     # re-extract into a temp dir and report drift
npm test                 # runs the conformance gate with every other test
```

`corpus:extract` and `corpus:check` need an installed game and do not run in
CI. Re-extract when the game patches or when the observation logic changes,
then review the fixture diff and commit it with the change that produced it.
The conformance gate runs in plain `npm test` because it reads the fixture, not
an install.

## Licensing boundary

The fixture is derived data of the same class as
`packages/codegen-cwt/src/drift-baseline.json`. It carries observations only:
field names, forms, counts, ids, and content hashes. It never carries script
bodies and never carries localized text. The closest call is the capped sample
of bare scalar tokens per field (`yes`, `large`, a referenced id), kept to
check closed unions.
