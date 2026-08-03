# @pdx-ts/sdk

A TypeScript SDK for generating Stellaris mods. You write ordinary TypeScript
that runs at build time; the SDK records typed content definitions, triggers,
and effects, then serializes a launcher-ready mod folder in PDXScript. There is
no DSL and no template language — loops, functions, and `if` statements are
plain TypeScript running at build time.

The model is the AWS CDK's: definitions are values, a build folds them into a
mod, and rendering is a pure function from that value to files.

## Usage

A definer returns an item and registers nothing. `collection(stem, items)`
places items in a file; `buildMod(config, collections)` folds them into a
`PureMod` value; `render(mod)` returns a path-to-contents map and
`write(dir, files)` puts it on disk.

```ts
import { buildMod, collection, defineTechnology, render, write } from "@pdx-ts/sdk";

const theory = defineTechnology({
  id: "mymod_tech_resonance_theory",
  name: "Crystal Resonance Theory", // localization rides along
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
});

const weapons = defineTechnology({
  id: "mymod_tech_resonance_weapons",
  name: "Resonance Disruptors",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [theory], // cross-references are objects, not strings
});

const mod = buildMod(
  { name: "My Mod", prefix: "mymod", supportedVersion: "4.0.*" },
  [collection(undefined, [theory, weapons])]
);

await write("./out", render(mod));
```

Most mods use filesystem discovery instead of hand-built collections:
`discoverContent(dir)` imports every `.ts` module under a directory and turns
each module's exports into a collection named after the file. Export is
registration; the basename decides only the emitted file stem. One feature
module fans out across every registry it defines into — a module holding
technologies and events emits both `common/technology/<prefix>_<stem>.txt` and
`events/<prefix>_<stem>.txt` — so source is organized by feature while output
satisfies the engine's one-directory-per-registry layout.

```ts
import { buildMod, discoverContent, render, write } from "@pdx-ts/sdk";

const mod = buildMod(config, await discoverContent(new URL("./content/", import.meta.url)));
await write("./out", render(mod));
```

Layout is not identity: ids are authored, emission order is a function of the
content alone (registry order, then file path, then id), and moving a
definition between modules changes which file it lands in and nothing else.

### Triggers, effects, and scope safety

Triggers are declarative expression trees built from combinators and generated
trigger builders. Effects are closures that run once at build time, recording
into a typed scope object. Both are branded with the scopes they are valid in,
so a planet-scoped trigger in a country-scoped field, or a wrong-scope effect,
is a compile error. Scope transitions hand the closure a new scope object.

```ts
const events = namespace("mymod"); // one event namespace per module/file

export const humReturns = events.defineCountryEvent({
  id: 1, // → mymod.1
  title: "The Hum Returns",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
      planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
    });
  },
  options: [{ name: "Fascinating." }],
});

export const gameStart = on(onActions.onGameStartCountry, [humReturns]);
```

Every effect closure gets a second argument, `ctx`, holding the ambient scopes
the block runs in. `ctx.self` is the block's own scope — the FROM witness at
fire sites, above. `ctx.from` is FROM, typed at whatever scope the rules say the
game hands the block. A scope reference is both a bare word and the key of a
block that opens it, so `.effects(...)` writes that block:

```ts
defineArchaeologicalSiteType({
  id: "mymod_derelict_outpost",
  name: "Derelict Outpost",
  stages: 3,
  // on_roll_failed runs in fleet scope, with the site as FROM
  onRollFailed: (fleet, ctx) => {
    ctx.from.effects((site) => site.addExpeditionLogEntry({ title: "..." }));
  },
});
```

Where nothing declares a FROM — an event with no `from:`, a block the rules give
a bare `push_scope` — `ctx.from` is an inert sentinel, so reading it is a
compile error rather than a ref pointing at whatever the game happens to have.

The same ref opens a condition block with `.trigger(...)`, which takes the
condition as a value since a trigger is one. Triggers and weight blocks are
values rather than closures, so a *declarative* field whose rules give it a FROM
accepts either form — the closure being the only place an argument list exists
to hand FROM to:

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
then on is the value it returned.

In-game branching inside effects is `scope.if(trigger, body).elseIf(...).else(...)`;
a TypeScript `if` branches at build time. Using a trigger in a TS `if` is a
compile error.

