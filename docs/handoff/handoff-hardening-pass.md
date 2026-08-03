# Handoff: close the loop before content expansion

The next implementation pass. Written after content codegen was generalized
across technologies, buildings, traditions/categories, agendas, and edicts.

Start from [handoff-content-codegen.md](handoff-content-codegen.md) for the
current content architecture, [verdict-testing-probe.md](../verdict/verdict-testing-probe.md)
for the testing design that held, and [verdict-patches.md](../verdict/verdict-patches.md)
for the already calibrated override path. Do not reopen those designs. This
pass closes four known gaps, proves them together in one real mod, and then
hands the repository over to content expansion.

## Why this is a hardening pass, not another spike

Agenda and edict exercised three shapes the original registries did not:
effect closures inferred from aliases, duplicate localization slots, and
economic-resource/triggered-modifier blocks. All three landed in the generic
content module without a registry-name conditional. Another isolated registry
would add breadth but little architectural evidence.

The remaining work is concrete:

1. fix the known multi-entry `or()` correctness bug;
2. give authored events an `on_action` entry point;
3. promote the validated testing probe into the SDK and calibrate the semantics
   that the probe could only assume;
4. exercise the whole stack in one generated, in-game mod.

These belong together because the on-action event chain can be both the
testing calibration corpus and the kitchen-sink mod's runtime smoke test.

## Outcome

After this pass:

- multi-entry triggers preserve their grouping under `or()`;
- a mod can register one of its typed events with a typed Stellaris on-action;
- the testing evaluator is production code rather than a design artifact;
- the evaluator's FROM override, event-target lifetime, and delayed-delivery
  behavior is pinned to observations from the supported game build;
- one checked-in example renders every current content registry, an additive
  on-action, an event/effect chain, and a real vanilla technology patch;
- automated goldens and a recorded in-game checklist establish the release
  gate for future registry batches.

No new registry is part of this pass.

## Stage 0: preserve the baseline

The branch should begin with the content-codegen implementation committed and
these commands green:

```sh
npm run codegen:check
npm run typecheck
npm test -- --run
npm run build
git diff --check
```

Do not rebaseline generated drift unless the change is intentional and reviewed.
Do not format snapshot `.yml` files; their BOM is significant.

## Stage 1: repair `or()` grouping

