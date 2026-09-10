# Windows 4.4.6 environment probe

Throwaway evidence source for [Verify build access, Steam readiness, and profile
paths on Windows 4.4.6](https://linear.app/unnamed-system/issue/SDK-455/verify-build-access-steam-readiness-and-profile-paths-on-windows-446).
It does not implement production installation, readiness, or cleanup behavior.

The probe records the installed executable, selected Steam branch/build, the
client process and last connection-log state, and a redacted cached-login
policy. These are preflight observations, not substitutes for the game
adapter's load/readiness marker. The alias matrix journals intent before each
junction, refuses cleanup for a mismatched type or target, and removes only a
verified, positively owned junction.

Run from the repository root with the Python used by the Windows 4.4.6 spike:

```powershell
& '<python.exe>' packages/sdk-testing/prototype/windows-446-environment/probe.py snapshot `
  --output '<new-evidence-directory>/snapshot.json' `
  --game 'E:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe' `
  --app-manifest 'E:/SteamLibrary/steamapps/appmanifest_281990.acf' `
  --steam-root 'C:/Program Files (x86)/Steam'

& '<python.exe>' packages/sdk-testing/prototype/windows-446-environment/probe.py alias-matrix `
  --output '<new-evidence-directory>/alias-matrix' `
  --external-alias-root 'C:/Users/<user>/sdk455 path cases'
```

To include the selectable branch inventory, parse the current client-owned
`appcache/appinfo.vdf` with a version-compatible parser and pass its JSON as
`--app-info-json`. The evidence report records the exact parser revision used;
the branch inventory is cached Steam-client metadata and should be dated.

The game-facing alias path is qualified as a complete path. The known Windows
parser constraint rejects a hyphen anywhere in that path; this task retains
the earlier crash evidence instead of replaying it. Spaces are accepted only
because a real launch through a spaced junction is separately required. The
real project, profile, and evidence paths remain unchanged behind the junction.
