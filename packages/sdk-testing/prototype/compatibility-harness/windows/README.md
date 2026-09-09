# Windows 4.5 compatibility spike

Throwaway native adapter for [Build the Windows Stellaris 4.5 spike adapter](https://linear.app/unnamed-system/issue/SDK-448/build-the-windows-stellaris-45-spike-adapter). This measures the frozen adapter boundary on one actual Windows installation. It is not production Windows support.

## Exact environment

- Windows 11 Home, kernel 10.0.26200, x64; Intel Core i9-13900K, NVIDIA RTX 4090.
- Stellaris Cygnus 4.5.0 (9e73), Steam `stellaris_test_4.5`, build 25085736; installed at `E:/SteamLibrary/steamapps/common/Stellaris`.
- `stellaris.exe` SHA-256: `bd86b8c8187bd23b793b6680cc979945e696f97c0a6aa89b5ca4199a5739535f`.
- Node 24.20.0; Python with Windows ctypes and `Path.is_junction`; MSVC 14.44.35207; Windows SDK 10.0.26100.0. `build.ps1` records the exact compiler and SDK locations.
- Native dependencies: nlohmann/json 3.12.0 and MinHook 1.3.4. Downloads are pinned by SHA-256 in the build script. Build output and vendor sources are ignored and retained in the evidence archive.

The Windows image is stripped: no useful COFF game symbols and no accompanying PDB. The evidence retains fresh disassembly, call-site ABI reconstruction, live object checks, and hook entry pins. Names inferred from Mac behavior are descriptive; the Windows addresses and actual observations are the proof.

## Reproduce on the recorded host

Build the DLL, then configure immutable local inputs. The fixture and source settings are distributed with the issue's evidence, not committed game assets.

```powershell
& packages/sdk-testing/prototype/compatibility-harness/windows/build.ps1
node packages/sdk-testing/prototype/compatibility-harness/windows/configure.ts `
  'E:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe' `
  '<evidence>/inputs/fixture.sav' '<evidence>/inputs/settings.txt' `
  'C:/Users/jacks/OneDrive/Documents/Paradox Interactive/Stellaris' `
  'C:/Users/jacks/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' `
  'C:/Users/jacks/sdk448/aliases'
node packages/sdk-testing/prototype/compatibility-harness/cli.ts `
  packages/sdk-testing/prototype/compatibility-harness/windows/adapter.ts `
  packages/sdk-testing/prototype/compatibility-harness/windows/local-config.json `
  .scratch/windows-spike-new-run
& '<python.exe>' packages/sdk-testing/prototype/compatibility-harness/windows/verify.py .scratch/windows-spike-new-run
```

Use a new output directory each time. Reconfigure after rebuilding the DLL; its exact hash is checked before launch. The adapter refuses a different executable and an already-running copy of that game. Run one spike at a time in the recorded unlocked, single-user graphical session. The source save and ordinary profile are hashed before and after each run; all private profiles are retained.

To exercise injected failures, copy `local-config.json`, add `fault` with `missing-end`, `stale-invocation`, `partial-launch`, or `hang`, and use the same CLI with a new directory. For `hang`, append `150` to the CLI arguments to set the operation deadline in milliseconds. Pass the fault name as the second argument to `verify.py`. These runs must report incomplete execution and a nonzero CLI exit; the independent verifier checks cleanup and retained evidence.

## Windows mechanisms

The tested game argument parser splits at hyphens, including those inside a `-userdir` path. The repository's `pdx-ts-sdk` name therefore made ordinary private-profile arguments crash before useful logs. Disassembly and a debugger captured the resulting null write-directory path. The process owner creates a fresh **hyphen-free directory junction** to the retained profile and passes that alias with forward slashes and a trailing slash. Cleanup checks the resolved target and unlinks only the junction.

`host.py` creates an inactive Windows desktop and launches the game there with `-dx11`, `--continuelastsave`, and `-gdpr-compliant`. DX9 device creation failed on that desktop; DX11 loaded the real world. Private settings select windowed 1280x720, cap 30, no borderless mode, and muted audio. No desktop switch, keyboard event, or mouse event is used. Samples record foreground PID, input-desktop identity, and actual game windows on each desktop. Sampling is evidence for these runs, not a continuous non-interference guarantee.

The game enters a kill-on-close Job Object before its suspended primary thread resumes. A detached Python owner retains its process handle and accepts a separate cleanup request even after the execution worker dies. A 600-second owner bound remains if the controlling process disappears. Injection uses remote `LoadLibraryW` after startup; early suspended-main injection failed and is retained. The bridge's process-local `WH_GETMESSAGE` hook executes only when its stack includes the pinned normal main-loop return address. `WM_NULL` prompts polling without OS input.

The bridge reads actual loaded player, date, pause, and global AI state, conditionally invokes the native AI toggle, then confirms the readback. It resolves real event definitions and scope objects, evaluates the actual trigger predicate, executes immediate effects, and calls the engine's synchronous fast-forward routine. Each explicit date change is checked exactly.

Native scopes temporarily permit RNG calls and restore the prior flag, reproducing the game's console-event guard. The retained first runs omitted that context and emitted forbidden-RNG diagnostics even though the behavioral controls passed. The final bridge records the flag before/after every reply and inside invocation markers. Scope construction draws from native RNG; boolean queries are not claimed to be RNG-state-pure. Fast-forward already owns its native guard. No general equivalence to every console command context is implied.

Country/planet bindings combine loaded-world identity, native object address, full database ID, and observed destructor generation. Complete-destructor hooks permanently retire old bindings. The short scenario observes address reuse with **changed full IDs**; it does not test full-ID wraparound. Unique locators evaluate their prepared predicate against live native objects. Colonized target handles are resolved through the engine's planet accessor.

Effect invocation markers come from a hook on the game's actual log-effect execution. Condition markers are native wrapper records around the actual predicate and its boolean return. Both correlate the current invocation synchronously. The game text log suppresses repeated messages, so it corroborates effect execution but cannot supply an exact invocation count. `verify.py` checks exact native marker sequences and independent save structure separately.

## Fixture and boundary

The immutable Windows fixture SHA-256 is `919df894628dcd1e21f636eb97eb8f20d9bb40b59527c2ef92cb9e2d297aeed7`. Windows loaded the retained Mac scenario and wrote this new save through its native Save Game request. It was not text-edited. The ready date is 2200.01.01, the real human player is full ID 16777218, and the same semantic targets include a populated colony, removable uncolonized planet, disposable global-event country, and two ambiguously marked planets. The idempotent fixture setup is retained unchanged from the Mac adapter. DLC selection is explicitly disabled; the private mod catalogue and source hashes are recorded per run.

The shared executable files, literal `sdk-446/v1-draft` contract, scenarios, controls, and prepared scripts remain unchanged from commit `59fd8ba463a8778f5ede8f6d67f4fb12cb89e81b`. Their combined runtime SHA-256 is `1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819`. All Windows launch, ownership, ABI, lifetime, and save-witness details stay inside this adapter directory. No shared amendment or corresponding Mac rerun was needed.

The added witness calls save through the actual asynchronous game request, wait for pending-save completion and a ZIP directory, then retain the hash. The independent verifier checks ZIP CRCs and uses the existing Mac save inspector unchanged. Saved targets and object tables corroborate native observations; game diagnostics remain visible in full logs.

## Limits and maintenance

Architectural fit is established only for the frozen scenario on this exact build. It does not establish cheap maintenance. Porting required fresh Windows launch discovery, stripped-image ABI reconstruction, x64 scope/string lifetimes, destructor hooks, and process-ownership debugging. The evidence includes the failed experiments and a partial effort ledger; elapsed spans are not summed as active engineering hours.

The Windows 4.4.6 follow-up can reuse this host, toolchain, private-desktop/process owner, evidence tooling, and frozen shared revision. It must independently establish its executable identity, ABI addresses/layouts, hook pins, fixture, and native controls. No wildcard build compatibility, general native operation catalogue, concurrent game support, cross-user ownership, or production orphan recovery is claimed.
