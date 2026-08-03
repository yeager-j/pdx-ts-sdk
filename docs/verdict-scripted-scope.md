# Scripted-scope verdict: the inference holds, and it is not the inference the handoff rejected

Stage 0 of SDK-13, per [the plan](handoff-vanilla-surface.md)'s Part 2 being
reopened. The probe lives in `design/scripted-scope-probe/` and stays there — it
is the design record, not the implementation.

## The judgment

**Scope can be inferred for vanilla's scripted triggers and effects, soundly,
from facts codegen already owns.** The analysis intersects the scopes the CWT
rules declare for the primitives a body evaluates; every key the rules do not
cover contributes nothing rather than a guess. It narrows 90% of scripted
triggers and 63% of scripted effects, and it contradicts none of the 4,860 call
sites vanilla itself ships.

Acceptance results:

| Check | Bar | Result |
| --- | --- | --- |
| False narrowings against real call sites | 0 | **0** of 4,860 checked, 894 definitions covered |
| Agreement with a hand-derived golden | all | **12 of 12**, derived before the analysis ran |
| Negative cases left unconstrained | all | **6 of 6** |
| Triggers narrowed at all | worth shipping | **1,462 / 1,618 (90.4%)** |
| Triggers at ≤3 scopes | ≥60% proposed | **880 / 1,618 (54.4%)** — missed, and it does not matter (below) |
| Parse repairs in bodies the analysis reads | 0 | **0** |

The one bar missed was the wrong bar. It was proposed before any measurement,
on the assumption that a scope set is only useful when it is nearly a single
scope. The distribution says otherwise: 1,257 triggers (77.7%) land at five
scopes or fewer, out of 41. A five-member `Trigger<"country" | "sector" | ...>`
rejects 36 wrong scopes at compile time. Against today's `Trigger<ScopeName>`,
which rejects none, that is most of the available win, and the ≤3 line was
measuring tidiness rather than safety.

## Distribution

```
trigger: 1618 definitions from 37 files (0 parse diagnostics)
  exactly one     680 (42.0%)
  at most three   880 (54.4%)
  at most five   1257 (77.7%)
  unconstrained   156 (9.6%)
  of which empty    4

effect: 1657 definitions from 42 files (0 parse diagnostics)
  exactly one     566 (34.2%)
  at most three   694 (41.9%)
  at most five    836 (50.5%)
  unconstrained   619 (37.4%)
  of which empty    1
```

`is_fallen_empire`, the ticket's own example and DoA's most-called trigger at
214 sites, infers `country` exactly.

Effects narrow substantially less than triggers, and the reason is legible
rather than mysterious: `inline_script` (118 definitions) splices a file the
analysis does not follow, `save_global_event_target_as` (120) is dropped from
the scope table because the rules declare it in scopes the SDK has no canonical
name for, and `modifier` weight blocks (67) are a `modifier_rule` splice the
walk does not descend into. All three widen rather than narrow, so they cost
coverage and never correctness. All three are also addressable later without
changing anything decided here.

## Why this is not the inference Part 2 rejected

The handoff rejected body inference on a specific argument: it "would be
confidently right on the easy majority and quietly wrong on the rest — the worst
distribution, because it teaches you to trust it." That argument is about
guessing what a body *means*. This analysis never asks. It reads only what the
rules already say about where each key is *legal*, and it is built so that every
uncertainty widens:

- **`OR` unions its arms, everything else intersects.** Vanilla deliberately
  writes dual-scope triggers as `OR` arms that are simply false in the other
  scope. Intersecting those gives ∅; unioning gives the truth.
- **A pushed scope contributes nothing to the enclosing one.** Conditions inside
  `owner = { ... }` or `any_owned_planet = { ... }` constrain the pushed scope.
  Only the link or iterator key itself constrains the caller.
- **`[[FLAG] ... ]` blocks contribute nothing.** The block is absent unless the
  caller defines the flag, so its conditions are not the definition's.
- **`$PARAM$` in key position, `prev`/`root`/`from`, and any key the rules do
  not cover contribute nothing.**
- **An empty result falls back to unconstrained.** ∅ means either a real
  dual-scope trigger or an analysis that lost the thread; neither is a claim.

So the failure mode is inverted. An over-wide answer is exactly today's
`Trigger<ScopeName>` — no worse than shipping nothing. An over-narrow answer is
a compile error the author can escape with the hand-declared form. Nothing here
can produce a silently wrong emission, which was the whole objection.

## The falsification test, and its demonstrated power

The golden is a control: it proves the walk agrees with a hand-application of
its own rules. It cannot prove those rules match the game.
`design/scripted-scope-probe/callsites.ts` can, in the direction that matters.
An event declares its own scope in its key (`country_event` runs in country
scope, from the generated `EVENT_KINDS`), so anything called at the top of that
event's `trigger`, `immediate`, `after`, or `option` blocks must admit country.
A call site where the inference disagrees is a false narrowing — the analysis
forbidding something the game ships.

4,860 such calls across 9,856 events reach 894 distinct scripted definitions.
Zero contradictions.

A passing test proves nothing until you know it can fail, so three mutations
were run against it:

