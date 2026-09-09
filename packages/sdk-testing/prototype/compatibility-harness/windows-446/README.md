# Windows 4.4.6 compatibility spike

Throwaway version port for [Build the Windows Stellaris 4.4.6 spike adapter](https://linear.app/unnamed-system/issue/SDK-449/build-the-windows-stellaris-446-spike-adapter). It implements the frozen shared scenario alongside the Windows 4.5 adapter from commit `91a5d51df0963e0c84cfd2c0ef5425e127e5b548`. This is evidence for the portability investigation, not production support.

## Pinned environment

- Same Windows 11 Home 10.0.26200 x64 host, Intel i9-13900K and NVIDIA RTX 4090 as the Windows 4.5 spike.
- Pegasus 4.4.6 (fdde), Steam public build `24109497`, at `E:/SteamLibrary/steamapps/common/Stellaris`.
- Executable SHA-256 `bc451c72d9654c8901f1bb0bee1dd78d76f415465c2fbf746e9f98ade333173a`; 46,418,552 bytes, AMD64 PE, no COFF game symbols.
- Node 24.20.0, Python 3.12.14, MSVC 14.44.35207 and Windows SDK 10.0.26100.0. The build reuses the earlier pinned nlohmann/json 3.12.0 and MinHook 1.3.4 downloads.
- Shared executable source SHA-256 remains `1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819`. No shared or earlier-adapter source changes are needed.

The installation had already been switched from the 4.5 test beta when this investigation began. This spike did not change Steam branches or modify the installation. The Linear evidence records both build identities, the current depot manifest, source differences, failed experiments, native results and partial effort measurements. A complete old-versus-new installation content inventory is unavailable.

## Reproduce

Obtain the game-produced fixture and settings from the issue's evidence. Use the exact recorded game installation and one unlocked graphical session. The fixture requires the installed DLC selection recorded in the evidence; this adapter enables the installation's DLCs.

```powershell
& packages/sdk-testing/prototype/compatibility-harness/windows-446/build.ps1
node packages/sdk-testing/prototype/compatibility-harness/windows-446/configure.ts `
  'E:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe' `
  '<evidence>/inputs/fixture-446.sav' '<evidence>/inputs/settings.txt' `
  'C:/Users/jacks/OneDrive/Documents/Paradox Interactive/Stellaris' `
  'C:/Users/jacks/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' `
  'C:/Users/jacks/sdk449/aliases'
node packages/sdk-testing/prototype/compatibility-harness/cli.ts `
  packages/sdk-testing/prototype/compatibility-harness/windows-446/adapter.ts `
  packages/sdk-testing/prototype/compatibility-harness/windows-446/local-config.json `
  .scratch/windows-446-new-run
& '<python.exe>' packages/sdk-testing/prototype/compatibility-harness/windows-446/verify.py .scratch/windows-446-new-run
```

Output directories must be new. Reconfigure after rebuilding: the DLL hash is a required launch pin. The process owner uses the existing inactive desktop, DX11, hyphen-free profile junction, suspended launch into a kill-on-close Job Object, delayed DLL loading, and detached cleanup owner. No desktop switch, keyboard input or mouse input is used. Every private profile is retained; cleanup removes only its checked junction and confirms the owned process handle has exited.

For fault controls, copy the configuration and add `fault`: `missing-end`, `stale-invocation`, `partial-launch`, or `hang`. Use the common CLI with a fresh directory; append `150` for the hang operation deadline. Pass the fault name as the verifier's second argument. These controls must retain incomplete execution and a nonzero CLI exit, with confirmed cleanup.

## Version-specific work

The adapter intentionally stays next to the frozen Windows 4.5 source, so the port is directly comparable. Similar source is retained as experimental evidence rather than folded into a production abstraction.

Native entrypoints and singleton addresses were reconstructed from retained 4.5 disassembly, unique masked byte-pattern candidates, 4.4 console registrations, fresh disassembly and live observations. A match is a discovery candidate, not proof of ABI or behavior. In particular, one string-call candidate was an assignment routine; inspection selected the actual constructor before native use.

Relevant changes include:

- CString constructor/destructor, country and planet database pointers, event-manager pointer, scope operations, predicate/effect entrypoints, RNG state, AI toggle, fast-forward, save request and destructor/log hooks all have new addresses.
- Country object internals changed; its full ID remains at `+0x20` in the verified accesses. Planet full IDs remain at `+0x18`.
- The save-manager pointer moved from in-game idler `+0xf90` to `+0xf88`. The asynchronous pending byte is still manager `+0x68`.
- The normal main-loop stack return is `0x1bba8ca`, replacing `0x1a4798a`. The bridge retains a captured stack; readiness still separately requires the loaded player, date, pause and AI observations.
- A reused host bug surfaced as `SetWindowsHookExW` error 126. The process-local hook now passes a null module handle, as required by [the Windows API contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw). This is a correction to reused Windows plumbing, not evidence of changed Stellaris semantics. Initialization failures now terminate readiness promptly and retain their native error.
- Diagnostic stack capture uses a single immutable file. An earlier continuously replaced diagnostic file stopped yielding stacks while the game continued loading; its exact cause was not established. Those failed runs remain in the evidence. Native exceptions now have a retained failure record.
- The fixture constructor uses `capital_scope.planet`: 4.4.6 rejected `set_planet_flag` directly in its colony-valued capital scope. Only the version-specific fixture constructor changed; common scripts and fixture roles did not.

## Fixture differences

The user supplied a normal game-produced 4.4.6 save. Original SHA-256: `3562af80811abd70f8e42754c3be21f322b06b6af81bd31051f919ca3aad2935`. It has a populated United Nations of Earth colony, date 2200.01.01, player full ID **0**, and 28 required DLCs. It has no original mod dependency.

The native game loaded that input, ran the retained fixture-construction event, and wrote the frozen prepared fixture through the engine's asynchronous save request. Frozen SHA-256: `a3373a32c4197eb863ad784ad2d538e90f9e6d46170a9b614bcf5e6255eeb2b5`. It names the spike mod and preserves the 28 required DLCs. Neither save was text-edited. Every run also produces independent ready/removal/replacement save witnesses.

The Windows 4.5 fixture used a different galaxy, nonzero player ID 16777218 and disabled DLCs. This is equivalent scenario semantics, not identical save bytes or a perfectly controlled whole-world performance comparison. The common fixture contract permits differing IDs and dates. The preferred nonzero-player anti-hardcoding control is absent from this 4.4.6 fixture; do not claim that extra coverage. The adapter obtains the actual native player and the verifier checks the supplied fixture's ID.

The first attempts retained a 4.5 save and did not establish readiness. The user then created this compatible save. A later attempt incorrectly retained the earlier disabled-DLC selection; that failed attempt is also preserved. Neither is relabeled as successful compatibility evidence.

## Evidence and limits

Use the issue's project-owned report and archive for the completed matrices, raw failure history, source/build identities, independent save checks, ordinary-profile manifests, observed timings and cleanup results. The ordinary-profile baseline changes across the explicitly requested pause while the user created the source save; comparisons resume from that new baseline and do not hide this change.

Bindings use world identity, full database ID, native address and observed complete-destructor generation. Removal and replacement must satisfy the unchanged delayed-removal and bounded explicit-tick controls. The short scenario does not establish full numeric-ID wraparound, general event coverage, arbitrary game builds, production orphan recovery, concurrent game support or release performance guarantees.

No common interface amendment was made, so no earlier-adapter rerun was required. Architectural fit for this scenario does not imply that future game updates will be inexpensive. The companion effort record explicitly separates reusable tools, incomplete discovery/implementation timing, debugging windows, measured native run durations and the human fixture pause.
