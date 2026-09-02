# `@pdx-ts/stellaris-ids` provenance

## What this package is

Every identifier vanilla Stellaris defines — content ids, scripted trigger and
effect names with their `$PARAM$` lists, event ids and namespaces, sprite and
sound names, resource keys — read out of a real, installed copy of the game
and shipped as TypeScript types. Alongside them, the install's path inventory:
which paths vanilla occupies, by name. `@pdx-ts/sdk` imports its lookup tables
(ADR-0006) so every vanilla reference is checked at compile time.

The identifier surface is types with zero runtime payload. Five subpaths are
the exception. `./triggers` and `./effects` carry one bound call per scripted
definition, each a single `scriptedTrigger`/`scriptedEffect` call naming the
definition and the scope inferred for it; they are `/*#__PURE__*/`-annotated so
a bundler drops the ones a mod does not import. `./paths` carries the path
inventory as a frozen array of strings — path **names** only, never contents,
hashes, sizes, or localized text. The names inside DLC archives are read from
each archive's central directory, which is its table of names; no entry's data
is ever inflated. `./gfx-ids` carries the ids of the registries whose names the
SDK mints without an id segment — sprites, meshes and particles — as frozen
arrays of strings. Those are the same ids the package already ships as types,
in the one other form the SDK needs them: a minted name is only known at build
time, so the SDK's refusal to shadow a vanilla definition is a lookup rather
than a question for a compiler. `./localization-keys` carries the localization
key inventory as a frozen array of strings — key **names** only, never the text
a key holds. Each is its own subpath so that importing the package's root loads
none of them.

## Game version

Generated from Stellaris **4.4.6**.

The npm `version` carries the game version: `@pdx-ts/codegen-vanilla` stamps
`package.json` with `major.minor.patch` from the installed game's
`launcher-settings.json`, so there is one authority for which build these
identifiers came from. The SDK compares its own install's version against this
package's `package.json` version and refuses to build silently on a mismatch
(`VanillaPackageMismatchError`; `buildMod`'s `acceptGameVersion` is the
deliberate escape).

### Revisions

The stamped version is the game version plus a `-r.<n>` revision — `4.4.6-r.1`,
`4.4.6-r.2`, `4.4.6-r.3`, `4.4.6-r.4` — and a bare `4.4.6` is never published. npm can
never reuse a version number, so numbering by game version alone allows exactly one publish
per game release, and this package can need a second long before Paradox ships
anything: a widened peer range, a regenerated registry, a generator fix. The
revision is what makes a second publish of one build possible.

Consumers ask for a build by range rather than by version:

```json
"@pdx-ts/stellaris-ids": ">=4.4.6-0 <4.4.6"
```

Both bounds do work. `>=4.4.6-0` is what admits prereleases at all — an
ordinary range like `^4.4.6` matches none of them. `<4.4.6` then excludes the
bare version, which by definition predates this scheme; without it, highest-wins
would hand every install that pre-scheme build instead of the newest revision.
`create-stellaris-mod` emits this range, and the SDK's mismatch message prints
it.

`r.1` rather than `r1`: the dot makes the number its own numeric identifier, so
`-r.10` sorts above `-r.9`. Run together they are one alphanumeric identifier
compared lexically, and the tenth revision would sort below the ninth.

Regenerating does not move the revision. A new game build restarts at `-r.1`;
regenerating the build already stamped leaves the version untouched, because
`codegen:vanilla:check` regenerates and then diffs `package.json` and a version
that moved every run would fail it unconditionally. **Bump `-r.<n>` by hand as
part of publishing**, which is the decision it records — a second publish of one
game build.

The 4.4.6 generation read 44 registries and 31,280 ids, 9,995 events across
114 namespaces, plus 1,618 scripted triggers (86 parameterized) and 1,657
scripted effects (382 parameterized). Of those events, 9,856 have an exact
scope and kind from `events.cwt`; the 139 generic `event = {}` definitions are
scopeless.
It also read 149,217 localization keys from the 231 files of
`localisation/english`, emitted as 4.5 MB of `localization-keys.ts`.

English is the whole inventory rather than a tenth of it: the game falls back
to english for any key a translation omits, so `localisation/english` is the
set of keys that resolve at all and every other language directory is a subset
of it. The launcher's own `pdx_launcher/` and `pdx_online_assets/` trees carry
english files too and are excluded — the game resolves no script key from
either.

That count is what decided the shape. The registries below at 9.2k and 5.9k ids
are already past what one completion menu can hold and get a trie beside their
flat union; 149,217 is another order of magnitude up, so this inventory gets
**no union at all**. `vanilla.localization(key)` is the only `vanilla.*` member
checked at build time against a `Set` rather than at compile time against a
type — 4.5 MB of literals is a file no compiler should be asked to hold, and
the same reasoning that put the path inventory behind `./paths` applies here
with more force.

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
  keys, event scope/kind contracts, the scope each scripted definition is
  legal in, the paths the install occupies, and the localization keys it
  defines.
- **Never here:** script bodies, localized text, descriptions, or asset data —
  and, for the path inventory, no file contents, sizes, or hashes either. The
  `./gfx-ids` runtime sets carry no id the flat unions do not already carry, in
  the same order and through the same gate; the form changed, the boundary did
  not.

The localization inventory is where that boundary is thinnest, since a key and
the text it holds sit on the same source line. The reader matches the key
prefix of a line and stops at the colon, so no character of the value is ever
captured, and the licensing test pins the emitted file to one quoted key per
line. A key answers "does this key exist"; the text answering "what does it
say" stays in the install.

Scripted-definition scopes are the one entry derived from a body rather than
read off one, so it is worth being precise about what crosses. The generator
parses each scripted definition, intersects the scopes cwtools' own rules
declare for the keys it evaluates, and keeps the resulting scope name —
`country`, from `scopes.cwt`, which is upstream rule data rather than anything
Paradox ships. The body itself is discarded in the same function that read it
and reaches no emitter. Event scope and kind do not inspect an event body:
their top-level definition key is mapped through `events.cwt`, shared with the
SDK generator. What ships is an enum-like contract per definition, which
answers "where may I call this" and still never "what does it do".

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

Read the report the run prints (per-registry id counts, scoped/scopeless event
and namespace counts, per-kind event counts, parameterized scripted
trigger/effect counts, the path inventory's counts — paths shipped, install
files walked, DLC archives read, and metadata excluded — the localization key
count and the files it came from, diagnostics, and any
licensing-chokepoint rejections; there should be zero of the last). A non-zero
"lines unrecognised" beside the localization count means vanilla started
writing a line shape the reader does not know, and those keys are missing from
the inventory. Review the diff under
`packages/stellaris-ids/src` as a public-API change, then commit the
generated output together with whatever prompted the regeneration (a game
patch, a generator fix).

`npm run codegen:vanilla:check` reruns the generator and diffs the committed
output; it is maintainer-local, since it needs a real install and CI has none.
