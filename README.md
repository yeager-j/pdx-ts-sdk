# pdx-ts

Write Stellaris mods in TypeScript. Your code runs once, at build time, and
produces an ordinary mod folder — the game never sees anything but normal
PDXScript. There is no DSL and no template language: definitions are plain
TypeScript values, a build folds them into a mod, and rendering is a pure
function from that value to files.

```ts
// src/mod.ts
import { createMod } from "@pdx-ts/sdk";

export const mod = createMod({
  name: "Hello Galaxy",
  prefix: "hello_galaxy",
  version: "0.1.0",
  supportedVersion: "4.4.*",
});
```

```ts
// src/content/resonance.ts
import {
  and,
  countryFlags,
  eventTarget,
  hasCountryFlag,
  hasOwner,
  isAtWar,
  not,
  onActions,
} from "@pdx-ts/sdk";

import { mod } from "../mod.ts";

const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");
const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");

export const resonanceTheory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  desc: "The lattice hums at frequencies we are only beginning to hear.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

export const resonanceWeapons = mod.technology("resonance_weapons", {
  name: "Resonance Disruptors",
  desc: "Weaponized harmonics that shatter hulls from within.",
  cost: 6000,
  area: "physics",
  tier: 3,
  category: "particles",
  prerequisites: [resonanceTheory, "tech_lasers_2"],
  isRare: true,
  weight: 70,
  potential: and(
    hasCountryFlag(flags.hello_galaxy_heard_the_hum),
    not(hasCountryFlag(flags.hello_galaxy_pacifist_path))
  ),
});

const events = mod.namespace("resonance");
export const aftershock = events.planet(2, {
  from: "country",
  title: "Aftershock",
  desc: "The crystal hum lingers over this world.",
  isTriggeredOnly: true,
  immediate: (planet, ctx) => {
    ctx.from.effects((country) => country.addResource({ resource: "influence", amount: 50 }));
  },
  options: [{ name: "Noted." }],
});

export const humReturns = events.country(1, {
  title: "The Hum Returns",
  desc: "Deep in the lattice, something answers back.",
  isTriggeredOnly: true,
  immediate: (country, ctx) => {
    country.randomList([
      {
        weight: 60,
        do: (c) => c.setCountryFlag(flags.hello_galaxy_heard_the_hum),
      },
      {
        weight: 40,
        modifiers: [{ factor: 2, when: isAtWar() }],
        do: (c) => {
          c.everyOwnedPlanet({ limit: hasOwner() }, (planet) => {
            planet.saveEventTargetAs(stormWorld);
            planet.planetEvent({ id: aftershock, from: ctx.self, days: 30 });
          });
        },
      },
    ]);
    country
      .if(hasCountryFlag(flags.hello_galaxy_heard_the_hum), () => {
        stormWorld.effects((planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{ name: "Fascinating." }],
});

export const feature = mod.feature("resonance", [
  resonanceTheory,
  resonanceWeapons,
  aftershock,
  humReturns,
  mod.on(onActions.onGameStartCountry, [humReturns]),
]);
```

`createMod` is the only authoring entry point. It mints each content id from
the mod prefix (`hello_galaxy_tech_resonance_theory`), gives events their
namespace and numeric ids (`hello_galaxy_resonance.1`), and compiles explicit
features into the immutable mod value that `render`, `write`, and `install`
consume.

It builds to `common/technology/hello_galaxy_resonance.txt`:

```
hello_galaxy_tech_resonance_theory = {
	area = physics
	tier = 2
	category = { particles }
	cost = 2000
	weight = 100
}

hello_galaxy_tech_resonance_weapons = {
	area = physics
	tier = 3
	category = { particles }
	cost = 6000
	weight = 70
	prerequisites = { "hello_galaxy_tech_resonance_theory" "tech_lasers_2" }
	potential = {
		AND = {
			has_country_flag = hello_galaxy_heard_the_hum
			NOT = {
				has_country_flag = hello_galaxy_pacifist_path
			}
		}
	}
	is_rare = yes
}
```

