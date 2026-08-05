# There is no mutable builder

`createMod(config)` returns an immutable capability whose methods mint ids and
return pure values that register nothing. `mod.feature(stem, items)` places
them, `mod.compile(features)` folds them into a `PureMod`, and `render`/`write`
turn that into bytes. A reader arriving from almost any other codegen or
document-building library will expect a mutable builder with an `.add()` and a
`.build()`, and will look for the one that isn't there.

The reason is that registration-on-construction makes emission order depend on
execution order, and this SDK's central promise is that it does not (see
[ADR-0005](./0005-emission-order-is-content-not-position.md)). Values that
register nothing can be created in any order, in any module, and moved between
modules, without changing a byte.

The cost, accepted: authoring is slightly more verbose, because items must be
explicitly placed rather than implicitly collected.

Evidence: `packages/sdk/tests/pure-api.test.ts` for the fold and its order
purity; `packages/sdk/tests/mod-capability.test.ts` for capability ownership;
`packages/sdk/tests/public-surface.test-d.ts`, which pins the absent builder by
asserting `buildMod`, `createFeature`, and `flattenItems` are not exported.
