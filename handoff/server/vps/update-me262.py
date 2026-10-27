#!/usr/bin/env python3
"""Install a pinned Me 262 client/catalog with the existing shared rollback.

Usage: python3 update-me262.py [--dry-run] PACKAGE_DIRECTORY
The existing server binary and all other battle data are retained.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import urllib.request


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def process_identity(service):
    pid = int(subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', service]))
    if pid <= 1:
        return None
    try:
        # Fields after comm's closing parenthesis begin at field3; starttime is22.
        ticks = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[19]
        return {'pid': pid, 'startTicks': ticks}
    except FileNotFoundError:
        return None


def restart(target, service):
    previous = process_identity(service)
    commands = [['systemctl', 'restart', service]]
    if shutil.which('sudo'):
        commands.append(['sudo', '-n', 'systemctl', 'restart', service])
    restarted = False
    for command in commands:
        if subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            restarted = True
            break
    if not restarted:
        # Same fallback as the existing updater, limited to this unit's own process.
        pid = int(subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', service]))
        proc = Path('/proc') / str(pid)
        assert pid > 1 and proc.stat().st_uid == os.getuid(), 'Cannot restart this service process'
        assert (proc / 'exe').resolve() == target / 'target/release/tg-server'
        os.kill(pid, signal.SIGTERM)
    # Disk page reads alone cannot prove the old Lobby's cached AirData reloaded.
    for _ in range(40):
        current = process_identity(service)
        if current and current != previous:
            return current
        time.sleep(.5)
    raise RuntimeError('Service did not start a new process')


def verify_running(port, manifest):
    healthy = False
    for _ in range(20):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3) as r:
                healthy = r.read() == b'ok'
        except OSError:
            pass
        if healthy:
            break
        time.sleep(1)
    assert healthy, 'Service health check failed'
    request = urllib.request.Request(f'http://127.0.0.1:{port}/', headers={'Accept-Encoding': 'identity'})
    served = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=30) as r:
        for b in iter(lambda: r.read(1024 * 1024), b''):
            served.update(b)
    assert served.hexdigest() == manifest['newPageSha256'], 'Running server did not serve the installed page'
    return served.hexdigest()


def write_receipt(path, manifest, identity):
    value = {'pageSha256': manifest['newPageSha256'], 'catalogSha256': manifest['newCatalogSha256'],
             'gzipSha256': manifest['newGzipSha256'], 'process': identity}
    staged = Path(str(path) + '.new-' + str(os.getpid()))
    try:
        staged.write_text(json.dumps(value, indent=2) + '\n')
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


# These are the reviewed production game's gun/projectile defaults, not a
# historical belt, certification, or independent ballistics accuracy claim.
ME262_GUNS = {
    'me262': ('air_mk108_', [100, 100, 80, 80], 650, 'he_30_mk108'),
    'me262a2a': ('air_mk108_', [100, 100], 650, 'he_30_mk108'),
    'me262u4': ('air_mk214a_', [32], 150, 'ap_50_mk214a'),
}
MK214A_GAME_SHELL = {
    'mass_kg': 2.06, 'speed_ms': 835, 'filler_kg': 0.02822,
    'caliber_mm': 50, 'incendiary': True,
}


def same_json(left, right):
    # Python equality treats True == 1; JSON changes must not hide that edit.
    def canonical(value):
        return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return canonical(left) == canonical(right)


def validate_catalog(before, after):
    """Allow exactly one replaced aircraft, two added aircraft and one shell.

    Gun shells are the legacy catalog's actual fixed-feed projectile references;
    this schema has no selectable belt object. All pre-existing shell values,
    other aircraft, missiles and top-level values must remain unchanged.
    """
    assert isinstance(before, dict) and isinstance(after, dict), 'Catalog must be an object'
    assert set(after) == set(before), 'Unexpected catalog top-level keys'
    old_types, new_types = before.get('types'), after.get('types')
    old_shells, new_shells = before.get('shells'), after.get('shells')
    assert all(isinstance(v, dict) for v in [old_types, new_types, old_shells, new_shells]), 'Missing catalog types/shells'
    added_types = {'me262a2a', 'me262u4'}
    assert 'me262' in old_types and not added_types.intersection(old_types), 'Expected pre-Me262-variants baseline'
    assert set(new_types) == set(old_types) | added_types, 'Unexpected aircraft type keys'
    assert 'ap_50_mk214a' not in old_shells, 'Expected baseline without MK214A projectile'
    assert set(new_shells) == set(old_shells) | {'ap_50_mk214a'}, 'Unexpected projectile keys'
    assert 'he_30_mk108' in old_shells, 'Missing existing MK108 projectile'
    assert same_json(new_shells['ap_50_mk214a'], MK214A_GAME_SHELL), 'Unexpected MK214A game projectile defaults'
    for aircraft, (prefix, rounds, rpm, projectile) in ME262_GUNS.items():
        record = new_types.get(aircraft)
        assert isinstance(record, dict), 'Invalid Me262 aircraft record: ' + aircraft
        guns = record.get('guns')
        assert isinstance(guns, list) and len(guns) == len(rounds), 'Invalid Me262 fixed gun feed count: ' + aircraft
        for index, (gun, ammo) in enumerate(zip(guns, rounds)):
            expected = {'id': prefix + str(index), 'kind': 'cannon', 'ammo': ammo,
                        'rpm': rpm, 'owner': 'body', 'shells': [projectile]}
            assert isinstance(gun, dict) and same_json(gun, expected) and type(gun.get('ammo')) is int, 'Invalid Me262 fixed gun feed/projectile: ' + aircraft
            assert all(shell in new_shells for shell in gun['shells']), 'Missing gun projectile: ' + aircraft
    # Compare every other JSON key/value after removing only the whitelist.
    # Do not normalize/re-export unrelated aircraft or mutate the caller's data.
    restored = dict(after)
    restored['types'] = {key: value for key, value in new_types.items() if key not in added_types}
    restored['types']['me262'] = old_types['me262']
    restored['shells'] = {key: value for key, value in new_shells.items() if key != 'ap_50_mk214a'}
    assert same_json(restored, before), 'Unexpected non-Me262 catalog edit'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('package', type=Path)
    a = p.parse_args()
    package = a.package.resolve()
    manifest = json.loads((package / 'release.json').read_bytes())
    target = Path(os.environ.get('TARGET', '/opt/tankforge')).resolve()
    service = os.environ.get('SERVICE', 'tankforge')
    port = int(os.environ.get('PORT', '8787'))
    page = target / 'client/web/dist/tankforge-range.html'
    catalog = target / 'data/aircraft/aircraft.json'
    compressed = package / 'index.html.gz'
    replacement = package / 'aircraft.json'
    receipt = Path(str(page) + '.release.json')
    assert sha(compressed) == manifest['newGzipSha256'], 'Package gzip changed'
    assert sha(replacement) == manifest['newCatalogSha256'], 'Package aircraft catalog changed'
    current = {'page': sha(page), 'catalog': sha(catalog)}
    if current == {'page': manifest['newPageSha256'], 'catalog': manifest['newCatalogSha256']}:
        assert sha(Path(str(page) + '.gz')) == manifest['newGzipSha256'], 'Installed gzip differs from this release'
        try:
            done = json.loads(receipt.read_bytes())
        except (OSError, ValueError):
            done = {}
        identity = process_identity(service)
        if identity and done == {'pageSha256': manifest['newPageSha256'], 'catalogSha256': manifest['newCatalogSha256'], 'gzipSha256': manifest['newGzipSha256'], 'process': identity}:
            print('已安装此版本，且当前进程已重新载入机型数据；无需重复备份或重启。')
            return
        if a.dry_run:
            print('文件已更新，但缺少当前进程的载入凭据；实际执行将重启核验，不重复备份。')
            return
        identity = restart(target, service)
        served = verify_running(port, manifest)
        write_receipt(receipt, manifest, identity)
        print(json.dumps({'installed': True, 'reloadedExistingFiles': True, 'servedPageSha256': served, 'process': identity}), flush=True)
        return
    assert current == {'page': manifest['oldPageSha256'], 'catalog': manifest['oldCatalogSha256']}, 'Deployment differs from inspected baseline; no files changed'
    assert sha(Path(str(page) + '.gz')) == manifest['oldGzipSha256'], 'Current gzip differs from inspected baseline'
    # Prove only the reviewed three Me262 definitions and new shell change.
    validate_catalog(json.loads(catalog.read_bytes()), json.loads(replacement.read_bytes()))
    needed = manifest['newPageBytes'] + compressed.stat().st_size + page.stat().st_size + Path(str(page) + '.gz').stat().st_size + 2 * replacement.stat().st_size + 64 * 1024 * 1024
    assert shutil.disk_usage(page.parent).free >= needed, f'Insufficient free space for staging and retained rollback ({needed} bytes needed)'
    # Full gzip read also catches truncation before any mutation.
    digest, count = hashlib.sha256(), 0
    with gzip.open(compressed, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(b)
            count += len(b)
    assert digest.hexdigest() == manifest['newPageSha256'] and count == manifest['newPageBytes']
    print(json.dumps({'validated': True, 'dryRun': a.dry_run, 'newPageSha256': digest.hexdigest(), 'stagingAndBackupBytesNeeded': needed}, ensure_ascii=False), flush=True)
    if a.dry_run:
        return
    stamp = time.strftime('%Y%m%d%H%M%S') + '-' + str(os.getpid())
    destinations = [page, Path(str(page) + '.gz'), catalog]
    staged = [Path(str(path) + '.new-' + stamp) for path in destinations]
    backups = [Path(str(path) + '.bak-' + stamp) for path in destinations]
    switched = []
    try:
        with gzip.open(compressed, 'rb') as src, staged[0].open('xb') as dst:
            shutil.copyfileobj(src, dst, 1024 * 1024)
        shutil.copy2(compressed, staged[1])
        shutil.copy2(replacement, staged[2])
        for dst, backup in zip(destinations, backups):
            shutil.copy2(dst, backup)
        assert sha(page) == manifest['oldPageSha256'] and sha(catalog) == manifest['oldCatalogSha256'], 'Deployment changed during staging'
        for src, dst in zip(staged, destinations):
            os.replace(src, dst)
            switched.append(dst)
        identity = restart(target, service)
        served = verify_running(port, manifest)
        assert sha(catalog) == manifest['newCatalogSha256']
        write_receipt(receipt, manifest, identity)
        print(json.dumps({'installed': True, 'servedPageSha256': served, 'process': identity, 'backups': [str(b) for b in backups]}, ensure_ascii=False), flush=True)
    except BaseException:
        for dst, backup in zip(destinations, backups):
            if dst in switched:
                restore = Path(str(dst) + '.restore-' + stamp)
                shutil.copy2(backup, restore)
                os.replace(restore, dst)
        if switched:
            restart(target, service)
            print('更新未通过，已恢复旧页面与旧机型数据；备份保留。', flush=True)
        raise
    finally:
        for path in staged:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
