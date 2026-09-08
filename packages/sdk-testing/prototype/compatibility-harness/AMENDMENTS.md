# Shared contract amendments

## Initial draft — sdk-446/v1-draft

At initial publication the baseline was not frozen: human review and the first
Apple Silicon real-game run were pending. The initial source and shared hash are
retained by the harness evidence. The freeze below supersedes that initial status.

This intentionally reduces the adopted runner contract to direct module selection,
four sequential cases, a fixed country/planet catalogue, Node IPC and separate
cleanup invocation. The full author/supervisor protocol remains outside this spike.
The ten-day removal window is an explicit experiment bound pending native evidence.
The long full-ID/address reuse experiment is not repeated by this short scenario.

## Required entry for every later amendment

- Previous shared source commit and SHA-256:
- New shared source commit and SHA-256:
- Changed contract/script/fixture/assertion or deadline:
- Observed problem and reason for the change:
- Baseline-to-change diff:
- Earlier adapters rerun, with exact input identities and result links:
- Unresolved failures or unavailable reruns:
- Human decision, if the change alters the experiment:

Freeze the Apple Silicon baseline here before starting the Windows adapter work.

## Apple Silicon baseline frozen — 8 September 2026

- Shared executable source commit: `b822716a950dbaa1a17a6ccc5b4c5c93e24bb4d1`.
- Shared executable SHA-256: `1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819`.
- Adapter source commit: `968868181bb254752b46f0693140589da559499e`.
- Exact final adapter source digest: `2638583d357eadfddf444a9fa166b351da520344b9263457cc7c8a0f936c1614`.
- Frozen scenario/contract/script/fixture/assertion/deadline changes: **none**.
  `contract.ts`, `scenario.ts`, `prepare.ts`, `checks.ts`, `supervisor.ts`,
  `worker.ts`, `cli.ts`, and `FIXTURE.md` have no diff from the approved source.
- The protocol's literal `sdk-446/v1-draft` string remains unchanged to preserve
  the approved executable bytes. This ledger freezes that named snapshot; the
  word `draft` is no longer a claim that native verification is pending.
- `native1` and `native2` each satisfied all four unchanged common controls on
  macOS 26.6.2 (25G83), Apple M4/arm64, and the pinned Cygnus 4.5.0 beta image.
  The earlier `bootstrap1` also satisfied them while constructing the fixture.
- Native missing-marker and stale-invocation controls, partial launch, and an
  independently timed-out operation retained failure and confirmed cleanup.
- Independent game-save/native/observer verification passed 2,436 checks across
  all seven retained runs. See [the adapter report](apple-silicon/REPORT.md).
- Jackson approved the starting contract before this task. No experiment behavior
  or scope amendment was needed, so no new behavioral decision was requested.

Windows adapters must use this shared source/hash and the same fixture semantics.
Their actual game-produced saves, executable/build pins and private dependencies
will differ. A future shared change must follow the amendment record above and
rerun the Apple Silicon baseline. This freeze does not decide production support.
