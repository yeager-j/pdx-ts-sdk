# @pdx-ts/sdk

A TypeScript SDK for Stellaris modding, in the AWS CDK / Pulumi mold: instead of
hand-writing PDXScript, you write TypeScript that executes at build time and
records the mod's content, and the SDK emits a launcher-ready mod folder.

There is no DSL and no template language. Your code really runs — loops,
functions, and plain `if` statements are build-time superpowers — and the SDK
serializes the result to PDXScript.

## Colocate by feature, not by content type

Stellaris reads one directory per registry: every technology in
`common/technology/`, every event in `events/`, every edict in
`common/edicts/`. That is an engine constraint, not an organizational choice.
Raw PDXScript makes you live inside it anyway — one feature's technologies,
events, and edicts end up in three different folders, and the only thing that
holds them together is a naming convention and your memory.

The SDK is a compiler, so **source layout and output layout are decoupled**.
Write a module per feature, put its technologies, its events, and its hook
bindings in it, and let the build sort out where the game wants them. What a
module's basename decides is only the emitted _file stem_, so the grouping is
still visible in the built mod: one feature module fans out across every
registry it defined into, keeping its name in each — `resonance.ts` becomes
`common/technology/<prefix>_resonance.txt` _and_
`events/<prefix>_resonance.txt`. Features small enough to share a file share a
basename instead, and same-stem modules merge.

## Quickstart

```
examples/hello-galaxy/
├── mod.ts             # config + the fold
├── flags.ts           # shared values live outside content/
└── content/
    ├── resonance.ts   → common/technology/hello_galaxy_resonance.txt
    │                  → events/hello_galaxy_resonance.txt
    └── amplifiers.ts  → common/technology/hello_galaxy_amplifiers.txt
```

```ts
// content/resonance.ts — technologies and events of one feature, in one
// module. A definer returns an item; exporting it is what registers it.
// Nothing is global and nothing is implicit.
// → common/technology/hello_galaxy_resonance.txt, events/hello_galaxy_resonance.txt
import { and, defineTechnology, hasCountryFlag, namespace, not } from "@pdx-ts/sdk";

import { flags } from "../flags.ts";

export const theory = defineTechnology({
  id: "hello_galaxy_tech_resonance_theory",
  name: "Crystal Resonance Theory", // localization rides along
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
});

export const weapons = defineTechnology({
  id: "hello_galaxy_tech_resonance_weapons",
  name: "Resonance Disruptors",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [theory], // cross-references are objects, not strings
  potential: and(
    hasCountryFlag(flags.hello_galaxy_heard_the_hum),
    not(hasCountryFlag(flags.hello_galaxy_pacifist_path))
  ),
});

// The same feature's events, right here — the flag the technology gates on is
// the flag this event sets. Stellaris wants them in different directories; the
// feature wants them on the same screen. The build settles it.
const events = namespace("hello_galaxy"); // local: one namespace per file

export const humReturns = events.defineCountryEvent({
  id: 1, // → hello_galaxy.1, from birth
  title: "The Hum Returns",
  isTriggeredOnly: true,
  immediate: (country) => country.setCountryFlag(flags.hello_galaxy_heard_the_hum),
  options: [{ name: "Fascinating." }],
});
```

```ts
// mod.ts — `discoverContent` imports every .ts module under a directory, in
// sorted path order, and turns each one's exports into a collection named
// after the file. `buildMod` is the fold: config plus collections in, an
// assembled mod value out. `render` serializes it; `write` touches disk.
import { buildMod, discoverContent, render, write } from "@pdx-ts/sdk";

const mod = buildMod(
  {
    name: "Hello Galaxy",
    prefix: "hello_galaxy", // namespaces every id and filename
    supportedVersion: "4.0.*",
  },
  await discoverContent(new URL("./content/", import.meta.url))
);

await write("./out", render(mod));
```

Export is registration, and it goes only one way: a module may **import**
another feature's technology to require it, and as long as it does not
re-export it, the definition is still placed once, by the module that wrote
it. Values that are not definitions — flag declarations, shared triggers,
constants — live in a module outside `content/`, because everything a
discovered module exports is registered. Anything that is not a `.ts` file is
ignored, so notes and data files can sit beside the definitions they belong to.

