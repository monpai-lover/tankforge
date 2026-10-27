#!/usr/bin/env python3
"""Validate or install a version-bound TankForge air-frontline increment."""
import argparse
from contextlib import contextmanager
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time
import urllib.request
import uuid

CHUNK = 1024 * 1024
SCHEMA = 'TankForgeAirFrontlineIncrementV1'

def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as source:
        for data in iter(lambda: source.read(CHUNK), b''):
            value.update(data)
    return value.hexdigest()

def inside(base, relative, *, missing=False):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Unsafe relative path')
    if any(part in ('', '.', '..') for part in relative.split('/')):
        raise ValueError('Unsafe relative path')
    current = base
    for part in relative.split('/'):
        current = current / part
        if current.is_symlink():
            raise ValueError('Linked path refused: ' + relative)
    if not current.resolve().is_relative_to(base.resolve()):
        raise ValueError('Path leaves selected root')
    if not missing and not current.is_file():
        raise ValueError('Required file missing: ' + relative)
    return current

def validated_absent_data_files(base, baseline):
    absent = baseline.get('absent_data_files', [])
    pins = baseline['data_files']
    if not isinstance(absent, list) or not isinstance(pins, dict):
        raise ValueError('Absent runtime data requires a path list and baseline data pins')
    accepted, destinations = [], set()
    pinned_destinations = {inside(base, path, missing=True) for path in pins}
    for path in absent:
        destination = inside(base, path, missing=True)
        if not path.startswith('data/'):
            raise ValueError('Absent runtime data path must be inside data/: ' + path)
        if destination in pinned_destinations:
            raise ValueError('Absent runtime data conflicts with a baseline pin: ' + path)
        if destination in destinations:
            raise ValueError('Duplicate absent runtime data path: ' + path)
        destinations.add(destination)
        accepted.append(path)
    return accepted

def validated_data_overlays(package, manifest):
    overlays = manifest['candidate'].get('data_overlays', [])
    pins = manifest['baseline']['data_files']
    if not isinstance(overlays, list) or not isinstance(pins, dict):
        raise ValueError('Data overlays require a list and pinned baseline data files')
    absent = set(validated_absent_data_files(package, manifest['baseline']))
    accepted, destinations = [], set()
    for entry in overlays:
        if not isinstance(entry, dict) or set(entry) != {'path', 'payload_file', 'sha256', 'bytes'}:
            raise ValueError('Invalid data overlay record')
        path, expected, size = entry['path'], entry['sha256'], entry['bytes']
        # Validate destination spelling with the same rooted path policy as the
        # live files, before ever consulting it as a dictionary key.
        destination = inside(package, path, missing=True)
        if path not in pins and path not in absent:
            raise ValueError('Data overlay destination lacks a required baseline pin or absent whitelist: ' + path)
        if destination in destinations:
            raise ValueError('Duplicate data overlay destination: ' + path)
        destinations.add(destination)
        if not isinstance(expected, str) or len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
            raise ValueError('Invalid data overlay SHA-256')
        if path in pins:
            baseline_hash = pins[path]
            if not isinstance(baseline_hash, str) or len(baseline_hash) != 64 or any(c not in '0123456789abcdef' for c in baseline_hash):
                raise ValueError('Data overlay requires a valid baseline SHA-256: ' + path)
        if type(size) is not int or size < 0:
            raise ValueError('Invalid data overlay bytes')
        payload = inside(package, entry['payload_file'])
        if payload.stat().st_size != size or digest(payload) != expected:
            raise ValueError('Data overlay payload hash or byte size mismatch: ' + path)
        accepted.append((entry, payload))
    if absent - {entry['path'] for entry, _ in accepted}:
        raise ValueError('Absent runtime data whitelist has no matching data overlay')
    return accepted

