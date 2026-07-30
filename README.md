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
  potential: and(
    hasCountryFlag("heard_the_hum"),
    not(hasCountryFlag("pacifist_path")),
  ),
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
  (like a technology `potential`) is a compile error.
- **Two kinds of time.** A plain TypeScript `if` branches at *build* time —
  use it freely to generate variants. Triggers describe *in-game* conditions;
  using one in a TS `if` is a compile error (and a runtime error with an
  explanatory message if forced).
- **Cross-references are objects.** `prerequisites: [theory]` instead of
  `"tech_x"` strings: typos become compile errors, "find usages" works, and
  localization keys ride along on the object.

## Development

```bash
npm test           # snapshot + type-level tests (vitest)
npm run typecheck  # tsc --noEmit
npm run example    # generate examples/hello-galaxy/out/
npm run build      # emit dist/
```

The golden files under `tests/__snapshots__/hello-galaxy/` are the emitted
PDXScript, reviewable in PRs.

## Status

Prototype: the technologies vertical only. Next slices (see design notes):
events with recorded-closure effects and typed scopes/`iff()`, type generation
from cwtools-stellaris-config, then the PDXScript parser unlocking patches and
the load-order linter.
