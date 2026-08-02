# @pdx-ts/codegen-vanilla

The install-derived code generator. It reads a real Stellaris installation and
emits [@pdx-ts/stellaris-ids](../stellaris-ids/README.md) — per-registry
literal-union types of every identifier vanilla defines, scripted trigger and
effect signatures, and navigable id tries — as committed, types-only
TypeScript. Private workspace package; never published (its *output* package
is).

Its sibling [@pdx-ts/codegen-cwt](../codegen-cwt/README.md) is rules-derived:
it knows what *fields* exist. This package knows what *ids* exist. This one
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

Read the report: per-registry id counts, parameterized scripted-name tallies,
trie bucket statistics, parser diagnostics, and the licensing gate's
rejection count (which must be zero). Review the output diff as a public-API
change and commit it with the change that produced it.

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
├── generate.ts     the pure core — generateVanillaPackage({ installRoot, ... })
├── manifest.ts     registry rows (derived from codegen-cwt's manifest + extras)
├── resolve.ts      CWT-rule path resolution per registry
├── read-ids.ts     recursive id extraction with per-file provenance
├── read-scripted.ts  scripted trigger/effect names and $PARAM$ lists
├── trie.ts         file-bucketed trie construction (BucketLayout per registry)
├── emit.ts         emitters + the licensing chokepoint (assertVanillaIdentifier)
└── format.ts       the one authority for on-disk bytes (programmatic Prettier)
tests/              hermetic generator tests against fixtures/fake-install,
                    licensing gate + negative control, determinism
```

`generate.ts` is deliberately a pure function of an install root: pointing it
at a different root (a user's install, mods included) is the intended seam
for future consumer-side generation, with no rewrite of the pipeline.

## Testing

Hermetic tests run everywhere against the shared `fixtures/fake-install/`
tree (plus a poisoned fixture proving the licensing gate rejects): bucket
derivation, dir-nesting, `$PARAM$` extraction cases, verbatim dotted leaf
keys, emitted-file-set pinning, and byte-determinism across runs. The
install-gated committed-output conformance test lives with the artifact it
gates, in `packages/stellaris-ids/tests/`.
