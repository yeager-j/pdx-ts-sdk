# @pdx-ts/stellaris-ids

Every identifier a real, installed copy of Stellaris defines — content ids for
43 registries, event ids with their exact scope and kind, scripted trigger and
effect names with their `$PARAM$` lists, sprite and sound names — shipped as
TypeScript types, version-pinned to the game build. The package's npm version
carries the game version: `4.4.6-r.1` carries the identifiers of Stellaris
4.4.6 and nothing else, where `-r.1` counts publishes of that one build.

Install a build by range rather than by version, so you get its newest
revision:

```json
"@pdx-ts/stellaris-ids": ">=4.4.6-0 <4.4.6"
```

`create-stellaris-mod` writes this for you. [PROVENANCE.md](PROVENANCE.md)
("Revisions") explains why both bounds are needed.

Types only: there are no runtime exports, no materialized constants, and —
deliberately — no script bodies, localized text, or asset data.
[PROVENANCE.md](PROVENANCE.md) states the game version, the licensing
boundary, and the regeneration procedure.

## Usage

Install it next to `@pdx-ts/sdk`, which requires it as a peer dependency. There
is nothing to import: the SDK reads this package's id tables directly, so every
`vanilla.*` helper it exports checks its argument against the real id set:

```ts
import { vanilla } from "@pdx-ts/sdk";

vanilla.technology("tech_lasers_1"); // ok
vanilla.technology("tech_lazers_1"); // compile error

// Oversized registries (sprites 9.2k, sounds 5.9k, static modifiers 3.1k)
// are also navigable, bucketed by the vanilla file each id is defined in.
// Buckets are navigation only; the leaf spells the id verbatim:
vanilla.sprite.eventpictures.GFX_evt_ship_in_orbit;
vanilla.staticModifier.deficit.food_deficit; // → "food_deficit"
vanilla.soundEffect.toxoids.events.tox_events.event_first_contact_toxoid;
vanilla.sprite("GFX_evt_ship_in_orbit"); // the checked call form, for copy-paste

// Events navigate by namespace and local id. The leaf carries the full id,
// exact event scope, and event kind, so only the matching fire effect accepts it:
vanilla.event.story.$5; // EventRef<"country", undefined, "country">, id "story.5"
vanilla.event.observer.$1; // country scope, distinct "observer" kind
```

Numeric local ids gain a `$` navigation prefix because JavaScript property
names cannot begin with a digit. `$` cannot occur in a Stellaris event id, so
the mapping is collision-free; the leaf's `.id` always preserves the exact
game id without the prefix. Nonnumeric local ids remain unchanged.

Generic `event = {}` definitions are exposed as `EventScopelessRef` leaves.
They cannot be passed to a scoped fire effect; use their raw id string only
where the game accepts such an unchecked reference. The event trie remains
types-only: the SDK reconstructs the full id from property access and this
package ships no install-derived runtime table.

### Scripted triggers and effects

Every one of vanilla's ~1,600 scripted triggers and ~1,650 scripted effects
ships already bound, under its own subpath:

```ts
import { isFallenEmpire, hasCrisisStage } from "@pdx-ts/stellaris-ids/triggers";
import { giveAscensionPerkEffect } from "@pdx-ts/stellaris-ids/effects";

potential: and(isFallenEmpire(), hasCrisisStage({ STAGE: 2 })),
immediate: (s) => {
  s.run(giveAscensionPerkEffect({ PERK: "ap_mind_over_matter" }));
},
```

Names and `$PARAM$` lists are checked offline, with no install present. So is
the **scope**: `isFallenEmpire()` is a `Trigger<"country">`, derived by
intersecting the scopes cwtools' rules declare for the keys the definition's
body evaluates. A body the analysis cannot read widens to every scope rather
than guessing, so a binding may be less specific than it could be and is never
wrong. `packages/codegen-vanilla/tests/callsites.test.ts` checks 4,860 direct
call sites across 9,856 known-scope events, reaching 894 of 3,275 scripted
definitions (27%), and fails on any contradiction in that structural slice.
Clause-bearing calls outside the event-body walk require manual review.

These two subpaths are the package's only runtime, one call per definition and
`/*#__PURE__*/`-annotated so unused ones drop out of a bundle. Everything else
here is types with no payload.

### How the SDK reads it

`src/tables.ts` exports five interfaces — `VanillaIds`, `VanillaEnums`,
`VanillaScriptedTriggers`, `VanillaScriptedEffects`, `VanillaTries` — and
`@pdx-ts/sdk` imports them
([ADR-0006](../../docs/adr/0006-stellaris-ids-is-a-hard-dependency.md)). The
`vanilla.*` helpers live in the SDK; this package supplies the data they check
against, and nothing has to be imported in a project for that to take effect.
A registry the SDK asks about and this package does not carry is a compile
error rather than a quietly unchecked field.

## Version pinning

Two guards keep the pin honest:

- **When compiling the mod at build time**, `mod.compile(features, { vanilla })`
  compares this package's version against the install a `stellaris.load()` view
  came from, and refuses a mismatched build
  with `VanillaPackageMismatchError` unless `acceptGameVersion` explicitly
  accepts that install version. A regeneration-fix release (`4.4.6-r2`) still
  pins install `4.4.6` — only `major.minor.patch` is compared.
- **In the type system**, a package resolves once per program: the tables
  `@pdx-ts/sdk` imports are one version's. That is what "pinned to one game
  build" means — two pins coexist across separate projects, never within one.

## What's inside

```
src/
├── index.ts             type re-exports; zero runtime
├── tables.ts            the five lookup tables `@pdx-ts/sdk` imports
├── registries/          one file per registry (43): literal-union id types;
│                        the four oversized registries are directories of
│                        per-bucket trie files instead
│                        (registries/sprite/eventpictures.ts, ...)
├── events/              one types-only file per namespace plus the event trie
├── scripted-triggers.ts name → parameter-object tables (1,618 triggers)
├── scripted-effects.ts  same for effects (1,657)
├── triggers.ts          the bound scripted triggers, with inferred scopes
└── effects.ts           the bound scripted effects
```

Everything under `src/` is generated — never edit it by hand.

## Regeneration

Generated by [@pdx-ts/codegen-vanilla](../codegen-vanilla/README.md) from a
clean install: `npm run codegen:vanilla` from the repository root, next to an
install of the pinned version. The generator stamps the version, enforces the
identifiers-only licensing boundary at an emit chokepoint, and prints a
report; the diff is reviewed as a public-API change.

## Testing

`tests/present.test-d.ts` is the package-present world: literal preservation,
typo rejection, cross-registry rejection, trie navigation to real leaves,
scripted-trigger parameter shapes cross-checked against the game's own files,
the bound scripted triggers and effects at their inferred scopes, and a guard
that the trie'd registries match the SDK's oversized list. The
package-absent world is covered from the SDK's own test program, which
excludes this package on purpose. `tests/committed-output.test.ts` regenerates
in memory wherever an install exists and fails on any divergence from the
committed files — the drift gate for the artifact itself.

## Vocabulary

This package is the [Vanilla Extraction](../codegen-vanilla/CONTEXT.md) context. Its glossary is the authority
for what these words mean; the [context map](../../CONTEXT-MAP.md) shows how they change
at the boundaries with the other contexts.