and `events/hello_galaxy_resonance.txt`:

```
namespace = hello_galaxy_resonance

country_event = {
	id = hello_galaxy_resonance.1
	title = hello_galaxy_resonance.1.name
	desc = hello_galaxy_resonance.1.desc
	is_triggered_only = yes
	immediate = {
		random_list = {
			60 = {
				set_country_flag = hello_galaxy_heard_the_hum
			}
			40 = {
				modifier = {
					factor = 2
					is_at_war = yes
				}
				every_owned_planet = {
					limit = {
						has_owner = yes
					}
					save_event_target_as = hello_galaxy_storm_world
					planet_event = {
						id = hello_galaxy_resonance.2
						days = 30
					}
				}
			}
		}
		if = {
			limit = {
				has_country_flag = hello_galaxy_heard_the_hum
			}
			event_target:hello_galaxy_storm_world = {
				add_deposit = d_minerals_1
			}
		}
		else = {
			log = "the hum went unheard"
		}
	}
	option = {
		name = hello_galaxy_resonance.1.a
	}
}
```

plus the localization `.yml` (BOM and all) and the descriptor.
Source can be organized however you like; the build sorts content into the engine's
one-directory-per-registry layout.

## The IDE plugins are good. They are also linters.

Serious PDXScript modding already has real tooling: the JetBrains Paradox
Language Support plugin and cwtools for VS Code index the game and your mod,
complete fields and vanilla ids — with documentation, icons, and
jump-to-definition — annotate scopes inline, and flag unresolved references.
They are driven by the same community-maintained cwtools rules this project
generates its types from, and if you write raw PDXScript you should
absolutely use one.

But a linter checks text you already wrote, and its findings are advisory.
That ceiling is what a compiler raises:

- **A squiggle can be ignored; a failed build ships nothing.** The plugin
  marks `tech_lazers_2` as unresolved and lets you package the mod anyway.
  Here the same mistake is a type error or a build refusal — the mod folder
  is never produced with the defect in it.
- **Wrong-scope code isn't flagged, it's unrepresentable.** The plugin
  annotates scopes and warns on mismatches, within what the `.cwt` rules can
  express. In the SDK an effect closure receives a scope object that simply
  does not have the wrong-scope methods, and contracts the rules cannot state
  are still checked: what `FROM` is when an event fires (witnessed at every
  fire site), what scope an event target holds, what a situation's `target`
  is.
- **Modifier completion that answers before you stop typing.** The plugin
  does complete modifiers — all 45,501 of them, in one flat list, which in
  practice means multi-second menus. The SDK types them as paths
  (`m.country.unity.produces.mult(0.01)`): the largest menu anywhere in the
  tree has 369 entries, every segment is checked, and scope-illegal modifiers
  don't appear at all.
- **A linter cannot write content; a language can.** Five amplifier
  technologies with scaling costs are a `for` loop. Shared trigger fragments
  are functions. Constants are constants. Rules-based tooling has nothing to
  offer here because there is nothing to check yet.
- **Nobody warns you that your vanilla override lost.** PDXScript overrides
  are whole-object, load-order-sensitive replacements, and the folklore
  answer is a `zz_` filename prefix and hope. The SDK parses the real install,
  computes a filename that provably byte-sorts after every competitor, and
  fails the build when no winning name exists.
- **The edit-test loop is "launch, console-fire, squint."** Recorded triggers
  and effects can be interpreted outside the game: event chains get unit
  tests that run in milliseconds, and `explain` answers "why doesn't my
  `potential` pass" by naming the failing subcondition.

The trade is real, in both directions: the plugins work on any existing mod
with zero adoption cost and show you icons and game files in place, while the
SDK asks you to write TypeScript and run a build. What you get for that is
the difference between warnings about what you typed and guarantees about
what ships.

## One feature, one module

Stellaris reads one directory per registry: every technology in
`common/technology/`, every event in `events/`. That is an engine constraint,
and raw PDXScript makes you live inside it — one feature's technologies and
events end up in different folders, held together by a naming convention and
your memory. The SDK is a compiler, so source layout and output layout are
decoupled: write a module per feature, and the build sorts its contents into
the directories the game demands using the feature's authored stem.

