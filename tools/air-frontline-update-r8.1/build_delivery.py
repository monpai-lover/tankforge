#!/usr/bin/env python3
"""Assemble a pinned air-mode increment from the preserved October 25 handoff."""
import argparse
import base64
import gzip
import hashlib
import json
import re
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile

TASK = Path(__file__).resolve().parents[2]
WORK = TASK
SOURCE = Path('D:/TankForge-workspaces/r8.1-penetration-20261027/online-source')
PRESERVED_TASK = Path('C:/Users/24908/.codex/scratch/tankforge-airwar-online-20261025')
PRESERVED_WORK = PRESERVED_TASK / 'worktree'
INTAKE = PRESERVED_TASK / 'intake'
RELEASE = INTAKE / 'handoff-release'
NAME = 'tankforge-penetration-r8.1-linux-amd64-20261027'
R6_MANIFEST_PIN = 'e7988f2fac6fe99550431785cf973dbae6af4fb2cafae76d923105183c1f6b93'
R7_MANIFEST_PIN = '662114bf8a950a4b469f893880b9e3b8f67d7eccc9c70e875c17a04fa77bba7a'
R8_MANIFEST_PIN = '42d5d7461ea8d794a64d427b004014c71de05497e6a3ce9d17f3999b24ed3fa3'
ALTERNATE_MANIFEST_PINS = {'r6': R6_MANIFEST_PIN, 'r7': R7_MANIFEST_PIN, 'r8': R8_MANIFEST_PIN}
TOOL_NAMES = ('install.py', 'build_delivery.py', 'verify_actual_release.py', 'finalize_delivery_r8.py',
              'test_installer.py', 'test_build_delivery.py', 'test_r8_package.py',
              'test_finalize_delivery_r8.py', 'test_r8_increment.py', 'test_r81_package.py', 'README-r8-zh.md',
              'R8-RUNS.example.json', 'R8-RUNS.schema.json')
CHUNK = 1024 * 1024
RUNTIME_ADDITIONS = {
    'data/vehicles/ru_pantsir_sm_sv/surface_armor.json': {
        'sha256': 'a5441a98aa8fc344daaa5e87f5535cca8b80336b5d623a33f5de9c0724bbb7b5',
        'bytes': 949756,
        'recovery_note': 'docs/provenance-recovery-20261026/pantsir-embedded-surface-recovery.json',
    },
}


def sha(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(CHUNK), b''):
            value.update(block)
    return value.hexdigest()


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def copy(file, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file, destination)


def tool_hashes(folder):
    return {name: sha(Path(folder) / name) for name in TOOL_NAMES}


def elf_report(file):
    with file.open('rb') as stream:
        header = stream.read(64)
        assert len(header) == 64, 'Truncated ELF header'
        assert header[:7] == b'\x7fELF\x02\x01\x01'
        assert struct.unpack_from('<H', header, 16)[0] in (2, 3), 'ELF is not an executable'
        assert struct.unpack_from('<H', header, 18)[0] == 62
        assert struct.unpack_from('<I', header, 20)[0] == 1, 'Invalid ELF version'
        entry_point = struct.unpack_from('<Q', header, 24)[0]
        offset = struct.unpack_from('<Q', header, 32)[0]
        entry_size, count = struct.unpack_from('<HH', header, 54)
        assert entry_size == 56 and 0 < count < 65535, 'Invalid ELF program table'
        assert offset >= 64 and offset + entry_size * count <= file.stat().st_size, 'Truncated ELF program table'
        program_types = []
        needed = []
        executable_entry = False
        for index in range(count):
            stream.seek(offset + index * entry_size)
            entry = stream.read(entry_size)
            kind = struct.unpack_from('<I', entry)[0]
            program_types.append(kind)
            flags = struct.unpack_from('<I', entry, 4)[0]
            file_offset, virtual_address = struct.unpack_from('<QQ', entry, 8)
            file_size, memory_size = struct.unpack_from('<QQ', entry, 32)
            assert file_offset + file_size <= file.stat().st_size, 'Truncated ELF segment'
            if kind == 1:
                assert memory_size >= file_size
                executable_entry |= bool(flags & 1) and virtual_address <= entry_point < virtual_address + file_size
            if kind == 2:
                dynamic_offset, dynamic_size = file_offset, file_size
                assert dynamic_size % 16 == 0, 'Malformed dynamic table'
                stream.seek(dynamic_offset)
                dynamic = stream.read(dynamic_size)
                for at in range(0, len(dynamic), 16):
                    tag, value = struct.unpack_from('<qQ', dynamic, at)
                    if tag == 0:
                        break
                    if tag == 1:
                        needed.append(value)
        assert 3 not in program_types, 'Unexpected external Linux loader'
        assert not needed, 'Unexpected dynamically required shared library'
        assert 1 in program_types and executable_entry, 'No executable load segment contains the entry point'
    return {'class': 'ELF64', 'byteOrder': 'little', 'machine': 'AMD64',
            'declaredBuildTarget': 'x86_64-unknown-linux-musl', 'ptInterp': False,
            'dtNeeded': [], 'linuxExecution': 'NOT RUN: no Linux execution environment on this Windows host',
            'bytes': file.stat().st_size, 'sha256': sha(file)}


