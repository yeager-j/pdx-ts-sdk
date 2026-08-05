# @pdx-ts/sdk-testing

Test Stellaris mod logic without launching the game.

Because [@pdx-ts/sdk](../sdk/README.md) records triggers and effects as data
rather than emitting text directly, that data can be interpreted outside the
game: event chains get unit tests that run in milliseconds, and a failing
trigger can say _which_ subcondition failed.

```ts
import { fixture } from "@pdx-ts/sdk-testing";

const world = fixture({ countries: [{ name: "player" }] }, { events: [welcome] });

world.fire(welcome, world.country(0));
world.advance(30); // delivers due scheduled fires

expect(world.country(0).hasFlag(flags.welcomed)).toBe(true);
```

For triggers, `explain` answers "why doesn't my `potential` pass":

```
✗ AND
  ✓ has_global_flag = lattice_awake — set globally
  ✓ has_country_flag = heard_the_hum — set on country "player"
  ✗ NOT
    ✓ has_country_flag = pacifist_path — set on country "player"
```

## Whitelist-only, on purpose

The interpreter is a **second implementation of the game's semantics**, so it is
deliberately whitelist-based: everything it models carries a one-line defense of
the real game's behavior, and anything unmodeled throws instead of guessing. A
test can only pass through semantics somebody consciously verified.

That is also why a passing test is a narrower claim than it looks. It says the
logic you wrote does what you meant — not that the game agrees about everything
surrounding it.

## Matchers

The evaluator itself has no test-framework dependency. Vitest matchers are a
separate subpath, installed explicitly:

```ts
// vitest.setup.ts
import { installMatchers } from "@pdx-ts/sdk-testing/matchers";

installMatchers();
```

Then `expect(world.fired).toContainEvent(event, { day: 30 })` and
`expect(trigger).toHoldFor(scope)`, whose failure message is the rendered
explain tree.

## Why this is not part of @pdx-ts/sdk

Two reasons, and the second is the one that keeps paying.

The matchers integrate with a test framework, so this package peer-depends on
vitest (optionally — the evaluator alone does not need it). That dependency does
not belong in an SDK whose job is emitting game files.

And a package boundary forces these helpers to consume the SDK through its
**public interface**, which is the honest test surface. Splitting the package
found exactly one place where they had been reaching past it: the interpreter
imported the generated `EFFECT_META` table to answer a yes/no question about a
key. That is now `isEffectKey` on the SDK's public API, and the generated
table's shape stayed private where it belongs.

## Vocabulary

This package is the [Simulation](./CONTEXT.md) context. Its glossary is the authority
for what these words mean; the [context map](../../CONTEXT-MAP.md) shows how they change
at the boundaries with the other contexts.