def load_package(package, *, include_overlays=False):
    package = Path(package).resolve(strict=True)
    manifest = json.loads(inside(package, 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != SCHEMA:
        raise ValueError('Unknown increment schema')
    old, new = manifest['baseline'], manifest['candidate']
    for field in ('html_sha256', 'prefix_sha256', 'tail_sha256', 'binary_sha256'):
        if len(old.get(field, '')) != 64:
            raise ValueError('Incomplete baseline fingerprint')
    tail = inside(package, new['tail_file'])
    binary = inside(package, new['binary_file'])
    if digest(tail) != new['tail_sha256'] or digest(binary) != new['binary_sha256']:
        raise ValueError('Increment payload hash mismatch')
    with binary.open('rb') as source:
        header = source.read(64)
    if len(header) < 64 or header[:7] != b'\x7fELF\x02\x01\x01' or struct.unpack_from('<H', header, 18)[0] != 62:
        raise ValueError('Candidate must be a Linux x86_64 ELF executable')
    if not isinstance(old['prefix_bytes'], int) or not 0 < old['prefix_bytes'] < old['html_bytes']:
        raise ValueError('Invalid baseline app boundary')
    if old['prefix_bytes'] + tail.stat().st_size != new['html_bytes']:
        raise ValueError('Candidate size does not match unchanged prefix plus new app')
    overlays = validated_data_overlays(package, manifest)
    if 'kernels' in new:
        kernels = new['kernels']
        if not isinstance(kernels, dict) or set(kernels) != {'flight', 'combat'}:
            raise ValueError('R7 kernel sidecars must contain exact flight/combat entries')
        for kind, entry in kernels.items():
            if not isinstance(entry, dict) or not {'file', 'sha256', 'bytes'} <= set(entry):
                raise ValueError('Incomplete kernel sidecar entry: ' + kind)
            file = inside(package, entry['file'])
            if type(entry['bytes']) is not int or entry['bytes'] < 8 or file.stat().st_size != entry['bytes'] or digest(file) != entry['sha256']:
                raise ValueError('Kernel sidecar hash/size mismatch: ' + kind)
            with file.open('rb') as source:
                if source.read(8) != b'\0asm\x01\0\0\0':
                    raise ValueError('Invalid kernel sidecar WASM header: ' + kind)
    baseline_cohorts(package, manifest)
    result = package, manifest, tail, binary
    return (*result, overlays) if include_overlays else result

def baseline_cohorts(package, manifest):
    """Return complete reviewed cohorts; alternatives never loosen primary pins."""
    primary = manifest['baseline']
    result = [('primary', primary)]
    alternatives = manifest.get('alternate_baselines', [])
    if not isinstance(alternatives, list):
        raise ValueError('Alternate baseline cohorts must be a list')
    universe = set(primary['data_files']) | set(primary.get('absent_data_files', []))
    fields = ('html_sha256', 'html_bytes', 'prefix_bytes', 'prefix_sha256',
              'tail_sha256', 'binary_sha256', 'data_files', 'absent_data_files')
    def identity(base):
        return json.dumps({key: base.get(key, [] if key == 'absent_data_files' else None)
                           for key in fields}, sort_keys=True, separators=(',', ':'))
    seen, ids = {identity(primary)}, {'primary'}
    for row in alternatives:
        if not isinstance(row, dict) or set(row) - {'id', 'baseline', 'source_manifest_sha256'} or not {'id', 'baseline'} <= set(row):
            raise ValueError('Invalid alternate baseline cohort record')
        name, base = row['id'], row['baseline']
        if not isinstance(name, str) or not name or len(name) > 160 or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in name) or name in ids:
            raise ValueError('Duplicate or unsafe baseline cohort ID')
        if not isinstance(base, dict) or not isinstance(base.get('data_files'), dict):
            raise ValueError('Incomplete alternate baseline fingerprint')
        for key in ('html_sha256', 'prefix_sha256', 'tail_sha256', 'binary_sha256'):
            value = base.get(key)
            if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('Invalid alternate baseline fingerprint: ' + key)
        if type(base.get('html_bytes')) is not int or type(base.get('prefix_bytes')) is not int or not 0 < base['prefix_bytes'] < base['html_bytes']:
            raise ValueError('Invalid alternate baseline app boundary')
        if base['prefix_bytes'] != primary['prefix_bytes'] or base['prefix_sha256'] != primary['prefix_sha256']:
            raise ValueError('Alternate baseline changes immutable asset prefix')
        absent = validated_absent_data_files(package, base)
        if set(base['data_files']) | set(absent) != universe:
            raise ValueError('Alternate baseline must pin the full data cohort universe')
        for path, value in base['data_files'].items():
            inside(package, path, missing=True)
            if not path.startswith('data/') or not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('Invalid alternate runtime data fingerprint')
        key = identity(base)
        if key in seen:
            raise ValueError('Duplicate equivalent baseline cohorts are ambiguous')
        seen.add(key); ids.add(name); result.append((name, base))
    return result

def select_baseline(package, root, binary, page, manifest):
    cohorts = baseline_cohorts(package, manifest)
    if len(cohorts) == 1:
        validate_live(root, binary, page, manifest)
        return manifest, 'primary'
    actual_binary = digest(binary)
    matches = []
    for name, base in cohorts:
        if actual_binary != base['binary_sha256']:
            continue
        selected = dict(manifest, baseline=base)
        try:
            validate_live(root, binary, page, selected)
        except ValueError:
            continue
        matches.append((selected, name))
    if len(matches) != 1:
        raise ValueError('No unique complete baseline hash cohort matches; no live files changed')
    return matches[0]

@contextmanager
def page_reader(page):
    if page.is_file():
        with page.open('rb') as source:
            yield source
    else:
        with gzip.open(Path(str(page) + '.gz'), 'rb') as source:
            yield source

def validate_live(root, binary, page, manifest):
    old = manifest['baseline']
    if digest(binary) != old['binary_sha256']:
        raise ValueError('Server baseline differs; no live files changed')
    page_file = page if page.is_file() else Path(str(page)+'.gz')
    if page_file.is_symlink() or not page_file.is_file():
        raise ValueError('Page baseline missing or linked')
    for name, expected in old['data_files'].items():
        if digest(inside(root, name)) != expected:
            raise ValueError('Runtime data baseline differs: ' + name)
    for name in validated_absent_data_files(root, old):
        target = inside(root, name, missing=True)
        if target.exists():
            raise ValueError('Absent runtime data baseline independently exists: ' + name)
        if not target.parent.is_dir():
            raise ValueError('Absent runtime data requires an existing parent directory: ' + name)
    value, size = hashlib.sha256(), 0
    with page_reader(page) as source:
        for data in iter(lambda: source.read(CHUNK), b''):
            size += len(data)
            value.update(data)
    if value.hexdigest() != old['html_sha256'] or size != old['html_bytes']:
        raise ValueError('Page baseline differs; no live files changed')

def assemble(page, tail, destination, manifest):
    old, new = manifest['baseline'], manifest['candidate']
    prefix_hash, old_hash, tail_hash = hashlib.sha256(), hashlib.sha256(), hashlib.sha256()
    remaining = old['prefix_bytes']
    with page_reader(page) as source, destination.open('xb') as output:
        while remaining:
            data = source.read(min(CHUNK, remaining))
            if not data:
                raise ValueError('Truncated page prefix')
            remaining -= len(data)
            output.write(data)
            prefix_hash.update(data)
            old_hash.update(data)
        for data in iter(lambda: source.read(CHUNK), b''):
            tail_hash.update(data)
            old_hash.update(data)
        if prefix_hash.hexdigest() != old['prefix_sha256'] or tail_hash.hexdigest() != old['tail_sha256'] or old_hash.hexdigest() != old['html_sha256']:
            raise ValueError('Page changed during staging')
        with tail.open('rb') as changed:
            shutil.copyfileobj(changed, output, CHUNK)
        output.flush()
        os.fsync(output.fileno())
    if destination.stat().st_size != new['html_bytes'] or digest(destination) != new['html_sha256']:
        raise ValueError('Complete candidate page hash mismatch')

def atomic_json(file, value):
    temporary = file.with_name(file.name + '.tmp-' + uuid.uuid4().hex)
    with temporary.open('x', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, file)

def service_state(service, expected_binary):
    if not service or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.@-' for c in service):
        raise ValueError('A specific systemd service name is required')
    result = subprocess.run(['systemctl', 'show', '-p', 'MainPID', '--value', service], check=True, capture_output=True, text=True, timeout=20)
    pid = int(result.stdout.strip())
    if pid <= 1 or digest(Path('/proc')/str(pid)/'exe') != expected_binary:
        raise ValueError('Service is not running the pinned server executable')
    return pid

def service_command(service, operation):
    subprocess.run(['systemctl', operation, service], check=True, timeout=45)

def verify_started(service, binary_hash, page_hash, port):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            service_state(service, binary_hash)
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3) as response:
                if response.read() != b'ok':
                    raise ValueError('Health response mismatch')
            request = urllib.request.Request(f'http://127.0.0.1:{port}/', headers={'Accept-Encoding': 'identity'})
            value = hashlib.sha256()
            with urllib.request.urlopen(request, timeout=90) as response:
                for data in iter(lambda: response.read(CHUNK), b''):
                    value.update(data)
            if value.hexdigest() != page_hash:
                raise ValueError('Running server does not serve the new page')
            return
        except (OSError, ValueError, subprocess.SubprocessError):
            time.sleep(.5)
    raise RuntimeError('Updated service did not become healthy with the pinned page')