Layout is not identity. A module's basename picks the file stem and nothing
else: ids are authored, localization is keyed by id, and emission order is a
function of the content alone — registry order, then file path, then id — so
moving a definition to another feature module changes which file it is written
into and not one byte of the definition, its id, or its position relative to
its neighbors. Reordering exports changes nothing at all. The one order that
_is_ author data is a hook's event list, and it is written where it belongs:
inside a single `on(hook, [first, second])` call.

`buildMod` is where every cross-collection check happens (duplicate ids,
localization key collisions, event references with no definition behind them),
and everything the build wants to say but need not refuse — an id missing the
mod prefix, a quote the Paradox yml format cannot escape — comes back as data
on `mod.warnings` rather than console output.

### The manual path

Discovery is a convenience over one primitive, and the primitive is public.
`collection(stem, items)` places a list of items in a file, and `buildMod`
takes collections (or nested arrays of them) from anywhere:

```ts
import { buildMod, collection, defineTechnology } from "@pdx-ts/sdk";

const theory = defineTechnology({ ... });

const mod = buildMod(config, [
  collection(undefined, [theory]), // the registry's default file stem
  collection("ascension", [ascensionTech, ascensionEvent]),
  // → common/technology/<prefix>_ascension.txt, events/<prefix>_ascension.txt
]);
```

The fan-out is the collection's, not discovery's: one stem plus a list spanning
two registries is two files, one per registry directory. `discoverContent` only
supplies the stem from a filename.

That is how a reusable pack ships (a module exporting a collection is data,
not a callback), and how a build assembles content that never came from a
directory at all — the [hardening example](examples/hardening/) is built this
way on purpose. Splitting a registry across files never bypasses the patch
machinery either: every file a registry emits joins the load-order enumeration
a patch filename has to beat.

One free definer per registry — 34 of them, all generated from the same rules.
Ascension perks, buildings, agendas, edicts, and traditions all come out of one
content module; effect blocks use the same scope-checked recorder as events,
and defined content passes directly through cross-registry references:

```ts
export const agenda = defineAgenda({
  id: "hello_galaxy_agenda_machine_futures",
  name: "Machine Futures",
  agendaCost: 1000,
  effect: (country) => {
    country.addResource({ resource: "unity", amount: 500 });
  },
});

export const ascension = defineTradition({
  id: "hello_galaxy_tradition_ascension",
  name: "Synthetic Ascension",
  unlocksAgenda: agenda,
  possible: hasAuthority("auth_machine_intelligence"),
  modifier: (m) => m.planet.pop.assembly.mult(0.1),
});

export const machines = defineTraditionCategory({
  id: "hello_galaxy_tradition_category_machines",
  name: "Machine Futures",
  treeTemplate: "tree_template_5",
  adoptionBonus: ascension,
  finishBonus: ascension,
  traditions: [ascension],
});

export const mobilization = defineEdict({
  id: "hello_galaxy_edict_machine_mobilization",
  name: "Machine Mobilization",
  length: 3600,
  icon: "GFX_edict_machine_mobilization",
  resources: [
    {
      category: "edicts",
      upkeep: { amounts: { unity: 2 } },
    },
  ],
  triggeredCountryModifier: [
    {
      when: hasAuthority("auth_machine_intelligence"),
      modifiers: (m) => m.country.naval.cap.mult(0.1),
    },
  ],
  effect: (country) => {
    country.setCountryFlag("machine_mobilization_active");
  },
});
```

Events work the same way — except effect blocks are closures that really run,
once, at build time, recording into a typed scope object. Event identity is
authored rather than inferred from layout: `namespace(...)` declares it, so
every id is `hello_galaxy.<n>` from birth. That matters because saves persist
pending fires by full id, so moving an event between files must never change
what it is called.

```ts
const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

// Every id below is `hello_galaxy.<n>`. The handle is local to the module;
// what gets exported — and so registered — are the events it defines.
const events = namespace("hello_galaxy");

export const aftershock = events.definePlanetEvent({
  id: 2,
  from: "country", // the FROM contract: fire sites are checked against it
  title: "Aftershock",
  isTriggeredOnly: true,
  immediate: (planet, ctx) => {
    planet.within(ctx.from, (country) => {
      country.addResource({ resource: "influence", amount: 50 });
    });
  },
  options: [{ name: "Noted." }],
});

export const humReturns = events.defineCountryEvent({
  id: 1,
  title: "The Hum Returns",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
      planet.saveEventTargetAs(stormWorld); // scope-checked at the save site
      planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
    });
    country
      .if(hasCountryFlag("heard_the_hum"), (c) => {
        c.within(stormWorld, (planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{ name: "Fascinating." }],
});
```