Modifiers are typed paths over the game's complete modifier table
(`m.country.unity.produces.mult(0.01)`), with `m.raw(name, value)` checked
against the flat name set and `m.unchecked(name, value)` as the explicit
escape hatch.

### Referencing vanilla content

References to the mod's own content are objects, checked at build time. For
identifiers vanilla defines, install the version-pinned
[@pdx-ts/stellaris-ids](../stellaris-ids/README.md) package and import it once;
the `vanilla.*` helpers then narrow from `string` to compile-checked literals:

```ts
import "@pdx-ts/stellaris-ids";

prerequisites: [
  vanilla.technology("tech_lasers_1"), // typo = compile error
  "tech_from_another_mod",             // raw strings stay legal
],
```

Oversized id sets (sprites, sounds, static modifiers) are also navigable by
the vanilla file that defines them: `vanilla.sprite.eventpictures.GFX_…`,
`vanilla.staticModifier.deficit.food_deficit`. Without the package installed,
every helper accepts any string — the degradation is exactly the unchecked
status quo. `buildMod` refuses a build whose loaded install version disagrees
with the package's pin unless `acceptGameVersion` accepts it.

### Vanilla scripted triggers and effects

`is_fallen_empire` is not a game primitive, so no amount of codegen from the
rules produces it — it is vanilla _script_, one of ~1,600 definitions under
`common/scripted_triggers`. The identifier package ships every one of them
already bound:

```ts
import { isFallenEmpire, hasCrisisStage } from "@pdx-ts/stellaris-ids/triggers";
import { giveAscensionPerkEffect } from "@pdx-ts/stellaris-ids/effects";

potential: and(isFallenEmpire(), hasCrisisStage({ STAGE: 2 })),
immediate: (s) => {
  s.run(giveAscensionPerkEffect({ PERK: "ap_mind_over_matter" }));
},
```

Every binding is a function, parameterless ones included, and the `$PARAM$`
list is typed — a wrong or misspelled parameter is a compile error.

**The scope is inferred, not asserted.** `isFallenEmpire()` is a
`Trigger<"country">` because its body evaluates `is_country_type` and nothing
else, and the rules say where that is legal. The inference only ever reads what
the rules already state; a body it cannot read widens to every scope rather than
guessing, so a binding is sometimes less specific than it could be and never
wrong. 90% of scripted triggers narrow, 78% to five scopes or fewer out of 41.
See [the verdict](../../docs/verdict-scripted-scope.md) for the evidence,
including the 4,860 vanilla call sites the result is checked against.

Effects go through `scope.run(...)` rather than being methods on the scope
object: the recorder's sink is closed over, and keeping it that way is what
stops arbitrary entries reaching the output.

For a definition no install-derived package can know — another mod's, or one
newer than the pinned package — bind it by hand. There the scope _is_ your
assertion, and only the name and parameters go unchecked with `.unchecked`:

```ts
const pdHabitable = scriptedTrigger("pd_habitability_check", "planet");
const modTrigger = scriptedTrigger.unchecked("othermod_check", ["country", "sector"]);
```

`"any"` is the deliberate opt-out, and yields a trigger that fits everywhere.

Without the package installed, both call forms of a binding still compile and
every name is accepted — the same degradation as the rest of the vanilla
surface. One thing does not degrade: the mod-testing evaluator refuses a
scripted trigger and always will, because the package carries names and scopes
and never bodies, so there is nothing for it to evaluate.

### Patching vanilla

PDXScript overrides are whole-object replacement, so patching requires the real
files. `stellaris.load()` locates the install (`STELLARIS_PATH` overrides the
platform Steam default), parses it with content-hash caching, and surfaces
vanilla definitions as typed objects; a patch is a transform over one:

```ts
const vanilla = stellaris.load();

const geneTailoring = patchTechnology(
  vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
  (t) => ({
    cost: t.cost.value * 2,
    prerequisites: [...t.prerequisites, myNewTech],
  })
);

const mod = buildMod(config, [collection(undefined, [geneTailoring])], { vanilla });
```

The patch's emitted filename is computed from the parsed load-order enumeration
so it provably byte-sorts after every competing file; the build fails loudly
when no winning name exists or the registry's override rule is unverified.
Numbers parse as value-plus-provenance (`cost` may be `@tier3cost1` in the
file); untouched references re-emit as references.

## Where stuff lives

