# @pdx-ts/sdk

A TypeScript SDK for Stellaris modding, in the AWS CDK / Pulumi mold: instead of
hand-writing PDXScript, you write TypeScript that executes at build time and
records the mod's source files, filenames, and folder structure.

There is no compiler. Your code really runs — loops, functions, and plain `if`
statements are build-time superpowers — and the SDK serializes the result to
PDXScript.

## Quickstart

```ts
import { and, eventTarget, hasCountryFlag, hasOwner, Mod, not } from "@pdx-ts/sdk";

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
namespaced `common/technology/*.txt` and `events/*.txt`, and BOM-prefixed
localization `.yml`.

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

## Testing mod logic

Because triggers and effects are recorded as plain ASTs, mod logic can be
interpreted outside the game — unit tests for event chains, with no game
launch and no console. The edit-test loop this replaces is "launch,
console-fire, squint"; the capability is impossible in raw PDXScript.

```ts
const world = fixture(
  {
    globalFlags: [globals.lattice_awake],
    countries: [
      { name: "player", flags: [flags.heard_the_hum], planets: [{ name: "alpha" }, { name: "beta" }] },
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

Status: the model passed its gated probe (`design/testing-probe/` is the
design record, [docs/verdict-testing-probe.md](docs/verdict-testing-probe.md)
the verdict); the API has not landed in `src/` yet.

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

Today codegen emits 1054 of 1082 triggers and 976 of 1058 effects — the
effects as 87 interfaces clustered by scope set (so each signature is emitted
once, not per scope) plus a serialization meta table that drives the one
runtime recorder — and the 21-kind event table derived from `type[event]`'s
subtypes. Nothing is dropped silently: every skipped rule is reported with a
named reason.

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

Prototype: the technologies and events/effects verticals, with types generated
from cwtools-stellaris-config. The recorded-closure effects model was
validated by a gated, hand-written probe before the emitter was built —
`design/effects-probe/` is the design record and
[docs/verdict-effects-probe.md](docs/verdict-effects-probe.md) the verdict;
[docs/handoff-effects-followups.md](docs/handoff-effects-followups.md) tracks
the follow-up work. The mod-testing evaluator
([docs/handoff-mod-testing.md](docs/handoff-mod-testing.md)) passed its own
gated probe the same way —
[docs/verdict-testing-probe.md](docs/verdict-testing-probe.md) — and awaits
implementation. Then the PDXScript parser, unlocking patches, real identifier
namespaces, and the load-order linter.
