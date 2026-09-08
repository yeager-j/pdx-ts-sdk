# Apple Silicon native compatibility baseline

[Project-owned report and raw evidence](https://linear.app/unnamed-system/document/apple-silicon-stellaris-45-compatibility-spike-native-baseline-and-d8605e52edc8)

The bounded adapter satisfied the unchanged common scenario on the pinned real game.
Two complete repetitions loaded the same immutable game-produced fixture. An earlier
four-case run also passed while constructing that fixture. This freezes the first
real-game shared baseline for the Windows experiments. No production API was added.

## Source and baseline

- Adapter implementation: `968868181bb254752b46f0693140589da559499e` on
  `feature/sdk-447-build-the-apple-silicon-stellaris-45-spike-adapter`.
- Final executed adapter source digest:
  `2638583d357eadfddf444a9fa166b351da520344b9263457cc7c8a0f936c1614`.
- Frozen shared source: `b822716a950dbaa1a17a6ccc5b4c5c93e24bb4d1`.
- Frozen shared SHA-256:
  `1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819`.
- Shared executable, script definition, fixture requirement, assertion and deadline
  amendments: **none**. The literal protocol revision remains `sdk-446/v1-draft` to
  preserve those bytes; [AMENDMENTS.md](../AMENDMENTS.md) records the freeze.

The [repeat instructions](README.md) use only tracked adapter source plus explicit
installation and retained fixture inputs. Every final run snapshots its actual source,
bridge binary, private mod, metadata, native mailbox, shared journal and game output.
The source digest was checked again after commit: no executed source file changed.

## Exact final environment

| Input | Identity |
| --- | --- |
| Host | macOS 26.6.2, build 25G83; Apple M4; native arm64 |
| Game | Stellaris Cygnus 4.5.0 beta |
| Executable SHA-256 | `408a5700a202837f16041bf14b5da34ff4a9d939b98e62a8240dc68dd602ddf7` |
| Final bridge SHA-256 | `d4d4a36d53f855c8855890c81ab46f12f9ad474eafdda9de214e8acc41a82d9e` |
| Visibility guard SHA-256 | `0475a555d7388470b3aa363fab7e921ff8e78a5b8bf93946d9c4222e13cc4807` |
| Observer SHA-256 | `957665fb0f9083e19e80391f15bbc16fbcfb293ecd654809ec96bd9f3e3e0442` |
| Final source fixture SHA-256 | `d57d95d6df53e9a204caeedeec1ec4a8aed57326f56a2a892b2617e24056c550` |
| Original nonzero-player fixture SHA-256 | `0721bc41fb7f779f76aff270a1e932564e72141f662a5d87f4ec4908cb6a7e07` |
| Ordered private inputs/dependency digest | `e6326e215f3bbe1dfa940b3a7249e0d999d0b7ed8e915ec44d673fe3101e1be6` |
| Primary runtime/compiler | Node 24.15.0; rustc 1.97.1 (`8bab26f4f68e0e26f0bb7960be334d5b520ea452`) |

`environment.json` retains full OS/CPU/compiler/runtime output and lock hashes.
`private-inputs.json` records every enabled mod file, the ordered mod/DLC selection,
settings and every disabled DLC descriptor. All DLCs are disabled; only the private
common-script/fixture mod is enabled. Binaries were rebuilt locally from the retained
sources; changed binary hashes do not imply a new game build. No separate native caller
is required: the Node worker writes the existing native file mailbox.

## Observed results

| Run | Common control result | Native responses | Independent checks |
| --- | --- | ---: | ---: |
| `bootstrap1` | All four satisfied; fixture constructed on load | 150 | 755 |
| `native1` | All four satisfied; saved fixture loaded | 151 | 757 |
| `native2` | All four satisfied; saved fixture loaded again | 151 | 757 |
| `missing-end` | Expected incomplete native marker result | 13 | 60 |
| `stale-invocation` | Expected incomplete native marker identity | 14 | 62 |
| `partial-launch` | Expected pre-readiness failure; independent disposal | 0 | 10 |
| `hang` | Expected shared operation deadline; independent disposal | 5 | 35 |
| **Total** | **16 owned game processes disposed** | **484** | **2,436** |

Each complete run includes two passing behavior cases, a deliberately failed boolean
comparison, and incomplete execution after intentional worker loss. Satisfying those
controls does not relabel the failed/incomplete cases as passing behavior.

The actual loaded human is country **16777218**, not country zero. The surviving colony
is native colony **2**, canonical planet **35**, with real population in the saved game.
The removable uncolonized planet is **2045** and disposable `global_event` country is
**15**. Missing/wrong-kind/nonunique locators, altered tokens and the earlier world's
actual binding are refused without dispatching the requested effect or changing date.

Repeated fixed effects set the real country flag; native parsed conditions capture
true/false directly. Every native marker retains the full active invocation, world,
phase and script digest. The native condition fault controls deliberately lose a marker
or corrupt its identity; native return alone does not qualify completion.

Validation stays at **2200.01.01**. The only scenario time changes are an explicit three
days to **2200.01.04**, then one explicit removal day to **2200.01.05**. After both
destruction requests, independent saved state still contains both objects while paused.
After that day, game-written saves omit both objects and the destructor records retire
their original bindings. Replacements are immediately acquired under the same global
targets without another tick; the saved objects and native lifetime labels are new.

All **14,206** observer samples recorded zero game-active, game-foreground and on-screen
window samples. Each disposal confirmed no matching owned process remained and verified
the source save, executable and ordinary settings/log/save manifests unchanged. Cleanup
worked after worker loss, partial launch and timeout without using the former worker or
native channel. The private profiles are deliberately retained with exact paths/reasons
in `disposal.json`; the evidence archive is their permanent copy.

## Diagnostics, failures and limits

Raw diagnostics are unfiltered. The first construction run included two invalid
`GetName` log-localization expressions; those adapter-fixture log messages were corrected
before the saved-fixture runs. Their original source and logs remain retained. Final
ordinary readiness/failure cases have the store-backend diagnostic. The passing scenarios
also retain engine forbidden-random-area diagnostics during the shared replacement
effects: 34/35 error-log lines in the final baseline/fresh-world cases. Default checked
behavior is established; strict diagnostic success is not claimed.

The deliberate missing-marker, stale-marker, partial-launch and stalled-operation
failures retain unsuccessful harness results and raw evidence. No unexpected native
scenario failure needed a shared amendment. The stalled-operation fault is a host worker
stall after native readiness; it is not evidence of a native engine deadlock.

This remains the exact-build bounded experiment. Full numeric-ID/address-wraparound,
broader script context and stockpile matrices retain their earlier primary evidence.
They were not all repeated here. Supervisor OS-kill/orphan recovery, racing concurrent
supervisors, other operating systems/builds, production packaging and deterministic
replay remain outside the shared prototype.

## Verification and effort

Passed: shared and adapter TypeScript checks, Rust format/release build, all native
controls, independent save/response/observer verification, repository typecheck, and
repository build. The pinned CWT submodule was initialized without changing its commit.

The final full repository test command failed: **190 files passed, 10 failed; 4,305 tests
passed, 18 failed, 4 skipped; no type errors**. Existing production checks detect the
installed 4.5.0 game versus 4.4.6 identifier data / 4.4.1 script docs, an unsupported
`pop_faction_parameter` extraction selector, and the pre-existing r.6 provenance mismatch.
The earlier run also retained missing-submodule failures. Production files and the
pre-existing lockfile edit were preserved. These failures remain visible and are not
native compatibility results.

On `native2`, launch/readiness took 23.31–30.59 seconds (median 25.11); shared operations
took 64–714 ms (median 92); independent cleanup took 1.25–2.19 seconds (median 1.47).
Some verification ran alongside repository gates. These are observations, not performance
targets or isolated benchmarking.

[effort-record.json](effort-record.json) separates the recorded categories. Timed later
phase wall intervals are 170.24 s debugging, 178.47 s implementation and 652.41 s
verification, including tools/waits. **Initial discovery and assembly were not timed**;
their cost, separate setup/tool-construction cost and historical research effort are
unavailable, never zero. These partial wall observations cannot establish total active
engineering cost or a fair full-effort comparison with the later Windows adapters.