def candidate_binary(file):
    if file is None:
        raise ValueError('An explicit final Linux --binary path is required; no target-directory fallback')
    file = Path(file).resolve(strict=True)
    elf_report(file)
    return file


def source_candidates(originals, *, root=None):
    root = Path(SOURCE if root is None else root)
    candidates = {root / name for name in originals}
    extensions = {'.rs', '.json', '.js', '.mjs', '.py', '.md', '.toml', '.lock', '.txt', '.html', '.wasm', '.h', '.c'}
    folders = ('crates', 'schemas', 'docs', 'data/aircraft', 'data/frontline', 'data/barrel-shapes', 'client/web/src',
               'client/web/tools', 'client/web/test', 'handoff/tools', 'handoff/tests',
               'handoff/model-upgrade-20261025', 'handoff/model-upgrade-v4-20261026', 'handoff/qa', 'config')
    for folder in folders:
        for file in (root / folder).rglob('*'):
            parts = file.relative_to(root).parts
            if file.is_file() and '__pycache__' not in parts and 'out' not in parts and (file.suffix in extensions or folder in ('data/barrel-shapes', 'handoff/model-upgrade-v4-20261026')):
                candidates.add(file)
    for name in ('Cargo.toml', 'Cargo.lock', 'handoff/flight/flight_core.wasm'):
        if (root / name).is_file():
            candidates.add(root / name)
    return candidates


def alternate_from_package(folder, *, expected_pin=None):
    from install import load_package
    folder = Path(folder).resolve(strict=True)
    actual_pin = sha(folder / 'manifest.json')
    if expected_pin is None:
        if actual_pin not in ALTERNATE_MANIFEST_PINS.values():
            raise ValueError('Alternate package manifest differs from immutable R6/R7/R8 pins')
        expected_pin = actual_pin
    if actual_pin != expected_pin:
        raise ValueError('Alternate package manifest differs from its immutable pin')
    _, previous, _, _ = load_package(folder)
    old, applied = previous['baseline'], previous['candidate']
    data = dict(old['data_files'])
    data.update({entry['path']: entry['sha256'] for entry in applied.get('data_overlays', [])})
    absent = sorted(set(old.get('absent_data_files', [])) - set(data))
    baseline = {key: applied[key] for key in ('html_sha256', 'html_bytes', 'tail_sha256', 'binary_sha256')}
    baseline.update(prefix_bytes=old['prefix_bytes'], prefix_sha256=old['prefix_sha256'],
                    data_files=data, absent_data_files=absent)
    return {'id': previous['version'], 'source_manifest_sha256': expected_pin, 'baseline': baseline}


def alternate_packages(packages):
    """Resolve every complete pinned cohort before any candidate output is made."""
    result = [alternate_from_package(folder) for folder in packages]
    if len({row['id'] for row in result}) != len(result) or len({row['source_manifest_sha256'] for row in result}) != len(result):
        raise ValueError('Duplicate alternate baseline package or manifest pin')
    return result


