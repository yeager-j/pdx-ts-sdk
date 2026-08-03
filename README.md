# pdx-ts

Write Stellaris mods in TypeScript. Your code runs once, at build time, and
produces an ordinary mod folder — the game never sees anything but normal
PDXScript. There is no DSL and no template language: definitions are plain
TypeScript values, a build folds them into a mod, and rendering is a pure
function from that value to files.

```ts
// content/resonance.ts

const events = namespace("hello_galaxy");
const stormWorld = eventTarget<"planet">("hello_galaxy_storm_world");
export const flags = countryFlags("hello_galaxy_heard_the_hum", "hello_galaxy_pacifist_path");

export const resonanceTheory = defineTechnology({
  id: "hello_galaxy_tech_resonance_theory",
  name: "Crystal Resonance Theory",
  desc: "The lattice hums at frequencies we are only beginning to hear.",
  cost: 2000,
  area: "physics",
  tier: 2,
  category: "particles",
  weight: 100,
});

export const resonanceWeapons = defineTechnology({
  id: "hello_galaxy_tech_resonance_weapons",
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

export const humReturns = events.defineCountryEvent({
  id: 1,
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
        modifiers: [{factor: 2, when: isAtWar()}],
        do: (c) => {
          c.everyOwnedPlanet({limit: hasOwner()}, (planet) => {
            planet.saveEventTargetAs(stormWorld);
            planet.planetEvent({id: aftershock, from: ctx.self, days: 30});
          });
        },
      },
    ]);
    country
      .if(hasCountryFlag(flags.hello_galaxy_heard_the_hum), (c) => {
        c.within(stormWorld, (planet) => planet.addDeposit("d_minerals_1"));
      })
      .else((c) => c.log("the hum went unheard"));
  },
  options: [{name: "Fascinating."}],
});

```

builds to `common/technology/hello_galaxy_resonance.txt`:

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
namespace = hello_galaxy

country_event = {
	id = hello_galaxy.1
	title = hello_galaxy.1.name
	desc = hello_galaxy.1.desc
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
						id = hello_galaxy.2
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
		name = hello_galaxy.1.a
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
the directories the game demands, keeping the module's name as each emitted
file's stem.

```
examples/hello-galaxy/
├── mod.ts             config + the fold
├── flags.ts           shared values live outside content/
└── content/
    ├── resonance.ts   → common/technology/hello_galaxy_resonance.txt
    │                  → events/hello_galaxy_resonance.txt
    └── amplifiers.ts  → common/technology/hello_galaxy_amplifiers.txt
```

`discoverContent(dir)` imports every module under a directory; export is
registration. Moving a definition to another module changes which file it is
emitted into and nothing else — ids are authored, never derived from layout,
and emission order is a function of the content alone, so reorganizing your
source changes zero bytes of output.

## A real language

The amplifier ladder in the tree above is one loop — five technologies, each
requiring the previous, costs on a curve:

```ts
const amplifiers: TechnologyItem[] = [];
let previous: TechnologyItem = resonanceTheory;
for (const [index, adjective] of
  ["Attuned", "Harmonic", "Coherent", "Superradiant", "Transcendent"].entries()) {
  const tier = index + 1;
  previous = defineTechnology({
    id: `hello_galaxy_tech_amplifier_${tier}`,
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

hasCountryFlag(flags.hello_galaxy_heard_the_hum);    // ok
hasCountryFlag(flags.hello_galaxy_heard_the_humm);   // typo: compile error
hasCountryFlag(planetFlags("surveyed").surveyed);    // wrong kind: compile error
hasCountryFlag("some_vanilla_flag");                 // raw strings still work
```

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

const geneTailoring = patchTechnology(
  vanilla.technology("tech_gene_tailoring").require("cost", "prerequisites"),
  (t) => ({
    cost: t.cost.value * 2, // cost is @tier3cost1 in the file — .value bakes it, visibly
    prerequisites: [...t.prerequisites, myNewTech],
  })
);

const mod = buildMod(config, [collection(undefined, [geneTailoring])], { vanilla });
```

Fields the transform doesn't touch are carried through byte-faithfully,
`@variable` references included. The build then emits the patch into a file
whose name is computed from the parsed load-order enumeration to provably
sort after every competing file — and fails loudly when no winning name
exists, when the registry's override rule is unverified, or when the install
version drifted from what the SDK was verified against. "Launched the game
and the override didn't take" becomes a build error.

## Packages

| Package | What it is |
| --- | --- |
| [create-stellaris-mod](packages/create-stellaris-mod/README.md) | `npx create-stellaris-mod my-mod` — detects your install and scaffolds a project that builds on the first `npm install` |
| [@pdx-ts/sdk](packages/sdk/README.md) | The SDK: definers, triggers/effects, scope safety, building, rendering, vanilla patching, mod-logic testing |
| [@pdx-ts/pdxscript](packages/pdxscript/README.md) | Standalone PDXScript parser/serializer — order-preserving, round-trip-verified, game-semantics-free |
| [@pdx-ts/stellaris-ids](packages/stellaris-ids/README.md) | Every identifier a real install defines, as version-pinned types — makes vanilla references compile-checked |
| [@pdx-ts/codegen-cwt](packages/codegen-cwt/README.md) | Rules-derived generator: emits the SDK's typed surface from the vendored cwtools rules |
| [@pdx-ts/codegen-vanilla](packages/codegen-vanilla/README.md) | Install-derived generator: emits @pdx-ts/stellaris-ids from an installed copy of the game |

At the root: `vendor/` (the committed cwtools rules and doc dumps),
`fixtures/` (the shared fake install the hermetic tests run against),
`examples/` (the quickstart and the hardening corpus), and `docs/` and
`design/` (dated design records and gated probes — check status headers
before treating one as current).

## Development

npm workspace; every command runs from the repository root.

```bash
npm test                     # all suites, all packages (vitest)
npm run typecheck            # tsc --noEmit
npm run typecheck:ids        # the stellaris-ids-present type program
npm run build                # emit dist/
npm run example              # build examples/hello-galaxy/out/
npm run codegen              # regenerate the SDK's types from the cwt rules
npm run codegen:check        # ...and fail if committed output moved
npm run codegen:vanilla      # regenerate stellaris-ids (needs an install)
npm run codegen:vanilla:check
npm run scaffold             # drive create-stellaris-mod from source
```

`create-stellaris-mod` is the one package with a build step, and it is forced
rather than chosen: `npx` installs a CLI into a real `node_modules`, and Node
refuses to strip types from anything under one. Every other package is consumed
through a workspace symlink, whose realpath escapes `node_modules` — which is
also why the SDK cannot be published in its current raw-`.ts` export shape, and
why a scaffolded project uses `--local` until that changes.

Contributor rules — codegen discipline, the content-registry procedure,
design boundaries — live in [AGENTS.md](AGENTS.md).

## Status

Prototype, unpublished, built and verified against Stellaris 4.4.6. Emitted
output is pinned by golden files, generated types by drift gates, override
behavior by an in-game calibration record, and the parser by a round-trip
fixpoint over the entire vanilla `common/` tree.
