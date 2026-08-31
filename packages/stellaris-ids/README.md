# @pdx-ts/stellaris-ids

`@pdx-ts/stellaris-ids` contains the identifiers defined by one installed
Stellaris build. Generated TypeScript covers content ids, event ids and scopes,
scripted trigger and effect signatures, sprites, sounds, resources, enum
members, paths, and localization keys.

The package version carries the game version. `4.4.6-r.4` describes Stellaris
4.4.6; `r.4` is the fourth package revision generated for that game build.

## Installation and compatibility

The package requires Node.js 22 or newer. Install a bounded range so npm selects
the newest generator revision for exactly one Stellaris build:

```bash
npm install "@pdx-ts/stellaris-ids@>=4.4.6-0 <4.4.6"
```

Install it beside `@pdx-ts/sdk`, which consumes it as a peer dependency.
`create-stellaris-mod` detects the local game build and writes the range
automatically.

Do not use `^4.4.6-r.4`: the leading numbers are the game coordinate, not the
SDK's compatibility version. A bounded range prevents a project from silently
moving to identifiers generated from another game patch.

## How the SDK uses the package

The SDK imports five generated lookup interfaces from `src/tables.ts`:

- `VanillaIds`
- `VanillaEnums`
- `VanillaScriptedTriggers`
- `VanillaScriptedEffects`
- `VanillaTries`

The generated `vanilla.*` helpers in `@pdx-ts/sdk/stellaris` resolve every known
reference through those tables:

```ts
import { vanilla } from "@pdx-ts/sdk/stellaris";

vanilla.technology("tech_lasers_1"); // accepted
vanilla.technology("tech_lazers_1"); // TypeScript error
```

No project import or registration call enables this checking. If the package is
present, the SDK's public types use its tables. A registry the SDK expects but
the package does not carry is a compile error rather than an unchecked string.

Raw strings remain valid in selected SDK fields for deliberate references to a
third-party mod or game content newer than the package pin.

## Identifier navigation

Small and medium registries expose checked call forms:

```ts
vanilla.technology("tech_lasers_1");
vanilla.planetClass("pc_continental");
```

Large registries would produce unusable flat completion lists. They also expose
tries grouped by the vanilla source file or directory:

```ts
vanilla.spriteType.eventpictures.GFX_evt_ship_in_orbit;
vanilla.staticModifier.deficit.food_deficit;
vanilla.soundEffect.toxoids.events.tox_events.event_first_contact_toxoid;
```

Buckets are navigation only. A leaf retains the exact underlying identifier.
The checked call form remains available when an id is copied from another file:

```ts
vanilla.spriteType("GFX_evt_ship_in_orbit");
```

Localization is too large for a practical TypeScript union. It is checked at
build time against a packaged runtime inventory:

```ts
vanilla.localization("requires_independence");
vanilla.localization("requires_independance"); // throws with the package pin
```

## Events

Events are indexed by namespace and local id. Each leaf carries its full id,
event scope, FROM contract, and event kind:

```ts
vanilla.event.story.$5;
vanilla.event.observer.$1;
```

A numeric local id gains a `$` prefix for property navigation because a
JavaScript property cannot begin with a digit in dotted syntax. `$` cannot occur
in a Stellaris event id, so the mapping is reversible. The leaf's `.id` remains
the exact game id, such as `story.5`.

Generic `event = {}` definitions are scopeless references. They cannot be passed
to a scoped fire effect because the package has no scope contract to prove.

## Scripted triggers and effects

Vanilla scripted definitions are game files, not primitive keys described by
cwtools. The generator reads their names and `$PARAM$` lists and emits bound
functions:

```ts
import { acceptEndOfTheCycle } from "@pdx-ts/stellaris-ids/effects";
import { hasCrisisStage, isFallenEmpire } from "@pdx-ts/stellaris-ids/triggers";

potential: and(isFallenEmpire(), hasCrisisStage({ STAGE: 2 })),
immediate: (country) => {
  country.run(acceptEndOfTheCycle());
},
```

Every binding is a function, including parameterless definitions. Parameter
objects preserve required and optional substitutions. A parameterless trigger
also accepts an optional boolean, so `isMachineEmpire(false)` writes a negated
call.

