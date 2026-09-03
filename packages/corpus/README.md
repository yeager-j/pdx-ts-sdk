# @pdx-ts/corpus

`@pdx-ts/corpus` holds the install-derived evidence about the authoring surface
that `@pdx-ts/codegen-cwt` generates into `@pdx-ts/sdk`. It is a private
workspace tool. The SDK never imports it, and it is never published.

The package has five parts:

- `fixtures/` — the committed fixtures: what every shipped definition of each
  manifested registry writes, recorded as observations per registry
  (`<registry>.json`), and how often vanilla writes each declared script key
  (`script-usage.json`).
- `src/extract.ts` and `src/check.ts` — the install-gated commands that write
  the fixtures and detect drift from them.
- `src/gaps.ts` and `src/observations.ts` — the ledgers. A gap row acknowledges
  a field the game writes that no author can produce yet, with a reason and a
  Linear issue. An observation row classifies a legal shape difference.
- `tests/conformance.test.ts` — the hermetic conformance gate. It measures the
  emitted interfaces against the fixture and never needs a game.
- `src/coverage/` and `src/coverage-report.ts` — the syntax coverage report.
  It joins the emitters' accounting, the ledgers, and the fixtures under one
  definition and prints how much of the declared syntax the SDK can author.

## Commands

Run every command from the repository root.

```bash
npm run corpus:extract   # rewrite fixtures/ from the local Stellaris install
npm run corpus:check     # re-extract into a temp dir and report drift
npm run coverage         # print the syntax coverage report
npm test                 # runs the conformance gate with every other test
```

`corpus:extract` and `corpus:check` need an installed game and do not run in
CI. Re-extract when the game patches, when the observation logic changes, or
when the rules change the declared script vocabulary, then review the fixture
diff and commit it with the change that produced it. `corpus:check` diffs
`script-usage.json` with the registry fixtures. The conformance gate runs in
plain `npm test` because it reads the fixture, not an install.

## The coverage report

`npm run coverage` reads the vendored rules and the committed fixtures, never
an install, and prints one table and one remainder list. It is not a gate: it
changes nothing and fails only when a fixture is missing or stale.

The table has one row per surface (triggers, effects, modifiers, scope links,
event fields, and each registry), a `registries (all)` row, and an `overall`
row. Each row gives the share of sites an author can write against two
denominators: `declared` counts sites, `used` weights each site by how often
vanilla writes it. The remainder lists every site an author cannot write, with
its class, its reason or Linear issue, and its vanilla usage count. See the
[CWT Codegen glossary](../codegen-cwt/CONTEXT.md) for **Site**, **Syntax
coverage**, and **Usage**.

`tests/coverage.test.ts` asserts that the report's rows reconcile with the
script gap ledger, `gaps.ts`, `CONTENT_DECLINED_FIELDS`, and the form rows of
`observations.ts`.

## Licensing boundary

The fixture is derived data of the same class as
`packages/codegen-cwt/src/drift-baseline.json`. It carries observations only:
field names, forms, counts, ids, and content hashes. It never carries script
bodies and never carries localized text. The closest call is the capped sample
of bare scalar tokens per field (`yes`, `large`, a referenced id), kept to
check closed unions. `script-usage.json` carries counts of key text only,
filtered to the names the rules declare.
