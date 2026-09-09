$ErrorActionPreference = 'Stop'
$msvc = 'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207'
$sdk = 'C:/Program Files (x86)/Windows Kits/10'
$version = '10.0.26100.0'
$env:INCLUDE = "$msvc/include;$sdk/Include/$version/ucrt;$sdk/Include/$version/um;$sdk/Include/$version/shared"
$env:LIB = "$msvc/lib/x64;$sdk/Lib/$version/ucrt/x64;$sdk/Lib/$version/um/x64"
$build = Join-Path $PSScriptRoot 'native/build'
New-Item -ItemType Directory -Force $build | Out-Null
$vendor = Join-Path $build 'vendor'
New-Item -ItemType Directory -Force $vendor | Out-Null
if (!(Test-Path -LiteralPath "$vendor/json.hpp")) {
    Invoke-WebRequest https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp -OutFile "$vendor/json.hpp"
}
if (!(Test-Path -LiteralPath "$vendor/minhook-1.3.4/src/hook.c")) {
    Invoke-WebRequest https://github.com/TsudaKageyu/minhook/archive/refs/tags/v1.3.4.zip -OutFile "$vendor/minhook.zip"
    Expand-Archive -LiteralPath "$vendor/minhook.zip" -DestinationPath $vendor -Force
}
if ((Get-FileHash -LiteralPath "$vendor/json.hpp").Hash -ne 'AAF127C04CB31C406E5B04A63F1AE89369FCCDE6D8FA7CDDA1ED4F32DFC5DE63') { throw 'JSON dependency hash mismatch' }
if ((Get-FileHash -LiteralPath "$vendor/minhook.zip").Hash -ne '172708123DAA0C98D20D3A980B16A50BE14AF243DC95DEE6F79C24193AD010E4') { throw 'MinHook archive hash mismatch' }
$hook = "$vendor/minhook-1.3.4"
Push-Location $build
try {
    & "$msvc/bin/Hostx64/x64/cl.exe" /nologo /c /MT /O2 "/I$hook/include" "$hook/src/hook.c" "$hook/src/buffer.c" "$hook/src/trampoline.c" "$hook/src/hde/hde64.c"
    if ($LASTEXITCODE -ne 0) { throw 'MinHook compilation failed' }
    & "$msvc/bin/Hostx64/x64/cl.exe" /nologo /LD /MT /EHsc /std:c++20 /W4 "/I$vendor" "/I$hook/include" "$PSScriptRoot/native/bridge.cpp" /link /OUT:bridge.dll hook.obj buffer.obj trampoline.obj hde64.obj user32.lib
    if ($LASTEXITCODE -ne 0) { throw 'Bridge compilation failed' }
} finally { Pop-Location }
