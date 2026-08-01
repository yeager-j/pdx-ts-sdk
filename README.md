# @pdx-ts/sdk

A TypeScript SDK for Stellaris modding, in the AWS CDK / Pulumi mold: instead of
hand-writing PDXScript, you write TypeScript that executes at build time and
records the mod's source files, filenames, and folder structure.

There is no compiler. Your code really runs — loops, functions, and plain `if`
statements are build-time superpowers — and the SDK serializes the result to
PDXScript.

## Quickstart

```ts
import { and, eventTarget, hasAuthority, hasCountryFlag, hasOwner, Mod, not } from "@pdx-ts/sdk";

const mod = new Mod({
  name: "Hello Galaxy",
  prefix: "hello_galaxy", // namespaces every id and filename
  supportedVersion: "4.0.*",
});

const theory = mod.defineTechnology({
  id: "hello_galaxy_tech_resonance_theory",
  name: "Crystal Resonance Theory", // localization rides along
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
});

mod.defineTechnology({
  id: "hello_galaxy_tech_resonance_weapons",
  name: "Resonance Disruptors",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [theory], // cross-references are objects, not strings
  potential: and(hasCountryFlag("heard_the_hum"), not(hasCountryFlag("pacifist_path"))),
});

await mod.synth("./out");
```

The same generated content module backs ascension perks, buildings, agendas,
edicts, and traditions. Effect blocks use the same scope-checked recorder as
events, and defined content can be passed directly through cross-registry
references:

```ts
const agenda = mod.defineAgenda({
  id: "hello_galaxy_agenda_machine_futures",
  name: "Machine Futures",
  agendaCost: 1000,
  effect: (country) => {
    country.addResource({ resource: "unity", amount: 500 });
  },
});

const ascension = mod.defineTradition({
  id: "hello_galaxy_tradition_ascension",
  name: "Synthetic Ascension",
  unlocksAgenda: agenda,
  possible: hasAuthority("auth_machine_intelligence"),
  modifier: (m) => m.planet.pop.assembly.mult(0.1),
});

mod.defineTraditionCategory({
  id: "hello_galaxy_tradition_category_machines",
  name: "Machine Futures",
  treeTemplate: "tree_template_5",
  adoptionBonus: ascension,
  finishBonus: ascension,
  traditions: [ascension],
});

mod.defineEdict({
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
once, at build time, recording into a typed scope object:

```ts
const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

const aftershock = mod.definePlanetEvent({
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

mod.defineCountryEvent({
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

`synth` writes a complete, launcher-ready mod folder: `descriptor.mod`,
namespaced files under each populated `common/` registry, `events/*.txt`, and
BOM-prefixed localization `.yml`.

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

Under the hood the names form a 111,401-node path trie whose identical
subtrees collapse into 3,456 shared interfaces, so both the compiler and the
editor stay fast — and the whole table regenerates from the vendored game
dump with the same drift gates as every other generated type.

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
the verdict) before the implementation moved into `src/testing/`.

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

mod.patchTechnology(
  vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
  (t) => ({
    cost: t.cost.value * 2, // cost is @tier3cost1 in the file — .value bakes visibly
    prerequisites: [...t.prerequisites, myNewTech],
  })
);
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

The headline is what happens at `synth()`: the patch is emitted into a file
whose name is _computed from the parsed enumeration_ to byte-sort after
every surviving file defining the key — no `zz_` cargo cult — and the build
fails loudly when no winning name exists or when the registry's override
rule is unverified (the per-registry rule table pins its evidence to
Stellaris 4.4.6 and refuses its open cells by name; a version-drifted
install refuses until explicitly accepted). "Launched the game and the
override didn't take" becomes a build error. The v1 claim is exactly
"provably beats vanilla" — wins against third-party mods await playset
enumeration and are stated as unverified in every emitted header.

Status: landed in `src/` ([docs/verdict-patches.md](docs/verdict-patches.md)
is the verdict). The parser it builds on is
[@pdx-ts/pdxscript](packages/pdxscript/README.md) — a standalone,
publishable workspace package (one AST, one serializer), gated by a
per-claim suite, a round-trip fixpoint over the entire vanilla `common/`
tree, a tree differential against jomini, and fast-check property tests.

## Generated types

`src/generated/` is produced by `tools/codegen` from the vendored
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
`tools/codegen/drift-baseline.json`; codegen fails when either set moves rather
than emitting a wrong signature. The disagreements are real and informative — the
rules track 4.x scope renames the game's dump has not caught up with, adding
`carrier` to 164 triggers and replacing `pop` with `pop_group` on 70 — which is
why the rules win where the two conflict.

Today codegen emits 1054 of 1082 triggers, 976 of 1058 effects, and 372 typed
on-action references — the effects as 87 interfaces clustered by scope set (so
each signature is emitted once, not per scope) plus a serialization meta table
that drives the one runtime recorder — the 21-kind event table derived from
`type[event]`'s subtypes, and six content registries from one content emitter.
Nothing is dropped silently: every skipped rule, unrepresentable on-action, or
content field is reported with a named reason.

Every deliberate departure from a mechanical reading of the rules lives in one
audited file, `tools/codegen/overlay.ts`. What the rules cannot supply at all —
which technologies or edicts actually exist, and the FIOS/LIOS load-order table —
needs the game install and the PDXScript parser.

## Development

```bash
npm test             # snapshot + type-level tests (vitest)
npm run typecheck    # tsc --noEmit
npm run codegen      # regenerate src/generated/
npm run codegen:check # regenerate and fail if the committed output moved
npm run example      # generate examples/hello-galaxy/out/
npm run build        # emit dist/
```

The golden files under `tests/__snapshots__/hello-galaxy/` are the emitted
PDXScript, reviewable in PRs.

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
implemented under `src/testing/`; its
final real-game semantics checkpoint is tracked by the
[hardening calibration](examples/hardening/calibration/README.md). The
PDXScript parser passed its round-trip-fidelity probe
([docs/verdict-parser-probe.md](docs/verdict-parser-probe.md)) and then
landed as [@pdx-ts/pdxscript](packages/pdxscript/README.md), the workspace
package the SDK's AST and serializer now come from — validated against the
entire vanilla `common/` tree and differential-tested against jomini.
