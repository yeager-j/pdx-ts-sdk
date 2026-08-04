# Mod-capability probe

This is the SDK-72 design probe. It tests a mod-bound, immutable capability of
pure authoring functions:

```ts
const mod = createMod(config, { ids });
const theory = mod.technology("resonance_theory", {
  name: "Crystal Resonance Theory",
  // ...
});
const events = mod.namespace("resonance");
const feature = mod.feature("resonance", [theory, events.country(1, {/* ... */})]);
const compilation = mod.compile([feature]);
```

The probe is not a migration and nothing under `packages/sdk/src/` may depend on
it. Its result belongs in `docs/verdict/`.

## Escape criteria

These criteria were fixed before the probe implementation.

Adopt the capability design only if the probe demonstrates all of the
following:

1. **Purity is preserved.** `createMod` returns an immutable value whose
   authoring methods return inert items and register nothing. `compile` must
   delegate to the existing `buildMod` fold rather than reproduce it.
2. **Prefix authority is real.** Content ids, event namespaces, and full event
   ids are minted from a literal config prefix. Their public types retain the
   minted template literals, and callers cannot supply a second full id that
   can disagree with the capability.
3. **The capability closes a real composability gap.** One reusable pack,
   written only against the capability interface, must compile under two
   different literal prefixes while preserving correctly branded references.
4. **References improve by construction.** A minted content value must flow
   into its registry's reference fields and fail in another registry's fields.
   Event handles must support declaration before definition and a cyclic event
   pair without mutable registration or unresolved placeholder text reaching
   the fold.
5. **Current output is unchanged.** Capability-authored equivalents of both
   `examples/hello-galaxy` and `examples/hardening` must render byte-for-byte
   equal file maps to the current examples, including the hardening patch plan.
6. **Feature colocation and layout non-identity survive.** One feature must fan
   out across registries, and moving an otherwise identical definition between
   feature stems may change only its emitted path. Identity and serialized
   definition bytes must not change.
7. **Discovery has an honest contract.** The probe must implement and compare
   both viable contracts—an explicit feature export and today's every-export
   collection—then identify which invariant or ergonomic each preserves. The
   verdict must not silently choose for the maintainer.
8. **Code generation stays data-driven.** Moving generated definers onto the
   capability must have a measured, generic emitter change with no
   registry-name conditional. Any hand-written exceptions must already exist
   as reviewed overlay knowledge.
9. **Type-system cost stays inside the established completion budget.** A
   representative generated capability surface must preserve useful error
   messages and must not make a cold no-emit check more than 20% slower than
   the equivalent current free-definer fixture over five measured runs.
10. **The migration can be priced.** The verdict must enumerate public exports,
    generated files, source/tests/examples/docs call sites, and downstream
    authoring patterns that would change. A vague "mechanical" estimate does
    not pass.

Reject or redesign the capability if any of criteria 1–6 fail. Criteria 7–10
may produce an explicit maintainer decision or a priced follow-up, but they
must be answered before a migration is scheduled.
