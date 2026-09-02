# @pdx-ts/sdk

`@pdx-ts/sdk` is the compiler and authoring API for TypeScript Stellaris mods.
Mod source runs at build time, records typed content and script, and compiles to
an immutable mod value. The renderer converts that value into ordinary
PDXScript, localization, assets, and mod-root metadata. Installation adds the
launcher-side descriptor.

Stellaris never loads this package. It receives the same file formats as a
hand-written mod.

## Requirements and installation

The package requires Node.js 22 or newer, uses ESM, and expects the
`@pdx-ts/stellaris-ids` package for the target Stellaris build as a peer
dependency.

```bash
npm install @pdx-ts/sdk "@pdx-ts/stellaris-ids@>=4.4.6-0 <4.4.6"
```

The recommended starting point is the project scaffolder:

```bash
npx create-stellaris-mod my-mod
```

It writes the manifest, TypeScript configuration, build entry points, example
Feature, and tests described below.

## Public entry points

- `@pdx-ts/sdk` contains mod creation, projects, discovery, rendering,
  inspection, writing, installation, diagnostics, and public types.
- `@pdx-ts/sdk/stellaris` contains generated content, triggers, effects, scopes,
  events, modifiers, on-actions, flags, and vanilla references.
- `@pdx-ts/sdk/installation` contains installation discovery and game-version
  metadata.
- `@pdx-ts/sdk/reference` exposes machine-readable facts about the supported SDK
  surface.
- `@pdx-ts/sdk/internals` exposes unstable interfaces for sibling tooling. Do
  not build mod APIs on this subpath.

## The build pipeline

```text
Project Manifest
  -> createModProject
  -> immutable mod capability
  -> discovered and additional Features
  -> deterministic Fold
  -> PureMod
  -> render
  -> RenderedMod
  -> write or install
```

`createMod(config)` is the low-level authoring entry point. It returns an
immutable capability bound to one mod prefix. The capability mints ids, creates
events and content Items, groups Items into Features, and owns the Fold.

`createModProject(manifest, options)` adds the conventional Project Manifest,
Feature discovery, Asset capture, and build sequence. Both routes use the same
compiler and renderer.

The Fold is the semantic authority. It validates identity, namespace and path
collisions, dangling references, localization, Asset claims, and patch plans
before returning a `PureMod`. `render(PureMod)` is pure and produces an
immutable, hash-identified byte snapshot. Project discovery and Asset capture
read the filesystem; only `write` and `install` modify materialized output.

## A project-based mod

The Project Manifest is the author-owned source of truth for mod identity,
launcher metadata, the Feature source directory, and the optional Asset tree:

```json
{
  "$schema": "./stellaris-mod.schema.json",
  "mod": {
    "mymod": {
      "name": "My Mod",
      "version": "0.1.0",
      "supportedVersion": "4.4.*",
      "tags": []
    }
  },
  "contentDirectory": "src/content",
  "assetsDirectory": "assets"
}
```

Bind the project once in `src/mod.ts`:

```ts
import { createModProject } from "@pdx-ts/sdk";

import manifest from "../stellaris-mod.json" with { type: "json" };

const project = createModProject(manifest, {
  projectRoot: new URL("../", import.meta.url),
});

export const { config, mod } = project;
export const buildTheMod = project.build;
```

Each selected module exports one named `feature`:

```ts
// src/content/resonance.ts
import { mod } from "../mod.ts";

const theory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  desc: "The lattice hums at frequencies we are only beginning to hear.",
  cost: 2_000,
  area: "physics",
  tier: 2,
  category: "particles",
});

export const feature = mod.feature("resonance", [theory]);
```

Build and materialize the result:

```ts
import { render, write } from "@pdx-ts/sdk";

import { buildTheMod } from "./mod.ts";

await write(new URL("../out/", import.meta.url), render(await buildTheMod()));
```

`project.build()` accepts `discover` and `additionalFeatures` hooks for
pre-compile customization. A different pipeline can compose
`discoverFeatures`, `mod.assetTree`, and `mod.compile` directly.

## Low-level authoring

Use `createMod` when a Project Manifest or filesystem discovery is not useful:

```ts
import { createMod, render } from "@pdx-ts/sdk";

const mod = createMod({
  name: "My Mod",
  prefix: "mymod",
  version: "0.1.0",
  supportedVersion: "4.4.*",
});

const theory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  cost: 2_000,
  area: "physics",
  tier: 2,
  category: "particles",
});

const compiled = mod.compile([mod.feature("resonance", [theory])]);
const rendered = render(compiled);
```

The content id is `mymod_tech_resonance_theory`. Cross-content references keep
their registry identity as branded values rather than degrading to strings.

## Features, Items, and identity

An authoring method returns an immutable Item. An Item becomes part of the mod
only when a Feature contains it. `mod.feature(stem, items)` gives those Items an
explicit output stem and provenance.

