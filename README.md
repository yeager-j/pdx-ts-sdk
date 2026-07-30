# @pdx-ts/sdk

A TypeScript SDK for Stellaris modding, in the AWS CDK / Pulumi mold: instead of
hand-writing PDXScript, you write TypeScript that executes at build time and
records the mod's source files, filenames, and folder structure.

There is no compiler. Your code really runs — loops, functions, and plain `if`
statements are build-time superpowers — and the SDK serializes the result to
PDXScript.

## Quickstart

```ts
import { and, hasCountryFlag, Mod, not } from "@pdx-ts/sdk";

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

`synth` writes a complete, launcher-ready mod folder: `descriptor.mod`,
namespaced `common/technology/*.txt`, and BOM-prefixed localization `.yml`.

## Design pillars

- **Triggers are expression trees.** `potential` takes a declarative condition
  built from combinators (`and`, `or`, `not`) and trigger builders
  (`hasCountryFlag`, `hasTechnology`, ...). Each builder returns an AST node.
- **Scope safety via types.** Triggers are branded with the scopes they are
  valid in. Passing a planet-scoped trigger to a country-scoped block
  (like a technology `potential`) is a compile error. All 41 scopes and the
  scope of every trigger are generated, not hand-maintained.
- **Two kinds of time.** A plain TypeScript `if` branches at _build_ time —
  use it freely to generate variants. Triggers describe _in-game_ conditions;
  using one in a TS `if` is a compile error (and a runtime error with an
  explanatory message if forced).
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

Prototype: the technologies vertical, with types generated from
cwtools-stellaris-config. Next slices (see design notes): events with
recorded-closure effects and typed scopes/`iff()`, then the PDXScript parser
unlocking patches, real identifier namespaces, and the load-order linter.