```
src/
├── index.ts           the public barrel — everything exported, by name
├── build.ts           buildMod: the fold, cross-collection checks, warnings
├── render.ts          PureMod → path-to-contents map
├── discover.ts        discoverContent: directory → collections (the impure shell)
├── content.ts         generic content lowering; field descriptors; modifier recorder
├── items.ts           ContentItem and the item kinds buildMod folds
├── definers.ts        hand-written definers and collection()
├── trigger-core.ts    Trigger<S>, the scope brand, trigger()
├── effect-core.ts     the scope-object recorder (makeScope), ScopeRef, event targets
├── triggers.ts        hand-written trigger combinators (and, or, not, ...)
├── events.ts          EventDef, event lowering, namespace()
├── on-actions.ts      on(hook, [events])
├── situations.ts      the situation target contract
├── scripted.ts        scriptedTrigger/scriptedEffect bindings and their lowering
├── scalar.ts          lowering a branded ref or scope ref to one PDXScript scalar
├── vanilla-ids.ts     VanillaIds merge targets + VanillaId/CheckedVanillaId resolvers
├── vanilla-trie.ts    makeIdTrie: the navigable-id runtime (one Proxy)
├── vanilla/           install-derived surface: VanillaView, patches, the version pin
├── stellaris/         locateInstall, stellaris.load(), the parse cache
├── resolver/          load-order model, per-registry override rules, patch planning
└── generated/         committed codegen output — never edit by hand
```

`src/generated/` (51 files) carries everything derived from the game's rules:
per-scope trigger/effect interfaces, the modifier path trie, content
definers and field descriptors for 34 registries, refs, and the `vanilla.*`
helper namespace.

## How codegen works

Generated code is produced by [@pdx-ts/codegen-cwt](../codegen-cwt/) from two
vendored sources: the cwtools `.cwt` rules (field shapes, cardinality,
references, scopes) and the game's own doc dumps (an independent second
opinion on names and scopes). The output is committed, so a rules bump lands
as a reviewable diff on the public API.

```bash
npm run codegen        # regenerate packages/sdk/src/generated/
npm run codegen:check  # regenerate and fail if committed output moved
```

Both runs print a report; skipped rules, unrepresentable declarations, and
collapsed fields are always listed with a named reason, never silently
dropped. Disagreements between the two sources are compared against a
committed drift baseline and fail codegen when either set moves. Deliberate
departures from a mechanical reading of the rules live in one audited file,
`packages/codegen-cwt/src/overlay.ts`.

The identifier package is generated separately by
[@pdx-ts/codegen-vanilla](../codegen-vanilla/) from a real install
(`npm run codegen:vanilla`); the SDK itself never reads the install at
codegen time.

## How testing works

```bash
npm test               # all suites (vitest), including type-level tests
npm run typecheck      # tsc --noEmit (models the ids-package-absent world)
npm run typecheck:ids  # the package-present world (packages/stellaris-ids + examples/)
```

Evidence comes in four kinds, and new registries are expected to add all four:

- **Golden PDXScript** under `tests/__snapshots__/` — real emitted `.txt`/
  `.yml`/`.mod` files, reviewed in PRs. `pure-api.test.ts` proves two reversed
  authoring orders render identically. The quickstart example's own goldens —
  which freeze its ids, event namespace, and localization bytes across
  restructures — live in `packages/stellaris-ids/tests/`, because the example
  imports that package and a module augmentation is global to a program.
- **Type-level tests** (`tests/*.test-d.ts`), run by vitest's typecheck:
  literal-id preservation, scope safety, cross-registry reference rejection.
- **Corpus conformance** (`tests/codegen/corpus-conformance.test.ts`) parses
  the installed game and measures every generated interface against every
  definition the game actually ships, for presence and shape.
- **Install-gated suites** use `describe.skipIf(installPath === undefined)`:
  hermetic gates run everywhere; suites needing a real Stellaris install
  (corpus conformance, patch calibration, ids-package drift) run wherever one
  exists and skip elsewhere.

For testing *mod logic* — the SDK's user-facing feature —
[@pdx-ts/sdk-testing](../sdk-testing/README.md) ships a whitelist interpreter
over the recorded ASTs: `fixture()` builds a world, `world.fire`/`world.advance`
drive events, `evaluate`/`explain` answer why a trigger fails by naming the
failing subcondition. It is a separate package because its matchers integrate
with a test framework, and a peer dependency on vitest does not belong in an SDK
whose job is emitting game files. Consuming this package through its public
interface is also what keeps that interface honest.
