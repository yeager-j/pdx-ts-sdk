"""Independent checks of retained native replies, game-written saves, and Windows disposal."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(sys.argv[1]).resolve()
fault = sys.argv[2] if len(sys.argv)>2 else None
inspector = Path(__file__).resolve().parent.parent / 'apple-silicon/inspect-save.ts'
checks = []
native_count = sample_count = 0

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def check(condition, claim):
    checks.append({'claim':claim,'passed':bool(condition)})
    if not condition:
        raise AssertionError(claim)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def parse_save(case, witness):
    identity = load(case/f'{witness}-save.json')
    archive = case/'profile/save games'/identity['path']
    check(sha(archive)==identity['sha256'], f'{case.name}/{witness}: recorded complete save hash')
    destination = case/'independent'
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as save:
        check(save.testzip() is None, f'{case.name}/{witness}: ZIP CRCs')
        text = save.read('gamestate')
        (destination/f'{witness}.gamestate').write_bytes(text)
        (destination/f'{witness}.meta').write_bytes(save.read('meta'))
    result = subprocess.run(['node',str(inspector),str(destination/f'{witness}.gamestate')],capture_output=True,text=True,check=True)
    parsed = json.loads(result.stdout)
    (destination/f'{witness}.json').write_text(json.dumps(parsed,indent=2),encoding='utf-8')
    check(not parsed['diagnostics'], f'{case.name}/{witness}: game save parsed without repairs')
    check('4.5.0' in parsed['version'], f'{case.name}/{witness}: Windows build save version')
    return parsed

report = load(root/'result.json')
inputs = load(root/'inputs.json')
check(report['sharedSha256']=='1042c9ec4ab83ef6ccde8bc367cde31ba88116591c5069a4231a36f94c629819','frozen shared executable bytes')
if fault:
    check(not report['controlsSatisfied'], f'{fault}: failure stays visible')
    check(report['cases'][0]['execution']=='incomplete',f'{fault}: incomplete execution')
else:
    check(report['controlsSatisfied'] and report['nativeCompatibilityEstablished'],'all four unchanged native controls')
    check([row['name'] for row in report['cases']]==['baseline','fresh-world','failed-condition','worker-loss'],'all four cases present')
    check(report['cases'][2]['behavior']=='failed' and report['cases'][2]['execution']=='complete','false assertion remains a completed failure')
    check(report['cases'][3]['behavior']=='not-assessed' and report['cases'][3]['execution']=='incomplete','worker loss remains incomplete')

for row in report['cases']:
    case = root/row['name']
    process = load(case/'process.json')
    disposal = load(case/'disposal.json')
    owner = load(case/'host-disposal.json')
    check(disposal['ordinaryAndSourceUnchanged'] and not disposal['remaining'],f'{case.name}: protected inputs and empty process inventory')
    check(owner['pid']==process['pid'] and owner['wait']==0 and owner['jobKillOnOwnerExit'],f'{case.name}: exact process-handle exit')
    check(load(case/'host-finished.json')['aliasRemoved'],f'{case.name}: private junction removed')
    check(load(case/'protected-before.json')==load(case/'protected-after.json'),f'{case.name}: independent manifest comparison')
    samples = load(case/'observer.json')
    sample_count += len(samples)
    check(bool(samples),f'{case.name}: observer samples retained')
    check(all(sample['foregroundPid']!=process['pid'] for sample in samples),f'{case.name}: no game foreground sample')
    desktop = load(case/'ownership.json')['desktop']
    check(all(sample['inputDesktop']!=desktop for sample in samples),f'{case.name}: private desktop never input desktop')
    detailed = [sample for sample in samples if 'inputDesktopGameWindows' in sample]
    if detailed:
        check(all(not sample['inputDesktopGameWindows'] for sample in detailed),f'{case.name}: no game window on sampled input desktop')
        if fault != 'partial-launch':
            check(any(sample['privateDesktopGameWindows'] for sample in detailed),f'{case.name}: actual game windows on private desktop')
    log_path = case/'profile/logs/game.log'
    game_log = log_path.read_text(encoding='utf-8',errors='replace') if log_path.exists() else ''
    expected_log_counts = {}
    for path in (case/'native').glob('response-*.json'):
        native_count += 1
        raw = load(path)
        request = raw['request']
        if 'randomForbiddenBefore' in raw:
            check(raw['randomForbiddenBefore']==raw['randomForbiddenAfter'],f'{case.name}/{path.stem}: native RNG permission restored')
        check(raw['pid']==process['pid'] and raw['tid']==process['tid'] and raw['normalBoundary'],f'{case.name}/{path.stem}: primary thread and boundary')
        if request['action']!='perform' or 'error' in raw:
            continue
        outcome = raw['reply']['outcome']
        evidence = outcome['evidence']
        check(evidence['invocation']==request['invocation'] and evidence['before']==raw['before'],f'{case.name}/{path.stem}: native evidence identity')
        for observed in [evidence['before'],evidence['after']]:
            check(observed['paused'] and observed['ai']=='off',f'{case.name}/{path.stem}: paused and AI off')
        command = request['command']
        elapsed = command['days'] if command['kind']=='advance' and outcome['kind']=='completed' else 0
        check(evidence['after']['day']-evidence['before']['day']==elapsed,f'{case.name}/{path.stem}: exact explicit date difference')
        if command['kind']=='invoke' and outcome['kind']=='completed':
            markers = raw['capturedMarkers']
            if markers and 'randomForbidden' in markers[0]:
                check(all(marker['randomForbidden']==0 for marker in markers),f'{case.name}/{path.stem}: native invocation permits RNG')
            check(all(marker['invocation']==request['invocation'] and marker['tid']==process['tid'] for marker in markers),f'{case.name}/{path.stem}: captured invocation markers')
            script = inputs['scripts'][command['script']]
            if script['kind']=='effect':
                expected = [f'SDK446:{script["definitionId"]}:start',f'SDK446:{script["definitionId"]}:end']
                check([marker['token'] for marker in markers]==expected,f'{case.name}/{path.stem}: native log-effect records')
                for token in expected:
                    expected_log_counts[token] = expected_log_counts.get(token,0)+1
            else:
                check([marker['token'] for marker in markers]==['start',f'result:{str(outcome["value"]).lower()}','end'],f'{case.name}/{path.stem}: captured native predicate return')
    # The engine's file logger coalesces repeated messages. Exact per-invocation
    # counts come from the real ExecuteActual hook above; the file is corroboration.
    for token,count in expected_log_counts.items():
        check(1 <= game_log.count(token) <= count,f'{case.name}: independent game-log witness {token}')
    if fault=='partial-launch':
        continue
    ready = parse_save(case,'ready')
    observed = load(case/'ready-native.json')
    targets = {target['name']:target for target in observed['targets']}
    player = ready['player']
    check(player=='16777218',f'{case.name}: game save nonzero human player')
    check('sdk446_effect' not in ready['countries'][player]['flags'] and 'sdk446_absent' not in ready['countries'][player]['flags'],f'{case.name}: initial flags absent')
    colony_planet = ready['planets'][str(targets['sdk446_colony']['id'])]
    colony_id = colony_planet['colony']
    check(colony_id in ready['colonies'],f'{case.name}: genuine colony membership')
    check(any(pop.get('planet')==colony_id and float(pop.get('size') or 0)>0 for pop in ready['pops'].values()),f'{case.name}: genuine colony population')
    removable = str(targets['sdk446_planet']['id'])
    country = str(targets['sdk446_country']['id'])
    check(ready['countries'][country]['type']=='global_event',f'{case.name}: disposable global-event country')
    check(ready['planets'][removable].get('colony') in [None,'4294967295'],f'{case.name}: removable planet uncolonized')
    check(sum('sdk446_duplicate' in planet['flags'] for planet in ready['planets'].values())==2,f'{case.name}: exactly two marked planets')
    if not fault and case.name in ['baseline','fresh-world']:
        removed_country = parse_save(case,'afterremoveCountry')
        removed_planet = parse_save(case,'afterremovePlanet')
        check(country in removed_country['countries'] and removable in removed_planet['planets'],f'{case.name}: removals deferred while paused')
        replacement = parse_save(case,'afterreplacePlanet')
        final_native = load(case/'afterreplacePlanet-native.json')
        new_targets = {target['name']:target for target in final_native['targets']}
        check(country not in replacement['countries'] and removable not in replacement['planets'],f'{case.name}: original lifetimes absent after advancement')
        check(str(new_targets['sdk446_country']['id']) in replacement['countries'] and str(new_targets['sdk446_planet']['id']) in replacement['planets'],f'{case.name}: immediate replacements present in game save')
        for name in ['sdk446_country','sdk446_planet']:
            original = targets[name]
            check(any(death['kind']==original['kind'] and death['id']==original['id'] and death['address']==original['address'] for death in final_native['deaths']),f'{case.name}: exact destructor witness {name}')

summary = {'passed':True,'fault':fault,'checks':len(checks),'nativeResponses':native_count,'observerSamples':sample_count,'claims':checks}
(root/'independent-verification.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({key:value for key,value in summary.items() if key!='claims'}))
