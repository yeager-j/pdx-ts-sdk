# Emission order is a function of content, never of source position

Output order is derived entirely from what the content _is_: content sorts by
registry declaration order, then emitted file path, then id; event files sort by
path with numeric ids inside a file; on-action hook blocks, the contribution
sink, and the patch list sort by name or id. Source position, module layout,
export order, and the order features were passed are all ignored.

The exception, and it is deliberate: arrays _inside_ a definition —
prerequisites, event options, the event list in one `mod.on()` call — are
author data and are emitted as written.

This is a promise with tests behind it rather than a tendency. Reordering
features, exports, or authoring statements must not change a byte, and moving a
definition to another module must change only which file it lands in, never its
id, its bytes, or its position among its neighbours. It is what makes a
generated mod diffable across refactors, and it is why there is no mutable
builder ([ADR-0004](./0004-no-mutable-builder.md)).

Evidence: the order-purity test in `packages/sdk/tests/pure-api.test.ts` (two
reversed authoring orders rendering identically) and the identity-preservation
test in `packages/stellaris-ids/tests/example-mod.test.ts`, which freezes
hello-galaxy's content ids, event namespace, and localization keys across its
restructure into feature modules.
