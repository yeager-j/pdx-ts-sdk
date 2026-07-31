# Handoff: patches that provably win

The next vertical. Written after the parser landed as `@pdx-ts/pdxscript`,
for whoever picks this up.

Read [verdict-parser-probe.md](verdict-parser-probe.md) for the typed-surface
decisions this builds on. The empirical spine of this slice is external:
`stellaris-docs/docs/spikes/resolver-evaluation.md` (Jackson's
resolver-evaluation spike, pinned to Pegasus v4.4.6) — every override-
semantics claim below cites it, and where it marks a cell open, this slice
refuses rather than guesses.

## The goal

```ts
const vanilla = stellaris.load(); // install located, parsed, cached by content hash

mod.patchTechnology(vanilla.technology("tech_gene_tailoring").require("cost"), (t) => ({
  cost: t.cost.value * 2,
  prerequisites: [...t.prerequisites, myNewTech],
}));

await mod.synth("./out");
// emits the complete patched object into a file whose name is COMPUTED to
// sort after every surviving file defining the key — and the build fails
// loudly if no such name can win, or if the rule for this registry is
// unverified. "Launched the game and the override didn't take" becomes a
// build error.
```

The win-assertion is the load-order linter's core, delivered inside the
patch slice: a patch that cannot prove it wins is not a patch, it is a
lottery ticket.

## The empirical model (superseding the old four-group notes)

The resolver-evaluation spike's central result: **there is no layer
precedence for distinct paths.** One algorithm, verified dual-channel
in-game:

1. Same-path file collisions resolve first (the mod's file replaces
   vanilla's outright — the loser contributes nothing).
2. Every surviving file enumerates in one global order: normalized logical
   path (NFC, `/` separators, UTF-8 byte sort), then definition ordinal
   within the file.
3. On a repeat registration, the registry's own rule applies: technologies,
   buildings, scripted triggers/effects, sprites are **last-wins**; events
   and scripted constants are **first-wins**. "The mod wins" is never a
   rule — it is a consequence of where the filename sorts. (`r10`: a
   technology in `!!!_oracle_tech.txt` *lost* to vanilla while an event in
   the same mod *won* — the exact inversion of any layer model.)

Consequences the SDK encodes:

- **To win a technology override**: the emitted file's normalized path must
  byte-sort after *every* surviving file containing the key. Computed from
  the parsed install, never assumed from a `zz_` prefix.
- **Whole-object replacement is proven for technologies** (omitted field =
  absent, not inherited) — the transform-patch design emits complete
  objects, so this is satisfied by construction, and the linter asserts it.
- **Never emit at a vanilla path** unless re-emitting every key in that
  file: the spike's path-collision run killed two vanilla techs, orphaned
  61 references, and threatened startup. The SDK's namespaced filenames
  already prevent this; a lint makes it impossible.
- **Resolve `@variables` and expand `inline_script` ourselves**: the game
  is *silent* on an unresolved constant (it corrupts the rest of the file)
  and silent on a skipped expansion. Both are already SDK policy; the spike
  proves the silence.
- **ASCII-only emitted filenames, by policy**: the byte comparator is
  validated only on ASCII discriminators; staying inside verified territory
  costs nothing.

## Per-rule confidence, encoded

The rule table carries the spike's verdicts and refuses on open cells — the
overlay discipline applied to override semantics:

| Registry | Rule | Assert wins? |
| --- | --- | --- |
| Technologies | last-wins, whole-object (`r0,r1,r4,r10`) | yes |
| Buildings | last-wins, whole-object (`r8`) | yes (when that vertical exists) |
| Scripted effects/triggers | last-wins (`r1,r4`) | yes; parameter behavior open |
| Events | first-wins — sort *before* (`r8–r10`) | yes (when patching events lands) |
| Scripted constants | first-wins, cross-source settled (`r19`) | yes |
| Megastructures | last-wins, but merge-vs-replace **inconclusive** | **refuse** |
| Ship components | duplicate winner **undetermined** | **refuse** |
| Localization | layer-ordered, filename irrelevant (`r13–r16`) | different mechanism; `replace/` policy stands |

Every rule pins `verifiedAgainst: "4.4.6"`; a game update flags the table
stale rather than silently trusting it — the drift-baseline discipline
pointed at reality.

## Scope: two contributors, honestly

The spike's evidence is vanilla + one mod. The v1 claim is exactly that:
**your override provably beats vanilla.** Beating arbitrary third-party
mods needs playset enumeration (`launcher-v2.sqlite`) and multi-mod
interleaving evidence that does not exist yet — the linter must say
"unverified against other mods", not pretend. Playset awareness upgrades
the claim later without changing the API.

## What you already have for free

|  |  |
| --- | --- |
| The parser, gated four ways | `@pdx-ts/pdxscript` — fixpoint over all of vanilla `common/`, jomini differential, properties |
| The typed surface design, verdict-bound | `design/parser-probe/` — `ParsedNumber`, `require()`, in-place substitution, `rest` carry-through |
| Positions on every entry | the linter's citations (`file:line`) come free from the package |
| The install, already exercised | corpus tests locate and parse it today |
| Version-drift hashing inputs | the model layer holds the vanilla bytes; hash at parse time |
| The comparator spec | `stellaris-docs/docs/technical-design.md` (NFC, byte sort) — one implementation, shared with the docs project |

## The open questions

**1. OR-prerequisites in the typed surface.** The parser hands over
`prerequisites = { tech_stingers OR = { ... } }` as ordinary data; the
probe's `TechnologyRef[]` cannot hold it, and five vanilla files use it.
Proposed: `prerequisites: (TechnologyRef | AnyOf<TechnologyRef>)[]` with an
`anyOf(...)` constructor, so `[...t.prerequisites, myTech]` still reads
clean. Settle before the surface lands in `src/`.

**2. Where the install comes from.** Steam default path per platform, an
env/config override, and a clear error when absent. The cache (parse
results keyed by content hash) decides whether `load()` is 100ms or 10s on
rebuild — the design notes demand fast and idempotent.

**3. `technology_swap` under patching.** The spike does not cover swap
semantics. The surface carries swaps through `rest` untouched — that is the
only defensible v1; patching *into* a swap is refused until evidence
exists.

**4. The resolver as shared code.** The docs project and the SDK now need
the same comparator and the same rule table. The parser already became a
shared package; whether the resolver follows (or the SDK vendors the
comparator spec) is a judgment call worth making deliberately, not by
drift.

## The trap that will get you

**Claiming wins beyond the evidence.** The whole point of the confidence
table is that "probably wins" is indistinguishable from "wins" until a
player loads the game. A linter that asserts a megastructure override, or
a win against an unenumerated third mod, manufactures the exact false
confidence the evaluator probe was designed to avoid. Refuse loudly; the
error message cites the open cell.

## Suggested first probe

Same playbook: hand-write the goldens first, in `design/patch-probe/` (or
straight to implementation if the surface promotion feels probe-covered —
the typed surface *was* probed; the genuinely new machinery is the
win-assertion).

> Patch the real `tech_gene_tailoring` from the local install: `cost.value
> * 2`, one appended prerequisite. The emitted file's name is computed
> against the actual parsed `common/technology` enumeration and the build
> proves it sorts after `00_soc_tech.txt` and every other file defining the
> key. A second, adversarial fixture: a synthetic "vanilla" tree where the
> key's last definition lives in `zz_zz_late.txt` — the computed name must
> beat it or the build must fail with the reason. A third: attempt to patch
> a megastructure — the build refuses, citing the inconclusive cell and the
> spike. Golden-pin the emitted file name, the emitted content, and both
> error messages.

**Gate — the model holds iff:** the patched emission is complete and
byte-stable; the winning filename is computed from parsed reality and the
win-assertion names every file it beat; refusals cite their open cell; and
nothing — not the install location, not a hash, not a rule — is assumed
silently. **Escape hatch needed means:** any hardcoded `zz_` prefix, any
win asserted for an unverified registry, or an install-reading layer so
slow the check gets skipped in practice. In-game verification of one real
patched tech (console `research_technology`, cost check) is the
calibration anchor — do it once, record it, pin the build number.

## Conventions worth keeping

- The rule table is this slice's overlay: one audited file, every row
  citing its oracle run, `Pending` cells refuse — never a generic
  fallback.
- Complete objects, always; namespaced filenames, always; ASCII filenames,
  by policy.
- The probe (if run) stays in `design/`, the verdict goes in `docs/`,
  goldens are the acceptance test.
- The game build is part of every claim. Pegasus v4.4.6 today; an update
  invalidates until re-verified.