The bug is documented in
[verdict-testing-probe.md](../verdict/verdict-testing-probe.md#findings-the-probe-caught-why-probes-exist).
`or()` currently splices every operand's entries directly into one `OR` block.
A hand-built trigger containing two entries therefore changes from
`A AND B` to `A OR B`.

Change `src/triggers.ts` so:

- a one-entry operand remains directly inside `OR`;
- a multi-entry operand is wrapped in `AND = { ... }` before entering `OR`;
- operand order remains stable;
- `and()` retains its current flattening behavior;
- `not()` retains the game's documented NOR-style block behavior.

Add a direct serialization test with one multi-entry operand and one ordinary
leaf. Add a regression assertion to the evaluator once Stage 3 has moved it
into production.

Acceptance:

- the regression would fail against the current implementation;
- the emitted PDXScript visibly preserves `(A AND B) OR C`;
- existing trigger goldens remain unchanged.

## Stage 2: typed on-action registration

The relevant rules are already present in
`../../vendor/cwtools-stellaris-config/config/common/on_actions.cwt`, while the
available named hooks and their scopes are documented in
`../../vendor/cwtools-stellaris-config/config/on_actions.cwt`.

Add an authoring surface to `Mod` that registers a `DefinedEvent` with a named
on-action and emits:

```text
common/on_actions/<prefix>_on_actions.txt
```

The target call site is:

```ts
mod.on(onActions.onGameStartCountry, entryEvent);
```

Design constraints:

- The event object, not a string id, is the registration input.
- Generate typed `onActions` references from `config/on_actions.cwt`; do not
  maintain a second handwritten name list.
- Derive the hook's event scope and any available FROM scope from
  `event_type`/`replace_scopes` metadata. A hook accepts only an event whose
  scope and declared FROM contract match what the hook supplies.
- Report hooks whose metadata cannot be represented; never guess their scopes.
- Reject hooks with `no_scope` until the SDK has a scopeless event kind.
- Reject an event that was not defined by the receiving `Mod`.
- Reject duplicate registrations of the same event on the same hook.
- Preserve registration order in `events = { ... }`.
- Emit one deterministic file per mod.
- Keep random-event registration out of this pass. It has different weight and
  eligibility semantics and is not needed for the acceptance mod.
- Do not route on-actions through the generic content registry. Their additive
  interaction with vanilla definitions and their typed event relationship make
  them a separate, small authoring module.

Add type tests for the matching-scope case, a wrong-scope rejection, an unknown
hook rejection, and a no-scope rejection. Add runtime tests for duplicate
registration and deterministic rendering.

The real-game check must also prove that adding the SDK file does not suppress
vanilla events on the selected hook. Do not infer additive behavior from
serialization alone.

Acceptance:

- the hardening mod's country entry event is registered on
  `on_game_start_country`;
- no raw event id or raw on-action name is needed at the call site;
- generated names/scopes are drift-checked with the rest of codegen;
- the rendered file is golden-pinned;
- both the SDK event and a visible vanilla game-start behavior occur in the
  calibration run.

## Stage 3: promote the mod-testing evaluator

The gated implementation in `../../design/testing-probe` is the executable design
record. Its model and decisions are binding; read
[verdict-testing-probe.md](../verdict/verdict-testing-probe.md) before moving code.
The broader rationale and public capability are in
[handoff-mod-testing.md](handoff-mod-testing.md). Do not invent a second
interpreter or expand the fixture into a general game simulation.

Move the capability into a cohesive `src/testing/` module:

- fixture construction and typed entity handles;
- immutable `run()` and stateful `World`;
- `evaluate()` and `explain()`;
- the discrete event queue and fired-event log;
- the single audited interpreter whitelist;
- the small Vitest matcher surface.

The design artifacts remain under `../../design/testing-probe`; production code must
not import from them. Share production behavior through the new module and
rewrite the probe tests as production tests rather than deleting the evidence.
Expose the harness intentionally from the package without making Vitest a
runtime dependency of the main SDK entry point. A testing subpath or an
explicit matcher installer are both acceptable; an import-time matcher side
effect is not.

Preserve the probe's binding decisions:

- unknown semantics throw and include the PDX key plus coverage summary;
- one interpreter powers `run()` and `World`;
- `advance(days)` drains only the timestamp/FIFO queue;
- options are never chosen automatically;
- random-list arms are forced by weight key in encounter order;
- event objects are the assertion inputs;
- the event is the only inference source for its scope and FROM contract;
- `declareFrom()` restores the runtime delivery check after phantom erasure;
- numeric v1 supports literals and fixture-stored values, not scripted values;
- fixture state grows only when a whitelisted semantic requires it.

Do not make derived interpreters a prerequisite. The current hand-audited
whitelist is acceptable for v1; metadata generation for value-set semantics can
follow when repeated additions justify it.

Acceptance:

- the original clean mainline and seven negative type claims still hold;
- all three handwritten probe goldens still match through production imports;
- the unimplemented trigger path remains loud;
- the `explain` matcher still identifies the failing subcondition;
- public imports are covered by a consumer-shaped type test;
- no production file imports from `../../design`.

## Stage 4: one hardening mod and one calibration corpus

Create `../../examples/hardening` rather than overloading `hello-galaxy` or the
existing patch calibration. It should be small enough to inspect as a golden,
but cross every implemented seam:

- one technology;
- one building;
- one tradition and its tradition category;
- one agenda;
- one edict;
- at least one object reference between authored definitions;
- one real vanilla technology loaded through `stellaris.load()` and transformed
  with `patchTechnology()`;
- one country event registered with `on_game_start_country`;
- an event/effect chain containing an explicit FROM override, a saved event
  target, and multiple delayed deliveries whose order is observable.

Reuse the shapes already demonstrated in `../../README.md`; this is an integration
artifact, not a showcase mod. Prefer explicit log markers and harmless flags or
resources over gameplay-changing effects. The build script must accept the
normal install discovery path and synthesize a launcher-ready mod without
embedding a machine-specific path.

Automated coverage:

- golden-pin every rendered relative path and its contents;
- assert the expected set of directories includes `common/on_actions`,
  every current content registry, `events`, `localisation`, and the computed
  patch path;
- run the same event chain through the production testing module;
- use the repository's fake install for ordinary tests;
- keep the real install out of the default test suite.

### Operator checkpoint: Stellaris 4.4.6

The agent can prepare the mod, commands, expected markers, and a clean capture
location. A human must launch Stellaris and report the observations; do not mark
this stage complete merely because the generated files look correct.

Record the exact game build and observed evidence under
`../../examples/hardening/calibration`. Keep the evidence compact: a README with the
procedure and conclusion plus normalized golden log excerpts is sufficient.
Do not commit saves, launcher state, machine paths, or the full game log.

The run must establish:

1. **Loading:** the game reports no parser or unknown-key errors for any emitted
   file, and representative definitions from every current registry are
   discoverable.
2. **Additive on-action behavior:** the SDK event fires on game start without
   suppressing the selected hook's vanilla behavior.
3. **Explicit FROM override:** the receiving event observes the overridden FROM,
   not the natural firing scope.
4. **Event-target lifetime:** a target is available through the event chain and
   unavailable after the game-defined chain lifetime. Update the evaluator to
   that observed lifetime before pinning its golden.
5. **Delivery order:** delayed events scheduled for the same day, plus one
   in-window cascade, produce the observed stable order. Update the queue model
   if the game disagrees.
6. **Patch survival:** the authored marker technology and the transformed vanilla
   technology both survive, retaining the patch verdict's dual-channel check.

If the game contradicts the probe, the game wins. Capture the observation,
repair the production interpreter, and add the smallest regression. Do not
broaden the emulator to unrelated semantics.

## Definition of done

This hardening pass is complete only when:

- all four stages above meet their acceptance criteria;
- the full baseline command set is green;
- the hardening example builds from a real install;
- the manual calibration evidence names the game build and is committed;
- `../../README.md` describes mod testing as implemented rather than awaiting
  implementation;
- `../../README.md` links the hardening example and calibration record;
- the generated report contains no unexplained new skip class;
- `git diff --check` is clean.

After that, registry work should move into throughput mode: add content types in
demand-driven batches and pause only when a registry requires a handwritten
type-name branch, exposes a CWT/game mismatch, or cannot be represented by the
existing field metadata.

## Suggested skills

- Invoke `$codebase-design` before changing the `Mod`, on-action, or testing
  module seams. The goal is one deep authoring module and one deep testing
  module, not coordination wrappers.