def kernel_report(app, flight, combat):
    if flight is None or combat is None:
        raise ValueError('Explicit final flight and combat kernel paths are required')
    text = Path(app).read_text(encoding='utf-8')
    files = {'flight': Path(flight).resolve(strict=True), 'combat': Path(combat).resolve(strict=True)}
    for kind, variable in (('flight', 'FLIGHT_CORE_WASM'), ('combat', 'TF_APHE_SURFACE_CORE')):
        matches = re.findall(r'\bvar ' + variable + r' = "([A-Za-z0-9+/=]+)"', text)
        if len(matches) != 1 or base64.b64decode(matches[0], validate=True) != files[kind].read_bytes():
            raise ValueError('Explicit ' + kind + ' kernel bytes differ from the actual embedded app')
    script = r'''const fs=require('node:fs');const b=fs.readFileSync(process.argv[1]);
const m=new WebAssembly.Module(b),e=new WebAssembly.Instance(m,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}}).exports;
const exports=WebAssembly.Module.exports(m).map(x=>x.name).sort();let r={exports};
if(process.argv[2]==='flight')r.coreVersion=e.core_version();else{r.revisions={};for(const n of ['tg_replay_revision','tg_surface_revision','tg_barrel_revision','tg_weapon_bindings_revision'])r.revisions[n]=e[n]();}console.log(JSON.stringify(r));'''
    result = {}
    for kind, file in files.items():
        run = subprocess.run(['node', '-e', script, str(file), kind], capture_output=True, text=True)
        if run.returncode:
            raise ValueError('Kernel export inspection failed: ' + kind + ': ' + run.stderr)
        value = json.loads(run.stdout)
        required = {'memory', 'core_version', 'configure_control', 'configure_airframe', 'configure_surfaces',
                    'configure_gear_sequence', 'state_ptr', 'state_len', 'aero_state_ptr', 'aero_state_len', 'spawn', 'step', 'set_damage'} if kind == 'flight' else {'memory', 'tg_alloc', 'tg_free', 'tg_call', 'tg_replay_revision', 'tg_surface_revision', 'tg_barrel_revision', 'tg_weapon_bindings_revision'}
        if not required <= set(value['exports']):
            raise ValueError('Incomplete final kernel ABI: ' + kind)
        if kind == 'flight' and value.get('coreVersion') != 215:
            raise ValueError('Final flight kernel must expose actual C215 version')
        if kind == 'combat' and set(value['revisions'].values()) != {1}:
            raise ValueError('Final combat kernel capability revisions differ')
        result[kind] = dict(value, sha256=sha(file), bytes=file.stat().st_size)
    return result


def source_delta(destination):
    receipt = json.loads((INTAKE / 'handoff-extraction.json').read_text(encoding='utf-8'))
    prefix = 'TankForge/source-baseline/'
    originals = {item['archivePath'][len(prefix):]: item for item in receipt['files']
                 if item['archivePath'].startswith(prefix)}
    changes = []
    candidates = source_candidates(originals)
    # source_candidates includes every barrel trust/geometry input, including
    # content-addressed binary files; unchanged baseline bytes are omitted below.
    # Reproducible inputs for the two reviewed folding packet overlays embedded
    # in the shipped app. Keep the large unrelated authoring fixtures excluded.
    fold_packets = SOURCE / 'handoff/qa/foldable-surface-packets-20261026.json'
    if fold_packets.is_file():
        candidates.add(fold_packets)
    candidates.update(SOURCE / name for name in RUNTIME_ADDITIONS)
    manifest = json.loads((destination / 'manifest.json').read_text(encoding='utf-8'))
    runtime_payloads = {entry['path']: entry['payload_file']
                        for entry in manifest['candidate'].get('data_overlays', [])}
    kernels = manifest['candidate'].get('kernels', {})
    if kernels:
        runtime_payloads['handoff/flight/flight_core.wasm'] = kernels['flight']['file']
    for file in sorted(candidates):
        name = file.relative_to(SOURCE).as_posix()
        old = originals.get(name)
        if not file.is_file():
            raise ValueError('Unexpected deleted baseline source: ' + name)
        current = sha(file)
        if old and current == old['sha256']:
            continue
        # Runtime payloads are authoritative; avoid duplicating the app/profile.
        payload = 'payload/app.tail.html' if name == 'handoff/bundle/app.js.html' else runtime_payloads.get(name)
        if payload is None:
            copy(file, destination / 'source-delta' / name)
        changes.append({'path': name, 'old_sha256': old['sha256'] if old else None,
                        'sha256': current, 'bytes': file.stat().st_size,
                        'content': payload or ('source-delta/' + name)})
    write_json(destination / 'source-delta.json', {
        'baseline': 'TankForge_handoff_20261025.zip / TankForge/source-baseline',
        'baselineArchiveSha256': receipt['archiveSha256'], 'files': changes,
        'kernelArtifacts': kernels,
        'note': 'Apply source-delta only to a copy of the supplied source baseline; runtime installation is handled by install.py.'})


