# Apple Silicon compatibility spike

Throwaway native adapter for **one** Stellaris Cygnus 4.5.0 beta executable:
`408a5700a202837f16041bf14b5da34ff4a9d939b98e62a8240dc68dd602ddf7`.
It answers whether the approved common scenario fits the existing native mechanisms.
It adds no production package API or support promise.

The [shared harness](../README.md), [fixture contract](../FIXTURE.md) and
[amendment ledger](../AMENDMENTS.md) remain the acceptance authority. The executable
shared files are unchanged from `b822716a950dbaa1a17a6ccc5b4c5c93e24bb4d1`, SHA-256
`1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819`.

## Repeat a native run

Use an unlocked single-user Apple Silicon macOS session, Node 24, Rust, Xcode command
line tools, repository npm dependencies, the pinned game, and the game-written fixture
and settings retained with this issue's evidence. No ordinary game may be running.
All control uses the private native mailbox; it emits no mouse or keyboard input.

From the repository root, configure paths and build the native tools:

```sh
node packages/sdk-testing/prototype/compatibility-harness/apple-silicon/configure.ts \
  '/absolute/path/stellaris.app/Contents/MacOS/stellaris' \
  '/absolute/path/evidence/inputs/fixture.sav' \
  '/absolute/path/evidence/inputs/settings.txt' \
  '/absolute/path/ordinary/Stellaris'
npm --prefix packages/sdk-testing/prototype/compatibility-harness/apple-silicon run check
npm --prefix packages/sdk-testing/prototype/compatibility-harness/apple-silicon run run -- \
  /absolute/path/to/a/new/run
python3 packages/sdk-testing/prototype/compatibility-harness/apple-silicon/verify.py \
  /absolute/path/to/a/new/run
```

`configure.ts` copies immutable save/settings inputs into ignored `inputs/`, compiles
the bridge, guard and observer, and writes an explicit local configuration. It does
not launch the game. Source lives here; no reusable runtime code depends on `.scratch`
or the original investigation directories. Binaries and game-produced saves are evidence
assets rather than Git source. Recompilation can change binary hashes; the configuration
pins the actual artifacts used, and every launch checks those pins.

The four unchanged cases are baseline, fresh world with the earlier world's actual
binding, intentionally false assertion, and worker loss after readiness. A successful
command means those controls behaved as intended. It does not turn the intentional
failure or incomplete worker-loss case into a passing behavior result.

## Fixture construction

The retained original input is the game-produced nonzero-player save from
[Country and planet locator identity: native evidence](https://linear.app/unnamed-system/document/country-and-planet-locator-identity-native-evidence-753293d05d90),
SHA-256 `0721bc41fb7f779f76aff270a1e932564e72141f662a5d87f4ec4908cb6a7e07`.
To reconstruct, configure with that save and run the same command into a new directory.
`fixture.txt` creates the disposable global-event country and uncolonized planet during
load, keeps the loaded human's genuinely populated capital, and marks exactly two
planets. The `sdk447_fixture_built` flag makes construction idempotent.

The native adapter saves `baseline/profile/save games/sdk447_fixture/ready.sav` before
scenario work. Preserve that game-written file as `fixture.sav` and configure future
runs with it. Those runs load the already constructed state. The initial construction
and later loaded-fixture runs are retained separately; no save text was edited.
All DLCs are disabled; the only enabled mod contains the unchanged common events and
the adapter fixture loader. The private input manifest records the complete mod,
settings, selection order and disabled DLC descriptor hashes.

## Native boundary and provenance

`adapter.ts` implements the common module contract. `lifecycle.ts` owns exact-build
selection, launch, durable resource ownership and independent disposal. `io.ts` owns
the file mailbox and process tools. `native/src` reuses the completed native locator,
script/context, stockpile and shared-suite probes. The inherited event and stockpile
operations are not exposed by this common adapter; their presence adds no acceptance
claim. In particular this experiment does not repeat the stockpile matrix.

The reused evidence is current, including completed
[script/context verification](https://linear.app/unnamed-system/document/country-and-planet-scripts-and-stockpiles-native-evidence-4325d6078bd2),
[additional stockpile coverage](https://linear.app/unnamed-system/document/additional-country-stockpiles-including-modded-resources-native-66d1f6f3247b),
and [shared-suite verification](https://linear.app/unnamed-system/document/prepared-scripts-and-shared-suite-execution-verification-evidence-9d35c1811e11).
The last reader's live economy-module guard remains in the inherited source.

Adapter changes select the common fixed catalogue, accept its UUID request identities,
retain the full native invocation context, and capture conditions around `CEvent::IsValid`.
Conditions never fire their event. Effects call `CEvent::PerformImmediate`; the existing
prologue-pinned log hook captures their fixed start/end markers while that native
invocation is active. Native return, marker identity and checked behavior remain separate.
The adapter never synthesizes missing native markers from log timing.

The existing country/planet destructor hooks retire issued native bindings permanently.
A subject label includes kind, full ID, address and the recorded destruction generation.
Repeated acquisition agrees while the object lives. Replacement cannot revive an old
token, even on complete ID/address reuse; the full wraparound stress remains the earlier
locator probe's evidence rather than a claim of this short run.

## Failure and cleanup controls

Copy `local-config.json`, add `fault`, and use the full common CLI with that copy:

```sh
node packages/sdk-testing/prototype/compatibility-harness/cli.ts \
  packages/sdk-testing/prototype/compatibility-harness/apple-silicon/adapter.ts \
  /absolute/path/fault-config.json /absolute/path/new-fault-run
```

`missing-end` removes a captured marker inside the native bridge after real execution.
`stale-invocation` corrupts a native marker identity. Both retain raw native records and
must fail. `partial-launch` fails after game creation, before readiness returns.
`hang` stalls the operation worker; supply a fourth CLI argument of `150` milliseconds
to exercise independent timeout and cleanup. Run `verify.py <run> <fault>` afterward.
These deliberate faults are adapter-only controls, not shared exceptions.

Every launch journals its unique private profile and launch intent before creating
processes. A fresh cleanup worker reads that record, verifies current command identities,
stops the launcher, rescans for the game, confirms exits, and retains observer output.
It does not depend on the former adapter worker or a functioning native channel.
Profiles stay in their run directories deliberately so raw logs and saves remain
reviewable. `disposal.json` records the exact path and reason. After retaining the
evidence archive, those completed run directories can be removed manually.

Supervisor OS kill/orphan recovery remains outside the shared prototype, as does
concurrent game admission across racing supervisors. This is a sequential experiment.
Uncertain completion is incomplete, and an unsupported executable fails before launch.

The independent verifier reads native responses separately from normalized outcomes,
parses game-written saves with the repository parser, checks real population and object
membership, and checks the observer and protected source/profile manifests. Raw game
diagnostics remain unfiltered; checked behavior does not imply strict diagnostic success.
