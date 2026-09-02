# Install-derived identifiers are a separate package and a separate generator

Vanilla's identifiers come from an installed copy of the game
(`@pdx-ts/codegen-vanilla` → `@pdx-ts/stellaris-ids`); the typed authoring
surface comes from a pinned cwtools config fork (`@pdx-ts/codegen-cwt` →
`packages/sdk/src/generated/`). Merging them into one generator would have been
the obvious economy, and it is refused: the two have different sources,
different regeneration triggers (a game patch versus a rules update), and
different failure modes, and only one of them can run in CI at all.

Two further consequences followed from the split rather than from either half.
`@pdx-ts/stellaris-ids` was an _optional_ dependency reached by declaration
merging — absent it, vanilla references degraded to unchecked `string` per
registry instead of failing to compile. And its licensing boundary is enforced
by a chokepoint in the generator rather than by convention, because "we only
emit identifiers" is a claim that has to survive contributors who did not read
this file.

The optional-dependency half is reversed by
[ADR-0006](0006-stellaris-ids-is-a-hard-dependency.md): the package is a hard
dependency, the SDK imports its tables, and the degraded mode is gone. The
split and the chokepoint stand.

Evidence: `packages/stellaris-ids/PROVENANCE.md` for the licensing boundary;
`packages/codegen-vanilla/tests/callsites.test.ts` for the scope inference the
install-derived half rests on.