def restore_files(root, journal, record):
    overlays = {item['path']: item for item in record['files'] if item.get('kind') == 'data_overlay'}
    absent = validated_absent_data_files(root, record)
    for name in absent:
        item = overlays.get(name)
        if item is None or item['existed'] or 'old_sha256' in item or 'backup' in item:
            raise ValueError('Rollback absent runtime data baseline record mismatch: ' + name)
    for name, item in overlays.items():
        if not item['existed'] and name not in absent:
            raise ValueError('Rollback new data overlay lacks its absent baseline: ' + name)
    for name, expected in record['data_files'].items():
        allowed = {expected}
        item = overlays.get(name)
        if item is not None:
            if not item['existed'] or item['old_sha256'] != expected:
                raise ValueError('Rollback data overlay baseline record mismatch: ' + name)
            # An interrupted cohort can contain either its baseline or its own
            # staged payload. A third deployment's data never qualifies.
            allowed.add(item['new_sha256'])
        if digest(inside(root, name)) not in allowed:
            raise ValueError('Rollback refused: runtime data changed independently: ' + name)
    # Refuse to overwrite a file changed by a different deployment after staging.
    for item in record['files']:
        target = inside(root, item['path'], missing=True)
        if target.exists() and digest(target) not in {item.get('old_sha256'), item['new_sha256']}:
            raise ValueError('Rollback refused: live destination changed independently')
        if item['existed'] and digest(inside(journal, item['backup'])) != item['old_sha256']:
            raise ValueError('Rollback backup hash mismatch')
    for item in record['files']:
        target = inside(root, item['path'], missing=True)
        if item['existed']:
            temporary = target.with_name(target.name + '.restore-' + uuid.uuid4().hex)
            shutil.copy2(inside(journal, item['backup']), temporary)
            os.replace(temporary, target)
        elif target.exists():
            target.unlink()
    record['state'] = 'rolled_back'
    atomic_json(journal/'journal.json', record)

