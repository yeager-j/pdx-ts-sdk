# Handoff: mod testing (the evaluator)

The next spike. Written after the events-and-effects vertical landed, for
whoever picks this up.

Read [handoff-effects-followups.md](handoff-effects-followups.md) for the
current state of the SDK, and [verdict-effects-probe.md](../verdict/verdict-effects-probe.md)
for how the last spike was gated — this one follows the same playbook. This
file only covers what is specific to testing.

## The goal

Let modders unit-test mod logic without launching the game:

```ts
const world = fixture({
  countries: [{ flags: ["tft_lcluster"] }],
  globalFlags: ["l_cluster_opened"],
});
expect(evaluate(newTech.potential, world.country(0))).toBe(false);

world.fire(eventA, world.country(0)); // eventA queues eventB at +180 days
world.advance(180);
expect(world.fired).toContainEvent(eventB);
expect(world.country(0).has(someTech)).toBe(true);
```

Stellaris has no headless mode and no test API; the edit-test loop for event
logic today is "launch, console-fire, squint." This feature is impossible in
raw PDXScript and exactly what a code-first SDK uniquely enables. It may be a
bigger adoption driver than the syntax.

## Why this next, and why the risk is different this time

The recorded-closure model is proven; the parser is understood (the docs
project already settled overrides and patches empirically). This spike's risk
is new in kind: **an interpreter is a second implementation of Paradox's
engine semantics, and every divergence is a green test for broken behavior.**
A wrong emulator is worse than no emulator — it manufactures confidence.

The mitigation is the same discipline codegen lives by, applied at runtime:
**whitelist and loud failure.** The interpreter throws — never guesses — on
any trigger or effect it has not deliberately implemented. A test can only
pass through semantics someone consciously modeled. "Nothing silently
evaluated" is this spike's version of "nothing dropped silently," and the
error ("this test evaluated 12 triggers; 3 unimplemented: …") is the report.

## What you already have for free

Both halves of the SDK produce plain data the interpreter can consume:

|                                                     |                          |
| --------------------------------------------------- | ------------------------ |
| Trigger ASTs (`trigger.entries`)                    | on every `Trigger` value |
| Event bodies (`immediate` block inside `event.entry`) | structured `PdxEntry`s — pull the block, no new plumbing |
| `EFFECT_META` (dispatch table: method -> key/shape) | `src/generated/effect-meta.ts` |
| Effects that are pure value-set writes              | 73, across 37 sets       |
| Triggers that are pure value-set reads              | 34, across 34 sets       |
| Scope-valued arguments (need ref resolution)        | 105 triggers, 67 effects |
| Scope links in the game's dump, with input/output scopes | 97, parsed by [logs/scopes.ts](../tools/codegen/logs/scopes.ts), currently unconsumed |
| Event kinds + scopes                                | `src/generated/events.ts` |

Two of these are the leverage points:

- **Value sets are the game's mutable string-set state**, and the rules say
  which effects write them and which triggers read them. That whole class of
  interpreter — the backbone of story-mod logic — can be *derived* from the
  rules rather than hand-written, the same move that made the effects emitter
  tractable.
- **The 97 scope links are the navigation table** (`owner`, `capital_scope`,
  `army_leader`…), each with typed input and output scopes and a summary.
  That is the fixture's entity-relation schema, sitting unread in the dump.

## Decisions already made (in discussion, 2026-07-30)

- **`advance(days)` is a discrete-event queue drain, not a tick simulation.**
  Move the clock, deliver queued fires due in the window in timestamp order,
  let delivered `immediate`s enqueue more, repeat. Cascades fall out
  correctly. `advance` ages **nothing else** — no MTTH rolls, no monthly
  income, no pull-event evaluation. Say so in its TSDoc.
- **Forced branches over seeds.** `random_list` in a test takes an explicit
  arm choice; the `random` delay component defaults to zero and is recorded.
  Seeds make flaky tests; forced branches make readable ones.
- **`world.fire()` carries the FROM contract.** Firing from the harness is
  the on_action-shaped untracked path — but in tests we control it, so the
  phantom extends: `world.fire(ev, planet, { from: player })`, required when
  the event declares `from:`, forbidden otherwise. The harness *restores*
  type safety on the one path production cannot check.
