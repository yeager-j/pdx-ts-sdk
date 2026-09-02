# @pdx-ts/codegen-cwt

`@pdx-ts/codegen-cwt` is the private, rules-derived generator for
`@pdx-ts/sdk`. It reads a pinned cwtools config fork and version-matched Stellaris
documentation dumps, reconciles their claims, applies reviewed policy and
overlays, and emits the committed TypeScript surface under
`packages/sdk/src/generated/`.

The package is a workspace tool and is never published.

## Inputs and outputs

The generator has two independent source families in the
`vendor/cwtools-stellaris-config/` Git submodule.
Its `config/` directory contributes content declarations,
field shapes, cardinality, references, enum values, documentation, triggers,
effects, scope links, and scope legality.

Its `script-docs/` directory supplies a second opinion on
trigger and effect names and legal scopes, plus modifier names and categories.

Generated output includes:

- content `Def` and `Item` types
- capability methods such as `mod.technology`
- runtime field and registry descriptors
- triggers, effects, and scope links
- events and fire methods
- on-action references
- modifiers and modifier path navigation
- enums and value sets
- script-reference metadata
- checked `vanilla.*` helper types

The output is committed because it is the SDK's public API, not a disposable
build artifact.

The submodule points to
[`yeager-j/cwtools-stellaris-config`](https://github.com/yeager-j/cwtools-stellaris-config),
our fork of the config used by Paradox Language Support. The fork is the source
of truth for SDK rule fixes and retains versioned documentation dumps. Clone it
with the rest of the repository:

```bash
git submodule update --init
```

To update it, run:

```bash
git submodule update --remote -- vendor/cwtools-stellaris-config
```

Review the fork's commit range, then run codegen and all verification gates.
The superproject's gitlink is the version pin; do not copy files out of the
fork or edit the detached submodule checkout.

This package does not enumerate the ids defined by a game installation. That is
the separate responsibility of
[@pdx-ts/codegen-vanilla](../codegen-vanilla/README.md).

## Running code generation

Run from the repository root with Node.js 24:

```bash
npm run codegen
npm run codegen:check
```

`codegen` rewrites `packages/sdk/src/generated/` and prints a report.
`codegen:check` regenerates and then runs `git diff --exit-code` against that
directory. It is the CI drift gate when generated output is expected to match
the committed tree.

After an intentional generator change, run `npm run codegen`, read the full
report, and inspect every generated diff. Commit source and generated output
together. Do not hand-edit generated headers, formatting, names, or files.

## Pipeline

```text
CWT rule files                  Stellaris documentation dumps
       |                                      |
       v                                      v
   CWT parser                              log parsers
       |                                      |
       +------------> reconciliation <--------+
                           |
                     drift baseline
                           |
                    semantic lowering
                           |
              content policy and overlays
                           |
                    TypeScript emitters
                           |
                 generated-file protocol
                           |
              programmatic Prettier output
                           |
              SDK generated files + report
```

Parsing records what the sources say. Lowering converts those declarations to
the supported authoring model. Emitters project that model into TypeScript and
runtime descriptors. This separation keeps source interpretation out of the
SDK runtime and formatting concerns out of semantic lowering.

## Reconciliation and drift

CWT and the documentation dumps overlap on names and scopes but do not always
agree. Reconciliation compares both sources before emission:

- names found in only one source
- scopes found in only one source
- incompatible scope sets

Known differences live in `src/drift-baseline.json`. Generation fails when the
observed sets move. The baseline is evidence of a reviewed disagreement, not a
filter for hiding current output.

Use `npm run codegen -- --rebaseline` only after reviewing and accepting the new
source relationship. Where scope sources conflict, current policy gives the CWT
rules authority because they track rule-level scope renames that documentation
dumps can lag.

## Content manifest

`src/policy/manifest.ts` is the explicit allowlist of SDK content registries. A
CWT `type[...]` declaration does not become public merely because the parser can
read it. A manifest row grants the registry a capability method, public
definition types, layout, generated descriptors, and reporting.

Adding a registry is therefore a public API change. It should be data driven:
add a manifest row and evidence, then let the generic lowerers and emitters
handle it. Do not add a registry-specific branch to the generic emitter when a
declarative row can express the difference.

Patch methods have a separate allowlist. `mod.x` does not imply `mod.patchX`
because whole-object override behavior and winning filename rules need evidence
for each registry.

## Policies and overlays

Policy files make reviewed choices where the source data alone does not select
an authoring surface. They cover registry exposure, triggers, effects,
modifiers, event fields, swaps, and known script gaps.

`src/overlay/` contains every deliberate departure from a mechanical reading of
the rules. Typical rows describe:

- required localization that the raw declaration marks optional
- a more useful authored form
- corrected field shape or scope with evidence
- content identity and minting behavior
- patch-specific widening
- a hand-written graft where the generic model cannot express the API

Overlay rows are audited for staleness. Keep exceptions centralized here rather
than embedding one-off conditions in an emitter.

## Lowering and descriptors

Lowering decides each field's shape, arity, interior, valid scopes, references,
and authored form. The selected form is emitted into runtime descriptors so the
SDK writer reads the decision instead of reconstructing CWT semantics.

The distinction matters for repeated and spliced structures. A generated
TypeScript property may admit a scalar, list, trigger, closure, or nested block,
while the runtime descriptor still records exactly how that value becomes
ordered PDXScript entries.

Unsupported, omitted, or collapsed declarations remain visible in the report.
Corpus conformance tracks generated fields that shipped definitions have not
used. Filters must not make either evidence stream disappear.

## Reports and generated files

The report covers generated-output counts and selected losses. Review at least:

- skipped declarations and their reasons
- unrepresentable rule shapes
- collapsed localization aliases
- generated registry and script counts

Source drift fails before the normal report is built, so review that diagnostic
separately when reconciliation stops generation. Stale overlay audits also fail
before report construction and need separate review.

Generated files follow a shared protocol for headers, import tracking, symbol
allocation, ordering, and formatting. Emitters return complete files rather
than appending ad hoc text to existing output.

## Common change workflows

Repository procedures cover the changes that cross several evidence layers:

- `.agents/skills/add-registry/SKILL.md` adds a new content registry.
- `.agents/skills/add-patch-registry/SKILL.md` adds a verified whole-object patch
  surface.
- `.agents/skills/close-corpus-gap/SKILL.md` lowers a game-written field the SDK
  cannot yet author.

Each workflow connects the manifest or overlay change with generated output,
type-level evidence, emitted PDXScript, and corpus observations. The root
[AGENTS.md](../../AGENTS.md) states the general codegen discipline.

## Implementation

The generator is strict TypeScript and ESM. It uses its own CWT lexer and
parser, parsers for the documentation dump formats, `@pdx-ts/pdxscript` for
corpus files, and programmatic Prettier for generated TypeScript.

```text
src/
|-- index.ts             pipeline coordinator and filesystem shell
|-- cwt/                 CWT lexer, parser, models, and rule loader
|-- logs/                Stellaris documentation-dump parsers
|-- reconcile/           source joining and drift-baseline checks
|-- policy/              registry allowlist and reviewed generation policy
|-- overlay/             audited departures from raw rules
|-- lower/               source declarations to supported authoring model
|-- render/              code writer, imports, symbols, and file protocol
|-- emit/                output-family emitters
|-- corpus/              installed-definition observations and conformance
|-- report.ts            visible pipeline accounting
`-- drift-baseline.json  accepted two-source differences
```

Filesystem access stays near the shell. Parsers, reconciliation, lowering, and
emitters are testable over in-memory data.

## Verification

Package tests exercise the CWT parser, documentation parsers, reconciliation,
overlay audits, lowerers, and emitters against the pinned inputs. Artifact-level
tests live with the SDK output under `packages/sdk/tests/codegen/`.

The complete change gate is:

```bash
npm run codegen
npm run typecheck
npm test
npm run build
```

Review generated text as public API. Corpus conformance is an observed lower
bound based on shipped Stellaris definitions, not proof that every legal game
shape has appeared in vanilla.

See the [CWT Codegen glossary](./CONTEXT.md) for the terms used by this package.
