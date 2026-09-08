# Equivalent fixture contract: sdk446-fixture/v1

Each native adapter supplies a **game-produced save from its target build**, not
copied incompatible save bytes. A loadable save alone is not sufficient evidence.
Record original build, save SHA-256, exact executable/bridge hashes, and ordered
mod/DLC identities and content hashes. Copy immutable inputs into a fresh private
profile. Preserve source-save and ordinary-profile manifests before/after the run.

The starting state, observed while paused and before scenario work:

| Role | Required meaning |
| --- | --- |
| Player | Actual local human country; prefer a nonzero ID as the anti-hardcoding control. AI mode is off. `sdk446_effect` and `sdk446_absent` flags are absent. |
| `sdk446_colony` global target | A live planet with real colony population that satisfies native `is_colony = yes`. Setting an owner alone is insufficient. It survives the scenario and supplies the replacement planet's system. |
| `sdk446_planet` global target | A different, removable uncolonized planet satisfying native `is_colony = no`. It is safe for the experiment to remove. |
| `sdk446_country` global target | A nonplayer disposable `global_event` country, which remains live without a colony until explicitly destroyed. |
| Duplicate condition | Exactly two live planets carry `sdk446_duplicate`; the locator must reject ambiguity. |
| Missing condition | No live country carries `sdk446_absent`; the locator must reject absence. |
| Prepared catalogue | All definitions emitted by the harness are installed before the game loads the fixture. Their names and bytes are reserved to this spike. |

The adapter may use a build-specific fixture-construction procedure, but the final
semantic roles and shared script bytes must agree. Retain the construction script,
original game-produced save, installed inputs, and independent game-written save or
native/script witnesses for these facts. Acquisition must use current live objects;
a galaxy iterator that only sees a newly created planet after a day cannot satisfy
immediate replacement acquisition.

The initial day and numeric object IDs need not agree across versions. The game
calendar must be converted to a monotonically integral game-day index in the adapter;
exact differences, not calendar-string arithmetic, are compared by shared checks.
No validation operation is allowed to advance the date. The chosen fixture must
keep both destruction requests pending at the initial paused point and allow their
engine removal within the common ten-day explicit-advance window. If a build cannot
satisfy that scenario, record the result and propose a shared amendment openly.

A replacement is a newly created lifetime under the same global target; old tokens
remain invalid. This short harness checks one replacement for each kind. It does
**not** establish native full numeric-ID/address wraparound. The earlier long native
locator probe provides exact-build evidence for that stronger case; the mock's
slot reuse demonstrates only that the harness detects a revived old binding.

Related primary evidence:

- [Country and planet locator identity: native evidence](https://linear.app/unnamed-system/document/country-and-planet-locator-identity-native-evidence-753293d05d90)
- [Runner module contracts and prepared-script dispatch](https://linear.app/unnamed-system/document/runner-module-contracts-and-prepared-script-dispatch-596115eda6a6)

Local investigations consulted: `.scratch/sdk-testing/native-bridge-probe/REPORT.md`,
`.scratch/sdk-testing/time-control-probe/REPORT.md`, and the retained locator evidence
under `.scratch/sdk-testing/sdk-439/inputs/`. These are historical inputs, not runtime
dependencies. Fixed create/remove/spawn syntax was also checked against the pinned
CWT and installed native game scripts; this does not prove these new scripts work
in each native adapter.
