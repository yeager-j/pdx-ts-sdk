# Handoff: the vanilla surface

> **Both parts landed.** Part 1 as SDK-12 (2026-08-02), Part 2 as SDK-13
> (2026-08-02). Kept as the design record — but read
> [verdict-scripted-scope.md](../verdict/verdict-scripted-scope.md) before treating Part 2
> as current: **its ruling against inferring scope was reversed**, and what
> shipped infers scope for 90% of scripted triggers. The rest of Part 2 stands,
> as the fallback for definitions no install-derived package can know.
>
> Originally: a proposal of 2026-07-31, on two problems that turned out to share
> one answer — type-safe references to vanilla content, and binding vanilla
> scripted triggers and effects. Supersedes the "audited overlay vs. body
> inference" framing in
> [coverage-dawn-of-ascension.md](../coverage/coverage-dawn-of-ascension.md).

## The problem

`../../AGENTS.md` states the boundary: cross-content references stay branded objects
"where the generated rules know the registry. Use raw strings only for
intentional vanilla or third-party references supported by the API."

Vanilla references are the one place the SDK knowingly degrades to strings. A
prerequisite on `tech_gene_tailoring`, a patch target, a building that requires a
vanilla technology — all unchecked. A typo is a silent no-op in game.

Separately, the Dawn of Ascension survey found that vanilla _scripted_ triggers
are invisible to codegen entirely: `is_fallen_empire` appears 214 times in that
mod and exists in neither the generated surface nor the CWT rules, because it is
vanilla script rather than a game primitive. Vanilla ships ~1449 scripted
triggers and ~1455 scripted effects.

Both are the same gap: the SDK generates from CWT rules, which describe what
_fields_ exist, and has no generated knowledge of what _ids_ exist.

## Part 1: a vanilla package

Ship a separate package — install-derived, version-pinned to the game — carrying
the identifiers vanilla defines.

### Types only

References are branded objects, not strings, so the ergonomic shape is a
literal-union constraint rather than thousands of materialized consts:

```ts
prerequisites: [vanillaTech("tech_gene_tailoring")];
```

Zero runtime payload; a typo is a compile error. This is the same pattern
`raw()` already uses against `keyof ScopedModifierBlock<S> & string`.

### Per-registry segmentation is a constraint, not a preference

The scoped-modifier work established this empirically: 45,501 flat modifier names
compiled fine (0.46s tsc) but made WebStorm completions multi-second. The fix was
structural — a path trie — and TS 7 alone did not help. Compile time was never
the problem; **editor completion-menu size** was.

Vanilla ids across every registry are the same order of magnitude. 679
technologies in one union is a comfortable menu. All vanilla ids in one union
reproduces the flat-modifier failure exactly.

So `vanillaTech(...)` / `vanillaBuilding(...)` — or a `vanilla.tech.*` namespace —
is the same mitigation the trie was. Do not later collapse this into one union.

### The package version is the game version

The SDK's own version can never express "this matches Stellaris 4.4.6." A
separate package can, multiple game versions can coexist, and it regenerates on
Paradox's cadence rather than the SDK's.

The existing `StaleRuleTableError` gate extends directly: package pin vs. install
version mismatch should fail loudly, never drift silently.

### CWT-derived and install-derived stay separate

`src/generated/` is CWT-derived — it knows what fields exist. This package is
install-derived — it knows what ids exist. Different sources, different
regeneration triggers, different failure modes. Separate packages make that
legible rather than something to remember.

**Decided:** this does NOT absorb the vendored `modifiers.log`. That dump is
load-bearing for the authoring API's modifier trie and should not sit behind an
optional dependency. The current arrangement works; leave it.

### It does not replace `stellaris.load()`

Patch emission still needs real file content, shas, load order, and file-local
`@vars` to compute a winning filename. The split:

- the package makes patches type-safe to **author**
- the install stays required to **emit** them

This keeps the win-assertion honesty fully intact, and makes task #11
(generalize patching beyond technology) meaningfully nicer to use.

### Licensing boundary

The package is derived from shipped game files, so the boundary is part of the
generator's contract, not an afterthought.

**Test: could this substitute for owning the game?** For identifiers, clearly no.

- **Emit:** ids, definition names, scripted trigger/effect names and their
  `$PARAM$` lists, event ids and namespaces
- **Never emit:** script bodies, localized text, descriptions, asset data

This is the narrow position and matches what cwtools already publishes. Encode it
as a generator constraint so it cannot erode by accident.