Numeric ids are per namespace, and a namespace and a file are in bijection:
each emitted event file carries exactly one `namespace = ...` header, and a
namespace is never split across two files. So a large mod gives every feature
its own `namespace(...)` and its own id space instead of one global counter —
and writes that feature's events in one module, which is the same thing.
Binding them to a hook is the free `on(hook, [...])`, whose array is the
firing order the game sees:

```ts
export const gameStart = on(onActions.onGameStartCountry, [humReturns]);
```

Firing an event whose module was never discovered (or whose collection was
never passed to `buildMod`) is a build error, not a silent dangling id.

The same holds for content: a reference carrying the mod's own prefix — a
technology named in `prerequisites`, a tradition in `traditions`, a limit in
`addShipOfSizeLimits` — must resolve to a definition in the build, in the
registry the field references, or `buildMod` fails and names the definition,
the field, and the id. Vanilla and third-party ids carry someone else's
prefix and are always left alone.

`render(mod)` returns the complete, launcher-ready mod folder as a
path-to-contents map — `descriptor.mod`, namespaced files under each
populated `common/` registry, `events/*.txt`, and BOM-prefixed localization
`.yml` — and `write(dir, files)` puts it on disk.

## Design pillars

- **Triggers are expression trees.** `potential` takes a declarative condition
  built from combinators (`and`, `or`, `not`) and trigger builders
  (`hasCountryFlag`, `hasTechnology`, ...). Each builder returns an AST node.
- **Effects are recorded closures.** An event's `immediate` receives a scope
  object whose methods append AST nodes; at runtime every scope object is one
  scope-agnostic recorder, and the generated per-scope interfaces are what
  restrict which effects exist where. Scope changes hand the closure a new
  scope object (`everyOwnedPlanet` gives a `PlanetScope`), so the #1 modder
  error — wrong-scope effects — is a compile error.
- **Scope safety via types.** Triggers and effects are branded with the scopes
  they are valid in. Passing a planet-scoped trigger to a country-scoped block
  (like a technology `potential`) is a compile error. All 41 scopes, the scope
  of every trigger, and the scope set of every effect are generated, not
  hand-maintained. Event targets declare their scope once
  (`eventTarget<"planet">(...)`) and every save site enforces it; events
  declare the scope they expect `FROM` to be, and every fire site proves it
  with a witness (`from: ctx.self`).
- **Scope links navigate single relationships.** The game's 87 navigation
  links (`owner`, `capital_scope`, `solar_system`, ...) are generated for both
  positions: in a trigger, `owner(...)` wraps a condition that runs in the
  link's target scope; in an effect closure, `planet.owner((country) => ...)`
  hands the body the target scope's object. Both directions are scope-checked —
  using a link outside its input scopes, or a wrong-scope condition inside
  one, is a compile error.

  ```ts
  // trigger position: valid wherever the game allows `owner = { ... }`
  potential: owner(not(isAtWar())),

  // effect position: emits owner = { add_resource = { energy = 100 } }
  immediate: (planet) => {
    planet.owner((country) => country.addResource({ resource: "energy", amount: 100 }));
  },
  ```

- **Two kinds of time.** A plain TypeScript `if` branches at _build_ time —
  use it freely to generate variants. Triggers describe _in-game_ conditions;
  using one in a TS `if` is a compile error (and a runtime error with an
  explanatory message if forced). In-game branching inside effects is
  `scope.if(trigger, body).elseIf(...).else(...)`, and the chain throws if
  effects are recorded between its links — PDXScript associates `else` with
  the preceding `if` purely by position.
- **Cross-references are objects.** `prerequisites: [theory]` instead of
  `"tech_x"` strings: typos become compile errors, "find usages" works, and
  localization keys ride along on the object.
