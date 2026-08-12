# Importing a PDXScript mod as generated TypeScript

> **Rough draft, 2026-08-12 — proposal, not a decision.** Nothing here is
> implemented. The measurements come from a working spike (`spike/run.ts` on the
> `claude/pdxscript-to-typescript-spike-317579` branch); the open questions at
> the end are the ones that would settle it.

## The adoption barrier is the thing this attacks

The README is candid about the trade against the IDE plugins: they "work on any
existing mod with zero adoption cost," while the SDK asks you to rewrite in
TypeScript before it gives you anything. For the authors we most want — people
maintaining substantial existing mods — that is the difference between
evaluating the SDK and dismissing it.

An importer inverts the compiler: parse an existing mod, emit generated
`@pdx-ts/sdk` TypeScript that builds back to the same mod, and let the author
port incrementally from a compiling project instead of from zero. Nothing else
on the roadmap buys that.

## What the spike established

The mechanical inversion is mostly free. The parser is lossless and
order-preserving; every registry's generated `ContentField` table (key ↔ member
↔ shape) inverts directly; `Trigger` is already a raw entry tree, so trigger
blocks import losslessly; `fieldEntries` already splices passthrough nodes
(built for patches). The spike raiser covers nine shapes in ~300 lines.

Measured against the two standing targets:

|                                          | Dawn Of Ascension (parity target) | Gigastructural (scale benchmark) |
| ---------------------------------------- | --------------------------------- | -------------------------------- |
| definitions in covered registries        | 719 of 761 in `common/`           | 4,252 of 13,033                  |
| field groups typed + round-trip-verified | 90.3% of 6,259                    | 79.6% of 26,193                  |
| drift after fixes                        | **0**                             | 0.3%                             |
| carried as explicit raw PDXScript        | 8.8%                              | 11.1%                            |
| `name` text recovered from localisation  | 500/719                           | 2,952/4,252                      |
| events (no surface today)                | 158                               | 2,155                            |

Two readings. For a manifest-shaped mod, the output is a genuine head start —
real `mod.technology(...)` calls with recovered English text, raw islands only
where no typed surface exists. And the ceiling is exactly registry coverage:
Giga keeps two-thirds of its definitions in registries the SDK does not expose
(scripted triggers/effects, button_effects, inline_scripts, script_values,
deposits, districts), so the importer's value grows automatically with every
registry the parity push lands.

## Reliability is the round-trip gate, and only the gate

The user-facing promise has to be: **nothing is silently dropped or
reinterpreted.** The spike's mechanism delivers it cheaply. Every raised field
is immediately re-lowered through the SDK's real `fieldEntries` and
tree-compared against the original parse (canonically, and order-insensitively
within entries-only blocks per ADR-0005). A field either round-trips, is
carried as raw PDXScript the build re-emits verbatim, or the definition is
refused by name — there is no fourth outcome.

The gate demonstrably works: it caught the spike's own raiser bugs (360 drifts
→ fixed → 0), and two live SDK bugs in one afternoon — `economicOperation`
lowers amounts with bare `kv()`, so a `@variable` amount is defensively quoted
and the game reads a literal string (139 occurrences in DoA alone;
`weightBlock.base` has the same flaw), and `upgrades = {}` is silently dropped
(absent-vs-empty needs a decision). Those two are worth fixing now, importer or
no importer.

That second finding suggests the spike's most valuable artifact is worth
keeping regardless of this proposal: promoted to a standing test that
round-trips vanilla plus the benchmark mods through the field tables, the gate
is a falsification gate for the lowering the same way
`codegen-vanilla/tests/callsites.test.ts` is for scope inference.

## What must exist first

These are prerequisites, and two of them touch guarantees the SDK currently
sells — they should be designed as their own decisions, not under importer
pressure:

- **Preserved foreign ids.** `assertCapabilityItem` throws on any content id
  outside the mod prefix, and it is right to. An imported mod must keep its
  original ids or every cross-reference and savegame breaks. Probably an
  explicit imported-mod mode with its own stated rules, not a loosening of the
  normal surface.
- **Raw escape hatches.** A def-level `raw()` rest carrier and a raw-effect
  constructor (the recorder's sink is already `PdxEntry[]`; the constructor is
  small). Same caution: explicit, visible islands — not a general bypass.
- **An events import surface.** Events are a large share of any real mod and
  the namespace/id minting is prefix-derived today.
- **Scripted triggers/effects as functions.** For a mod like DoA these are the
  identity of the mod, and the right projection is TS functions — which means
  designing `$PARAM$` substitution semantics. Real design work, not mechanical
  inversion; scope it deliberately or explicitly out of v1.

## The product shape

`create-stellaris-mod --from <modDir>`: scaffold a project, run the importer,
emit one module per source file (feature grouping is author knowledge and
cannot be derived — the honest projection is the file structure they already
have), join localisation text back onto definitions, and print an import
report in the same spirit as the codegen report: every raw island, every
refused definition, every unmapped key, visible and counted.

## Costs to be honest about

- **The raiser couples to every future shape.** Each new `ContentShape` or
  registry wants a raise arm, or its fields quietly degrade to raw islands.
  Data-driven off the same tables, the increment is small — but it is a
  standing tax on codegen work.
- **Escape hatches dilute the pitch.** The SDK's story is "guarantees about
  what ships"; imported raw islands are exactly the untyped text the story
  defines itself against. Mitigation: islands are explicit in source, counted
  in the report, and the natural unit of incremental porting.
- **Expectation management.** Import produces a _starting point_, not an
  idiomatic port: no feature grouping, no loops, `rawTrigger()` instead of
  typed builders until someone inverts `EFFECT_META`/the modifier tables for
  emission. Worth saying loudly in the tool's own output.
- **Sequencing.** Built today, the importer imports the mods that need it least
  best. Every registry the parity push lands raises the ceiling for free, so
  this belongs behind the parity milestone.

## Open questions

1. **Id preservation: what exactly does imported-mod mode relax, and what does
   it still refuse?** This is the load-bearing design decision and is
   ADR-shaped.
2. **Refusal granularity.** When one definition fails the round-trip gate, does
   the importer refuse the definition (carry it as a raw file), the file, or
   the run? The spike suggests per-definition with a named report line.
3. **`$PARAM$` substitution semantics** for scripted triggers/effects → TS
   functions: in scope for v1, or explicitly out with raw carriage?
4. **Where does the round-trip gate live if the importer waits?** As a
   maintainer-local, install-gated corpus test (like `callsites.test.ts`), or
   in CI against committed fixtures?
5. **Events projection.** Import numeric ids into the existing
   namespace/handle model, or a dedicated imported-event surface that keeps
   foreign namespaces verbatim?

## Not covered here

Inverting `EFFECT_META` and the modifier tables to emit idiomatic builder calls
(`m.country.energy.produces.mult(0.05)` instead of a raw island) is an emission
quality upgrade the import architecture does not depend on; it can land
incrementally per shape after the fact. The two lowering bugs the spike found
stand on their own and should be fixed immediately regardless of any decision
here.
