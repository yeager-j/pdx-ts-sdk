# @pdx-ts/sdk-testing

`@pdx-ts/sdk-testing` runs recorded Stellaris mod logic without launching the
game. It supplies fixtures, a mutable simulated world, trigger evaluation,
event delivery, explanation trees, and optional Vitest matchers.

The interpreter is intentionally incomplete. It executes only game semantics
that have been reviewed and entered in a central whitelist. Unsupported script
throws instead of returning a result based on a guess.

## Installation

The package requires Node.js 22 or newer and `@pdx-ts/sdk`. Install Vitest only
when using the matcher subpath or Vitest as the test runner.

```bash
npm install --save-dev @pdx-ts/sdk-testing vitest
```

The core evaluator does not import a test framework.

## A complete event test

```ts
import { expect, test } from "vitest";
import { countryFlags } from "@pdx-ts/sdk/stellaris";
import { fixture } from "@pdx-ts/sdk-testing";

import { mod } from "../mod.ts";

const flags = countryFlags("mymod_welcomed");
const events = mod.namespace("welcome");

const welcome = events.country(1, {
  isTriggeredOnly: true,
  immediate: (country) => {
    country.setCountryFlag(flags.mymod_welcomed);
  },
});

test("the welcome event marks the country", () => {
  const world = fixture(
    { countries: [{ name: "player" }] },
    { events: [welcome] }
  );

  world.fire(welcome, world.country(0));

  expect(world.country(0).hasFlag(flags.mymod_welcomed)).toBe(true);
});
```

The fixture consumes the same event metadata and PDXScript entries that the SDK
would render. The test does not call a second implementation of the authored
TypeScript closure.

## How interpretation works

```text
SDK effect closure
  -> typed effect recorder
  -> PDXScript entries
  -> whitelist dispatcher
  -> mutable World state
  -> fired records, queued events, and explanations
```

`fixture(spec, { events })` validates the declared world and every event the
world may deliver. `world.fire()` delivers an event immediately.
`world.advance(days)` moves the discrete-event clock and drains due scheduled
fires in timestamp order. Delivered events can schedule more events into the
same queue.

The clock is not a game tick simulator. It does not run monthly income, mean
time to happen rolls, pull events, situation progress, or option selection.

## Fixtures and world state

The supported simulated scopes are:

- country
- planet
- fleet
- situation
- archaeological site

Fixture specs describe only state used by whitelisted semantics:

```ts
const global = globalFlags("lattice_awake");
const country = countryFlags("heard_the_hum");

const world = fixture(
  {
    globalFlags: [global.lattice_awake],
    countries: [
      {
        name: "player",
        flags: [country.heard_the_hum],
        resources: { energy: 24_000 },
        storage: { energy: 25_000 },
        planets: [{ name: "alpha", deposits: ["d_minerals_1"] }],
      },
    ],
  },
  { events: [] }
);
```

Entity handles such as `Country`, `Planet`, and `Fleet` are typed scope
witnesses as well as state accessors. Passing a planet handle to a
country-scoped trigger is a TypeScript error.

Storage is undeclared and unbounded by default. When a country declares a
resource capacity, `add_resource` clamps the resulting stockpile to it. The
fixture does not invent capacities because the real value depends on game and
mod state outside the test.

## Trigger evaluation and explanations

Use `evaluate` for a boolean result:

```ts
const holds = evaluate(hasCountryFlag(country.heard_the_hum), world.country(0));
```

Use `explain` when the reason matters:

```ts
const result = explain(potential, world.country(0));
console.log(renderExplanation(result));
```

`renderExplanation` formats the result as a nested pass/fail tree and includes
the world-state reason for each leaf, such as a named flag being present on the
selected country.

`evaluateWeightBlock` evaluates supported base, factor, add, and modifier
arithmetic directly against a simulated scope. This is useful for situation
progress formulas even though the World does not advance situation months.

## Event delivery and time

Delivery records the firing and runs the event's `immediate` block. It does not
select an option, re-check the event's `trigger`, or run `after`. An event that
contains executable structure the harness would skip is refused when it is
registered.

Options containing only metadata such as a name or icon remain deliverable.
Options with effects do not. `fireOnlyOnce` is enforced: a second delivery is
refused because executing the immediate twice would create a state the game
would not have produced.

`world.advance(30)` delivers scheduled events due during those 30 days. It
refuses to cross a month boundary while the fixture contains a situation whose
monthly progress would silently remain fixed. Set `staticProgress: true` on a
situation only when the test explicitly does not depend on progress changing.

Events with a declared FROM contract require a matching simulated scope witness
when fired. Ambient contracts the harness cannot model, such as deeper FROM or
PREV chains and split ROOT, are refused during registration.

## Deterministic random branches

The interpreter does not roll random numbers. Supply zero-based arm indices for
each `random_list` reached by an event chain:

```ts
world.fire(event, world.country(0), { arms: [1, 0] });
```

The plan is consumed in execution order and follows scheduled events through
the queue. A leftover arm or a missing choice fails the run. Arm indices, not
weights, identify branches, so lists with duplicate weights remain selectable.

## Vitest matchers

Install the optional matchers once in a setup file:

```ts
// vitest.setup.ts
import { installMatchers } from "@pdx-ts/sdk-testing/matchers";

installMatchers();
```

Then reference the setup file from `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./vitest.setup.ts"] },
});
```

The matchers include event-log and trigger assertions:

```ts
expect(world.fired).toContainEvent(followup, { day: 30 });
expect(potential).toHoldFor(world.country(0));
```

Trigger failures include the rendered explanation tree.

## The whitelist boundary

The whitelist classifies supported leaf triggers, combinators, effects,
structural effects, iterators, and scope links. Every implemented row carries a
short defense of its behavior. Rows based on Paradox's documentation also pin
the exact source paragraph by hash.

A changed documentation-dump version or a changed pinned paragraph fails the
whitelist audit until the affected claims are reviewed. Unpinned documentation
paragraphs are outside that hash check. Semantics established through an
in-game probe, such as event-target lifetime, are pinned to the verified game
build instead.

Scripted vanilla triggers and effects cannot run here. The identifier package
contains their names, parameters, and inferred scopes, but excludes their
bodies. The interpreter reports this boundary rather than treating the calls as
true, false, or no-ops.

A passing test proves the behavior of the modeled script under the declared
fixture. It does not prove unmodeled game systems around that script.

## Implementation

The package uses strict TypeScript and ESM. It depends on
`@pdx-ts/pdxscript` for syntax trees and consumes the SDK through public or
explicitly internal package exports. Vitest is an optional peer dependency.

```text
src/
|-- state.ts       fixture schema, mutable state, and typed entity handles
|-- world.ts       event registry, delivery, queue, and clock
|-- interpret.ts   trigger evaluation and effect execution
|-- whitelist.ts   audited semantic dispatch tables and documentation pins
|-- matchers.ts    optional Vitest integration
`-- index.ts       framework-independent public API
```

The separate package boundary keeps test-framework dependencies out of the SDK
and forces the interpreter to consume recorded script through a defined
interface.

## Development and verification

Run the root repository gates:

```bash
npm run typecheck
npm test
npm run build
```

Changes to modeled semantics need focused interpreter tests, whitelist audit
evidence, and refusal tests for nearby unsupported behavior. See the
[Simulation glossary](./CONTEXT.md) for the package's terms and design bar.