- **Flags are namespaced by kind.** Declare the names a mod invents and they
  autocomplete; because the rules record which value set each trigger draws from,
  a planet flag passed to `hasCountryFlag` is a compile error.

  ```ts
  const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");

  hasCountryFlag(flags.hello_galaxy_heard_the_hum); // ok
  hasCountryFlag(flags.hello_galaxy_heard_the_humm); // typo: compile error
  hasCountryFlag(planetFlags("surveyed").surveyed); // wrong kind: compile error
  hasCountryFlag("some_vanilla_flag"); // raw strings still work
  ```

- **Modifiers are typed paths.** All 45,501 modifier names the game knows,
  scope-checked and discoverable segment by segment — see the next section.

## Every modifier, discoverable

Stellaris 4.4 knows **45,501** modifier keys. Most are generated at game load —
every economic category × resource × produces/upkeep/cost, every ship size ×
combat stat — so no wiki page lists them all, and nobody keeps them in their
head. In raw PDXScript a misspelled modifier is not an error; it is a bonus
that silently never applies.

The SDK generates the complete set from the game's own modifier dump, joins it
with the scope tables, and types modifiers as paths:

```ts
modifier: (m) => m.country.unity.produces.mult(0.01),
// emits: country_unity_produces_mult = 0.01
```

Each `.` completes from a small menu — the largest menu in the entire tree has
369 entries — so the editor answers instantly where a flat 45k-key type took
seconds. Every segment is checked: a typo anywhere in the path is a compile
error, and so is a modifier used outside its scope — a federation-only
modifier in a country block, or a country economy modifier on a building's
planet block. A name that is also a prefix of longer names is both callable
and traversable: `m.bonus.pop.growth(0.1)` and `m.bonus.pop.growth.mult(0.05)`
are different modifiers, and both complete.

Flat names still work when you already know them:

```ts
modifier: (m) => {
  m.raw("country_unity_produces_mult", 0.01); // checked against all 45,501 names
  m.unchecked("another_mods_modifier", 0.5); // arbitrary strings, explicitly
},
```

`raw` is checked against the full name set plus anything you declare:
declaration-merge `CustomModifiers` to register your own scripted modifiers,
including template patterns (``readonly [k: `mymod_${string}`]: number``)
that admit a whole generated family at once. `unchecked` is the honest
escape for names computed at build time.

Where the rules pin no scope, every path is legal instead of none. A static
modifier is the clearest case: its body _is_ the modifier grammar, spliced in
with no enclosing key, so the rows land at the definition's root exactly as
vanilla writes them.

```ts
export const surge = defineStaticModifier({
  id: "hello_galaxy_synthetic_surge",
  name: "Synthetic Surge",
  modifiers: (m) => {
    m.country.unity.produces.mult(0.15);
    m.planet.jobs.alloys.produces.mult(0.1);
  },
});
// emits: hello_galaxy_synthetic_surge = {
//          country_unity_produces_mult = 0.15
//          planet_jobs_alloys_produces_mult = 0.1
//        }
```

Under the hood the names form a 111,401-node path trie whose identical
subtrees collapse into 3,457 shared interfaces, so both the compiler and the
editor stay fast — and the whole table regenerates from the vendored game
dump with the same drift gates as every other generated type.

## Situations and the target contract

Situations are the one place the game's rules cannot say what a scope link
lands on: a situation's `target` is whatever `start_situation` passed, and
`links.cwt` types it `any`. The SDK splits the contract in two. Inside blocks,
you assert it — `target<"planet">(...)` in triggers,
`situation.target<"planet">((planet) => ...)` in effects. At start sites, you
declare it once and every start is checked:

```ts
export const uprising = defineSituationType({
  id: "mymod_situation_uprising",
  name: "Machine Uprising",
  targetScope: "planet", // compile-time only; emits nothing
  monthlyProgress: { base: 2 },
  onMonthly: {
    randomEvents: [
      { weight: 80, event: unrestEvent }, // 80 = mymod.3
      { weight: 20 }, //                     20 = 0, the nothing-happens arm
    ],
  },
  stages: {
    mymod_uprising_start: {
      name: "Rumblings",
      icon: "GFX_stage_1",
      iconBackground: "GFX_bg",
      end: 50,
    },
    mymod_uprising_open_revolt: {
      name: "Open Revolt",
      icon: "GFX_stage_2",
      iconBackground: "GFX_bg",
    },
  },
});

// Later, in any country-scoped effect closure:
country.startSituation({ type: uprising, target: stormWorld }); // stormWorld: EventTarget<"planet">
country.startSituation({ type: uprising, target: ctx.self }); // compile error: country is not planet
```