def check_recovery_note(note, name, expected):
    assert note.is_file(), 'Required runtime recovery note missing: ' + str(note)
    evidence = json.loads(note.read_text(encoding='utf-8'))
    assert evidence.get('recoveredPath') == name and evidence.get('sha256') == expected['sha256'] and evidence.get('bytes') == expected['bytes'], 'Runtime recovery note differs from exact payload: ' + name


def runtime_data_overlays(folder):
    data_files, overlays, preserved_backups, absent = {}, [], [], []
    for file in sorted((RELEASE / 'data').rglob('*')):
        if not file.is_file():
            continue
        name = file.relative_to(RELEASE).as_posix()
        if '.bak-' in file.name:
            preserved_backups.append(name)
            continue
        data_files[name] = sha(file)
        candidate = SOURCE / name
        assert candidate.is_file(), name
        if sha(candidate) != data_files[name]:
            allowed_overlays = {'data/aircraft/frontline.json', 'data/aircraft/aircraft.json',
                                'data/projectiles/apcbc_75_pzgr39.json',
                                'data/projectiles/apcbc_75_pzgr39_l43.json',
                                'data/projectiles/apcbc_75_pzgr39_42.json',
                                'data/vehicles/de_pz4_h/armor.json',
                                'data/vehicles/de_panther_g/armor.json',
                                'data/vehicles/de_panther_f/armor.json'}
            assert name in allowed_overlays, 'Unexpected runtime data change: ' + name
            payload_name = 'payload/' + name
            copy(candidate, folder / payload_name)
            overlays.append({'path': name, 'payload_file': payload_name, 'sha256': sha(candidate), 'bytes': candidate.stat().st_size})
    for name, expected in RUNTIME_ADDITIONS.items():
        assert not (RELEASE / name).exists() and name not in data_files, 'Runtime recovery baseline must be absent: ' + name
        assert (RELEASE / name).parent.is_dir(), 'Runtime recovery requires existing baseline parent: ' + name
        candidate = SOURCE / name
        assert candidate.is_file() and candidate.stat().st_size == expected['bytes'] and sha(candidate) == expected['sha256'], 'Exact runtime recovery bytes/hash differ: ' + name
        check_recovery_note(SOURCE / expected['recovery_note'], name, expected)
        payload_name = 'payload/' + name
        copy(candidate, folder / payload_name)
        overlays.append({'path': name, 'payload_file': payload_name, 'sha256': expected['sha256'], 'bytes': expected['bytes']})
        absent.append(name)
    return data_files, overlays, preserved_backups, absent


