# Adapter compatibility spike — throwaway

Question: can one fixed scenario and adapter contract run on native Apple Silicon
Stellaris 4.5, Windows 4.5, and Windows 4.4.6 without platform rules leaking into
shared checks? This is the shared harness for **Build the shared adapter
compatibility spike harness**, not the production testing package.

Status: **draft for human review; mock mechanics verified; no native compatibility
established here**. The Apple Silicon child must establish the first real-game
baseline and freeze its exact shared source revision before Windows work begins.

## Run from a checkout

Requires the repository's Node 24+ and `npm install`. No game is needed for the mock.
From the repository root:

```sh
npm --prefix packages/sdk-testing/prototype/compatibility-harness run check
npm --prefix packages/sdk-testing/prototype/compatibility-harness run demo
```

`demo` writes `runs/demo`. Output directories must be new: evidence is never
silently overwritten. For another run or an external native adapter:

```sh
node packages/sdk-testing/prototype/compatibility-harness/cli.ts \
  packages/sdk-testing/prototype/compatibility-harness/mock-adapter.ts \
  packages/sdk-testing/prototype/compatibility-harness/mock-config.json \
  packages/sdk-testing/prototype/compatibility-harness/runs/another-run
```

The same arguments work on Windows (use one line or your shell's continuation).
Replace only the adapter module and its JSON configuration. Configuration may
contain machine-local install/fixture paths, native manifest and tool locations;
do not put credentials in it, because resolved configuration is retained.

The entry point exports no production API and adds no production package exports
or dependencies. Its nested private package is only a convenient npm task runner.
The SDK package's build includes `src`, and publishes `dist`; this prototype stays
out of the published package.

## Executable subset and ownership

- `contract.ts`: wire types for a small adapter, invocation, outcomes and cleanup.
- `scenario.ts`: fixed scripts, locators and day counts; acceptance authority.
- `prepare.ts`: exact shared event definitions, generated before launch.
- `checks.ts`: shared comparisons, with no platform/build inputs or special cases.
- `supervisor.ts`: sequential scenario and independent host deadlines.
- `worker.ts`: composition boundary that imports the selected adapter module.
- `cli.ts`: four-case experiment, source identities and JSON evidence output.
- `mock-adapter.ts`: synthetic world and real disposable Node child for exercising
  supervisor mechanics. It deliberately reuses numeric slots with new lifetimes.

The adapter module implements `create(context)` and `disposeOwned(context, control)`.
`create` returns `launch` and `perform`. Installation selection, exact-build
revalidation, profile creation, native engine access and native evidence collection
belong to that module. The CLI supplies a module path instead of implementing the
production installation-discovery factory. Shared code never selects by OS/build.

`launch` returns a paused ready world and exact input metadata. All launches in one
experiment must report identical installation/fixture/dependency metadata and new
world identity. The fixture has already installed the supplied prepared definitions.
Every `perform` command carries a fresh host invocation identity. The adapter must
validate current world, kind, exact issued binding and lifetime before dispatch.
The `subject` returned by validation is a stable object-lifetime identity: repeated
acquisition of the same live object agrees, and a replacement has a different
lifetime even if its full numeric ID and address are reused. Bindings are adapter
wire tokens, not a proposed public author API or a permit for numeric-ID lookup.

A completed effect requires native completion plus the exact fixed start/end
markers associated with that invocation at the native boundary. Conditions use the
parsed definition's native predicate, and the native sink produces start,
`result:true` or `result:false`, and end records around that evaluation. Checking a
condition must not fire its event. The event definitions in `sdk446-events.txt`
contain fixed arguments only; invocation identity lives in the native call context,
not in runtime script substitutions. `scriptHashes` hash each full prepared-script
record, including definition ID and definition bytes. A raw log line or an adapter's
native-call return by itself is not completion. The native adapter must retain the
underlying evidence that justifies each normalized record; this harness checks the
record contract, not arbitrary raw native formats.

A rejection certifies no requested mutation. Foreign-world binding use is a
`contract-error`, not a successful expected game rejection. A lost channel,
unsupported required operation, or uncertain completion returns `incomplete` with
causes and raw evidence. Do not map these to a rejection or silently skip a check.

## Shared scenario assertions

1. Load the version-appropriate fixture. Observe world/date, actual player, paused
   state and AI off. Acquire player, disposable nonplayer country, a genuinely
   colonized planet, and an uncolonized disposable planet.
2. Validate player identity, native `is_ai = no`, `is_colony = yes/no`, and the
   initially false effect flag. No operation or gap between operations may change
   the date. The player locator must not assume country zero.
3. Require `missing-object`, `wrong-object-kind`, and `ambiguous-object` for the
   three fixed negative locators. A changed token must produce `invalid-binding`
   for validation and attempted effect dispatch. Foreign-world validation and
   effect dispatch must return a contract error. The effect flag must remain false.
4. Invoke the same prepared flag effect twice, with distinct invocation IDs, checking
   its native condition each time. Advance exactly **three days**, ending paused.
5. Resolve the disposable country again and require the same lifetime identity.
   Request country destruction and planet removal. Both bindings must still be live
   at that paused point; this is the selected delayed-removal control, grounded in
   the earlier native evidence. Do not equate the request with actual removal.
6. Advance in explicit **one-day increments, at most ten days**, checking both
   lifetimes after each increment. Both must become invalid; an invalid token must
   never revive. The same loop and bound apply to every adapter.
7. Create replacements with fixed effects and reacquire their same global targets
   immediately, without a hidden tick. New bindings must be live, have different
   lifetime identities, and leave old bindings invalid. The new planet is uncolonized.
8. Dispose all owned processes and the private profile, retaining evidence. A second
   fresh world repeats the scenario and rejects the first world's real player token.
9. A separate fresh fixture captures the false flag condition and compares it with
   true. Preserve `behavior: failed`; the negative control succeeds only if this
   exact mismatch occurs and cleanup is confirmed.
10. A fourth fresh fixture loses its adapter worker after readiness. Preserve
    `execution: incomplete`; the negative control succeeds only if independent
    cleanup confirms exit and evidence retention. No game action is retried.

The harness stops the matrix on an unsatisfied control. Omitted cases are visible
because the report has fewer than four cases and `controlsSatisfied` is false.

## Process and profile deadlines

Launch: 180 seconds. Each operation: 60 seconds. Independent cleanup: 10 seconds.
Worker exit confirmation: 5 seconds. These are bounded experiment controls, not
release performance promises. An optional fourth positional value overrides the
operation bound in milliseconds for fault exercises; it is recorded in inputs.

The supervisor forks a worker for normal operations, applies its own timers, stops
that worker on completion/failure, then forks a **new cleanup worker**. The cleanup
module must work from the same run context and a durable owned-resource record,
without the old worker's memory or channel. Journal launch intent and recoverable
ownership **before** creating resources. Partial launch must not lose cleanup
identity. Ownership must verify process identity beyond a bare PID before signaling.
The adapter's ordinary control path cannot be its only disposal path.

`disposeOwned` must positively establish process exit, preserve logs/raw/partial
records, then remove the private profile or report deliberate retention. Failed
profile handling and unconfirmed exit cannot satisfy the cleanup control. Retained
profiles require an explicit path and reason in raw cleanup evidence and later
manual disposal. Successful disposal does not erase earlier behavior or execution
failure. An unconfirmed cleanup stops all later cases. The mock child uses a private
STOP mailbox; it never sends a signal to a PID read from an untrusted ownership file.

This subset does not implement supervisor-crash/orphan recovery, lock-based run
exclusion, author processes/hooks, inactive-phase admission, synchronous assertion
RPC, the full length-delimited production protocol, full event operations, numeric
observations, automatic fixture discovery, polished reporting or packaging. Native
adapter methods must remain bounded and preserve evidence on cancellation. A
supervisor OS kill still requires manual recovery. Those limits must not be read as
proof of the broader adopted runner contract.

## Evidence and portable handoff

`inputs.json` preserves shared source file hashes and combined SHA-256, selected
module hash, runtime, configuration, timeouts, full script definitions and digests.
`sdk446-events.txt` is the common engine input. Each case keeps its append-only
`journal.jsonl`, raw adapter/cleanup logs and references, `result.json` (observed
facts), and `control.json` (whether the intended positive or negative control was
satisfied). The top-level `result.json` has `schemaVersion: 1`, shared revision/hash,
all case results, `controlsSatisfied`, and `nativeCompatibilityEstablished`.

The distinction matters: a satisfied false-condition control still contains a
failed behavior result. A satisfied worker-loss control still contains incomplete
execution. Mock results **always** keep `nativeCompatibilityEstablished: false`.
Input metadata must include exact OS/CPU/game, executable/bridge hashes, source-save
build/hash, ordered dependency hashes and adapter revision. Native runs must retain
independent engine witnesses for fixture state, effect outcome, actual removal and
replacement, plus unfiltered diagnostics. A source hash and a self-reported
capability are not independent native verification.

Use `effort-template.json` for every adapter. Keep measured time separate from
estimates and unavailable values; separate discovery, implementation, debugging,
verification, environment setup and reusable tools. Earlier probe research is
reused evidence with unknown prior cost, not zero-cost work.

After the Apple Silicon baseline, record its source commit and shared hash in
`AMENDMENTS.md`. Windows runs use that exact revision. Every change to shared
code, fixed script, fixture semantics, bound or assertion requires a reason,
baseline diff and reruns against earlier adapters. A port that fails remains a
finding. It must not adjust shared checks just to turn green.

## Fault exercises

Set `fault` in a copy of the mock config to `validation-ticks`, `stale-invocation`,
`missing-end`, `revive-binding`, `hang`, `block`, `partial-launch`, or `cleanup-fails`.
Each should return exit code 1 and retain its failure. `hang` leaves a promise
pending; `block` synchronously blocks the worker. Use an operation bound such as
150 ms for these two. `partial-launch` fails after creating its owned child, so
independent cleanup must still find it. `cleanup-fails` requests child exit but
withholds confirmation; the harness must not claim confirmed cleanup.

These are disposable demonstration controls, not additions to the package test
suite. See `VERIFICATION.md` for the recorded local exercise and native limits.