```
examples/hello-galaxy/
├── mod.ts             config + the fold
├── flags.ts           shared values live outside content/
└── content/
    ├── resonance.ts   → common/technology/hello_galaxy_resonance.txt
    │                  → events/hello_galaxy_resonance.txt
    └── amplifiers.ts  → common/technology/hello_galaxy_amplifiers.txt
```

`discoverFeatures(dir)` imports every selected module and reads its named
`feature` export. Other named and default exports are ordinary ESM API, so
`resonanceTheory` can be reused by `amplifiers.ts` without placing it twice.
Each feature owns its output stem; moving or renaming a source module changes
neither emitted identity nor bytes unless that authored stem changes.

## A real language

The amplifier ladder in the tree above is one loop — five technologies, each
requiring the previous, costs on a curve:

```ts
const amplifiers: TechnologyItem[] = [];
let previous: TechnologyItem = resonanceTheory;
for (const [index, adjective] of [
  "Attuned",
  "Harmonic",
  "Coherent",
  "Superradiant",
  "Transcendent",
].entries()) {
  const tier = index + 1;
  previous = mod.technology(`amplifier_${tier}`, {
    name: `${adjective} Resonance Amplifiers`,
    cost: 1000 * 2 ** tier,
    area: "physics",
    tier: Math.min(tier + 1, 5),
    category: "particles",
    prerequisites: [previous],
    weight: 100 - 10 * tier,
  });
  amplifiers.push(previous);
}
export { amplifiers };
export const feature = mod.feature("amplifiers", amplifiers);
```

That is ordinary TypeScript — no macros, no templates. The same move scales
to anything mechanical: a function that stamps out a family of edicts, a
shared trigger fragment used by twelve events, a constant used in forty
places and changed in one.

## Flags know their kind

Flags are the classic silent failure: `has_country_flag` against a flag that
was only ever set on a planet is not an error in game, it is a condition that
is never true. Declare the names your mod invents, and they autocomplete and
type-check by kind:

```ts
const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");

hasCountryFlag(flags.hello_galaxy_heard_the_hum); // ok
hasCountryFlag(flags.hello_galaxy_heard_the_humm); // typo: compile error
hasCountryFlag(planetFlags("surveyed").surveyed); // wrong kind: compile error
hasCountryFlag("some_vanilla_flag"); // raw strings still work
```

## Vanilla's own script is callable, and knows its scope

Most of what a real mod's conditions do is call vanilla's scripted triggers.
`is_fallen_empire` appears 214 times in one surveyed mod, and it is not a game
primitive the rules describe — it is script, in a file the game ships. Install
the identifier package and all ~1,600 of them arrive already bound:

```ts
import { isFallenEmpire, hasCrisisStage } from "@pdx-ts/stellaris-ids/triggers";
import { giveAscensionPerkEffect } from "@pdx-ts/stellaris-ids/effects";

potential: and(isFallenEmpire(), hasCrisisStage({ STAGE: 2 })),
immediate: (s) => {
  s.run(giveAscensionPerkEffect({ PERK: "ap_mind_over_matter" }));
},
```

The parameter lists are typed, and so is the scope: `isFallenEmpire()` is a
`Trigger<"country">`, so using it where a planet condition belongs is a compile
error. That scope is derived rather than asserted — the generator intersects
the scopes the rules already declare for the keys each body evaluates, and a
body it cannot read widens to every scope instead of guessing. It is checked
against 4,860 of vanilla's own call sites, which it contradicts nowhere.

`examples/hello-galaxy/content/resonance.ts` uses all three forms, including a
scripted effect whose `TECH` parameter is handed the mod's own technology.

## Nested content stays nested

Some registries are trees. A solar system initializer holds planets, planets
hold moons, and moons hold moons, to whatever depth you write:

