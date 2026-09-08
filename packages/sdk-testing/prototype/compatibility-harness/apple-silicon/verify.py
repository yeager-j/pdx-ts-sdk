"""Independent checks over native records and game-written saves, outside shared acceptance."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile
from decimal import Decimal

ROOT = Path(__file__).resolve().parent
checks = 0


def check(condition, message):
    global checks
    assert condition, message
    checks += 1


def read(path):
    return json.loads(path.read_text())


def extract(save, destination):
    with zipfile.ZipFile(save) as archive:
        gamestate = archive.read("gamestate")
        meta = archive.read("meta")
    text = destination.with_suffix(".gamestate.txt")
    text.write_bytes(gamestate)
    destination.with_suffix(".meta.txt").write_bytes(meta)
    process = subprocess.run(["node", str(ROOT / "inspect-save.ts"), str(text)], capture_output=True, text=True, check=True)
    facts = json.loads(process.stdout)
    facts["sourceSha256"] = hashlib.sha256(save.read_bytes()).hexdigest()
    facts["gamestateSha256"] = hashlib.sha256(gamestate).hexdigest()
    destination.write_text(json.dumps(facts, indent=2) + "\n")
    check(not facts["diagnostics"], f"save parsed without repairs: {save}")
    return facts


def target(facts, name):
    return next(value for value in facts["targets"] if value["name"] == name)


def verify_fixture(facts):
    check(facts["version"] == "Cygnus v4.5.0", "game-written fixture build")
    check(facts["player"] != "0", "actual nonzero loaded player")
    check("sdk446_effect" not in facts["countries"][facts["player"]]["flags"], "initial effect flag absent")
    check(not any("sdk446_absent" in value["flags"] for value in facts["countries"].values()), "missing locator absent")
    colony = target(facts, "sdk446_colony")
    check(colony["type"] == "colony", "real colony target")
    planets = [(key, value) for key, value in facts["planets"].items() if value.get("colony") == colony["id"]]
    check(len(planets) == 1, "canonical colony planet unique")
    colony_planet = planets[0][0]
    groups = facts["colonies"][colony["id"]]["popGroups"]
    check(sum(Decimal(facts["pops"][key].get("size", "0")) for key in groups) > 0, "real populated colony")
    planet = target(facts, "sdk446_planet")
    check(planet["type"] == "planet" and planet["id"] != colony_planet, "separate removable planet")
    check(facts["planets"][planet["id"]].get("colony") in (None, "4294967295"), "uncolonized removable planet")
    country = target(facts, "sdk446_country")
    check(country["id"] != facts["player"] and facts["countries"][country["id"]]["type"] == "global_event", "disposable global-event country")
    check(sum("sdk446_duplicate" in value["flags"] for value in facts["planets"].values()) == 2, "exactly two duplicate planets")
    return country["id"], planet["id"]


def verify_case(directory, expected_control):
    result = read(directory / "result.json")
    disposal = read(directory / "disposal.json")
    check(not disposal["remaining"], "independent process exit")
    check(disposal["ordinaryAndSourceUnchanged"], "ordinary profile and source unchanged")
    focus = read(directory / "focus.json")
    check(focus["terminated"] and focus["samples"] > 0, "independent process observer finished")
    for key in ["activeSamples", "targetFrontmostSamples", "onscreenWindowSamples"]:
        check(focus[key] == 0, f"background operation: {key}")
    native_records = 0
    for path in sorted(directory.glob("response-*.json")):
        response = read(path)
        request = read(directory / path.name.replace("response-", "request-"))
        native_records += 1
        check(response["id"] == request["id"] and response["invocation"] == request["invocation"], "native request correlation")
        check(response["run"] == request["run"] and response["pid"] == request["expectedPid"], "native run/process identity")
        if "stateBefore" not in response:
            continue
        before, after = response["stateBefore"], response["stateAfterAcceptance"]
        if "dateRaw" not in before:
            continue
        days = request.get("days", 0) if request["action"] == "fast-forward" and response["status"] == "fast-forward-completed" else 0
        check(after["dateRaw"] - before["dateRaw"] == days * 24, "only explicit days advance")
        if response["status"] == "script-completed" and expected_control is None:
            prepared = response["prepared"]
            check(prepared["nativeReturned"] and prepared["nativeAccepted"], "accepted plus returned")
            check(prepared["identity"]["invocation"] == request["invocation"], "prepared invocation")
            for index, marker in enumerate(prepared["markers"]):
                check(marker["invocation"] == request["invocation"] and marker["sequence"] == index, "native marker identity/order")
            if prepared["conditionValue"] is not None:
                check(prepared["nativePredicate"] == "CEvent::IsValid", "condition uses native predicate without firing")
                check([m["token"] for m in prepared["markers"]] == ["start", "result:" + str(prepared["conditionValue"]).lower(), "end"], "native boolean marker grammar")
    extracts = directory / "save-extracts"
    extracts.mkdir(exist_ok=True)
    saves = {save.stem: extract(save, extracts / (save.stem + ".json")) for save in sorted((directory / "profile/save games").rglob("*.sav")) if save.stem != "baseline"}
    if "ready" not in saves:
        check(expected_control == "partial-launch", "only partial launch lacks a ready save")
        return {"nativeRecords": native_records, "observerSamples": focus["samples"], "saves": len(saves)}
    old_country, old_planet = verify_fixture(saves["ready"])
    if result["behavior"] == "passed":
        outcomes = [entry["record"] for entry in map(json.loads, (directory / "journal.jsonl").read_text().splitlines()) if entry["record"]["kind"] == "outcome"]
        removed = False
        for outcome in outcomes:
            command = outcome["command"]
            if outcome["outcome"]["kind"] != "completed":
                continue
            name = "w_" + outcome["invocation"]["id"].replace("-", "")
            facts = saves.get(name)
            if facts is None:
                continue
            script = command.get("script")
            if script == "mark":
                check("sdk446_effect" in facts["countries"][facts["player"]]["flags"], "effect independently saved")
            if script in ("removeCountry", "removePlanet"):
                check(old_country in facts["countries"] and old_planet in facts["planets"], "destruction request is still live in saved engine state")
            if command["kind"] == "advance" and old_country not in facts["countries"]:
                check(old_planet not in facts["planets"], "actual country and planet engine removal")
                removed = True
            if script == "replaceCountry":
                replacement = target(facts, "sdk446_country")["id"]
                check(replacement != old_country and replacement in facts["countries"], "new saved country lifetime")
            if script == "replacePlanet":
                replacement = target(facts, "sdk446_planet")["id"]
                check(replacement != old_planet and replacement in facts["planets"], "new saved planet lifetime")
        check(removed, "save witnesses actual removal after explicit time")
        witnesses = [read(path) for path in directory.glob("w_*-native-witness.json")]
        deaths = [death for witness in witnesses for death in witness["locator"]["deaths"]]
        check(any(d["kind"] == "country" and str(d["id"]) == old_country for d in deaths), "native destructor country witness")
        check(any(d["kind"] == "planet" and str(d["id"]) == old_planet for d in deaths), "native destructor planet witness")
    return {"nativeRecords": native_records, "observerSamples": focus["samples"], "saves": len(saves)}


def main():
    run = Path(sys.argv[1]).resolve()
    fault = sys.argv[2] if len(sys.argv) > 2 else None
    result = read(run / "result.json")
    check(result["sharedSha256"] == "1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819", "unchanged shared source")
    if fault:
        check(not result["controlsSatisfied"] and not result["nativeCompatibilityEstablished"], "fault cannot establish compatibility")
        first = result["cases"][0]
        text = json.dumps(first["failures"])
        expected = {"partial-launch": "injected-partial-launch", "missing-end": "script-incomplete", "stale-invocation": "native-marker-identity-mismatch", "hang": "deadline"}[fault]
        check(expected in text, "intended fault retained")
    else:
        check(result["controlsSatisfied"] and result["nativeCompatibilityEstablished"], "common real-game controls satisfied")
        check(len(result["cases"]) == 4, "all four cases executed")
    cases = {case["name"]: verify_case(run / case["name"], fault) for case in result["cases"]}
    report = {"checks": checks, "fault": fault, "cases": cases, "result": "passed"}
    (run / "independent-verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
