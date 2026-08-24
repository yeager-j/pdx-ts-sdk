# Subpath exports encode package boundaries

`@pdx-ts/sdk` publishes five entry points, one per kind of consumer:

- `.` — the pipeline: configure, discover, build, materialize. `createMod`,
  `discoverFeatures`, `render`, `write`, `install`, the terminal helpers
  (`runBuild`, `runInstall`), the error classes, and the mod-level dev tools
  (`inspectSolarSystem`, `writeSystemPreviews`).
- `./stellaris` — the game vocabulary: what an author types inside defs,
  trigger expressions, and effect closures. Combinators, the generated
  triggers and scope links, value-set factories, branded refs and enums,
  content and event types, `onActions`, `eventTarget`, `scriptedTrigger`/
  `scriptedEffect`, and the `vanilla` reference builders.
- `./installation` — the player's installed copy of the game: `locateInstall`,
  `load`, `modDir`, version reading, and the parsed-vanilla surface
  (`VanillaView`, `ParsedDefinition`, `anyOf`).
- `./reference` — machine-readable facts about the SDK, for tools that reason
  *about* the surface rather than author with it: the registry descriptors,
  field-docs ledger, script-reference tables, `EVENT_KINDS`, and
  `SUPPORTED_STELLARIS_BUILD`.
- `./internals` — unstable machinery with no semver guarantee: the effect
  recorder, policy tables, recovery operations, identifier plumbing, ordering
  comparators, and the raw PDXScript constructors. `@pdx-ts/sdk-testing`'s
  interpreter is the named consumer.

The admission criterion is the kind of sentence the name appears in. A name an
author writes inside a def or expression belongs to `./stellaris`; a name a
build script calls belongs to `.`; a table a tool reads belongs to
`./reference`; machinery no author names belongs to `./internals`. For
generated names, `codegen-cwt/src/policy/public-surface.ts` already states the
same rule ("a type is public because an author must be able to name a value of
it") and gates drift.

The vocabulary is one subpath, not several. An earlier sketch split
combinators (`and`, `or`) from trigger leaves (`hasCountryFlag`) and both from
scope links — but those interleave inside single expressions
(`and(hasCountryFlag(...), not(...))`), so the seam would cut through every
`potential` and `limit` an author writes. There is also no symmetric
`/effects` to justify a `/triggers`: per [ADR-0001](0001-triggers-are-trees-effects-are-closures.md),
effects are methods on the recorded scope proxy, not importable functions.

Each name has exactly one public home. The root's former `export * as
stellaris` namespace mirror is gone, and no entry re-exports another entry's
names; a type referenced by signatures on two surfaces is exported where
authors name it and imported internally by relative path everywhere else.
Error classes are defined once in `errors.ts` and exported only from the
root, so `instanceof` holds regardless of which entry threw.

Two consequences bind future changes. `@pdx-ts/stellaris-ids`' generated
modules import their ref types and `scriptedTrigger`/`scriptedEffect` from
`@pdx-ts/sdk/stellaris`; moving those names is a lockstep change to the
`codegen-vanilla` emitters plus a full regeneration. And per
[ADR-0005](0005-emission-order-is-content-not-position.md), none of this
reorganization can change emitted mod bytes — entry layout is invisible to
the game.

The name `./installation` is deliberate: `./install` reads as the verb and
collides with the root's `install()` (which installs the *built mod* into the
launcher directory — the opposite direction), and the old name `./stellaris`
now means the vocabulary, not the install.

Evidence: `packages/sdk/tests/public-surface.test-d.ts` gates each entry's
surface and asserts evicted names stay evicted.
