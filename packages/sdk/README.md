# @pdx-ts/sdk

`@pdx-ts/sdk` generates Stellaris mods from ordinary TypeScript. Your program
runs at build time, records typed content, triggers, and effects, and writes a
launcher-ready PDXScript mod folder. The game receives no runtime or template
language.

## Usage

`createMod(config)` is the only public authoring entry point. The immutable
capability it returns mints prefixed ids, creates events in namespaces, places
items in explicit features, and compiles those features into the value that
`render`, `write`, and `install` consume.

```ts
import { createMod, onActions, render, write } from "@pdx-ts/sdk";

const mod = createMod({
  name: "My Mod",
  prefix: "mymod",
  version: "0.1.0",
  supportedVersion: "4.4.*",
});

const theory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
});

const weapons = mod.technology("resonance_weapons", {
  name: "Resonance Disruptors",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [theory],
});

const events = mod.namespace("resonance");
const followup = events.countryHandle(2);
const opener = events.country(1, { isTriggeredOnly: true });
const followupDefinition = followup.define({ isTriggeredOnly: true });

const feature = mod.feature("resonance", [
  theory,
  weapons,
  opener,
  followupDefinition,
  mod.on(onActions.onGameStartCountry, [opener]),
]);

const compiled = mod.compile([feature]);
await write("./out", render(compiled));
```

The capability gives the first technology the id
`mymod_tech_resonance_theory`; the two events are `mymod_resonance.1` and
`mymod_resonance.2`. Cross-content references remain branded objects rather
than stringly typed ids.

Use a direct event method when its definition is available immediately. Use a
forward handle for a cyclic or delayed reference, then call `.define()` exactly
once. The scaffold's ESLint configuration catches a second direct call on the
same local handle; `compile()` remains the authoritative validation step, so it
also catches aliases, helpers, cross-module construction, and every other
semantic duplicate.

### Features and discovery

`mod.feature(stem, items)` makes source placement explicit. A feature may fan
out into every registry it contains while preserving its stem, so a feature
with technologies and events writes both a technology file and an event file.
Feature order and source order never decide emission order: output sorts by
registry declaration order, emitted path, and id.

For a file-per-feature project, `discoverFeatures` imports selected modules and
reads only their named `feature` export. Other exports are ordinary TypeScript
values, not implicit registration, and a filename is never part of content
identity.

`src/mod.ts` creates the capability and performs discovery:

```ts
import { createMod, discoverFeatures } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "My Mod",
  prefix: "mymod",
  version: "0.1.0",
  supportedVersion: "4.4.*",
});

export async function compileMod() {
  const features = await discoverFeatures<typeof mod.config.prefix>(
    new URL("./content/", import.meta.url)
  );
  return mod.compile(features);
}
```

`src/content/resonance.ts` imports the capability and explicitly exports its
feature:

```ts
import { mod } from "../mod.ts";

export const feature = mod.feature("resonance", [
  mod.technology("resonance_theory", {
    name: "Crystal Resonance Theory",
    cost: 2000,
    area: "physics",
    tier: 2,
    category: "particles",
  }),
]);
```

Event namespaces and event files are in bijection: keep one namespace's events
in one feature. Raw definers, raw event/on-action constructors, collection
assembly, and the old export-discovery mechanism are package internals, not
public alternatives to the capability.

### Triggers, effects, and scope safety

Triggers are declarative expression trees. Effects are closures that run once
at build time and record into a typed scope object. Both carry their valid
scopes, so a planet condition in a country field or a wrong-scope effect is a
compile error. Scope transitions hand the closure a new scope object.

```ts
const events = mod.namespace("resonance");
const aftershock = events.planet(2, { from: "country", isTriggeredOnly: true });

const humReturns = events.country(1, {
  title: "The Hum Returns",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
      planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
    });
  },
  options: [{ name: "Fascinating." }],
});
```

Every effect closure gets a second argument, `ctx`, holding the ambient scopes.
`ctx.self` is the block's own scope — the FROM witness at fire sites above.
`ctx.from` is FROM, typed at whatever scope the rules say the game hands the
block. A scope reference is both a bare word and the key of a block that opens
it, so `.effects(...)` writes that block:

```ts
const derelictOutpost = mod.archaeologicalSiteType("derelict_outpost", {
  name: "Derelict Outpost",
  stages: 3,
  // on_roll_failed runs in fleet scope, with the site as FROM.
  onRollFailed: (fleet, ctx) => {
    ctx.from.effects((site) => site.addExpeditionLogEntry({ title: "..." }));
  },
});
```

Where nothing declares a FROM — an event with no `from:`, or a block the rules
give a bare `push_scope` — `ctx.from` is an inert sentinel, so reading it is a
compile error rather than a ref pointing at whatever the game happens to have.

The same ref opens a condition block with `.trigger(...)`, which takes the
condition as a value since a trigger is one. Triggers and weight blocks are
values rather than closures, so a declarative field whose rules give it a FROM
accepts either form — the closure is the only place an argument list exists to
hand FROM to:

