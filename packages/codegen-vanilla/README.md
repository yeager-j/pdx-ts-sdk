# @pdx-ts/codegen-vanilla

The install-derived code generator. It reads a real Stellaris installation and
emits [@pdx-ts/stellaris-ids](../stellaris-ids/README.md) — per-registry
literal-union types of every identifier vanilla defines, scripted trigger and
effect signatures, exact event-reference types, and navigable id tries — as
committed, types-only TypeScript. Private workspace package; never published
(its _output_ package is).

Its sibling [@pdx-ts/codegen-cwt](../codegen-cwt/README.md) is rules-derived:
it knows what _fields_ exist. This package knows what _ids_ exist. This one
regenerates on the game's release cadence, the other when the vendored rules
are bumped.

## Usage

```bash
npm run codegen:vanilla        # regenerate packages/stellaris-ids/src/
npm run codegen:vanilla:check  # regenerate, then git diff --exit-code the output
```

Both run from the repository root and need an installed copy of Stellaris
(`STELLARIS_PATH` overrides the platform Steam default). The game version is
read from the install's `launcher-settings.json` and stamped as the output
package's npm version — the pin is generator-written, never hand-edited, and
generation aborts loudly if the version is missing or not `major.minor.patch`.

Read the report: per-registry id counts, event totals by scope and kind,
namespace and event-file counts, parameterized scripted-name tallies, trie
bucket statistics, parser diagnostics, and the licensing gate's rejection
count (which must be zero). Review the output diff as a public-API change and
commit it with the change that produced it.

Because CI has no game install, `codegen:vanilla:check` is a maintainer-local
gate. The committed output is kept trustworthy by the install-gated
conformance test in `packages/stellaris-ids/tests/` (regenerates in memory
and compares, wherever an install exists) plus hermetic generator tests here
against the shared fixture install.

## What it reads, what it emits

For each registry in the shared content manifest — plus scripted triggers and
effects, sounds, sprites, and resources — the generator resolves the
registry's install directory from the CWT rules, parses every file with
`@pdx-ts/pdxscript` (`.txt`, `.asset`, and `.gfx` are all the same syntax),
and extracts identifiers:

- **Registry ids**: top-level keys, or name-field values for keyword-keyed
  registries, including `skip_root_key` and non-recursive `path_strict`
  handling.
- **Scripted triggers/effects**: definition names plus their `$PARAM$` lists,
  with optionality inferred from `$X|default$` defaults and `[[FLAG]]`
  blocks. Parameter names only — never default values.
- **Events**: top-level event definitions, keyed by the namespace and local id
  derived from each definition's full `id` field. The file's `namespace =`
  declaration is not authoritative and may be absent or wrong. Missing,
  malformed, and duplicate full ids stop generation. The event key selects its
  subtype and canonical scope through the same `events.cwt` mapping used by the
  SDK generator; generic `event = {}` definitions remain scopeless. Numeric
  local ids gain the collision-free navigation key `$<id>` (`story.5` becomes
  `vanilla.event.story.$5`); `$` is illegal in the source event id and is
  removed only when the SDK proxy reconstructs the exact full id.
- **Oversized registries** (more than ~2,000 ids) additionally get a
  navigable trie keyed by the vanilla file each id is defined in: bucket
  names come from file stems (static modifiers strip their `NN_` prefix and
  `static_modifiers` token; sounds nest by directory), and the leaf key is
  the verbatim id. Buckets are navigation only; reconstruction is `.id` =
  last path segment.

The licensing boundary is enforced at a single chokepoint: every string that
reaches emitted output passes `assertVanillaIdentifier`, which rejects
anything shaped like script bodies or localized text. The generator emits
identifiers, names, and parameter lists — never bodies, defaults, loc
strings, or asset data. A negative control in the tests proves the gate goes
red.

## Where stuff lives

```
src/
├── index.ts        impure shell: locate install, read version, write, report
├── build-facts.ts  versioned evidence identity + selected definitions/scopes/events
├── generate.ts     the pure core — generateVanillaPackage({ installRoot, ... })
├── manifest.ts     registry rows (derived from codegen-cwt's manifest + extras)
├── resolve.ts      CWT-rule path resolution per registry
├── read-ids.ts     recursive id extraction with per-file provenance
├── read-events.ts  strict full-id event extraction and namespace derivation
├── read-scripted.ts  scripted trigger/effect names and $PARAM$ lists
├── trie.ts         file-bucketed trie construction (BucketLayout per registry)
├── emit-events.ts  one types-only leaf map per event namespace
├── emit.ts         emitters + the licensing chokepoint (assertVanillaIdentifier)
└── format.ts       the one authority for on-disk bytes (programmatic Prettier)
tests/              hermetic generator tests against fixtures/fake-install,
                    licensing gate + negative control, determinism
```

`build-facts.ts` resolves one versioned, in-memory `VanillaBuildFacts` value
before emission: selected scripted-definition identities, inferred scopes and
diagnostics, canonical CWT event kinds, evidence versions, and SHA-256 evidence
hashes. Bodies remain inside that private build value and never reach an
emitter. Generation rejects a game whose `major.minor` compatibility version
does not match the selected script-docs snapshot.

`generate.ts` remains a pure function of its explicit roots and versions:
pointing it at a different root (a user's install, mods included) is the
intended seam for future consumer-side generation, with no rewrite of the
pipeline.

## Testing

Hermetic tests run everywhere against the shared `fixtures/fake-install/`
tree (plus a poisoned fixture proving the licensing gate rejects): bucket
derivation, dir-nesting, `$PARAM$` extraction cases, verbatim dotted leaf
keys, exact scoped/observer/scopeless event types, strict malformed and
duplicate event failures, emitted-file-set pinning, and byte-determinism across runs. The
install-gated committed-output conformance test lives with the artifact it
gates, in `packages/stellaris-ids/tests/`.

## Vocabulary

This package is the [Vanilla Extraction](./CONTEXT.md) context. Its glossary is the authority
for what these words mean; the [context map](../../CONTEXT-MAP.md) shows how they change
at the boundaries with the other contexts.
