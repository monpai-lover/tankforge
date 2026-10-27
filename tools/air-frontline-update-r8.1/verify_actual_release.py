#!/usr/bin/env python3
"""Exercise an increment against a new copy of the complete original release."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import time

from install import digest, install, rollback, load_package, select_baseline


def snapshot(root):
    return {file.relative_to(root).as_posix(): digest(file)
            for file in sorted(root.rglob('*'))
            if file.is_file() and not any(p.startswith('.tankforge-air-') for p in file.relative_to(root).parts)}


def verify(package, baseline, clone):
    baseline, clone, package = (Path(p).resolve() for p in (baseline, clone, package))
    if clone.exists():
        raise ValueError('Preserve previous verification copies; choose a new clone path')
    if clone.is_relative_to(baseline) or baseline.is_relative_to(clone):
        raise ValueError('Verification copy must be separate from the preserved baseline')
    started = time.monotonic()
    before = snapshot(baseline)
    shutil.copytree(baseline, clone)
    assert snapshot(clone) == before
    _, manifest, _, _ = load_package(package)
    manifest, selected = select_baseline(package, clone, clone / 'tg-server',
                                        clone / 'client/web/dist/tankforge-range.html', manifest)
    absent = manifest['baseline'].get('absent_data_files', [])
    assert all(name not in before for name in absent), 'Runtime additions must be absent from the preserved release'
    dry = install(package, clone, binary='tg-server')
    assert dry['validated'] and dry['dry_run']
    assert snapshot(clone) == before, 'Dry-run modified its selected deployment'
    applied = install(package, clone, binary='tg-server', offline=True, apply=True)
    assert applied['installed'] and not applied['dry_run']
    candidate = manifest['candidate']
    page = clone / 'client/web/dist/tankforge-range.html'
    assert digest(clone / 'tg-server') == candidate['binary_sha256']
    assert digest(page) == candidate['html_sha256']
    decompressed = hashlib.sha256()
    with gzip.open(Path(str(page) + '.gz'), 'rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            decompressed.update(data)
    assert decompressed.hexdigest() == candidate['html_sha256']
    expected_data = dict(manifest['baseline']['data_files'])
    expected_data.update({item['path']: item['sha256'] for item in candidate.get('data_overlays', [])})
    for name, expected in expected_data.items():
        assert digest(clone / name) == expected, name
    additions = [{'path': name, 'sha256': expected_data[name]} for name in absent]
    restored = rollback(clone, Path(applied['journal']), offline=True)
    assert restored['restored'] and snapshot(clone) == before, 'Rollback failed to restore complete original layout/bytes'
    assert all(not (clone / name).exists() for name in absent), 'Rollback failed to restore runtime-file absence'
    assert snapshot(baseline) == before, 'Preserved release changed'
    return {'result': 'PASS', 'scope': 'Real full release copy, no service process/systemd execution',
            'selectedBaseline': selected,
            'packageManifestSha256': digest(package / 'manifest.json'),
            'baseline': str(baseline), 'clone': str(clone),
            'baselineFilesRehashed': len(before), 'baselineUntouched': True,
            'dryRunPreservedAllFiles': True, 'appliedCompleteCohort': True,
            'candidateRawAndGzipMatched': True, 'runtimeDataMatched': True,
            'runtimeDataAdditions': additions, 'rollbackRestoredAddedRuntimeAbsence': True,
            'rollbackRestoredEveryOriginalFileAndPresence': True,
            'dryRun': dry, 'apply': applied, 'rollback': restored,
            'elapsedWallSeconds': round(time.monotonic() - started, 3)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--clone', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args()
    if args.receipt.exists():
        raise ValueError('Preserve previous receipts')
    result = verify(args.package, args.baseline, args.clone)
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
