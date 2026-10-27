#!/usr/bin/env python3
"""Validate all supported release origins against an actual packaged target.

The optional baseline snapshot recovers earlier reviewed inputs from the old
release's exact reversible context hunks. It does not download assets or change
any installed game. Run snapshot before replacing the old payload, then verify
once the new handoff has been assembled.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

EXPECTED_ORIGINS = (
    'e75dff32e6c19240263ce61186106ed406f683bbb1963582117b365c80126344',
    '2671a37e9c8a4aacc10557fc36519040951de1975dcf515e6db6f6a97c0a8334',
    'd5d27a26a6220d32120cfadac48217a509f64f2c00a71d78e52346861a36c0be',
)
MARKER = b'<script>(() => {'
COMBAT_EDIT = b'    // Independent local air-combat change retained by model upgrade.\n'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_module(path):
    spec = importlib.util.spec_from_file_location('actual_model_installer', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot(package, destination):
    payload = json.loads((package/'model-hunks.json').read_bytes())
    reviewed = (package/'reference/FROZEN_model_upgrade_app_script.html').read_bytes()
    assert sha(reviewed) == EXPECTED_ORIGINS[-1], 'Snapshot requires reviewed d5 release'
    installer = load_module(package/'install.py')
    destination.mkdir(parents=True, exist_ok=True)
    rows = []
    for profile in payload['profiles']:
        reverse = {
            'format': 'tankforge-model-context-v1',
            'base_sha256': profile['target_sha256'],
            'target_sha256': profile['base_sha256'],
            'hunks': [{
                'old': h['new'], 'new': h['old'],
                'old_sha256': h['new_sha256'], 'new_sha256': h['old_sha256'],
            } for h in profile['hunks']],
        }
        original, exact = installer.apply_hunks(reviewed, reverse)
        assert exact and sha(original) == profile['base_sha256']
        output = destination/(profile['base_sha256']+'.html')
        output.write_bytes(original)
        rows.append({'sha256': sha(original), 'file': str(output)})
    output = destination/(sha(reviewed)+'.html')
    output.write_bytes(reviewed)
    rows.append({'sha256': sha(reviewed), 'file': str(output)})
    assert tuple(row['sha256'] for row in rows) == EXPECTED_ORIGINS
    return {'snapshot': rows}


def local_combat_edit(original, target, installer, payload):
    # These markers live in existing combat/audio blocks. They are semantic
    # boundaries, so this models a syntactically valid independent source edit.
    for marker in (
        b'    // BEGIN AIRCRAFT SHOT AUDIO\n',
        b'    // BEGIN NATIVE FRONTLINE CLIENT\n',
        b'  // BEGIN NATIVE FRONTLINE GLOBAL HELPERS\n',
    ):
        if original.count(marker) != 1 or target.count(marker) != 1:
            continue
        local = original.replace(marker, marker+COMBAT_EDIT)
        expected = target.replace(marker, marker+COMBAT_EDIT)
        try:
            actual, exact = installer.apply_hunks(local, payload)
        except ValueError:
            continue
        assert not exact and actual == expected
        return local, expected
    raise AssertionError('No unaffected local combat boundary survived the patch')


def verify(package, baselines):
    encoded = (package/'model-hunks.json').read_bytes()
    payload = json.loads(encoded)
    manifest = json.loads((package/'manifest.json').read_bytes())
    target = (package/'reference/FROZEN_model_upgrade_app_script.html').read_bytes()
    assert sha(encoded) == manifest['payload_sha256']
    assert sha(target) == manifest['target_app_sha256']
    profiles = payload['profiles']
    assert tuple(p['base_sha256'] for p in profiles) == EXPECTED_ORIGINS
    assert all(p['target_sha256'] == sha(target) for p in profiles)
    installer = load_module(package/'install.py')
    rows = []
    for origin in EXPECTED_ORIGINS:
        original = (baselines/(origin+'.html')).read_bytes()
        assert sha(original) == origin
        actual, exact = installer.apply_hunks(original, payload)
        assert exact and actual == target, origin
        local, expected = local_combat_edit(original, target, installer, payload)
        with tempfile.TemporaryDirectory(prefix='tankforge-installer-check-') as temp:
            root = Path(temp)
            # The installer must preserve arbitrary original asset bytes, even
            # if the app is changed and the prefix is not valid UTF-8 text.
            prefix = b'<!doctype html>\nASSET-FIXTURE\x00\xff\n'
            source = root/'local-combat.html'
            source.write_bytes(prefix+local)
            output = root/'upgraded.html'
            command = [sys.executable, str(package/'install.py'), str(source)]
            dry = subprocess.run(command+['--check'], capture_output=True)
            assert dry.returncode == 0 and not output.exists(), dry.stderr
            run = subprocess.run(command+['--output', str(output)], capture_output=True)
            assert run.returncode == 0, run.stderr
            assert output.read_bytes() == prefix+expected
            assert source.read_bytes() == prefix+local
            second = subprocess.run(command+['--output', str(output)], capture_output=True)
            assert second.returncode != 0 and output.read_bytes() == prefix+expected
        rows.append({
            'baseSha256': origin, 'exactReconstruction': True,
            'independentCombatEditRetained': True, 'assetPrefixRetained': True,
            'dryRunPassed': True, 'sourcePreserved': True,
            'existingOutputRejected': True,
        })
    previous = (baselines/(EXPECTED_ORIGINS[-1]+'.html')).read_bytes()
    def block(data, name):
        start_marker = ('/* '+name+'_BEGIN */').encode()
        end_marker = ('/* '+name+'_END */').encode()
        assert data.count(start_marker) == data.count(end_marker) == 1, name
        start = data.index(start_marker)
        end = data.index(end_marker, start)+len(end_marker)
        return data[start:end]
    interior_previous = block(previous, 'TF_ALL_AIRCRAFT_INTERIORS')
    interior_target = block(target, 'TF_ALL_AIRCRAFT_INTERIORS')
    assert b'TFAllAircraftInteriors.install(this,' in target
    assert b'TFAllAircraftInteriors.show(this)' in target
    return {'ok': True, 'targetAppSha256': sha(target), 'origins': rows,
            'interiors': {'modulePresent': True, 'installAndShowHooksPresent': True,
                          'previousBundleSha256': sha(interior_previous),
                          'targetBundleSha256': sha(interior_target),
                          'bundleByteIdentical': interior_previous == interior_target}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package-root', type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument('--baselines', type=Path, required=True)
    parser.add_argument('--snapshot', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = snapshot(args.package_root, args.baselines) if args.snapshot else verify(args.package_root, args.baselines)
    text = json.dumps(report, indent=2)+'\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text)
    print(text)


if __name__ == '__main__':
    main()