def prepare(folder, *, binary=None, flight_wasm=None, combat_wasm=None, alternate_baseline_package=None, alternate_baseline_packages=None):
    new_binary = candidate_binary(binary)
    new_app = SOURCE / 'handoff/bundle/app.js.html'
    kernels = kernel_report(new_app, flight_wasm, combat_wasm)
    if sha(SOURCE / 'handoff/flight/flight_core.wasm') != kernels['flight']['sha256']:
        raise ValueError('Authoritative source flight kernel differs from explicit final kernel')
    packages = list(alternate_baseline_packages or [])
    if alternate_baseline_package is not None:
        packages.append(alternate_baseline_package)
    alternatives = alternate_packages(packages)
    assert not folder.exists(), 'Preserve the previous delivery; choose a fresh directory'
    folder.mkdir(parents=True)
    old_page = INTAKE / 'tank-monpai-root-20261025.html'
    old_app = RELEASE / 'frontend-app.js.html'
    assert sha(old_page) == '36bb12d62609f3f9ad2be9a0015786500c1de374623a11a0a60301e29967e63f'
    assert sha(RELEASE / 'tg-server') == '13571854f12301d67bf169ead59f2987b4c497965695470290bf9afed97c2972'
    boundary = old_page.stat().st_size - old_app.stat().st_size
    assert boundary == 384435458
    copy(new_app, folder / 'payload/app.tail.html')
    copy(new_binary, folder / 'payload/tg-server')
    (folder / 'payload/tg-server').chmod(0o755)
    write_json(folder / 'evidence/linux-elf.json', elf_report(new_binary))
    for kind, file in (('flight', flight_wasm), ('combat', combat_wasm)):
        name = 'payload/flight_core.wasm' if kind == 'flight' else 'payload/tg_design_wasm.wasm'
        copy(Path(file), folder / name)
        kernels[kind]['file'] = name
    write_json(folder / 'evidence/kernel-abi.json', kernels)
    candidate_page = folder.parent / (NAME + '-test.html')
    assert not candidate_page.exists(), 'Preserve previous test HTML'
    prefix_hash, whole_hash, old_tail_hash = hashlib.sha256(), hashlib.sha256(), hashlib.sha256()
    with old_page.open('rb') as source, candidate_page.open('xb') as output:
        remaining = boundary
        while remaining:
            data = source.read(min(CHUNK, remaining))
            assert data
            remaining -= len(data)
            output.write(data)
            prefix_hash.update(data)
            whole_hash.update(data)
        for data in iter(lambda: source.read(CHUNK), b''):
            old_tail_hash.update(data)
        assert old_tail_hash.hexdigest() == sha(old_app)
        with new_app.open('rb') as changed:
            for data in iter(lambda: changed.read(CHUNK), b''):
                output.write(data)
                whole_hash.update(data)
    assert sha(candidate_page) == whole_hash.hexdigest()
    data_files, overlays, preserved_backups, absent = runtime_data_overlays(folder)
    manifest = {'schema': 'TankForgeAirFrontlineIncrementV1', 'version': NAME,
                'baseline': {'html_sha256': sha(old_page), 'html_bytes': old_page.stat().st_size,
                             'prefix_bytes': boundary, 'prefix_sha256': prefix_hash.hexdigest(),
                             'tail_sha256': sha(old_app), 'binary_sha256': sha(RELEASE / 'tg-server'),
                             'data_files': data_files, 'absent_data_files': absent,
                             'preserved_handoff_backups': preserved_backups},
                'candidate': {'html_sha256': sha(candidate_page), 'html_bytes': candidate_page.stat().st_size,
                              'tail_file': 'payload/app.tail.html', 'tail_sha256': sha(new_app),
                              'binary_file': 'payload/tg-server', 'binary_sha256': sha(new_binary),
                              'data_overlays': overlays, 'kernels': kernels},
                'buildInputs': {'app': sha(new_app), 'profile': sha(SOURCE / 'data/aircraft/frontline.json'),
                                'aircraft': sha(SOURCE / 'data/aircraft/aircraft.json'),
                                'flightWasm': kernels['flight']['sha256'], 'combatWasm': kernels['combat']['sha256'],
                                'linuxBinary': sha(new_binary), 'cargoLock': sha(SOURCE / 'Cargo.lock'),
                                'packageTools': hashlib.sha256(json.dumps(tool_hashes(Path(__file__).parent), sort_keys=True, separators=(',', ':')).encode()).hexdigest()}}
    if alternatives:
        manifest['alternate_baselines'] = alternatives
    from install import baseline_cohorts
    baseline_cohorts(folder, manifest)
    write_json(folder / 'manifest.json', manifest)
    for name in TOOL_NAMES:
        copy(Path(__file__).parent / name, folder / name)
    source_delta(folder)
    for name in absent:
        note = SOURCE / RUNTIME_ADDITIONS[name]['recovery_note']
        copy(note, folder / 'evidence' / note.name)
    for file in (INTAKE / 'online-baseline-readonly-verification-20261025.json',
                 PRESERVED_TASK / 'audit/missing-config-recovery-evidence.json',
                 PRESERVED_WORK / 'target-air-frontline-ui-proof-20261025.json',
                 PRESERVED_WORK / 'target-air-frontline-export-provenance-20261025.json'):
        assert file.is_file(), file
        copy(file, folder / 'evidence' / file.name)
    print(json.dumps({'prepared': str(folder), 'html': str(candidate_page),
                      'dataOverlays': overlays, 'candidateHtmlSha256': manifest['candidate']['html_sha256']}))


