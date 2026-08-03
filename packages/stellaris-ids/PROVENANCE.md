# `@pdx-ts/stellaris-ids` provenance

## What this package is

Every identifier vanilla Stellaris defines — content ids, scripted trigger and
effect names with their `$PARAM$` lists, event ids and namespaces, sprite and
sound names, resource keys — read out of a real, installed copy of the game
and shipped as TypeScript types. `@pdx-ts/sdk` declaration-merges against it
(`import "@pdx-ts/stellaris-ids";`) so a vanilla reference is checked at
compile time instead of degrading to an unchecked string.

The identifier surface is types with zero runtime payload. Two subpaths are the
exception: `./triggers` and `./effects` carry one bound call per scripted
definition, each a single `scriptedTrigger`/`scriptedEffect` call naming the
definition and the scope inferred for it. They are `/*#__PURE__*/`-annotated so
a bundler drops the ones a mod does not import.

## Game version

Generated from Stellaris **4.4.6**.

The npm `version` *is* the game version: `@pdx-ts/codegen-vanilla` stamps
`package.json` with `major.minor.patch` from the installed game's
`launcher-settings.json`, so there is one authority for which build these
identifiers came from. The SDK compares its own install's version against this
package's `package.json` version and refuses to build silently on a mismatch
(`VanillaPackageMismatchError`; `buildMod`'s `acceptGameVersion` is the
deliberate escape).

The 4.4.6 generation read 38 registries and 29,725 ids, plus 1,618 scripted
triggers (86 parameterized) and 1,657 scripted effects (382 parameterized).
`sprite`, `sound`, `sound_effect`, and `static_modifier` are large enough to be
emitted as navigable tries as well as flat unions. The first three nest by name
(ids split on `_`); `static_modifier` nests by the vanilla file each id is
defined in, since its names share first words by coincidence rather than by
meaning — 658 top-level keys, of which 626 are ids from files carrying no
subject in their name, and the largest bucket holds 232 ids.

## What is here, and what is not

This is a licensing boundary the generator enforces, not merely a convention:

- **Here:** ids, definition names, scripted trigger/effect names and their
  `$PARAM$` lists, event ids and namespaces, sprite and sound names, resource
  keys, and the scope each scripted definition is legal in.
- **Never here:** script bodies, localized text, descriptions, or asset data.

The scopes are the one entry derived from a body rather than read off one, so it
is worth being precise about what crosses. The generator parses each scripted
definition, intersects the scopes cwtools' own rules declare for the keys it
evaluates, and keeps the resulting scope name — `country`, from `scopes.cwt`,
which is upstream rule data rather than anything Paradox ships. The body itself
is discarded in the same function that read it and reaches no emitter. What
ships is one enum-like word per definition, which answers "where may I call
this" and still never "what does it do".

Nothing this package emits could substitute for owning the game. It answers
"does this id exist and what does it need," never "what does it do" or "what
does it say."

## Paradox trademark notice

Stellaris is a trademark of Paradox Interactive AB. This package is an
unofficial, community-maintained artifact derived from a licensed install of
the game; it is not produced, endorsed, or supported by Paradox Interactive.

## Updating

Regenerate against a clean, pinned-version install of Stellaris:

```sh
npm run codegen:vanilla
```

Read the report the run prints (per-registry id counts, parameterized
scripted trigger/effect counts, diagnostics, and any licensing-chokepoint
rejections — there should be zero of the last). Review the diff under
`packages/stellaris-ids/src` as a public-API change, then commit the
generated output together with whatever prompted the regeneration (a game
patch, a generator fix).

`npm run codegen:vanilla:check` reruns the generator and diffs the committed
output; it is maintainer-local, since it needs a real install and CI has none.