`stages` keys are stage ids (order preserved, mod prefix enforced), scalar and
block forms of dual-declared fields like `end` both work, and every event kind
the game declares has a generated `defineXEvent` plus a scope-checked fire
method (`situation.situationEvent({ id: ... })`).

## Testing mod logic

Because triggers and effects are recorded as plain ASTs, mod logic can be
interpreted outside the game — unit tests for event chains, with no game
launch and no console. The edit-test loop this replaces is "launch,
console-fire, squint"; the capability is impossible in raw PDXScript.

```ts
import { declareFrom, fixture } from "@pdx-ts/sdk/testing";
import { installMatchers } from "@pdx-ts/sdk/testing/matchers";

installMatchers();

const world = fixture(
  {
    globalFlags: [globals.lattice_awake],
    countries: [
      {
        name: "player",
        flags: [flags.heard_the_hum],
        planets: [{ name: "alpha" }, { name: "beta" }],
      },
      { name: "rival" },
    ],
  },
  { events: [humReturns, declareFrom(aftershock, "country")] }
);

world.fire(humReturns, world.country(0), { arms: [40] }); // random_list arms are forced, never rolled
world.advance(30); // a discrete-event queue drain: delivers due fires, ages nothing else

expect(world.fired).toContainEvent(aftershock, { day: 30, from: world.country(0) });
expect(world.country(0).has(resonanceTheory)).toBe(true);
```

Assertions take objects, not id strings, and `world.fired` is a rich log that
doubles as the failure trace. For triggers, `evaluate`/`explain` answer "why
doesn't my `potential` pass" by naming the failing subcondition:

```
✗ AND
  ✓ has_global_flag = lattice_awake — set globally
  ✓ has_country_flag = heard_the_hum — set on country "player"
  ✗ NOT
    ✓ has_country_flag = pacifist_path — set on country "player"
```

An interpreter is a second implementation of the game's semantics, so it is
whitelist-only: every implemented trigger, effect, iterator, and scope link
carries a one-line defense against the real game's behavior, and anything
else throws with a coverage summary. A test can only pass through semantics
someone consciously modeled — nothing is evaluated silently.

The evaluator is published from `@pdx-ts/sdk/testing`; Vitest integration is
separate at `@pdx-ts/sdk/testing/matchers`, so importing the evaluator has no
matcher side effect and the main SDK entry does not depend on Vitest. The model
first passed its gated probe (`design/testing-probe/` remains the executable
design record, [docs/verdict-testing-probe.md](docs/verdict-testing-probe.md)
the verdict) before the implementation moved into `packages/sdk/src/testing/`.

The [hardening example](examples/hardening/) is the integration corpus: every
current content registry, typed `on_game_start_country` registration, an
event/effect chain, and a transformed vanilla technology. Its
[calibration record](examples/hardening/calibration/README.md) contains the
Stellaris 4.4.6 operator checkpoint; generated files and evaluator tests do not
substitute for that in-game evidence.

## Patching vanilla

PDXScript overrides are whole-object replacement, so changing one field of a
vanilla technology means re-emitting the complete object — which requires
parsing the game's own files. `stellaris.load()` locates the local install
(Steam defaults per platform, `STELLARIS_PATH` to override), parses it with
results cached by content hash, and surfaces each vanilla definition as a
typed object; a patch is a plain TypeScript transform over it:

```ts
const vanilla = stellaris.load();

const geneTailoring = patchTechnology(
  vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
  (t) => ({
    cost: t.cost.value * 2, // cost is @tier3cost1 in the file — .value bakes visibly
    prerequisites: [...t.prerequisites, myNewTech],
  })
);

// A patch is an item like any other: export it from a discovered module, or
// place it by hand. Its emitted filename is computed, so no stem names it.
// Hand `buildMod` the view the patches came from: a defined id colliding with
// a real vanilla id then becomes a hard error rather than a silent override.
const mod = buildMod(config, [collection(undefined, [geneTailoring])], { vanilla });
```