def archive(folder, destination):
    assert folder.is_dir()
    assert (folder / 'README-zh.md').is_file(), 'Deployment guide required'
    assert (folder / 'evidence/validation.json').is_file(), 'Final validation receipt required'
    from install import inside, load_package
    _, manifest, _, _ = load_package(folder)
    for name in manifest['baseline'].get('absent_data_files', []):
        assert name in RUNTIME_ADDITIONS, 'Unexpected runtime recovery addition: ' + name
        expected = RUNTIME_ADDITIONS[name]
        entry = next(item for item in manifest['candidate']['data_overlays'] if item['path'] == name)
        assert entry['sha256'] == expected['sha256'] and entry['bytes'] == expected['bytes'], 'Runtime recovery payload differs from exact source: ' + name
        note = folder / 'evidence' / Path(expected['recovery_note']).name
        check_recovery_note(note, name, expected)
    validation = json.loads((folder / 'evidence/validation.json').read_text(encoding='utf-8'))
    assert validation['manifestSha256'] == sha(folder / 'manifest.json'), 'Validated manifest changed'
    assert manifest.get('version') == NAME and validation.get('schema') == 'TankForgeAirwarR8ValidationV1' and validation.get('version') == NAME, 'Fresh R8 validation schema/version required; R6 evidence cannot authorize an R8 archive'
    assert validation.get('result') == 'PASS_WITH_EXPLICIT_UNVERIFIED_SCOPES', 'R8 validation has not completed'
    assert validation.get('sourceDeltaSha256') == sha(folder / 'source-delta.json'), 'Source delta manifest changed'
    assert validation.get('candidate') == manifest['candidate'], 'Validated candidate changed'
    for name, expected in validation.get('evidence', {}).items():
        file = inside(folder, name)
        assert file.stat().st_size == expected['bytes'] and sha(file) == expected['sha256'], 'Bound R8 evidence changed: ' + name
    delta = json.loads((folder / 'source-delta.json').read_text(encoding='utf-8'))
    for item in delta['files']:
        content = inside(folder, item['content'])
        assert content.stat().st_size == item['bytes'] and sha(content) == item['sha256'], 'Source delta changed: ' + item['path']
    records = {file.relative_to(folder).as_posix(): {'sha256': sha(file), 'bytes': file.stat().st_size}
               for file in sorted(folder.rglob('*')) if file.is_file() and file.name != 'FILES.json'}
    write_json(folder / 'FILES.json', records)
    destination.parent.mkdir(parents=True, exist_ok=True)
    assert not destination.exists(), 'Preserve previous package'
    with destination.open('xb') as output:
        with gzip.GzipFile(filename='', fileobj=output, mode='wb', compresslevel=9, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as tar:
                for file in sorted(folder.rglob('*')):
                    if not file.is_file():
                        continue
                    info = tar.gettarinfo(str(file), arcname=NAME + '/' + file.relative_to(folder).as_posix())
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    info.mtime = 0
                    info.mode = 0o755 if file.name == 'tg-server' else 0o644
                    with file.open('rb') as content:
                        tar.addfile(info, content)
    checked = 0
    with tarfile.open(destination, mode='r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name.startswith(NAME + '/')
            name = member.name[len(NAME) + 1:]
            expected = records.get(name)
            data = tar.extractfile(member).read()
            if name == 'FILES.json':
                assert json.loads(data) == records
            else:
                assert expected and len(data) == expected['bytes'] and hashlib.sha256(data).hexdigest() == expected['sha256'], name
            checked += 1
    assert checked == len(records) + 1
    receipt = {'archive': str(destination), 'bytes': destination.stat().st_size,
               'sha256': sha(destination), 'membersRehashed': checked, 'result': 'PASS'}
    write_json(destination.with_name(destination.name + '.receipt.json'), receipt)
    print(json.dumps(receipt))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'archive'))
    parser.add_argument('--folder', type=Path, default=Path('D:/TankForge-validation/delivery-r8.1') / NAME)
    parser.add_argument('--destination', type=Path, default=Path('D:/TankForge-validation/delivery-r8.1') / (NAME + '.tar.gz'))
    parser.add_argument('--binary', type=Path, help='Explicit final Linux executable; never inferred from SOURCE/target')
    parser.add_argument('--flight-wasm', type=Path)
    parser.add_argument('--combat-wasm', type=Path)
    parser.add_argument('--alternate-baseline-package', type=Path, action='append', default=[], help='Repeat for exact manifest-pinned immutable R6, R7 and R8 prepared folders')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.folder, binary=args.binary, flight_wasm=args.flight_wasm, combat_wasm=args.combat_wasm,
                alternate_baseline_packages=args.alternate_baseline_package)
    else:
        archive(args.folder, args.destination)