| Mutation | Contradictions | Caught by |
| --- | --- | --- |
| A link's body constrains the caller | **328** | the call-site check |
| `OR` intersects its arms | 0 | `dual_scope_or` negative case |
| `[[FLAG]]` blocks constrain | 0 | `conditional_only` negative case |

The call-site check has real power against the likeliest error in the design —
mishandling nesting — and is blind to the two mutations that only widen or
empty, because widening never contradicts a call site. That is not a gap: those
two are precisely what the negative cases in `probe-negative.ts` exist to pin,
and each is caught there. The two halves are complementary by construction, and
neither alone would be sufficient evidence.

## Findings the probe caught (why probes exist)

The first run narrowed 89.0% of triggers and 58.2% of effects, with a long tail
of unknown keys. Reading that tail found four gaps, each a place the analysis
was ignoring something the rules already state:

1. **`hidden_trigger` and `hidden_effect` were treated as unknown keys** — 42
   trigger and 222 effect definitions lost every narrowing behind them. They are
   real script keywords that only suppress tooltips; cwtools declares no scopes
   for them, so they never reached the table. They belong with `AND` as
   scope-transparent wrappers.
2. **Dotted link chains and the `?` suffix were unreadable** — `owner.overlord`,
   `from.owner`, `starbase?`. Only the first hop constrains the caller, and
   where the chain lands is several hops away and unattributable.
3. **A block rule's arguments were walked as conditions.** `while = { count = 5
   <effects> }` both splices effects and declares `count`, so "not a clause
   field" does not distinguish an argument from a spliced condition. The rule's
   own field list does. `count` alone was hitting 438 effect definitions.
4. **The effect walk could not see scripted triggers.** A scripted effect's
   `limit` blocks call them constantly; `is_machine_empire` alone cost 59
   definitions their narrowing.

None of the four changed a scope the analysis was already confident about — all
four turned "unconstrained" into "constrained", which is why the golden and the
call-site check both stayed green across them.

The fifth finding was in the probe's own negative cases rather than the
analysis: `dual_scope_or` was written asserting "unconstrained" while its own
stated reasoning said the arms should union. The analysis was right and the
assertion was wrong, which is the failure mode a negative case is supposed to
have.

## Decisions validated (now binding for the implementation)

- **`RuleScopes = readonly string[] | "universal"`**, with `"universal"` as the
  intersection identity and the union absorber. Every "unknown" in the design
  routes through that one value.
- **Two facts per rule, not one.** `scopes` (where the key is legal) and the
  scope each nested clause runs in. A walk with only the first produces ∅ for
  any body that navigates, which is most of them.
- **A rule that names a scope the SDK cannot canonicalize is dropped whole**,
  not narrowed to its recognizable members. Dropping members would manufacture a
  false narrowing; dropping the rule widens.
- **Cycles are answered but not memoized.** A result computed across a broken
  cycle depends on which definition the walk entered from, and caching it would
  make the output order-dependent — which `AGENTS.md` forbids for emission and
  which would be worse here, since it would be invisible.
- **Scope names are emitted through the licensing chokepoint with their own
  context string.** `assertVanillaIdentifier` is a content filter with no notion
  of provenance, so `"country"` passes it by silence rather than by decision.
  The emitter should say what it is emitting.

## Watch items for the implementation

- **`TRIGGER_META` and `LINK_META` are the shipping form of
  `scope-tables.ts`.** The trigger half is currently built twice at test time —
  once here, once in `packages/sdk/tests/codegen/corpus-conformance.test.ts`
  (lines 129-158). Emitting it once from `@pdx-ts/codegen-cwt` retires both
  copies, and `corpus.ts`'s `workableScopes` becomes the flat special case of
  the nesting-aware walk rather than a separate implementation.
- **The call-site check should ship as a gate, not stay a probe.** It is the
  only evidence that the inference matches the game rather than the rules, and
  it costs one install-gated test. It belongs beside `corpus-conformance.test.ts`,
  which is the same kind of measurement.
- **Effect coverage is the obvious follow-up**, and the three causes are named
  above. None of them requires revisiting a decision here.
- **`target` (9 triggers, 35 effects) stays unknown on purpose.** Its output
  scope is `any`, which is exactly why `src/triggers.ts` makes the author assert
  it. The analysis should keep declining to guess.
- **The 5 emptied definitions were read by hand, and they are the SDK-24 shape.**
  `titan_possible_construction`, `colossus_possible_construction`, and
  `juggernaut_possible_construction` are one body each of
  `if = { limit = { is_scope_type = megastructure } ... } else_if = { ... }
  else = { ... is_scope_type = starbase ... }` — a definition that branches on
  its own scope at runtime, so its branches constrain to disjoint scopes and
  intersecting them is ∅ by construction. That is not an analysis failure; it is
  the same finding `corpus-conformance.test.ts:90-97` already records against
  `ship_size.potential_construction`, whose acknowledgment says vanilla "tests
  `is_scope_type` 13 times across these clauses" and waits on SDK-24's `inScope`
  combinator. The remaining two (`any_available_random_trait_by_tag` and its
  effect twin) empty on `$TAG$`-parameterized bodies reached through
  `root.owner`. Falling back to unconstrained is right in all five; when
  `inScope` lands, the first three become expressible rather than merely wide.
