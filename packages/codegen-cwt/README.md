# @pdx-ts/codegen-cwt

The rules-derived code generator. It reads the vendored
[cwtools-stellaris-config](../../vendor/cwtools-stellaris-config/VERSION.md)
rules and the game's documentation dumps, and emits the committed TypeScript
surface under `packages/sdk/src/generated/` — trigger and effect interfaces,
the modifier path trie, content definers and field descriptors, event tables,
on-action references, and the `vanilla.*` helper namespace. Private workspace
package; never published.

Its sibling [@pdx-ts/codegen-vanilla](../codegen-vanilla/README.md) is
install-derived: it reads a real Stellaris installation instead of the rules.
The two stay separate because they have different sources, different
regeneration triggers, and different failure modes — this package regenerates
when the vendored rules are bumped, the other when the game updates.

## Usage

```bash
npm run codegen        # regenerate packages/sdk/src/generated/
npm run codegen:check  # regenerate, then git diff --exit-code the output
```

Both run from the repository root. Read the report: every skipped rule,
unrepresentable declaration, and collapsed field is listed with a named
reason; nothing is dropped silently. The generated diff is a public-API
change and is reviewed and committed together with the source change that
produced it. Generated headers, formatting (programmatic Prettier), and file
naming are generator-owned.

## Two sources, joined with a drift gate

- **The `.cwt` rules** give argument shapes — fields, cardinality, enums,
  cross-registry references, doc comments — and scopes.
- **The game's doc dumps** (version-matched to the release the rules target)
  cover what the rule annotations miss and act as an independent second
  opinion on every name and scope.

Names present in one source but not the other, and scopes the two disagree
on, are compared against the committed `src/drift-baseline.json`. Codegen
fails when either set moves rather than emitting a possibly-wrong signature.
Do not rebaseline reflexively: `npm run codegen -- --rebaseline` is for
reviewed, intentionally accepted drift only. Where the sources conflict, the
rules win — they track scope renames the game's own dump lags behind.

## Where stuff lives

```
src/
├── index.ts             the pipeline: load, join, emit, report, drift-check
├── content-manifest.ts  the registry allowlist (adding one is a public-API decision)
├── overlay.ts           barrel for overlay/; every audited departure from a mechanical rules reading
├── overlay/             the rows themselves, split by domain: content.ts (content-type
│                        fields, localisation, patches, registry identity), script.ts
│                        (trigger/effect/modifier lowering), mints.ts (identity-mint shapes)
├── corpus.ts            reads a registry directory of a real install (conformance tests)
├── naming.ts            snake_case → PascalCase/camelCase, doc-comment helpers
├── reconcile.ts         the two-source join and drift comparison
├── drift-baseline.json  committed record of accepted source disagreements
├── cwt/                 lexer, parser, and rule model for .cwt files
├── logs/                parsers for the game's dumps (triggers, modifiers, scopes)
└── emit/                one emitter per output family; shared shape lowering in
                         shape.ts/types.ts; authored-form.ts decides the form
                         each field arm admits (emitted into descriptors, so the
                         SDK runtime reads it instead of recomputing)
tests/                   emitter unit tests that re-run the pipeline in-process
```

Two design rules keep the emitters honest. Additions should be data-driven —
a new registry is a manifest row, not a new emitter or a
`if (type === "...")` branch in the generic writer. And exceptions are
centralized: anything that departs from what the rules mechanically say lives
as a reviewed row in `overlay.ts` (required localization, ergonomic field
widenings, shape/scope corrections with evidence), never inline in an
emitter.

## Testing

Unit tests here (`tests/`) re-run pipeline pieces in-process against the
vendored rules: the cwt parser, the two-source reconciliation, and individual
emitters. The committed _output_ is gated elsewhere, with the artifact it
belongs to: `packages/sdk/tests/codegen/` holds the generated-text snapshot
tests and the corpus-conformance suite that measures every emitted interface
against the committed vanilla-install fixture as an observed lower bound.
`npm run codegen:check`
is the CI-style drift gate for the whole pipeline.

Adding a content registry has a documented procedure — manifest row, report
review, overlay evidence, four kinds of tests — in the repository's
[AGENTS.md](../../AGENTS.md).

## Vocabulary

This package is the [CWT Codegen](./CONTEXT.md) context. Its glossary is the authority
for what these words mean; the [context map](../../CONTEXT-MAP.md) shows how they change
at the boundaries with the other contexts.
