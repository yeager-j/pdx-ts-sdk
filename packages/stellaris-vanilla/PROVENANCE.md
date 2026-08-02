# `@pdx-ts/stellaris-vanilla` provenance

## What this package is

Every identifier vanilla Stellaris defines — content ids, scripted trigger and
effect names with their `$PARAM$` lists, event ids and namespaces, sprite and
sound names, resource keys — read out of a real, installed copy of the game
and shipped as TypeScript types. It carries no runtime code: `@pdx-ts/sdk`
declaration-merges against it (`import "@pdx-ts/stellaris-vanilla";`) so a
vanilla reference is checked at compile time instead of degrading to an
unchecked string.

## Game version

`0.0.0` placeholder — this package's real `version` is stamped by
`tools/vanilla-codegen` from the installed game's `launcher-settings.json` the
next time it runs against a real install. The stamped version is
`major.minor.patch` of the game build the package was generated from; the SDK
compares its own install's version against this package's `package.json`
version and refuses to build silently on a mismatch.

## What is here, and what is not

This is a licensing boundary the generator enforces, not merely a convention:

- **Here:** ids, definition names, scripted trigger/effect names and their
  `$PARAM$` lists, event ids and namespaces, sprite and sound names, resource
  keys.
- **Never here:** script bodies, localized text, descriptions, or asset data.

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
npm run vanilla:codegen
```

Read the report the run prints (per-registry id counts, parameterized
scripted trigger/effect counts, diagnostics, and any licensing-chokepoint
rejections — there should be zero of the last). Review the diff under
`packages/stellaris-vanilla/src` as a public-API change, then commit the
generated output together with whatever prompted the regeneration (a game
patch, a generator fix).

`npm run vanilla:codegen:check` reruns the generator and diffs the committed
output; it is maintainer-local, since it needs a real install and CI has none.
