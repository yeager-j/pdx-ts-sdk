"""Bounded Windows environment probe for SDK-455.

The probe records installation and Steam observations without treating them as
game readiness, and exercises junction ownership rules without deleting target
directories or unrelated paths.
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any


EXPECTED_BUILD_ID = "24109497"
EXPECTED_EXECUTABLE_SHA256 = (
    "bc451c72d9654c8901f1bb0bee1dd78d76f415465c2fbf746e9f98ade333173a"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def absolute_path(path: Path) -> str:
    return os.path.abspath(path)


def text_vdf_value(contents: str, key: str) -> str | None:
    match = re.search(rf'"{re.escape(key)}"\s+"([^"]*)"', contents)
    return match.group(1) if match else None


def steam_process_names() -> list[str]:
    completed = subprocess.run(
        ["tasklist.exe", "/fo", "csv", "/nh"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    names = []
    for line in completed.stdout.splitlines():
        match = re.match(r'^"([^"]+)"', line)
        if match and match.group(1).lower().startswith("steam"):
            names.append(match.group(1).lower())
    return sorted(set(names))


def latest_connection_state(connection_log: Path) -> dict[str, str] | None:
    if not connection_log.is_file():
        return None
    state_pattern = re.compile(
        r"^\[(?P<timestamp>[^]]+)] \[(?P<state>Logged On|Logged Off|Logging On|Connecting),"
    )
    latest = None
    for line in connection_log.read_text(encoding="utf-8", errors="replace").splitlines():
        match = state_pattern.match(line)
        if match:
            latest = match.groupdict()
    return latest


def cached_login_policy(login_users: Path) -> dict[str, str | bool | None]:
    if not login_users.is_file():
        return {
            "loginUsersFilePresent": False,
            "rememberPassword": None,
            "autoLogin": None,
            "wantsOfflineMode": None,
        }
    contents = login_users.read_text(encoding="utf-8", errors="replace")
    return {
        "loginUsersFilePresent": True,
        "rememberPassword": text_vdf_value(contents, "RememberPassword"),
        "autoLogin": text_vdf_value(contents, "AutoLogin"),
        "wantsOfflineMode": text_vdf_value(contents, "WantsOfflineMode"),
    }


def selected_branch_details(app_info_json: Path | None) -> dict[str, Any] | None:
    if app_info_json is None:
        return None
    apps = json.loads(app_info_json.read_text(encoding="utf-8"))
    app = next(item for item in apps if item.get("appid") == 281990)
    branches = app["raw"]["appinfo"]["depots"]["branches"]
    return {
        "cacheChangeNumber": app["change_number"],
        "cacheLastUpdated": app["last_updated"],
        "branches": branches,
        "hasExact446Rollback": "4.4.6" in branches,
    }


def installation_snapshot(
    game: Path, app_manifest: Path, app_info_json: Path | None
) -> dict[str, Any]:
    manifest = app_manifest.read_text(encoding="utf-8", errors="replace")
    executable_hash = sha256(game)
    build_id = text_vdf_value(manifest, "buildid")
    branch = text_vdf_value(manifest, "BetaKey")
    return {
        "game": str(game.resolve()),
        "executableBytes": game.stat().st_size,
        "executableLastWriteUnixSeconds": game.stat().st_mtime,
        "executableSha256": executable_hash,
        "expectedExecutableSha256": EXPECTED_EXECUTABLE_SHA256,
        "executableMatches": executable_hash == EXPECTED_EXECUTABLE_SHA256,
        "appManifest": str(app_manifest.resolve()),
        "buildId": build_id,
        "expectedBuildId": EXPECTED_BUILD_ID,
        "buildMatches": build_id == EXPECTED_BUILD_ID,
        "selectedBranch": branch,
        "availableBranches": selected_branch_details(app_info_json),
    }


def steam_snapshot(steam_root: Path) -> dict[str, Any]:
    process_names = steam_process_names()
    connection = latest_connection_state(steam_root / "logs" / "connection_log.txt")
    return {
        "steamProcesses": process_names,
        "steamProcessPresent": bool(process_names),
        "latestConnectionObservation": connection,
        "cachedLoginPolicy": cached_login_policy(steam_root / "config" / "loginusers.vdf"),
        "interpretationLimit": (
            "Process presence and the client connection log are preflight observations only; "
            "neither establishes that the game reached its load marker."
        ),
    }


def volume_file_system(path: Path) -> str:
    root = Path(path.resolve().anchor)
    file_system = ctypes.create_unicode_buffer(256)
    volume_name = ctypes.create_unicode_buffer(256)
    serial = wintypes.DWORD()
    maximum_component = wintypes.DWORD()
    flags = wintypes.DWORD()
    success = ctypes.windll.kernel32.GetVolumeInformationW(
        str(root),
        volume_name,
        len(volume_name),
        ctypes.byref(serial),
        ctypes.byref(maximum_component),
        ctypes.byref(flags),
        file_system,
        len(file_system),
    )
    if not success:
        raise ctypes.WinError()
    return file_system.value


def alias_compatibility(alias: Path) -> dict[str, Any]:
    parent = alias.parent
    reasons = []
    if "-" in str(alias):
        reasons.append("complete alias path contains a hyphen")
    if alias.exists() or alias.is_symlink():
        reasons.append("alias path already exists")
    try:
        file_system = volume_file_system(parent)
    except OSError as error:
        file_system = None
        reasons.append(f"alias volume unavailable: {error}")
    writable = False
    if parent.is_dir():
        try:
            descriptor, write_probe = tempfile.mkstemp(prefix="sdk455-", dir=parent)
            os.close(descriptor)
            Path(write_probe).unlink()
            writable = True
        except OSError as error:
            reasons.append(f"alias root is not writable: {error}")
    else:
        reasons.append("alias root is not an existing directory")
    if file_system not in {None, "NTFS"}:
        reasons.append(f"directory-junction support is not established on {file_system}")
    return {
        "alias": str(alias),
        "containsSpaces": " " in str(alias),
        "containsHyphen": "-" in str(alias),
        "fileSystem": file_system,
        "writable": writable,
        "compatible": not reasons,
        "reasons": reasons,
    }


def create_junction(alias: Path, target: Path) -> dict[str, Any]:
    completed = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(alias), str(target)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "exitCode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def journal_intent(path: Path, alias: Path, target: Path) -> None:
    write_json(
        path,
        {
            "alias": absolute_path(alias),
            "target": str(target.resolve()),
            "intent": "create-and-own-directory-junction",
        },
    )


def remove_owned_junction(alias: Path, target: Path, intent_path: Path) -> dict[str, Any]:
    if not intent_path.is_file():
        return {"removed": False, "reason": "ownership intent is missing"}
    intent = json.loads(intent_path.read_text(encoding="utf-8"))
    if intent.get("alias") != absolute_path(alias):
        return {"removed": False, "reason": "ownership intent names a different alias"}
    if intent.get("target") != str(target.resolve()):
        return {"removed": False, "reason": "ownership intent names a different target"}
    if not alias.exists() and not alias.is_symlink():
        return {"removed": False, "reason": "alias is already absent"}
    if not alias.is_junction():
        return {"removed": False, "reason": "existing alias is not a directory junction"}
    if alias.resolve() != target.resolve():
        return {"removed": False, "reason": "junction target does not match ownership intent"}
    alias.rmdir()
    return {"removed": True, "reason": "owned junction target verified"}


def prepare_target(path: Path, marker: str) -> None:
    path.mkdir(parents=True)
    (path / "marker.txt").write_text(marker + "\n", encoding="utf-8")


def run_alias_matrix(output: Path, external_alias_root: Path) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError(f"output must be new: {output}")
    output.mkdir(parents=True)
    external_alias_root.mkdir(parents=True, exist_ok=True)
    results: dict[str, Any] = {}

    compatible_target = output / "real project-with hyphen" / "profile with spaces"
    prepare_target(compatible_target, "compatible-target")
    compatible_alias = external_alias_root / "space compatible alias"
    compatible_intent = output / "compatible-spaces" / "intent.json"
    journal_intent(compatible_intent, compatible_alias, compatible_target)
    compatible_check = alias_compatibility(compatible_alias)
    compatible_create = create_junction(compatible_alias, compatible_target)
    if compatible_create["exitCode"] == 0:
        (compatible_alias / "write-through.txt").write_text("preserved\n", encoding="utf-8")
    compatible_cleanup = remove_owned_junction(
        compatible_alias, compatible_target, compatible_intent
    )
    results["compatibleSpaces"] = {
        "check": compatible_check,
        "create": compatible_create,
        "cleanup": compatible_cleanup,
        "targetPreserved": (compatible_target / "marker.txt").is_file(),
        "writeThroughPreserved": (compatible_target / "write-through.txt").is_file(),
    }

    incompatible_alias = external_alias_root / "hyphen-alias"
    results["incompatibleHyphen"] = alias_compatibility(incompatible_alias)

    unavailable_root = output / "unavailable-root-file"
    unavailable_root.write_text("preserve\n", encoding="utf-8")
    unavailable_alias = unavailable_root / "alias"
    try:
        unavailable_alias.parent.mkdir(parents=True, exist_ok=True)
        unavailable_error = None
    except OSError as error:
        unavailable_error = f"{type(error).__name__}: {error}"
    results["unavailableRoot"] = {
        "error": unavailable_error,
        "rootFilePreserved": unavailable_root.read_text(encoding="utf-8") == "preserve\n",
        "aliasAbsent": not unavailable_alias.exists(),
    }

    existing_target = output / "preexisting-target"
    prepare_target(existing_target, "preexisting-target")
    existing_alias = external_alias_root / "preexisting directory"
    existing_alias.mkdir()
    (existing_alias / "unrelated.txt").write_text("preserve\n", encoding="utf-8")
    existing_intent = output / "preexisting-directory" / "intent.json"
    journal_intent(existing_intent, existing_alias, existing_target)
    results["preexistingDirectory"] = {
        "check": alias_compatibility(existing_alias),
        "cleanup": remove_owned_junction(existing_alias, existing_target, existing_intent),
        "unrelatedPathPreserved": (existing_alias / "unrelated.txt").is_file(),
    }

    intended_target = output / "intended-target"
    actual_target = output / "actual-target"
    prepare_target(intended_target, "intended-target")
    prepare_target(actual_target, "actual-target")
    wrong_target_alias = external_alias_root / "wrong target alias"
    wrong_target_intent = output / "wrong-target" / "intent.json"
    journal_intent(wrong_target_intent, wrong_target_alias, intended_target)
    wrong_target_create = create_junction(wrong_target_alias, actual_target)
    wrong_target_refusal = remove_owned_junction(
        wrong_target_alias, intended_target, wrong_target_intent
    )
    recovery_intent = output / "wrong-target" / "recovery-intent.json"
    journal_intent(recovery_intent, wrong_target_alias, actual_target)
    wrong_target_recovery = remove_owned_junction(
        wrong_target_alias, actual_target, recovery_intent
    )
    results["wrongTarget"] = {
        "create": wrong_target_create,
        "refusal": wrong_target_refusal,
        "recovery": wrong_target_recovery,
        "bothTargetsPreserved": (
            (intended_target / "marker.txt").is_file()
            and (actual_target / "marker.txt").is_file()
        ),
    }

    symbolic_target = output / "symbolic-target"
    prepare_target(symbolic_target, "symbolic-target")
    symbolic_alias = external_alias_root / "symbolic alias"
    symbolic_intent = output / "wrong-link-type" / "intent.json"
    journal_intent(symbolic_intent, symbolic_alias, symbolic_target)
    try:
        symbolic_alias.symlink_to(symbolic_target, target_is_directory=True)
        symbolic_create_error = None
        symbolic_refusal = remove_owned_junction(
            symbolic_alias, symbolic_target, symbolic_intent
        )
        if symbolic_alias.is_symlink() and symbolic_alias.resolve() == symbolic_target.resolve():
            symbolic_alias.unlink()
        symbolic_removed = not symbolic_alias.exists()
    except OSError as error:
        symbolic_create_error = f"{type(error).__name__}: {error}"
        symbolic_alias.write_text("wrong-link-type\n", encoding="utf-8")
        symbolic_refusal = remove_owned_junction(
            symbolic_alias, symbolic_target, symbolic_intent
        )
        symbolic_removed = False
        if symbolic_alias.read_text(encoding="utf-8") == "wrong-link-type\n":
            symbolic_alias.unlink()
            symbolic_removed = True
    results["wrongLinkType"] = {
        "createError": symbolic_create_error,
        "refusal": symbolic_refusal,
        "testLinkRemovedAfterIndependentTargetCheck": symbolic_removed,
        "targetPreserved": (symbolic_target / "marker.txt").is_file(),
    }

    partial_target = output / "partial-target"
    prepare_target(partial_target, "partial-target")
    partial_alias = external_alias_root / "partial alias"
    partial_intent = output / "partial-creation" / "intent.json"
    journal_intent(partial_intent, partial_alias, partial_target)
    partial_create = create_junction(partial_alias, partial_target)
    partial_cleanup = remove_owned_junction(partial_alias, partial_target, partial_intent)
    results["partialCreation"] = {
        "create": partial_create,
        "simulatedFailure": "after junction creation and before launch",
        "cleanup": partial_cleanup,
        "targetPreserved": (partial_target / "marker.txt").is_file(),
    }

    write_json(output / "alias-matrix.json", results)
    return results


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)

    snapshot = subcommands.add_parser("snapshot")
    snapshot.add_argument("--output", type=Path, required=True)
    snapshot.add_argument("--game", type=Path, required=True)
    snapshot.add_argument("--app-manifest", type=Path, required=True)
    snapshot.add_argument("--steam-root", type=Path, required=True)
    snapshot.add_argument("--app-info-json", type=Path)

    aliases = subcommands.add_parser("alias-matrix")
    aliases.add_argument("--output", type=Path, required=True)
    aliases.add_argument("--external-alias-root", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if arguments.command == "snapshot":
        record = {
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "installation": installation_snapshot(
                arguments.game, arguments.app_manifest, arguments.app_info_json
            ),
            "steam": steam_snapshot(arguments.steam_root),
        }
        write_json(arguments.output, record)
        print(json.dumps(record, indent=2))
        return 0

    record = run_alias_matrix(arguments.output, arguments.external_alias_root)
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