```ts
potential: canGoMia(), // no FROM to name, so no closure needed
allow: (ctx) => and(canGoMia(), ctx.from.trigger(isSiteLocked(false))),
```

Event targets work the same way, since `event_target:x = { ... }` is the same
shape of block:

```ts
const stormWorld = eventTarget<"planet">("mymod_storm_world");

planet.saveEventTargetAs(stormWorld); // the bare word
stormWorld.effects((planet) => planet.addDeposit("d_minerals_1")); // the block
```

The closure runs once, at definition time, and what the definition carries from
then on is the value it returned. `hidden_trigger` and `hidden_effect` hide
from generated tooltips without changing scope, so `this`, `from`, and `root`
inside are what they are outside:

```ts
allow: and(isShipClass("shipclass_science_ship"), hiddenTrigger(exists("owner"))),
effect: (country) => {
  country.hiddenEffect((hidden) => hidden.setCountryFlag("mymod_quietly"));
},
```

In-game branching inside effects is
`scope.if(trigger, body).elseIf(...).else(...)`; a TypeScript `if` branches at
build time. Using a trigger in a TypeScript `if` is a compile error.

Modifiers are typed paths over the complete modifier table
(`m.country.unity.produces.mult(0.01)`), with `m.raw(name, value)` checked
against the flat name set and `m.unchecked(name, value)` as the explicit escape
hatch.

### Referencing and patching vanilla content

Install the version-pinned [@pdx-ts/stellaris-ids](../stellaris-ids/README.md)
package and import it once to narrow `vanilla.*` helpers to compile-checked
literals. Raw strings remain available for intentional third-party references.

```ts
import "@pdx-ts/stellaris-ids";

const prerequisite = vanilla.technology("tech_lasers_1");
```

Oversized id sets (sprites, sounds, and static modifiers) are also navigable
by the vanilla file that defines them: `vanilla.sprite.eventpictures.GFX_…`
and `vanilla.staticModifier.deficit.food_deficit`. Without the package,
every helper accepts any string — the unchecked status quo. `mod.compile()`
refuses a loaded vanilla view whose install version disagrees with the package
pin unless `acceptGameVersion` accepts it.

### Vanilla scripted triggers and effects

`is_fallen_empire` is vanilla script, not a game primitive, so code generation
from the rules cannot produce it. The identifier package binds the roughly
1,600 scripted definitions under `common/scripted_triggers`:

```ts
import { isFallenEmpire, hasCrisisStage } from "@pdx-ts/stellaris-ids/triggers";
import { giveAscensionPerkEffect } from "@pdx-ts/stellaris-ids/effects";

potential: and(isFallenEmpire(), hasCrisisStage({ STAGE: 2 })),
immediate: (scope) => {
  scope.run(giveAscensionPerkEffect({ PERK: "ap_mind_over_matter" }));
},
```

Every binding is a function, parameterless ones included, and its `$PARAM$`
list is typed. A parameterless trigger also accepts an optional boolean,
defaulting to `true`: `isMachineEmpire(false)` writes
`is_machine_empire = no`. A trigger with `$PARAM$`s does not, because vanilla
substitutes those into a block rather than the call site itself.

**The scope is inferred, not asserted.** `isFallenEmpire()` is a
`Trigger<"country">` because its body evaluates `is_country_type` and nothing
else, and the rules say where that is legal. The inference only reads what the
rules state; a body it cannot read widens to every scope rather than guessing.
See [the verdict](../../docs/verdict/verdict-scripted-scope.md) for the
evidence, including its vanilla call-site calibration.

Effects go through `scope.run(...)` rather than becoming scope methods: the
recorder's sink is closed over, which prevents arbitrary entries reaching the
output. For a definition no install-derived package can know — another mod's,
or one newer than the pin — bind it by hand. There the scope is your assertion,
and only name and parameters go unchecked with `.unchecked`:

```ts
const pdHabitable = scriptedTrigger("pd_habitability_check", "planet");
const modTrigger = scriptedTrigger.unchecked("othermod_check", ["country", "sector"]);
```

`"any"` is the deliberate opt-out and yields a trigger that fits everywhere.
Without the package installed, both binding forms still compile and every name
is accepted. The mod-testing evaluator still refuses scripted triggers: the
package carries names and scopes, never bodies to evaluate.

Patching is whole-object replacement and requires the real game files. Load a
version-pinned install, create the patch through the capability, and compile it
with that vanilla view:

```ts
const vanilla = stellaris.load();
const newTechnology = mod.technology("new", {
  name: "New Technology",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
});
const geneTailoring = mod.patchTechnology(
  vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
  (technology) => ({
    cost: technology.cost.value * 2,
    prerequisites: [...technology.prerequisites, newTechnology],
  })
);

const compiled = mod.compile([mod.feature(undefined, [newTechnology, geneTailoring])], { vanilla });
```

