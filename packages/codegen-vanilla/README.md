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

Complex-enum unions and the localization key inventory are *exact membership*:
the SDK rejects anything outside them. A reader that cannot read all of its
source therefore records an extraction gap instead of returning a shorter list,
and emission refuses while any gap is open. A short inventory would publish as a
wrong answer rather than as a missing completion, so it is not a warning.

One file is not a gap: one proved unable to hold a member. The install ships
prose under extensions these enums search — `interface/credits.txt` is the
credits, and `complex_enum[scrollbar_type]` searches `interface/` for `.txt` —
and a member of an enum can only come from inside the block its selector names.
A file whose text never contains that identifier cannot contribute one under any
parse, so its unreadability costs that inventory nothing. This is checked per
file, not a list of blessed filenames.

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

The arrow after "assemble" is the seam. `readVanillaFacts` is the impure shell:
it takes an install root and returns one `VanillaBuildFacts` value, and it is
the only step whose result can change without an argument changing.
`emitVanillaPackage` is the pure core: it takes that value and returns files and
a report, reading nothing. `generateVanillaPackage` composes the two for callers
that hold a directory rather than facts.

The CLI shell owns install discovery, file writes, package stamping, and report
printing.

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
`$PARAM$` names. Default values and bodies do not reach an emitter.

Optionality is derived from what the caller's choices do to the body, not read
off any single occurrence. The caller decides which `[[FLAG] ... ]` regions are
active by supplying or omitting each flag; that decides which substitution sites
are reached; and a parameter must be supplied when some reached site would
substitute it with no default. So `$X|10$` in one place and `$X$` in another is
required — the second substitution has nothing to fall back on.

Negation is part of that reading. `[[!FLAG] ... ]` is active when its flag is
*absent*, and vanilla nearly always pairs a region with its negated twin:
`add_random_trait_evopred` writes `[[SPECIES] ... $TAG$ ... ]` beside
`[[!SPECIES] ... $TAG$ ... ]`, so exactly one branch always runs and `TAG` is
required however `SPECIES` is answered. Treating every region as
presence-activated makes that look like a dependency between the two names and
publishes a signature that refuses `{ TAG: "organic" }`.

Where the choices genuinely disagree — a region with no negated twin, so its
parameters are reachable only when its flag is supplied — the emitted type is
the union of the definition's call shapes rather than one object. All 3,275
vanilla 4.4.6 definitions collapse to one flat shape; the report counts any that
do not.

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

Every install-derived string that reaches generated output passes the
appropriate licensing chokepoint. `assertVanillaIdentifier` accepts
identifier-shaped material; `assertVanillaPath` validates emitted paths; and
`assertVanillaModuleStem` validates the text that *names* a generated module.
Each rejects content outside its allowed shape.

The third door exists because module specifiers are not all generator-owned. An
oversized registry's bucket files are named after the install's own files and
directories, and an event namespace file is named after a namespace read out of
a shipped event id. Both are install text, and a stem is one path component
rather than a path: it is a name first, so the identifier rules apply, plus
refusals for separators, drive letters, leading or trailing dots, spaces, the
characters Windows reserves, and the device names Windows reserves — `con`,
`nul`, `com1` and the rest, which the event reader's namespace rule would
otherwise accept and which no file may be called whatever extension follows.
The byte limit is measured against the emitted filename, extension included.

This is an enforced architecture boundary, not a review convention. A negative
control in the test suite deliberately attempts to emit forbidden content and
must fail, including a bucket key and an event namespace that try to escape
their directory. The suite also checks every component of every relative
specifier in the emitted output, that each one names a module the generator
emitted, and that every bare specifier is a package this generator is allowed to
import. Specifiers are read off the `import`/`export` statements rather than
recognised by prefix, because a prefix test answers "does this look like what we
emit today" instead of "is this a specifier". Bodies used for scope inference
remain inside `VanillaBuildFacts` and cannot reach an emitter.

The resulting package carries game identities and derived type facts without
redistributing game implementation or presentation content.

## Versioning and release cadence

The generated package version uses `<game-version>-r.<revision>`, for example
`4.4.6-r.4`. The generator writes the game coordinate. Maintainers increment the
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
|-- generate.ts       reading and emission, composed
|-- emit-package.ts   pure emission over parsed facts
|-- read-facts.ts     impure install reader: versioned evidence and extracted facts
|-- manifest.ts       selected registry rows and extras
|-- resolve.ts        CWT registry-path resolution
|-- read-ids.ts       identifier extraction with provenance
|-- read-events.ts    strict full-id event extraction
|-- read-scripted.ts  names and parameter lists
|-- read-complex-enums.ts generated enum-member extraction
|-- read-localization.ts  localization keys without localized values
|-- extraction-gap.ts what a reader could not read, and the refusal to publish it
|-- infer-scopes.ts   conservative scripted scope inference
|-- callsites.ts      vanilla call-site observations for scope checks
|-- trie.ts           bucket and trie construction
|-- emit-events.ts    event namespace outputs
|-- emit.ts           output families and licensing chokepoint
|-- format.ts         generated-byte authority
|-- verified-build.ts accepted verified-build facts
`-- verified-build-projection.ts writes those facts for SDK consumers
```

The pure core is the seam for policy tests and possible future consumer-side
generation from an explicit root. Policy tests supply facts directly and need no
install; the reader's own tests still need a fixture one, which is the point of
putting the boundary there.

## Verification

Hermetic tests run against `fixtures/fake-install/` and cover extraction,
version checks, bucket layouts, nested directories, parameter forms, event
scope and kind, duplicate failures, licensing, file sets, and deterministic
bytes.

Emission policy is tested against facts built in memory instead, which is what
the pure core is for: trie thresholds, empty registries, and the refusals that
fire when the facts carry no registry or enum a required runtime set names —
refusals a fixture install cannot reach, because one either defines those
registries or fails earlier.

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
