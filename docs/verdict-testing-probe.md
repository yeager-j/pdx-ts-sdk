# Testing probe verdict: the model holds

Stage 0 of the mod-testing evaluator, per the
[handoff doc](handoff-mod-testing.md)'s suggested first probe. The probe lives
in `design/testing-probe/` and stays there — it is the design record, not the
implementation.

## The judgment

**A whitelisted interpreter over the recorded ASTs holds, with zero casts in
the mainline and nothing evaluated silently.**
[probe-mod.ts](../design/testing-probe/probe-mod.ts) defines the chain with
the real SDK (the example mod's humReturns/aftershock shape plus a tech-grant
follow-up);
[probe.test.ts](../design/testing-probe/probe.test.ts) runs the handoff's
end-to-end case — fixture with two countries and owned planets, `evaluate` +
`explain` failing on one named subcondition, `world.fire` with a forced
`random_list` arm, the nested iterator saving an event target, two delayed
`planet_event`s delivered by `advance(30)` with FROM checked at the harness,
the tech grant asserted via `player.has(tech)`, and `is_at_war` proving the
loud-failure path. All three goldens (serialized mod, explain tree, fired
log) were written by hand before the interpreter existed and matched on the
first full run.

Acceptance results:

| Check | Result |
| --- | --- |
| Mainline (`probe-mod.ts`, `probe.test.ts`) reads clean, zero casts | Pass |
| 7 negative claims pinned with `@ts-expect-error` | Pass (one needed a design fix, below) |
| Hand-written goldens byte-match | Pass, first run |
| Unimplemented trigger throws with key + coverage summary | Pass |
| `explain` matcher names the failing subcondition | Pass (`tp_pacifist_path` in the failure message) |
| Full suite: `examples/` and `tests/` goldens untouched | Pass (118 tests) |
| One interpreter under both layers (`run()` reuses the walker unchanged) | Pass |

## Findings the probe caught (why probes exist)

1. **The witness pattern does not survive the FROM phantom's erasure into a
   harness signature — twice.** The SDK-style overload pair let a witness on
   a *contract-less* event compile (the erased `?: undefined` brand lets `F`
   fall back to its constraint and unify), and the first repair — a
   conditional rest parameter over an inferred `F` — let a *wrong-kind*
   witness compile (the witness site widened `F` to a union; `NoInfer` does
   not block inference through a conditional tuple). The design that holds:
   **infer the whole event type `E` and derive both the scope kind and the
   FROM kind from it** (`EventScope<E>`, `EventFromKind<E>` in
   [world.ts](../design/testing-probe/world.ts)), making the event the only
   inference site *by construction* rather than by annotation. This is the
   testing-API sibling of the effects probe's `NoInfer` finding, and the
   emitter should use the same shape if fire-effect types are ever
   regenerated for harness use.
2. **The FROM contract must be restated at the fixture, once per contracted
   event.** The phantom is erased, so `advance` cannot recover the declared
   kind at delivery. `declareFrom(aftershock, "country")` restates it in one
   line, type-checked against the phantom — wrong restatements do not
   compile. The harness then re-checks the contract at delivery, which is
   the point: it restores the check on the one path production cannot see.
3. **`or()` has a splice hazard the interpreter inherits** (analysis finding;
   not fixed here). `and`/`or` splice operand *entries* into one block. Every
   generated leaf records exactly one entry, so per-entry attribution is
   sufficient for `explain` — but a hand-built multi-entry trigger spliced
   into `or()` turns AND-of-its-entries into OR-of-its-entries. Real fix
   belongs in `src/triggers.ts` (wrap multi-entry operands in an `AND`
   block), not in the interpreter.

## Error-message quality (checked by hand)

- Unimplemented trigger: `This trigger uses 1 condition; 1 unimplemented:
  is_at_war. The interpreter whitelists semantics deliberately; nothing
  evaluates silently. (coverage: 5 triggers + 3 combinators, 6 effects + 4
  structural, 1 iterator, 2 links)` — the error is the coverage report, as
  the handoff asked.