A Feature can fan out across registries:

```text
src/content/resonance.ts
  -> common/technology/mymod_resonance.txt
  -> events/mymod_resonance.txt
  -> common/on_actions/mymod_resonance.txt
  -> localisation/english/mymod_resonance_l_english.yml
```

Source layout does not create ids. Moving a module changes no emitted identity,
and Feature discovery reads only the module's named `feature` export. Other
exports remain ordinary ESM API and do not place an Item twice.

Output order is canonical: registry declaration order, logical path, then id.
Feature discovery order and source order do not affect rendered bytes. Anonymous
nested blocks, such as bodies in a solar-system initializer, preserve their
array order because that order is game data.

## Triggers, effects, and scopes

Triggers are declarative `Trigger<S>` expression trees. Effects are closures
that run once during authoring and record PDXScript entries through a typed
scope object. The generated surface exposes only methods and links legal for
the current Stellaris scope.

```ts
const events = mod.namespace("resonance");

const aftershock = events.planet(2, {
  scopes: { from: "country" },
  isTriggeredOnly: true,
});

const humReturns = events.country(1, {
  title: "The Hum Returns",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
      planet.planetEvent({
        id: aftershock,
        scopes: { from: ctx.root },
        days: 30,
      });
    });
  },
  options: [{ name: "Fascinating.", key: "fascinating" }],
});
```

The second closure parameter exposes only ambient scopes declared for that
field. `ctx.self` is the block's relative `THIS`; stable references such as
`ctx.root`, `ctx.from`, and deeper declared FROM or PREV chains are available
when the generated field metadata supplies them.

Effect scope links compose as paths:

```ts
planet.hiddenEffect.owner.effects((country) => {
  country.setCountryFlag("mymod_contacted");
});
```

TypeScript lexical capture maps to the game's PREV chain. If an outer scope
proxy is used inside a verified nested push, the recorder routes it through
`PREV` at the correct depth:

```ts
immediate: (country) => {
  country.everyOwnedPlanet({}, (planet) => {
    country.addResource({ resource: "influence", amount: 10 });
    planet.addDeposit("d_minerals_1");
  });
};
```

The recorder supports verified depths through `PREVPREVPREVPREV`. It rejects a
captured ancestor across a replacement or unknown transition, and rejects a
fifth push rather than guessing. Declared `ctx.prev*` references remain bound to
their ambient scope as verified callbacks add depth.

In-game branching uses
`scope.if(trigger, body).elseIf(trigger, body).else(body)`. A TypeScript `if`
runs during the build and cannot accept a `Trigger` value.

## Events and on-actions

`mod.namespace(name)` creates event definitions and forward handles owned by
one namespace. A namespace maps to one emitted event file and therefore one
shared Feature stem. Separate Features with that same stem can contribute to
the file.

Use a direct event method when the definition is available immediately. For a
cycle or forward reference, create a typed handle and call `.define()` once:

```ts
const events = mod.namespace("chain");
const followup = events.countryHandle(2);
const opener = events.country(1, { isTriggeredOnly: true });
const followupDefinition = followup.define({ isTriggeredOnly: true });
```

`mod.compile()` catches duplicate definitions even when aliases, helpers, or
module boundaries hide them from local static analysis. Event fire methods also
check the target scope, event kind, and declared FROM contract.

`mod.on(onAction, events)` creates an on-action hook. Scoped events must match
the hook's `THIS` and `FROM` types; weighted event lists retain their weighting
rules.

## Localization and assets

Localized definition fields accept language maps and travel with the Feature
that owns the definition. The renderer emits BOM-prefixed Stellaris YAML and
rejects duplicate keys collected in the same localization layer and language.

Use `mod.localization(keySuffix, text)` for standalone, prefixed text:

```ts
const counter = mod.localization("ASCENSION_COUNTER", {
  english: "Ascension progress",
  french: "Progression de l'ascension",
});

const localizationFeature = mod.feature("ascension", [counter]);
```

Use `mod.replaceLocalization(exactKey, text)` only when replacing a key that
already exists. It preserves the exact key and writes under
`localisation/replace/`.

`mod.assetFile()` and `mod.assetTree()` capture opaque files as immutable
content-addressed Items. Asset paths are checked against generated paths and
filesystem portability collisions before compilation succeeds.

## Vanilla identifiers and scripted definitions

The `vanilla.*` namespace checks ids against the installed
`@pdx-ts/stellaris-ids` package:

```ts
import { vanilla } from "@pdx-ts/sdk/stellaris";

const prerequisite = vanilla.technology("tech_lasers_1");
const portrait = vanilla.spriteType.eventpictures.GFX_evt_ship_in_orbit;
```

Large registries use file-bucketed tries to keep completion menus small. Raw
string forms remain available for intentional third-party references.

