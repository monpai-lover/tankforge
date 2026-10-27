#!/usr/bin/env python3
"""Bind explicitly supplied fresh R8 runs; never execute GUI, Linux or builds."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from build_delivery import NAME, SOURCE, ALTERNATE_MANIFEST_PINS, copy, elf_report, sha, tool_hashes, write_json
from install import inside, load_package

HERE = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))


def resolve_file(base, value):
    require(isinstance(value, str) and value, 'Evidence file path is required')
    file = Path(value)
    return (file if file.is_absolute() else Path(base) / file).resolve(strict=True)


def parse_log(kind, text):
    if kind == 'rust':
        rows = [{'status': status, 'passed': int(passed), 'failed': int(failed)}
                for status, passed, failed in re.findall(r'test result: (ok|FAILED)\. (\d+) passed; (\d+) failed;', text)]
        require(rows and all(row['status'] == 'ok' and row['failed'] == 0 for row in rows), 'Rust run is not a complete green run; old targeted reruns cannot erase failed cases')
        require(sum(row['passed'] for row in rows) > 0, 'Rust run contains zero executed cases')
        return rows
    if kind == 'node':
        counts = {}
        for name in ('tests', 'pass', 'fail'):
            found = re.findall(r'^(?:# |ℹ )?' + name + r' (\d+)\s*$', text, re.M)
            require(found, 'Node log is missing actual counts: ' + name)
            counts[name] = [int(value) for value in found]
        require(len(counts['tests']) == len(counts['pass']) == len(counts['fail']), 'Node run has incomplete summaries')
        rows = list(zip(counts['tests'], counts['pass'], counts['fail']))
        require(all(tests > 0 and tests == passed and failed == 0 for tests, passed, failed in rows), 'Node run has failed or incomplete cases; a later targeted pass cannot erase earlier failures')
        return [{'status': 'ok', 'passed': passed, 'failed': 0} for _, passed, _ in rows]
    if kind == 'unittest':
        counts = re.findall(r'Ran (\d+) tests? in ', text)
        require(counts and int(counts[-1]) > 0 and re.search(r'^OK\s*$', text, re.M) and not re.search(r'^(?:FAILED|ERROR:|FAIL:)', text, re.M), 'Python tool log is not green')
        return [{'status': 'ok', 'passed': int(counts[-1]), 'failed': 0}]
    raise ValueError('Unsupported actual run log kind: ' + str(kind))


def required_inputs(name, kind):
    if kind == 'ws':
        return {'app', 'profile', 'aircraft', 'flightWasm', 'windowsBinary'}
    if kind == 'unittest' or name == 'package-tools':
        return {'packageTools'}
    if kind == 'node':
        return {'app', 'profile', 'aircraft', 'flightWasm'}
    if name == 'combat':
        return {'combatWasm', 'cargoLock'}
    return {'profile', 'aircraft', 'flightWasm', 'cargoLock'}


def validate_run(row, inputs, index_root, manifest_hash):
    require(isinstance(row, dict), 'Run must be an evidence record')
    name, kind, status = row.get('name'), row.get('kind'), row.get('status')
    require(isinstance(name, str) and name and re.fullmatch(r'[a-z0-9_-]+', name), 'Unsafe run name')
    require(isinstance(row.get('scope'), str) and row['scope'] and isinstance(row.get('limitations'), list), 'Every run requires scope and explicit limitations')
    if status == 'NOT_RUN':
        require(isinstance(row.get('reason'), str) and row['reason'], 'NOT_RUN scope needs its actual reason')
        return {'name': name, 'kind': kind, 'status': status, 'scope': row['scope'], 'reason': row['reason'], 'limitations': row['limitations']}
    require(status in ('PASS', 'REFERENCE'), 'Unfinished or failed evidence cannot be finalized')
    result = {'name': name, 'kind': kind, 'status': status, 'scope': row['scope'], 'limitations': row['limitations']}
    if status == 'REFERENCE' or kind == 'install':
        file = resolve_file(index_root, row.get('receipt'))
        require(sha(file) == row.get('receiptSha256'), 'Evidence receipt hash differs')
        value = read_json(file)
        result.update(receiptSource=str(file), receiptSha256=sha(file))
        if status == 'REFERENCE':
            result['referenceOnly'] = True
            return result
        require(value.get('result') == 'PASS' and value.get('packageManifestSha256') == manifest_hash, 'Install receipt is not bound to this manifest')
        require(all(value.get(key) is True for key in ('baselineUntouched', 'dryRunPreservedAllFiles', 'rollbackRestoredEveryOriginalFileAndPresence', 'rollbackRestoredAddedRuntimeAbsence')), 'Install receipt lacks complete baseline/rollback preservation proof')
        require(isinstance(value.get('selectedBaseline'), str), 'Install receipt must identify its exact selected baseline')
        result.update(selectedBaseline=value['selectedBaseline'], install=value)
        return result
    require(type(row.get('exitCode')) is int and row['exitCode'] == 0, 'Actual run process exit must be zero')
    for phase in ('before', 'after'):
        actual = row.get(phase)
        require(isinstance(actual, dict) and required_inputs(name, kind) <= set(actual), 'Fresh run requires actual before/after input hashes')
        require(all(actual[key] == inputs[key] for key in actual if key in inputs), 'Run input hashes are stale: ' + name + '/' + phase)
    log = resolve_file(index_root, row.get('log'))
    require(sha(log) == row.get('logSha256'), 'Run log hash differs: ' + name)
    result.update(before=row['before'], after=row['after'], logSource=str(log), logSha256=sha(log))
    if kind == 'ws':
        receipt = resolve_file(index_root, row.get('receipt'))
        require(sha(receipt) == row.get('receiptSha256'), 'WS receipt hash differs')
        value = read_json(receipt)
        require(value.get('passed') is True and value.get('error') is None, 'WS run is not green')
        source = value.get('source', {})
        require(source.get('appSha256') == inputs['app'] and source.get('serverExeSha256') == inputs['windowsBinary'], 'WS observed app/binary inputs are stale')
        checks = value.get('checks')
        require(isinstance(checks, dict) and checks and all(isinstance(v, dict) and v.get('passed') is True for v in checks.values()), 'WS named checks are incomplete or failed')
        logged = [json.loads(line) for line in log.read_text(encoding='utf-8-sig').splitlines()
                  if line.lstrip().startswith('{"passed":')]
        require(logged and logged[-1] == {key: val for key, val in value.items() if key != 'timeline'}, 'WS CLI log and JSON receipt describe different runs')
        result.update(receiptSource=str(receipt), receiptSha256=sha(receipt), checks=checks)
    else:
        result['results'] = parse_log(kind, log.read_text(encoding='utf-8-sig'))
    return result


def current_inputs(folder, linux_binary, windows_binary):
    folder, manifest, _, binary = load_package(folder)
    require(manifest.get('version') == NAME, 'Not a prepared R8 increment')
    require(linux_binary is not None and windows_binary is not None, 'Explicit final Linux and Windows binary paths are required')
    linux_binary, windows_binary = Path(linux_binary).resolve(strict=True), Path(windows_binary).resolve(strict=True)
    require(sha(linux_binary) == sha(binary), 'Explicit Linux binary differs from package payload')
    expected = manifest.get('buildInputs')
    require(isinstance(expected, dict) and {'app', 'profile', 'aircraft', 'flightWasm', 'combatWasm', 'cargoLock', 'linuxBinary'} <= set(expected), 'R8 manifest lacks complete bound build inputs')
    actual = {'app': sha(SOURCE / 'handoff/bundle/app.js.html'), 'profile': sha(SOURCE / 'data/aircraft/frontline.json'),
              'aircraft': sha(SOURCE / 'data/aircraft/aircraft.json'), 'flightWasm': sha(SOURCE / 'handoff/flight/flight_core.wasm'),
              'combatWasm': manifest['candidate']['kernels']['combat']['sha256'], 'cargoLock': sha(SOURCE / 'Cargo.lock'),
              'linuxBinary': sha(linux_binary), 'windowsBinary': sha(windows_binary)}
    require(all(actual.get(key) == value for key, value in expected.items() if key != 'packageTools'), 'Prepared source/build inputs changed')
    require(actual['app'] == manifest['candidate']['tail_sha256'] and actual['flightWasm'] == manifest['candidate']['kernels']['flight']['sha256'], 'Prepared app/flight kernel payload differs from current source')
    tools = tool_hashes(HERE)
    for name, value in tools.items():
        require(sha(inside(folder, name)) == value, 'Prepared package tool differs from current R8 tool: ' + name)
    actual['packageTools'] = hashlib.sha256(json.dumps(tools, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if 'packageTools' in expected:
        require(expected['packageTools'] == actual['packageTools'], 'Prepared package tool cohort changed')
    delta = read_json(inside(folder, 'source-delta.json'))
    for row in delta['files']:
        source, payload = inside(SOURCE, row['path']), inside(folder, row['content'])
        require(source.stat().st_size == payload.stat().st_size == row['bytes'] and sha(source) == sha(payload) == row['sha256'], 'Source delta changed after preparation: ' + row['path'])
    return manifest, actual, tools


def required_install_roles(manifest):
    roles = {'install-primary': 'primary'}
    by_pin = {value: 'install-' + name for name, value in ALTERNATE_MANIFEST_PINS.items()}
    for row in manifest.get('alternate_baselines', []):
        role = by_pin.get(row.get('source_manifest_sha256'))
        require(role is not None and role not in roles, 'Unknown or duplicate pinned alternate baseline cohort')
        roles[role] = row['id']
    return roles


def finalize(folder, runs, *, linux_binary, windows_binary):
    folder = Path(folder).resolve(strict=True)
    require(not (folder / 'evidence/validation.json').exists(), 'Preserve previous finalized evidence; choose a fresh package')
    manifest, inputs, tools = current_inputs(folder, linux_binary, windows_binary)
    index_path = Path(runs).resolve(strict=True)
    index = read_json(index_path)
    require(index.get('schema') == 'TankForgeR8RunSetV1' and index.get('version') == NAME, 'Only an explicit R8 run set is accepted; no R6 result reuse')
    require(isinstance(index.get('runs'), list), 'R8 runs must be an explicit list')
    manifest_hash = sha(folder / 'manifest.json')
    checked = [validate_run(row, inputs, index_path.parent, manifest_hash) for row in index['runs']]
    names = {row['name']: row for row in checked}
    require(len(names) == len(checked), 'Duplicate run names are ambiguous')
    install_roles = required_install_roles(manifest)
    required = {'native', 'combat', 'node', 'package-tools'} | set(install_roles)
    require(required <= set(names) and all(names[name]['status'] == 'PASS' for name in required), 'Fresh required R8 run receipts are missing or not PASS')
    expected_kinds = {'native': 'rust', 'combat': 'rust', 'node': 'node', 'package-tools': 'unittest',
                      **{name: 'install' for name in install_roles}}
    require(all(names[name]['kind'] == expected_kinds[name] for name in required), 'Required run role has the wrong actual suite kind')
    for role, selected in install_roles.items():
        require(names[role].get('selectedBaseline') == selected, 'Exact selected baseline installation proof is required: ' + role)
    # All checks finish before publishing any new package evidence.
    evidence = {}
    for number, row in enumerate(checked):
        for field in ('receiptSource', 'logSource'):
            if field in row:
                file = Path(row.pop(field))
                role = 'receipt' if field == 'receiptSource' else 'log'
                target = 'evidence/runs/' + f'{number:02d}-' + row['name'] + '-' + role + '-' + file.name
                copy(file, folder / target)
                evidence[target] = {'sha256': sha(file), 'bytes': file.stat().st_size}
                row['receipt' if field == 'receiptSource' else 'log'] = target
    copy(index_path, folder / 'evidence/r8-run-set.json')
    evidence['evidence/r8-run-set.json'] = {'sha256': sha(index_path), 'bytes': index_path.stat().st_size}
    copy(HERE / 'README-r8-zh.md', folder / 'README-zh.md')
    validation = {'schema': 'TankForgeAirwarR8ValidationV1', 'version': NAME,
                  'result': 'PASS_WITH_EXPLICIT_UNVERIFIED_SCOPES', 'manifestSha256': manifest_hash,
                  'sourceDeltaSha256': sha(folder / 'source-delta.json'), 'runSetSha256': sha(index_path),
                  'inputs': inputs, 'packageToolSha256': tools, 'candidate': manifest['candidate'],
                  'runs': checked, 'evidence': evidence, 'linuxElf': elf_report(Path(linux_binary)),
                  'linuxExecutionPerformed': False, 'remoteDeploymentPerformed': False, 'guiExecutionPerformedByFinalizer': False,
                  'limitations': ['This finalizer performs no GUI or Linux process execution and no remote/systemd deployment.',
                                  'REFERENCE entries preserve earlier scoped evidence and are not new R8 test runs.',
                                  'Each supplied run retains its original scope and exclusions; no R6/R7 result is relabeled as a fresh R8 run.']}
    write_json(folder / 'evidence/validation.json', validation)
    return {'finalized': str(folder), 'manifestSha256': manifest_hash, 'validationSha256': sha(folder / 'evidence/validation.json'), 'archiveCreated': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', required=True, type=Path)
    parser.add_argument('--linux-binary', required=True, type=Path)
    parser.add_argument('--windows-binary', required=True, type=Path)
    parser.add_argument('--runs', type=Path)
    parser.add_argument('--print-inputs', action='store_true')
    args = parser.parse_args()
    if args.print_inputs:
        print(json.dumps(current_inputs(args.folder, args.linux_binary, args.windows_binary)[1], sort_keys=True))
    else:
        if args.runs is None:
            parser.error('--runs is required for finalization')
        print(json.dumps(finalize(args.folder, args.runs, linux_binary=args.linux_binary, windows_binary=args.windows_binary)))


if __name__ == '__main__':
    main()