- **Assertions take objects, not strings** (`toContainEvent(eventB)`,
  `player.has(newTech)`) — the cross-references-are-objects pillar extended.
  Ship a small vitest matcher pack.
- **`world.fired` is a rich log** — id, delivery day, firing scope, FROM —
  not a set. It doubles as the failure trace.
- **Calendar constants**: a month is 30 days, a year is 360. Convert
  `months`/`years` delays through exactly those.
- **Two layers**: immutable `run(effect, scope) -> after` for one-shot unit
  tests, stateful `world` for chain tests, one interpreter under both.

## The four open questions

**1. The state model.** What is a country, planet, leader *in the fixture*?
Needs: identity (handles like `world.country(0)`), typed per-entity state
(flag sets, resources, technologies — the tech grant is deliberately in the
probe because it forces state beyond string sets), relations
(country→planets, planet→owner) for the iterator effects and the scope
links, and partial construction with sensible defaults. Watch for the
fixture becoming a game-state ontology project; model only what the
whitelisted semantics touch.

**2. `explain`.** The killer feature inside `evaluate` is not the boolean —
it is the pass/fail tree showing *which* subcondition failed, surfaced
through matcher output. Decide its shape early (it is also the dynamic
sibling of the docs project's "what does X do"). `and`/`or`/`not` flattening
at record time may lose structure `explain` wants — check whether the
combinators' current entry-splicing keeps enough tree to attribute failures.

**3. Numeric evaluation.** Comparison triggers and `value_field`s reach
arithmetic fast (`count_owned_pop_group`, resource amounts), and script
values/variables lurk behind them. Draw the v1 line explicitly: literals and
fixture-stored numbers yes, scripted values no (loud error).

**4. Scope-link and iterator semantics.** `every_owned_planet` iterates a
relation the rules never name — shapes are in the rules, *semantics* are
not. The mapping "this iterator walks this fixture relation" is a
hand-maintained table, this spike's version of the overlay. Keep it small,
audited, and loud about gaps. The 97 dump links cover the named navigations
(`owner`, `capital_scope`); the iterators need their own entries.

## The trap that will get you

**Calibration drift.** The emulator does not substitute for the game, and it
can entrench wrong assumptions if never checked against it. Anchor a small
corpus — a dozen trigger/effect behaviors, especially the `scopes = { from }`
override, event-target lifetime across a chain, and delay delivery order —
by running them in the actual game console once, and commit the observed
behavior as the emulator's own golden files. Re-verify the corpus on game
patches, like the drift baseline but against reality instead of the dump.

## Suggested first probe

Same playbook as last time: hand-write the target API for the nastiest
realistic case before building anything, in `../../design/testing-probe`, with a
hand-written interpreter for ~20 whitelisted triggers/effects. The case,
end to end in one test file:

> A fixture with two countries and owned planets; `evaluate` + `explain` on a
> `potential` that fails on one specific subcondition; `world.fire` of the
> example mod's real `humReturns` event with a forced `random_list` arm; the
> nested iterator saving an event target; the delayed `planetEvent` fire
> delivered by `advance(30)` with FROM checked at the harness; a tech-granting
> follow-up asserted via `player.has(tech)`; and one deliberately
> unimplemented trigger proving the loud-failure path.

**Gate — the model holds iff:** the test reads clean with zero casts; no
interpreter behavior was fudged to make it pass (every implemented semantic
is one you would defend against the real game); the unimplemented path fails
with an actionable message; and `explain`'s matcher output names the failing
subcondition without the reader opening the fixture. **Escape hatch needed
means:** any semantic implemented as "probably close enough," any silent
skip, or fixture construction so verbose the test obscures its intent. On
failure, write the finding and stop — same as last time, that outcome is a
success of the spike.

## Conventions worth keeping

- The interpreter whitelist is this spike's overlay: one audited table,
  adding an entry should feel expensive, every entry defensible against the
  real game.
- Nothing silently evaluated; unimplemented constructs throw with the
  trigger/effect name and the test's whitelist coverage summary.
- The probe stays in `../../design`, the verdict goes in `..`, golden files
  remain the acceptance test.
- Derived interpreters (value-set reads/writes) come from the rules;
  hand-written semantics (iterators, links, arithmetic) are listed and
  counted. The split should be visible in a report, like the emitters'.
