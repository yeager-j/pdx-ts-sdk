# @pdx-ts/codegen-vanilla

`@pdx-ts/codegen-vanilla` is the private, install-derived generator for
[@pdx-ts/stellaris-ids](../stellaris-ids/README.md). It reads a real Stellaris
installation and emits version-pinned TypeScript containing vanilla identifiers,
events, scripted-definition signatures, selected runtime inventories, and
navigable tries.

The generator is a workspace tool and is never published. Its generated package
is public.

## Requirements and install discovery

Run the generator from the repository root with Node.js 24 and a clean copy of
the target Stellaris build.

The CLI searches the platform's normal Steam installation locations. Set
`STELLARIS_PATH` when the game is elsewhere:

```bash
STELLARIS_PATH="/path/to/Stellaris" npm run codegen:vanilla
```

The selected root must contain `launcher-settings.json`. Its
`rawVersion`/game-version data must produce an exact `major.minor.patch`
coordinate. Generation also checks that the game's `major.minor` compatibility
line matches the selected documentation evidence.

## Running the generator

```bash
npm run codegen:vanilla
npm run codegen:vanilla:check
```

`codegen:vanilla` writes `packages/stellaris-ids/src/` and stamps the output
package's game-version coordinate. `codegen:vanilla:check` regenerates, then
checks `src/` and `package.json` for drift.

Both commands require the commercial game installation and are maintainer-local
gates. CI uses hermetic fixture tests instead.

Read the report and inspect the complete generated diff. The report covers
registry id counts, event scopes and kinds, namespace and file counts,
scripted-definition parameters, inferred scopes, trie buckets, parser
diagnostics, and licensing rejections.

## Inputs and outputs

The generator combines installed Stellaris files, the CWT content manifest and
rules, versioned Stellaris documentation evidence, and generator policy. The
installation supplies actual ids, events, scripted definitions, paths,
localization keys, and selected runtime inventories. CWT supplies registry
directories, extraction strategy, event kinds, fields, and scope facts. Policy
selects outputs and large-registry layouts while enforcing licensing constraints.

The output package includes literal-union registry ids, event maps and refs,
scripted trigger/effect parameter tables and bindings, file-bucketed tries,
vanilla path data, and runtime sets used by SDK membership checks.

It never emits script bodies, localized values, descriptions, default parameter
values, or Asset bytes.

## Pipeline

```text
locate installation and read version
  -> resolve registry paths through CWT rules
  -> parse PDXScript files
  -> extract ids, events, parameters, paths, and runtime inventories
  -> infer scripted-definition scopes
  -> assemble versioned VanillaBuildFacts
  -> pass every emitted install string through the licensing chokepoint
  -> build unions, maps, bindings, and tries
  -> format generated TypeScript
  -> write stellaris-ids and print the report
```

The CLI shell owns install discovery, file writes, package stamping, and report
printing. `generateVanillaPackage` is the pure core and accepts explicit install,
configuration, evidence, and version roots.

## Registry identifiers

Registry rows are derived from the shared CWT content manifest plus explicit
identifier-only extras. The CWT declaration determines where the game stores a
registry and how its identity is written.

Extraction supports top-level-key registries, keyword-keyed definitions whose id
lives in a name field, `skip_root_key`, strict paths, nested sound directories,
and additional graphics formats such as `.asset` and `.gfx`. All use the same
PDXScript syntax parser.

Every retained id keeps source-file provenance during generation. Provenance
drives trie bucketing and identifies the selected source file.

## Events

Event extraction reads top-level event definitions and derives identity from
each definition's full `id` field. A file-level `namespace =` statement is not
trusted because shipped files may omit it or disagree with their definitions.

The event key selects its canonical kind and scope through the same CWT event
mapping used by SDK generation. Generic `event = {}` definitions remain
scopeless. Missing, malformed, or duplicate full ids stop generation.

Numeric local ids gain `$` only as a TypeScript navigation key. The emitted leaf
still carries the exact full event id.

## Scripted definitions and scope inference