Numbers parse as value-plus-provenance: `cost` in the file is the scripted
variable `@tier3cost1`, so `t.cost * 2` is a compile error — take `.value`
to bake the resolved number, or pass the whole object through and the
reference re-emits as `@tier3cost1`. Fields the type model does not cover
(`weight_modifier`, `technology_swap`, `ai_weight`, ...) are carried through
in original order and re-emitted complete; a patched field keeps its slot in
the file's own field order. Unknown `@variables`, invalid enum values, and
unknown ids all fail at parse time with file and line — never a silent
widening to `string`.

The headline is what happens at `buildMod`: the patch is emitted into a file
whose name is _computed from the parsed enumeration_ to byte-sort after
every surviving file defining the key — no `zz_` cargo cult — and the build
fails loudly when no winning name exists or when the registry's override
rule is unverified (the per-registry rule table pins its evidence to
Stellaris 4.4.6 and refuses its open cells by name; a version-drifted
install refuses until explicitly accepted). "Launched the game and the
override didn't take" becomes a build error. The v1 claim is exactly
"provably beats vanilla" — wins against third-party mods await playset
enumeration and are stated as unverified in every emitted header.

`buildMod` is also where patches are first seen together, so it is where
patching the same technology twice, or mixing patches from two different
`stellaris.load()` views, is refused. The resulting plan — the winning
filename and its win assertions — rides on the built value as
`mod.patchPlan`, ready to print or assert on before anything is written.

Status: landed in `packages/sdk/src/` ([docs/verdict-patches.md](docs/verdict-patches.md)
is the verdict). The parser it builds on is
[@pdx-ts/pdxscript](packages/pdxscript/README.md) — a standalone,
publishable workspace package (one AST, one serializer), gated by a
per-claim suite, a round-trip fixpoint over the entire vanilla `common/`
tree, a tree differential against jomini, and fast-check property tests.

## Referencing vanilla content

Content this mod defines is a value, so a typo is a compile error. A reference
to something _vanilla_ defines is a string, and a typo there is a silent no-op
in game. `@pdx-ts/stellaris-vanilla` closes that gap: a version-pinned package
of every identifier a real install defines, generated by `@pdx-ts/vanilla-codegen`
and shipped as types only. One import activates it:

```ts
import "@pdx-ts/stellaris-vanilla";
import { vanilla } from "@pdx-ts/sdk";

defineTechnology({
  id: "mymod_tech_resonance",
  name: "Resonance Theory",
  area: "physics",
  tier: 2,
  category: "computing",
  prerequisites: [
    vanilla.technology("tech_lasers_1"), // checked; `tech_lazers_1` will not compile
    "tech_from_another_mod", // plain strings stay legal, for content no install has
  ],
});

// Sprites, sounds, and static modifiers are too large for a completion menu
// (9,197 sprites in 4.4.6), so they are navigable as well as callable. They
// navigate by the vanilla file each id is defined in — the buckets are
// navigation only, and the leaf spells the id verbatim:
vanilla.sprite.eventpictures.GFX_evt_ship_in_orbit; // → "GFX_evt_ship_in_orbit"
vanilla.sprite("GFX_evt_ship_in_orbit"); // checked, for an id copied from a game file

// `sound/` nests several directories deep, so every level is a segment:
vanilla.soundEffect.toxoids.events.tox_events.event_first_contact_toxoid;
vanilla.staticModifier.deficit.food_deficit; // → "food_deficit"
```

Without the package installed nothing breaks and nothing is checked: every
helper accepts any string and returns the same branded reference, so the
degradation is exactly today's behavior. The package's npm version _is_ the
game version (`4.4.6`), and `buildMod` refuses a build whose
`stellaris.load()` install disagrees with it unless `acceptGameVersion` says
otherwise.

## Generated types

`packages/sdk/src/generated/` is produced by `@pdx-ts/codegen` from the vendored
[cwtools-stellaris-config](vendor/cwtools-stellaris-config/VERSION.md), and it
is committed so a rules bump lands as a reviewable diff on the public API.

Two sources feed it:

- **The `.cwt` rules** give argument shapes — fields, cardinality, enums,
  references, the doc comments that become TSDoc — and scopes, via `## scopes` on
  all but five of 1133 trigger declarations.