- Numeric v1 line: names the offending entry (`num_owned_planets =
  some_script_value`), states the line ("literals and fixture-stored numbers
  only; script values and variables are out").
- Unforced `random_list`: states the discipline ("forced branches make
  readable tests, seeds make flaky ones") and lists the available arms.
- `toHoldFor` failure: prints the ✓/✗ tree; the failing leaf reads
  `✗ NOT` / `✓ has_country_flag = tp_pacifist_path — set on country
  "player"` — the reader never opens the fixture.

## Decisions validated (now binding for the implementation)

- **One interpreter, two layers.** `run()` records with the SDK's real
  `makeScope`, clones the world, and calls the same `applyEffectEntries` the
  stateful `World` uses. No divergence was needed.
- **`advance` as a pure queue drain.** Timestamp order with FIFO within a
  day, cascades re-enqueue and deliver in-window; nothing else ages, and
  delivery runs `immediate` only (options are player choices, never
  auto-taken).
- **Forced arms by weight key, consumed in encounter order**; weight
  modifiers deliberately unevaluated under forcing — which is why
  `is_at_war` could stay off the whitelist while sitting inside the real
  chain's modifiers.
- **Natural FROM = the firing execution's root scope.** `from: ctx.self`
  records nothing, and the interpreter's default reproduces it; an explicit
  `scopes = { from = ... }` block resolves through the link table.
- **Per-entry attribution suffices for `explain`** on SDK-built triggers
  (each generated leaf is one entry); no re-architecture of the combinators
  was needed for the probe.
- **The whitelist as one audited table with defense notes**
  ([whitelist.ts](../design/testing-probe/whitelist.ts)): 5 triggers, 3
  combinators, 6 effects, 4 structural forms, 1 iterator, 2 links. Every
  entry carries a one-line defense against the real game; `NOT`-is-NOR is
  written down where it belongs.
- **Assertions take objects** — `toContainEvent(aftershock, { day: 30, from:
  player })`, `player.has(resonanceTheory)` — and the fired log doubles as
  the failure trace in the matcher output.

## Deviations from the handoff, for the record

- **The chain is probe-local, not the example mod's.** The handoff said
  "the example mod's real humReturns event", but the case requires a
  tech-granting follow-up the example lacks, and the example's events are
  not exported. The probe defines the same chain with the real `Mod` and
  recording machinery (identical fidelity, golden-pinned) and adds the tech
  grant; `examples/` and its goldens are untouched. User-approved.
- The `potential` gained a `has_global_flag` conjunct beyond the example's,
  to exercise global flags in the explain tree.

## Watch items for the implementation

- **Calibration drift is still the trap.** Nothing here was checked against
  the actual game console. Before the implementation ships, anchor the
  corpus the handoff lists — `scopes = { from }` override, event-target
  lifetime across a chain, delay delivery order — in the real game and
  commit the observations as golden files.
- **Event-target lifetime is world-long in the probe**; the game scopes
  targets to the event chain. Noted on the whitelist entry; the
  implementation needs the real lifetime (and it is on the calibration
  corpus).
- **The `scopes = { from = ... }` override path is implemented but not
  exercised** by the probe chain (its fire uses natural FROM). Cover it when
  the calibration corpus lands.
- **The 97 dump scope links remain unconsumed.** Only `from` and
  `event_target:` were needed. The links table is still the right seed for
  the navigation whitelist when iterators/links grow past a handful.
- **Derived value-set interpreters need metadata that does not exist yet.**
  `EFFECT_META` carries serialization shape only; value-set-ness and
  scope-valued-ness live in the cwt rules (`RuleType.valueSet` /
  `RuleType.scope`) and are erased from the generated tables. The
  "derive the flag/tech interpreters from the rules" move needs the meta
  emitter extended (and there is no `TRIGGER_META` at all — the trigger
  whitelist is keyed by PDX key strings, which worked fine for the probe).
- The fixture spec deliberately models only what the whitelist touches
  (countries, planets, flags, techs, resources, deposits). Growing it should
  stay demand-driven — the ontology trap is real.