```ts
const home = mod.solarSystemInitializer("home", {
  class: "rl_standard_stars",
  usage: ["custom_empire"],
  planet: [
    { count: 1, class: "star", orbitDistance: 0, size: { min: 30, max: 35 } },
    {
      name: "NAME_Resonance_Prime",
      class: "pc_continental",
      orbitDistance: 60,
      size: 20,
      homePlanet: true,
      initEffect: (planet) => planet.setCapital(true),
      moon: [
        // Advances the orbit cursor for the moon that follows — the long
        // form of `change_orbit`, see below.
        { class: "none", orbitDistance: 12 },
        { class: "pc_barren", size: 8, orbitDistance: 10 },
      ],
    },
  ],
  neighborSystem: [{ initializer: outpost, hyperlaneJumps: 1 }],
});
```

These blocks are anonymous and ordered — they have no ids, and their array
order is the order the game reads them in, so it is preserved exactly as
written. That is the one place array order is author data rather than something
the SDK sorts.

The scopes follow the nesting too. The initializer's own `initEffect` runs in
system scope and a planet's runs in planet scope, so `setCapital` is available
on the inner one and not the outer.

**There is no `changeOrbit` field.** The rules' `change_orbit` key is sugar —
written between two `planet` (or two `moon`) blocks, it advances an orbit
cursor for whatever follows it, so its _position_ among its siblings is the
geometry. A field can't carry that: every repeated `change_orbit` collapses
into one array-shaped member with one fixed emission slot, and 288 of 355
shipped top-level initializer blocks interleave it between `planet` blocks —
the position the collapse cannot keep. The long form says the same thing
without needing one: a `planet` or `moon` entry with `class: "none"` and its
own `orbitDistance` advances the cursor exactly where it sits in the array,
because array order among these siblings is preserved verbatim. `none` is a
real, game-legal class (`SolarSysInitPlanetClass`), so this is not a
workaround — it is the same thing `change_orbit` already meant, spelled as an
ordinary sibling instead of a field with nowhere consistent to go.

## Testing mod logic

Because triggers and effects are recorded as data, mod logic can be
interpreted outside the game — unit tests for event chains, no game launch,
no console:

```ts
const world = fixture(
  {
    countries: [
      { name: "player", flags: [flags.heard_the_hum], planets: [{ name: "alpha" }] },
      { name: "rival" },
    ],
  },
  { events: [humReturns, aftershock] }
);

world.fire(humReturns, world.country(0));
world.advance(30); // delivers due scheduled fires

expect(world.fired).toContainEvent(aftershock, { day: 30, from: world.country(0) });
expect(world.country(0).has(resonanceTheory)).toBe(true);
```

For triggers, `explain` answers "why doesn't my `potential` pass" by naming
the failing subcondition:

```
✗ AND
  ✓ has_global_flag = lattice_awake — set globally
  ✓ has_country_flag = heard_the_hum — set on country "player"
  ✗ NOT
    ✓ has_country_flag = pacifist_path — set on country "player"
```

The interpreter is a second implementation of the game's semantics, so it is
deliberately whitelist-only: everything it models carries a one-line defense
of the real game's behavior, and anything unmodeled throws instead of
guessing. A test can only pass through semantics someone consciously
verified.

## Patching vanilla

PDXScript overrides are whole-object replacement: changing one field of a
vanilla technology means re-emitting the complete object, which requires the
game's own files. `stellaris.load()` parses the local install and surfaces
each definition as a typed object; a patch is a plain transform over it:

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
  vanilla.definition("technology", "tech_gene_tailoring").require("cost", "prerequisites"),
  (t) => ({
    cost: t.cost.value * 2, // cost is @tier3cost1 in the file — .value bakes it, visibly
    prerequisites: [...t.prerequisites, newTechnology],
  })
);
const cityDistrict = mod.patchBuilding(
  vanilla.definition("building", "building_capital_1"),
  () => ({
    planetLimit: 2,
    prerequisites: [newTechnology],
  })
);

