# Local verification — 8 September 2026

Shared source SHA-256: `1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819`. This identifies the seven shared TypeScript files
listed by `cli.ts`, independent of the surrounding checkout's next commit.

Evidence mode: **mock only**. No game was launched, no native adapter was built,
and no platform compatibility or frozen native baseline is claimed.

## Checks performed

- Prototype strict TypeScript check: passed.
- Repository `tsc --noEmit`: passed.
- Existing `@pdx-ts/sdk-testing` package build: passed; the prototype is outside its output.
- All eleven fixed event definitions parsed with the repository PDXScript parser,
  with no repairs. This is syntax evidence, not native script validation.
- Code-style diagnostic rubric reviewed in a temporary review worksheet.
- The final unmodified mock satisfied all four shared controls: normal scenario,
  fresh world with a real previous-world binding, false-condition mismatch, and
  worker loss followed by independent cleanup. Both normal cases passed; the
  false condition retained failed behavior; worker loss retained incomplete execution.
- All eight deliberately broken adapter modes produced exit code 1 and an
  unsatisfied control: validation time drift, stale invocation, missing end marker,
  revived binding, pending promise, synchronous worker block, partial launch, and
  failed cleanup. No run claimed native compatibility.

The hang and synchronous-block controls used a recorded 150 ms operation deadline;
all other controls used the common defaults. Partial launch retained ownership and
confirmed cleanup despite no successful launch response. Failed cleanup preserved
its failure instead of assuming child exit from a stop request.

Immediately after the preceding draft matrix, an extra process sweep saw the intentionally
failed-cleanup child still exiting. A later process sweep confirmed all twelve
disposable mock children had exited. `post-run-exit-check.json` records that later
observation without upgrading the failed run's cleanup outcome.

## Evidence and limits

The project evidence archive contains `capture-verification.json`, each final
case's input/source hashes, journal, raw mock response records, observed result and
control result, the failure output, and the final exit sweep (`capture-exit-check.json`). `effort-record.json`
records measured subprocess wall time; untimed work and historical native research
remain unavailable, not zero. Earlier drafts were exercised locally, but only the
final shared source hash above is the portable handoff revision.

Native adapters still have to prove the semantic fixture, fixed dispatch/marker
correlation, native condition evaluation, exact-day control, lifetime validity and
independent bounded disposal. The short replacement check does not reproduce the
prior long full-ID/address wraparound experiment. See `README.md`, `FIXTURE.md`, and
`AMENDMENTS.md` for the contract and intentionally omitted production machinery.