For scripted triggers and effects, the generator extracts definition names and
`$PARAM$` names. `$X|default$` marks an optional parameter, and `[[FLAG]]`
regions contribute conditional parameter names. Default values and bodies do
not reach an emitter.

Scope inference reads a body only inside the private build stage. It finds
rule-known keys evaluated by that body and intersects the scopes cwtools
declares for those keys. Caller-relative navigation such as `this`, `root`,
`from`, and `prev` does not narrow the result by itself.

An unreadable or unconstrained body widens to a universal scope rather than
inventing a narrow contract. The report makes inferred-scope coverage visible;
a sudden widening may weaken the public types even when generation still
succeeds.

Install-gated call-site tests compare emitted scopes with direct vanilla uses in
known event scopes and fail on contradictions.

## Large-registry tries

Registries above the configured size threshold receive navigable tries in
addition to checked ids. Buckets usually come from source-file stems; static
modifiers strip conventional numeric prefixes, while sounds preserve useful
directory nesting.

Bucket names organize completion and do not alter identifiers. Trie leaves keep
the verbatim id, including dots and other legal characters.

## Licensing chokepoint

Every install-derived string literal that reaches generated output passes the
appropriate licensing chokepoint. `assertVanillaIdentifier` accepts
identifier-shaped material, while `assertVanillaPath` validates emitted paths;
both reject content outside their allowed shape.

This is an enforced architecture boundary, not a review convention. A negative
control in the test suite deliberately attempts to emit forbidden content and
must fail. Bodies used for scope inference remain inside `VanillaBuildFacts` and
cannot reach an emitter.

The resulting package carries game identities and derived type facts without
redistributing game implementation or presentation content.

## Versioning and release cadence

The generated package version uses `<game-version>-r.<revision>`, for example
`4.4.6-r.3`. The generator writes the game coordinate. Maintainers increment the
revision when publishing another generator result for the same game build,
because npm versions cannot be reused.

The generator runs when Stellaris changes or when extraction logic changes. The
sibling CWT generator runs when vendored rules or SDK generation policy change.
Keeping them separate prevents a game update from rewriting the field model and
prevents a rules update from pretending to be a new vanilla id set.

## Implementation

The package uses strict TypeScript and ESM, `@pdx-ts/pdxscript` for game files,
CWT path metadata from `@pdx-ts/codegen-cwt`, SDK installation utilities, and
programmatic Prettier for output.

```text
src/
|-- index.ts          impure CLI shell
|-- generate.ts       pure generation core
|-- build-facts.ts    versioned in-memory evidence and extracted facts
|-- manifest.ts       selected registry rows and extras
|-- resolve.ts        CWT registry-path resolution
|-- read-ids.ts       identifier extraction with provenance
|-- read-events.ts    strict full-id event extraction
|-- read-scripted.ts  names and parameter lists
|-- read-complex-enums.ts generated enum-member extraction
|-- read-localization.ts  localization keys without localized values
|-- infer-scopes.ts   conservative scripted scope inference
|-- callsites.ts      vanilla call-site observations for scope checks
|-- trie.ts           bucket and trie construction
|-- emit-events.ts    event namespace outputs
|-- emit.ts           output families and licensing chokepoint
|-- format.ts         generated-byte authority
|-- verified-build.ts accepted verified-build facts
`-- verified-build-projection.ts writes those facts for SDK consumers
```

The pure core is the seam for fixture tests and possible future consumer-side
generation from an explicit root. It does not depend on global install
discovery.

## Verification

Hermetic tests run against `fixtures/fake-install/` and cover extraction,
version checks, bucket layouts, nested directories, parameter forms, event
scope and kind, duplicate failures, licensing, file sets, and deterministic
bytes.

The generated artifact has an install-gated conformance test under
`packages/stellaris-ids/tests/`. Where the matching real installation exists,
it regenerates in memory and compares the result with committed output.

Before committing a regeneration, run:

```bash
npm run codegen:vanilla
npm run typecheck
npm test
npm run build
```

Review the package version, report, inferred-scope changes, and every generated
file. See the [Vanilla Extraction glossary](./CONTEXT.md) for this pipeline's
terms.
