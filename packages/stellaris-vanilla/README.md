# `@pdx-ts/stellaris-vanilla`

Vanilla Stellaris identifiers — content ids, scripted trigger/effect names and
their `$PARAM$` lists, event ids and namespaces, sprite and sound names,
resource keys — generated from a real, installed copy of the game and
version-pinned to it. See `PROVENANCE.md` for the game version, the licensing
boundary, and the regeneration procedure.

## Activation

This package has no runtime exports. Installing it is not enough on its own;
import it once, anywhere in the mod's build entry, for its side effect:

```ts
import "@pdx-ts/stellaris-vanilla";
```

That one line declaration-merges this package's per-registry id unions,
scripted trigger/effect parameter tables, and trie node types into
`@pdx-ts/sdk`'s merge targets (`VanillaIds`, `VanillaScriptedTriggers`,
`VanillaScriptedEffects`, `VanillaTries`). From then on, every `vanilla.*`
helper the SDK exports (`vanilla.technology(...)`, `vanilla.sprite.ship...`)
checks its argument against this package's real id set instead of accepting
any string.

Without this import — or without the package installed at all — the same
helpers still work, just unchecked: `VanillaId<K>` degrades to `string` for
whichever registries this package does not cover (absent entirely, or merely
stale and missing that one registry).

## Two versions, one hard compile error

TypeScript's module augmentation is global to the program it runs in. Two
different versions of this package resolving into the _same_ TypeScript
program both try to extend the same merge targets and will not typecheck —
this is not a bug to work around, it is what "version-pinned to one game
build" means. Coexistence of two game-version pins is fine across separate
projects; it is not supported within one.

## Relationship to `@pdx-ts/sdk`

The checked `vanilla.*` namespace, and the `VanillaId`/`CheckedVanillaId`
plumbing it is built on, live in `@pdx-ts/sdk` itself — this package supplies
only the data those types check against. Without `@pdx-ts/stellaris-vanilla`
installed, `vanilla.*` helpers still exist and still accept plain strings;
they simply cannot catch a typo.