Vanilla scripted triggers and effects are bound from separate package subpaths:

```ts
import { acceptEndOfTheCycle } from "@pdx-ts/stellaris-ids/effects";
import { hasCrisisStage, isFallenEmpire } from "@pdx-ts/stellaris-ids/triggers";

potential: and(isFallenEmpire(), hasCrisisStage({ STAGE: 2 })),
immediate: (country) => {
  country.run(acceptEndOfTheCycle());
},
```

Names, `$PARAM$` lists, and inferred scopes are checked offline. The identifier
package does not include vanilla script bodies, so the testing interpreter
cannot execute these bindings.

## Patching vanilla

PDXScript patches are whole-object overrides, not field mutations. Load a
version-pinned installation, select a typed parsed definition, and return the
members to change:

```ts
import * as stellaris from "@pdx-ts/sdk/installation";

const vanillaInstall = stellaris.load();

const newTechnology = mod.technology("new", {
  name: "New Technology",
  cost: 2_000,
  area: "physics",
  tier: 2,
  category: "particles",
});

const geneTailoring = mod.patchTechnology(
  vanillaInstall
    .definition("technology", "tech_gene_tailoring")
    .require("cost", "prerequisites"),
  (technology) => ({
    cost: technology.cost.value * 2,
    prerequisites: [...technology.prerequisites, newTechnology],
  })
);

const compiled = mod.compile(
  [mod.feature("patches", [newTechnology, geneTailoring])],
  { vanilla: vanillaInstall }
);
```

Untouched parsed values keep their syntax-tree meaning, including variable
references, and are emitted in canonical PDXScript form. The patch planner
computes a filename that byte-sorts after every known vanilla and current-mod
definition for that registry. It fails when no
winning filename exists, when the registry's override rule is not accepted, or
when the loaded game version does not match the identifier package pin.

Patching support is registry-specific because each registry needs evidence for
whole-object replacement and load order. The generated authoring method and the
`patchX` method are separate permissions.

## Inspection, diagnostics, and materialization

`runInspect` prints deterministic YAML for a compiled project without rendering
or writing it. The report includes the content directory, project package and
mod metadata, vanilla status, Feature counts and Item ids, patch assertions,
and warnings.

Diagnostics are thrown errors or entries in `mod.warnings`; runtime APIs do not
write console diagnostics. Common Fold failures include duplicate ids, missing
references, namespace conflicts, output path collisions, invalid localization,
and unsafe patch plans.

`write(root, rendered)` and `install(rendered)` materialize only a
`RenderedMod`. The ownership manifest allows a later write to remove stale SDK
output while preserving foreign files. Modified, missing, type-changed, or
symlinked owned paths are refused rather than overwritten silently.

## Implementation

The package uses strict TypeScript and ESM. Its main layers are:

```text
src/
|-- authoring/       capabilities, Features, Items, and discovery
|-- compiler/        the deterministic Fold and compiler-owned validation
|-- content/         generic content lowering driven by field descriptors
|-- events/          event definitions, fire contracts, and on-actions
|-- script/          triggers, effects, scopes, modifiers, and scalar lowering
|-- installation/    install discovery, launcher paths, parsed vanilla, and patches
|-- output/          pure rendering plus write and install materialization
|-- identifiers/     vanilla identifier package contracts and resolvers
|-- generated/       committed codegen output; never edit by hand
|-- project.ts       Project Manifest to conventional build pipeline
|-- stellaris.ts     public Stellaris vocabulary entry point
`-- inspect.ts       project and PureMod data to deterministic YAML
```

`@pdx-ts/pdxscript` supplies the syntax tree and canonical serializer. YAML is
used for inspection output. Most Stellaris-facing TypeScript is generated from
cwtools rules and documentation data; hand-written runtime machinery interprets
the generated descriptors instead of duplicating registry-specific logic.

Workspace development uses the `pdx-source` export condition to resolve `.ts`
sources directly. Published consumers resolve built JavaScript and declaration
files under `dist/`.

## Code generation and verification

`@pdx-ts/codegen-cwt` generates `src/generated/` from the pinned cwtools config fork and
version-matched Stellaris documentation dumps. Deliberate departures from a
mechanical reading of those inputs live in audited overlay tables.

Run generator and verification commands from the repository root:

```bash
npm run codegen
npm run typecheck
npm test
npm run build
```

Read the codegen report and inspect the full generated diff. Unsupported,
collapsed, or omitted declarations remain visible in the report. Verification
includes emitted-file snapshots, type-level tests, deterministic authoring-order
tests, corpus conformance, and installation-gated patch and vanilla checks.

For mod-logic tests, use
[@pdx-ts/sdk-testing](../sdk-testing/README.md). For the terms used by this
package, see the [Authoring glossary](./CONTEXT.md) and the repository
[context map](../../CONTEXT-MAP.md).