- **The game's own doc dumps**, version-matched to the release the rules target,
  give the usage examples, cover the rules the annotations miss, and act as an
  independent second opinion on every scope.

Both joins are build gates. Names present in one source and not the other, and
scopes the two disagree on, are compared against
`packages/codegen/src/drift-baseline.json`; codegen fails when either set moves rather
than emitting a wrong signature. The disagreements are real and informative — the
rules track 4.x scope renames the game's dump has not caught up with, adding
`carrier` to 164 triggers and replacing `pop` with `pop_group` on 70 — which is
why the rules win where the two conflict.

Today codegen emits 1054 of 1082 triggers, 976 of 1058 effects, and 372 typed
on-action references — the effects as 87 interfaces clustered by scope set (so
each signature is emitted once, not per scope) plus a serialization meta table
that drives the one runtime recorder — the 21-kind event table derived from
`type[event]`'s subtypes, and **34 content registries** from one content
emitter, 26 of them at 100% coverage against every definition the real game
ships. Nothing is dropped silently: every skipped rule, unrepresentable
on-action, or content field is reported with a named reason.

Not every registry entry is a `define`. Where the entries are the _engine's_
rather than the mod's, the API says so instead of inventing an id — a country's
ownership limit has exactly one entry, keyed `default`, which the game reads
additively, so ship-of-size limits author as a contribution to it:

```ts
export const titan = defineCountryShipOfSizeLimit({ id: "mymod_titan_limit", ... });
export const limits = addShipOfSizeLimits([titan]);
// emits: default = { ship_of_size_limits = { mymod_titan_limit } }
```

Every deliberate departure from a mechanical reading of the rules lives in one
audited file, `packages/codegen/src/overlay.ts`. What the rules cannot supply at all —
which technologies or edicts actually exist, and the FIOS/LIOS load-order table —
needs the game install and the PDXScript parser.

## Development

This repository is an npm workspace. The SDK lives in `packages/sdk` and the
PDXScript parser in `packages/pdxscript`; the two generators are workspace
members of their own (`packages/codegen`, `packages/vanilla-codegen`), and the
shared inputs (`vendor/`, `fixtures/`, `examples/`, `design/`) sit at the root.
Every command below runs from the repository root.

```bash
npm test             # snapshot + type-level tests (vitest)
npm run typecheck    # tsc --noEmit
npm run codegen      # regenerate packages/sdk/src/generated/
npm run codegen:check # regenerate and fail if the committed output moved
npm run example      # generate examples/hello-galaxy/out/
npm run build        # emit dist/
```

The golden files under `packages/sdk/tests/__snapshots__/hello-galaxy/` are the
emitted PDXScript, reviewable in PRs. `packages/sdk/tests/example-mod.test.ts`
also freezes what the
example's restructure into feature modules could not change — its technology
ids, its event namespace and ids, and its localization bytes — so a layout
change that moved identity would fail rather than be re-baselined.

## Status

Prototype: technologies, buildings, agendas, edicts, traditions/categories,
and events/effects, with types and content-writer metadata generated from
cwtools-stellaris-config. The recorded-closure effects model was
validated by a gated, hand-written probe before the emitter was built —
`design/effects-probe/` is the design record and
[docs/verdict-effects-probe.md](docs/verdict-effects-probe.md) the verdict;
[docs/handoff-effects-followups.md](docs/handoff-effects-followups.md) tracks
the follow-up work. The mod-testing evaluator
([docs/handoff-mod-testing.md](docs/handoff-mod-testing.md)) passed its own
gated probe the same way —
[docs/verdict-testing-probe.md](docs/verdict-testing-probe.md) — and is now
implemented under `packages/sdk/src/testing/`; its
final real-game semantics checkpoint is tracked by the
[hardening calibration](examples/hardening/calibration/README.md). The
PDXScript parser passed its round-trip-fidelity probe
([docs/verdict-parser-probe.md](docs/verdict-parser-probe.md)) and then
landed as [@pdx-ts/pdxscript](packages/pdxscript/README.md), the workspace
package the SDK's AST and serializer now come from — validated against the
entire vanilla `common/` tree and differential-tested against jomini.