The patch's emitted filename is computed from the parsed load-order enumeration
so it provably byte-sorts after every competing file. Compilation fails when no
winning name exists, the registry override rule is unverified, or the loaded
install version does not match the identifier package pin. Numbers retain
value-plus-provenance (`cost` may be `@tier3cost1`); untouched references
re-emit as references.

## Where stuff lives

```
src/
├── index.ts           public capability, discovery, materialization, and types
├── authoring/        createMod, feature placement, and named feature discovery
│   ├── mod.ts        createMod and capability-owned authoring operations
│   ├── feature.ts    feature/item vocabulary and placement helpers
│   └── discover.ts   discoverFeatures: directory → named feature exports
├── build.ts           internal fold, cross-feature checks, and warnings
├── output/             pure rendering and filesystem materialization
│   ├── render.ts       compiled mod → path-to-contents map
│   ├── write.ts        path map → files beneath an explicit root
│   └── install.ts      atomic launcher-directory installation
├── content/           generic content-definition machinery
│   ├── types.ts       public authored block contracts
│   ├── schema.ts      generated field metadata and registry descriptors
│   ├── blocks.ts      reusable PDXScript block encoders
│   ├── lower.ts       recursive descriptor interpretation
│   ├── authoring.ts   definition identity, localization, and registration
│   └── situations.ts  situation type lowering and target-scope contracts
├── events/            event contracts, lowering, and on-action authoring
│   ├── types.ts       event definitions and fire-site types
│   ├── lower.ts       event-to-PDXScript lowering
│   └── on-actions.ts  on-action lowering and binding construction
├── script/             triggers, scalar lowering, scripted bindings, and effects
│   ├── trigger-core.ts Trigger<S>, scope brand, and trigger()
│   ├── triggers.ts     trigger combinators and generated trigger exports
│   ├── scalar.ts       authored scalar argument lowering
│   ├── scripted.ts     scripted trigger/effect bindings
│   └── effects/        scope-object recorder and effect lowering
│       ├── types.ts    effect contracts and scope references
│       ├── modifiers.ts modifier and modifier-localization lowering
│       ├── structural.ts in-game control-flow lowering
│       └── recorder.ts recordEffects and the scope proxy
├── ordering.ts        canonical logical-path and UTF-8 ordering
├── references.ts      recorded content-reference vocabulary
├── identifiers/       optional vanilla identifier contracts and package pin
├── stellaris/         installed-game integration and vanilla content
│   ├── installation/  install discovery and game-version metadata
│   ├── launcher/      launcher-owned mod directory discovery
│   └── vanilla/       parsed view, patches, and override rules
└── generated/         committed codegen output — never edit by hand
```

`src/generated/` carries the interfaces and content shapes derived from the
game rules. Its raw constructors are internal implementation details; the
capability is the public authoring surface.

## Code generation and testing

[@pdx-ts/codegen-cwt](../codegen-cwt/) generates `src/generated/` from the
vendored cwtools rules (field shapes, cardinality, references, and scopes) and
the game's documentation dumps (an independent second opinion on names and
scopes). The output is committed and reviewed as public API:

```bash
npm run codegen
npm run codegen:check
npm test
npm run typecheck
```

Both runs print a report; skipped rules, unrepresentable declarations, and
collapsed fields are always named rather than silently dropped. Disagreements
between the two sources are compared against a committed drift baseline and
fail codegen when either set moves. Deliberate departures from a mechanical
reading of the rules live in the audited
`packages/codegen-cwt/src/overlay.ts`. Read every report and generated diff.

The separate
[@pdx-ts/codegen-vanilla](../codegen-vanilla/) generator reads a pinned local
install for `@pdx-ts/stellaris-ids`; the SDK does not read an install during its
own code generation.

Evidence comes in four kinds, and a new registry should add all four:

- **Golden PDXScript** under `tests/__snapshots__/`: reviewed emitted
  `.txt`/`.yml`/`.mod` files. `pure-api.test.ts` proves two reversed authoring
  orders render identically. The quickstart's goldens freeze ids, event
  namespace, and localization bytes across restructures.
- **Type-level tests** (`tests/*.test-d.ts`): literal-id preservation, scope
  safety, and cross-registry reference rejection.
- **Corpus conformance** (`tests/codegen/corpus-conformance.test.ts`): measures
  every generated interface against the definitions a local game installation
  ships, for presence and shape.
- **Install-gated suites** use `describe.skipIf(installPath === undefined)`:
  hermetic gates run everywhere; corpus conformance, patch calibration, and id
  package drift run where a Stellaris install exists.

For testing mod logic, [@pdx-ts/sdk-testing](../sdk-testing/README.md) ships a
whitelist interpreter over the recorded ASTs: `fixture()` builds a world,
`world.fire`/`world.advance` drive events, and `evaluate`/`explain` identify why
a trigger fails. It is separate because its matchers integrate with a test
framework; it intentionally throws for unmodeled game semantics rather than
guessing.