def rollback(root, journal, *, offline=False, service=None, port=8787):
    root, journal = Path(root).resolve(strict=True), Path(journal).resolve(strict=True)
    if not journal.is_relative_to(root) or not journal.name.startswith('.tankforge-air-rollback-'):
        raise ValueError('Rollback journal must belong to this selected deployment')
    record = json.loads(inside(journal, 'journal.json').read_text(encoding='utf-8'))
    if record['root'] != str(root) or not (offline or service):
        raise ValueError('Rollback requires the same root and explicit offline or service coordination')
    if service:
        service_state(service, record['new_binary_sha256'])
        service_command(service, 'stop')
    restore_files(root, journal, record)
    if service:
        service_command(service, 'start')
        verify_started(service, record['old_binary_sha256'], record['old_page_sha256'], port)
    return {'restored': True, 'journal': str(journal)}

def install(package, root, *, apply=False, offline=False, service=None, port=8787,
            binary='target/release/tg-server', page='client/web/dist/tankforge-range.html'):
    package, manifest, tail, payload_binary, overlays = load_package(package, include_overlays=True)
    root = Path(root).resolve(strict=True)
    binary_path, page_path = inside(root, binary), inside(root, page, missing=True)
    gzip_path = inside(root, page+'.gz', missing=True)
    manifest, selected_baseline = select_baseline(package, root, binary_path, page_path, manifest)
    absent = set(manifest['baseline'].get('absent_data_files', []))
    overlay_targets = [(entry, payload, inside(root, entry['path'], missing=entry['path'] in absent)) for entry, payload in overlays]
    if any(target in {binary_path, page_path, gzip_path} for _, _, target in overlay_targets):
        raise ValueError('Data overlay collides with the server/page publication cohort')
    if apply and not (offline or service):
        raise ValueError('Apply requires --service coordination or explicit --offline')
    validate_live(root, binary_path, page_path, manifest)
    old, new = manifest['baseline'], manifest['candidate']
    reserve = 64 * 1024 * 1024
    required = 2 * new['html_bytes'] + payload_binary.stat().st_size + reserve
    required += sum(entry['bytes'] for entry, _, _ in overlay_targets)
    if apply:
        required += sum(target.stat().st_size for target in (binary_path, page_path, gzip_path) if target.exists())
        required += sum(target.stat().st_size for _, _, target in overlay_targets if target.exists())
    volume = root if apply else Path(tempfile.gettempdir())
    if shutil.disk_usage(volume).free < required:
        raise ValueError('Insufficient free space for validated staging and complete backups')
    # Dry-run uses a separate named temporary directory and never writes to root.
    temporary = tempfile.TemporaryDirectory(prefix='tankforge-air-candidate-') if not apply else None
    stage = Path(temporary.name) if temporary else root / ('.tankforge-air-stage-' + uuid.uuid4().hex)
    if apply:
        stage.mkdir()
    journal, record, stopped = None, None, False
    try:
        candidate_page, candidate_gzip, candidate_binary = stage/'page.html', stage/'page.html.gz', stage/'tg-server'
        assemble(page_path, tail, candidate_page, manifest)
        with candidate_page.open('rb') as source, candidate_gzip.open('xb') as target:
            with gzip.GzipFile(filename='', fileobj=target, mode='wb', compresslevel=6, mtime=0) as compressed:
                shutil.copyfileobj(source, compressed, CHUNK)
            target.flush()
            os.fsync(target.fileno())
        shutil.copy2(payload_binary, candidate_binary)
        candidate_binary.chmod(0o755)
        candidate_page.chmod(0o644)
        candidate_gzip.chmod(0o644)
        if digest(candidate_binary) != new['binary_sha256']:
            raise ValueError('Candidate binary changed during staging')
        staged_overlays = []
        for index, (entry, payload, target) in enumerate(overlay_targets):
            staged = stage / f'overlay-{index}.data'
            shutil.copy2(payload, staged)
            staged.chmod(target.stat().st_mode & 0o777 if target.exists() else 0o644)
            if staged.stat().st_size != entry['bytes'] or digest(staged) != entry['sha256']:
                raise ValueError('Data overlay payload changed during staging: ' + entry['path'])
            staged_overlays.append((target, staged))
        result = {'validated': True, 'dry_run': not apply, 'page_sha256': new['html_sha256'], 'binary_sha256': new['binary_sha256'], 'selected_baseline': selected_baseline}
        if not apply:
            return result
        validate_live(root, binary_path, page_path, manifest)
        if service:
            service_state(service, old['binary_sha256'])
        journal = root / ('.tankforge-air-rollback-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex)
        journal.mkdir()
        record = {'schema': SCHEMA, 'root': str(root), 'state': 'prepared', 'selected_baseline': selected_baseline,
                  'data_files': old['data_files'],
                  'absent_data_files': old.get('absent_data_files', []),
                  'old_binary_sha256': old['binary_sha256'], 'new_binary_sha256': new['binary_sha256'],
                  'old_page_sha256': old['html_sha256'], 'new_page_sha256': new['html_sha256'], 'files': []}
        cohort = [(binary_path, candidate_binary), (page_path, candidate_page), (gzip_path, candidate_gzip)] + staged_overlays
        for index, (target, staged) in enumerate(cohort):
            item = {'path': target.relative_to(root).as_posix(), 'existed': target.exists(), 'new_sha256': digest(staged)}
            if index >= 3:
                item['kind'] = 'data_overlay'
            if item['existed']:
                item['backup'] = f'{index}.before'
                item['old_sha256'] = digest(target)
                shutil.copy2(target, journal/item['backup'])
            record['files'].append(item)
        atomic_json(journal/'journal.json', record)
        if service:
            service_command(service, 'stop')
            stopped = True
        validate_live(root, binary_path, page_path, manifest)
        for target, staged in cohort:
            if target.relative_to(root).as_posix() in absent and target.exists():
                raise ValueError('Absent runtime data destination appeared before publication')
            os.replace(staged, target)
        record['state'] = 'committed'
        atomic_json(journal/'journal.json', record)
        if service:
            service_command(service, 'start')
            stopped = False
            verify_started(service, new['binary_sha256'], new['html_sha256'], port)
        result.update({'journal': str(journal), 'installed': True, 'restart': 'verified' if service else 'offline'})
        return result
    except BaseException:
        if record is not None:
            if service and not stopped:
                service_command(service, 'stop')
                stopped = True
            restore_files(root, journal, record)
        if service and stopped:
            service_command(service, 'start')
        raise
    finally:
        if temporary:
            temporary.cleanup()
        elif stage.exists():
            checked = stage.resolve()
            if not checked.is_relative_to(root) or not checked.name.startswith('.tankforge-air-stage-') or stage.is_symlink():
                raise ValueError('Refusing cleanup outside owned staging directory')
            shutil.rmtree(checked)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--package', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--service')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--binary', default='target/release/tg-server')
    parser.add_argument('--page', default='client/web/dist/tankforge-range.html')
    parser.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    if args.apply and args.dry_run:
        parser.error('Choose --apply or --dry-run')
    if args.rollback and (args.apply or args.dry_run):
        parser.error('--rollback cannot be combined with --apply or --dry-run')
    if not 1 <= args.port <= 65535:
        parser.error('Invalid port')
    if args.rollback:
        result = rollback(args.root, args.rollback, offline=args.offline, service=args.service, port=args.port)
    else:
        result = install(args.package, args.root, apply=args.apply, offline=args.offline,
                         service=args.service, port=args.port, binary=args.binary, page=args.page)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