## Part 2: scripted trigger and effect scope

### Why not body inference

Inference is not merely imperfect — it is unfalsifiable where it matters. A body
of `has_country_flag = x` is obviously country scope. The triggers you would
actually want help with are the ones that delegate to other scripted triggers,
branch on `exists = owner`, or are deliberately written to work in two scopes.
Inference would be confidently right on the easy majority and quietly wrong on
the rest — the worst distribution, because it teaches you to trust it.

This also contradicts the house rule that unsupported game semantics should fail
loudly rather than be guessed.

**Decided: opt-in assertion.**

### Existence and parameters are checked; only scope is asserted

The parser yields each trigger's name and `$PARAM$` list. So:

- a typo in the name is a hard build error
- wrong parameters are a type error
- **only the scope** is an unverified claim by the author

Make this explicit in the API surface so nobody assumes the whole binding is
unchecked. It is a much better deal than "assertion" implies.

### Assert once at the declaration, not per call site

DoA calls `is_fallen_empire` 214 times. A call-site assertion would decay into
copy-paste noise. The declaration is the right home:

```ts
const isFallenEmpire = scriptedTrigger("is_fallen_empire", "country");
```

From there it is an ordinary `Trigger<"country">`, and the existing contravariant
scope brand makes wrong-scope use a compile error — real safety, conditional on
the assertion being honest.

Because the package makes names checkable offline, this works without an install.

### The escape hatch is real and should be deliberate

Asserting `ScopeName` yields "fits everywhere," so an author can opt out of
safety in one keystroke. That is probably correct — honest and opt-in — but
decide it rather than discover it.

### Later, not now

An audited scope overlay composes with assertion instead of competing with it:
ship reviewed scopes for the common triggers, let the long tail take the one-line
declaration. That buys hot-path ergonomics without owing 1449 scope judgments up
front.

The whitelist-based mod-testing evaluator is a natural backstop — an
asserted-scope trigger evaluated in the wrong scope is exactly what it could
catch. Worth designing toward even if not built now.

## What changed, and why the reversal is not a contradiction

**"Why not body inference" was answered against a different proposal than the
one that shipped.** The objection was that inference is "unfalsifiable where it
matters" and would be "confidently right on the easy majority and quietly wrong
on the rest." That is true of heuristics over what a body _means_ — reading
`exists = owner` and deciding what the author intended.

What shipped never asks. It intersects the scopes the CWT rules already declare
for the keys a body evaluates: `is_country_type` is country-scoped, so a body
that evaluates only it can only be a country trigger. Every key the rules do not
cover contributes nothing rather than a guess, `OR` unions rather than
intersects, a pushed scope contributes nothing to its caller, and an empty
result falls back to unconstrained. The distribution of errors is therefore
inverted from the one this note feared: too wide is the `Trigger<ScopeName>`
that shipping nothing would have given, and too narrow is a compile error with
an escape hatch. Neither is silent.

It is also falsifiable, which was the sharpest word in the original objection.
Vanilla's own event files declare their scope, so 4,860 real call sites can be
checked against the inference; zero contradict it, and mutating the analysis to
mishandle nesting produces 328. The evidence is in
[verdict-scripted-scope.md](../verdict/verdict-scripted-scope.md).

**The open question at the bottom of this note is answered: yes.** Scripted
effects need one thing beyond the trigger treatment. A trigger is a value that
travels, so a binding returns a `Trigger`; an effect records into a sink the
scope object closes over and nothing outside can reach, so a binding returns an
inert call that `scope.run(...)` splices. Exposing the sink instead would have
put the scope check on structural typing and opened the recorder to arbitrary
entries.

## Decided

- Separate install-derived package, version-pinned to the game
- Types only, literal-union constraints, no materialized ref objects
- Per-registry segmentation, for the measured editor-performance reason
- Does not absorb `modifiers.log`; does not replace `stellaris.load()`
- Emits identifiers only, never script bodies or localized text
- ~~Opt-in scope assertion for scripted triggers and effects, asserted once at
  the declaration, with existence and parameters checked~~ — **superseded.**
  Scope is inferred where the rules support it and asserted only for definitions
  no install-derived package can know.

## Open

- One package per game version, or one package with versioned subpaths?
- Package naming under the `pdx-ts` npm org
- Which registries ship in the first cut (technologies and ascension perks are
  the obvious starters; events and buildings close behind)
- Whether scripted _effects_ need anything beyond the trigger treatment, since
  they must also record into the effect AST