const compiled = mod.compile(
  [mod.feature(undefined, [newTechnology, geneTailoring, cityDistrict])],
  { vanilla }
);
```

`vanilla.definition(registry, id)` is tagged with the registry it came from, so
a parsed building cannot be handed to `patchTechnology`. Each patched registry
gets its own emission, resolved independently — `technology`, `building` and
`megastructure` are the registries with a `patchX` today. The first two rest on
fully verified override rules; `megastructure`'s whole-object replacement is a
recorded judgment rather than a finding, so every win it backs reports
`confidence: "assumed"` and the emitted patch file states the judgment in its
own header.

Fields the transform doesn't touch are carried through byte-faithfully,
`@variable` references included. The build then emits the patch into a file
whose name is computed from the parsed load-order enumeration to provably
sort after every competing file — and fails loudly when no winning name
exists, when the registry's override rule is unverified, or when the install
version drifted from what the SDK was verified against. "Launched the game
and the override didn't take" becomes a build error.

## Packages

| Package                                                         | What it is                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [create-stellaris-mod](packages/create-stellaris-mod/README.md) | `npx create-stellaris-mod my-mod` — detects your install and scaffolds a project that builds on the first `npm install`                       |
| [@pdx-ts/sdk](packages/sdk/README.md)                           | The SDK: capability authoring, triggers/effects, scope safety, building, rendering, vanilla patching, mod-logic testing                       |
| [@pdx-ts/sdk-testing](packages/sdk-testing/README.md)           | Test mod logic without launching the game: a whitelist interpreter over the recorded triggers and effects, plus vitest matchers               |
| [@pdx-ts/pdxscript](packages/pdxscript/README.md)               | Standalone PDXScript parser/serializer — order-preserving, round-trip-verified, game-semantics-free                                           |
| [@pdx-ts/stellaris-ids](packages/stellaris-ids/README.md)       | Every identifier a real install defines, as version-pinned types, plus vanilla's scripted triggers and effects bound at their inferred scopes |
| [@pdx-ts/codegen-cwt](packages/codegen-cwt/README.md)           | Rules-derived generator: emits the SDK's typed surface from the vendored cwtools rules                                                        |
| [@pdx-ts/codegen-vanilla](packages/codegen-vanilla/README.md)   | Install-derived generator: emits @pdx-ts/stellaris-ids from an installed copy of the game                                                     |

At the root: `vendor/` (the committed cwtools rules and doc dumps),
`fixtures/` (the shared fake install the hermetic tests run against),
`examples/` (the quickstart and the hardening corpus), and `docs/`
(the ADRs, plus proposals not yet implemented).

[CONTEXT-MAP.md](CONTEXT-MAP.md) indexes the five bounded contexts and their
glossaries.

## Development

npm workspace; every command runs from the repository root.

```bash
npm test                     # all suites, all packages (vitest)
npm run typecheck            # tsc --noEmit
npm run typecheck:ids        # the stellaris-ids-present type program
npm run build                # emit each package's dist/
npm run example              # build examples/hello-galaxy/out/
npm run codegen              # regenerate the SDK's types from the cwt rules
npm run codegen:check        # ...and fail if committed output moved
npm run codegen:vanilla      # regenerate stellaris-ids (needs an install)
npm run codegen:vanilla:check
npm run scaffold             # drive create-stellaris-mod from source
```

Every publishable package builds to `dist/`, because Node refuses to strip
types from anything under `node_modules` — a package shipping raw `.ts` dies at
a consumer's first import. The workspace hides that completely, since npm links
members as symlinks whose realpath escapes `node_modules`, so during development
nothing is built. `exports` therefore names both worlds: a `pdx-source`
condition pointing at `src/`, and `types`/`default` pointing at `dist/`. This
repo passes that condition (tsconfig `customConditions`, Node `--conditions`,
Vite `resolve.conditions`); a published consumer never does, and gets `dist/`.

Contributor rules — codegen discipline, the content-registry procedure,
design boundaries — live in [AGENTS.md](AGENTS.md).

## Status

0.x, built and verified against Stellaris 4.4.6. Emitted
output is pinned by golden files, generated types by drift gates, override
behavior by an in-game calibration record, and the parser by a round-trip
fixpoint over the entire vanilla `common/` tree.