A definition whose body wraps parameters in a `[[FLAG] ... ]` region is read by
what each caller choice reaches. Vanilla nearly always pairs such a region with
its negated `[[!FLAG] ... ]` twin, so exactly one branch runs and whatever both
substitute is required: `addRandomTraitEvopred({ TAG: "organic" })` is a
complete call, and `SPECIES` is an ordinary optional flag.

Where a region has no negated twin its parameters are reachable only when its
flag is supplied, and the parameter type becomes a union of call shapes —
supplying the flag then requires the rest, and omitting it forbids them. No
vanilla definition is shaped that way today.

The binding carries an inferred scope. `isFallenEmpire()` is a
`Trigger<"country">` because its body uses keys that cwtools declares legal in
country scope. The analysis intersects those known key scopes. If it cannot
read or narrow a body safely, it widens the binding instead of guessing a
smaller scope.

Install-gated call-site tests compare inferred scopes with thousands of direct
uses in vanilla event bodies and fail on any contradiction in that measured
slice.

## Type and runtime exports

The package is primarily a generated type surface, but it is not entirely
types-only.

| Export | Runtime payload |
| --- | --- |
| `@pdx-ts/stellaris-ids` | Type re-exports; no root runtime data. |
| `/triggers` and `/effects` | One pure binding call per scripted definition. |
| `/paths` | Vanilla path inventory used by SDK and docs coverage. |
| `/gfx-ids` | Runtime graphics-id sets used for collision checks. |
| `/localization-keys` | Runtime localization-key membership data. |
| `/enum-members` | Runtime enum membership data used for build checks. |

The generated bindings are annotated as pure so bundlers can drop unused
definitions. Runtime inventories exist only where a union is impractical or the
SDK must perform a build-time membership check.

## Version guards

When a build supplies a parsed vanilla installation, `mod.compile(features,
{ vanilla })` compares its game version with this package pin. A mismatch throws
`VanillaPackageMismatchError` unless `acceptGameVersion` explicitly accepts the
installed version.

Package revisions do not affect the game comparison. Both `4.4.6-r.1` and
`4.4.6-r.4` pin Stellaris 4.4.6.

TypeScript also resolves one table set per program. Two projects can use
different game pins, but one compilation does not combine identifier tables
from different Stellaris builds.

## Generation and licensing boundary

[@pdx-ts/codegen-vanilla](../codegen-vanilla/README.md) generates this package
from a real installation. It parses game files with `@pdx-ts/pdxscript`,
extracts allowed identities, infers scripted scopes, builds large-registry
tries, and emits formatted TypeScript.

Every emitted install-derived string passes through one licensing chokepoint.
The allowed output includes identifiers, definition names, event ids and
namespaces, parameter names, paths, and inferred scope names. Script bodies,
localized text, descriptions, default parameter values, and Asset data cannot
cross that boundary.

[PROVENANCE.md](PROVENANCE.md) records the source game version, evidence, npm
revision policy, licensing boundary, and regeneration process.

## Generated layout

```text
src/
|-- index.ts             type re-exports
|-- tables.ts            lookup interfaces consumed by the SDK
|-- registries/          literal-union ids and large-registry trie buckets
|-- enums/               generated enum-member union modules
|-- events/              namespace event maps and event trie
|-- scripted-triggers.ts trigger name to parameter-table types
|-- scripted-effects.ts  effect name to parameter-table types
|-- triggers.ts          runtime scripted-trigger bindings
|-- effects.ts           runtime scripted-effect bindings
|-- paths.ts             vanilla source-path inventory
|-- gfx-ids.ts           runtime graphics inventories
|-- localization-keys.ts runtime localization membership
`-- enum-members.ts      runtime enum membership
```

Everything under `src/` is generated. Do not edit it by hand.

## Regeneration and verification

Run regeneration from the repository root beside a clean installation of the
target game build:

```bash
npm run codegen:vanilla
npm run codegen:vanilla:check
npm run typecheck
npm test
npm run build
```

`STELLARIS_PATH` overrides platform install discovery. The generator prints
per-registry counts, event and scripted-definition statistics, inferred-scope
coverage, trie buckets, parser diagnostics, and licensing rejections. Review
the report and the complete generated diff as a public API change.

CI cannot regenerate from a commercial game installation. Hermetic generator
tests use `fixtures/fake-install`, while install-gated tests regenerate in
memory and compare the result with committed output wherever the real game is
available.

This package shares the [Vanilla Extraction glossary](../codegen-vanilla/CONTEXT.md)
with its generator.
