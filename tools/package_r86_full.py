#!/usr/bin/env python3
"""Create and read back a complete R8.6 Linux VPS handoff; never deploy or execute it."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import tarfile
import tempfile


CHUNK = 1024 * 1024
PAGE_NAME = 'tankforge-r86.html'
REQUIRED_NOTICES = (
    'docs/third-party/afl_ext-prococean-LICENSE.txt',
    'docs/third-party/afl_ext-prococean-reference.glsl',
    'docs/third-party/frank-hugenroth-water-LICENSE.txt',
    'docs/third-party/frank-hugenroth-water-reference.glsl',
)
UPGRADE_GUIDE = 'docs/releases/r86-20261028/CODEX_VPS_UPGRADE.md'
SOURCE_CONTEXT = (
    'handoff/tools/apply_r82_airwar_fixes.mjs',
    'handoff/tools/apply_r83_airwar_fixes.mjs',
    'handoff/tools/apply_r84_airwar_fixes.mjs',
    'handoff/tools/apply_r85_airwar_fixes.mjs',
    'handoff/tools/patch_r85_water.mjs',
    'handoff/tools/patch_r85_theatre_fleet.mjs',
    'handoff/tools/sync_frontline_client.py',
    'handoff/tools/export_frontline_aircraft.mjs',
    'tools/rebuild_current_handoff.py',
    'tools/package_r86_full.py',
    'tools/test_package_r86_full.py',
)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(CHUNK):
            digest.update(block)
    return digest.hexdigest()


def plain_path(value):
    """Check the original spelling before resolve can hide a link or junction."""
    path = Path(os.path.abspath(value))
    for candidate in (path, *path.parents):
        if candidate.is_symlink() or (hasattr(os.path, 'isjunction') and os.path.isjunction(candidate)):
            raise ValueError('Symlink or reparse input refused: ' + str(candidate))
    return path


def regular_file(value):
    path = plain_path(value)
    if not path.is_file():
        raise ValueError('Required regular file is missing: ' + str(path))
    return path


def require_canonical_app_suffix(page, app):
    """The frozen rebuild is head + resources + app; compare its tail in chunks."""
    app_bytes = app.stat().st_size
    if app_bytes < 1 or page.stat().st_size < app_bytes:
        raise ValueError('HTML is missing the exact canonical app suffix')
    with page.open('rb') as html, app.open('rb') as canonical:
        html.seek(-app_bytes, os.SEEK_END)
        while block := canonical.read(CHUNK):
            if html.read(len(block)) != block:
                raise ValueError('HTML does not contain the exact canonical app suffix')
        if html.read(1):
            raise ValueError('HTML extends beyond the canonical app suffix')


def inspect_elf(path):
    """Inspect metadata only; accepting an ELF is not a Linux runtime test."""
    with path.open('rb') as source:
        header = source.read(64)
        if len(header) != 64 or header[:7] != b'\x7fELF\x02\x01\x01':
            raise ValueError('Expected little-endian ELF64 Linux server')
        elf_type, machine = struct.unpack_from('<HH', header, 16)
        if machine != 62 or elf_type not in (2, 3):
            raise ValueError('Expected x86_64 executable or static PIE ELF')
        offset = struct.unpack_from('<Q', header, 32)[0]
        size, count = struct.unpack_from('<HH', header, 54)
        if size != 56 or not 0 < count <= 256:
            raise ValueError('Invalid ELF program header table')
        stack_seen = False
        for index in range(count):
            source.seek(offset + index * size)
            row = source.read(size)
            if len(row) != size:
                raise ValueError('Truncated ELF program header')
            kind, flags, file_offset, _, _, file_size, _, _ = struct.unpack('<IIQQQQQQ', row)
            if kind == 3:
                raise ValueError('Expected static Linux server; found dynamic interpreter')
            if kind == 0x6474e551:
                stack_seen = True
                if flags & 1:
                    raise ValueError('Executable ELF stack refused')
            if kind == 2:
                if file_size > path.stat().st_size or file_size % 16:
                    raise ValueError('Invalid ELF dynamic table')
                source.seek(file_offset)
                dynamic = source.read(file_size)
                if len(dynamic) != file_size:
                    raise ValueError('Truncated ELF dynamic table')
                for tag, _ in struct.iter_unpack('<qQ', dynamic):
                    if tag == 0:
                        break
                    if tag == 1:
                        raise ValueError('Dynamic ELF dependency refused')
        if not stack_seen:
            raise ValueError('ELF GNU_STACK declaration required')
    return {'format': 'ELF64', 'machine': 'x86_64',
            'type': 'static PIE' if elf_type == 3 else 'static executable',
            'dynamicInterpreter': False, 'dynamicDependencies': False,
            'executableStack': False, 'binaryExecuted': False,
            'executedOnLinux': False}


VERIFY_SCRIPT = r'''#!/usr/bin/env python3
"""Verify an already extracted R8.6 package without running the game server."""
import hashlib,json,os
from pathlib import Path,PurePosixPath
base=Path(__file__).resolve().parent
manifest=json.loads((base/'manifest.json').read_text(encoding='utf-8'))
failed=[]
for name,expected in manifest['files'].items():
    relative=PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or chr(92) in name:
        failed.append([name,'unsafe manifest path']);continue
    path=base.joinpath(*relative.parts)
    if any(p.is_symlink() for p in [path,*list(path.parents)[:len(relative.parts)]]):
        failed.append([name,'symlink refused']);continue
    if not path.is_file():failed.append([name,'missing regular file']);continue
    digest=hashlib.sha256();size=0
    with path.open('rb') as source:
        while block:=source.read(1024*1024):digest.update(block);size+=len(block)
    if size!=expected['bytes'] or digest.hexdigest()!=expected['sha256']:
        failed.append([name,'size/hash mismatch'])
    if os.name=='posix' and expected['mode']==0o755 and not os.access(path,os.X_OK):
        failed.append([name,'executable permission missing'])
print(json.dumps({'release':manifest['release'],'passed':not failed,
    'checkedFiles':len(manifest['files']),'failures':failed,
    'binaryExecuted':False},ensure_ascii=False,indent=2))
raise SystemExit(1 if failed else 0)
'''

START_SCRIPT = b'''#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
exec ./tg-server --bind "${TF_BIND:-0.0.0.0}" --port "${TF_PORT:-8787}" --data "${TF_DATA_DIR:-./data}" --page "${TF_PAGE:-./tankforge-r86.html}" "$@"
'''


def source_identity(root):
    result = {'repository': 'https://github.com/monpai-lover/tankforge.git',
              'branch': 'codex/r81-airwar-agm-fixes',
              'headAtPackaging': None, 'sourceTreeDirty': None,
              'note': 'source-patches is a scoped audit handoff, not a standalone full source checkout; use the repository branch for development.'}
    for command, key in [(['git', 'rev-parse', 'HEAD'], 'headAtPackaging'),
                         (['git', 'status', '--porcelain'], 'sourceTreeDirty')]:
        try:
            run = subprocess.run(command, cwd=root, capture_output=True, text=True,
                                 timeout=15, check=False)
            if run.returncode == 0:
                result[key] = bool(run.stdout.strip()) if key == 'sourceTreeDirty' else run.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass
    return result


def payloads(root, page, server):
    files = {'tg-server': server, PAGE_NAME: page}
    for folder in ('data', 'config', 'docs/third-party'):
        directory = plain_path(root / folder)
        if not directory.is_dir():
            raise ValueError('Required package directory is missing: ' + folder)
        for path in sorted(directory.rglob('*')):
            plain_path(path)
            if path.is_file():
                name = path.relative_to(root).as_posix()
                if '\n' in name or '\r' in name:
                    raise ValueError('Newline in payload filename refused')
                files[name] = path
    for name in ('SOURCES.md', *REQUIRED_NOTICES, UPGRADE_GUIDE):
        regular_file(root / name)
    files['SOURCES.md'] = root / 'SOURCES.md'
    files['CODEX_VPS_UPGRADE.md'] = root / UPGRADE_GUIDE
    for name in ('LICENSE', 'LICENSE.md', 'NOTICE.md'):
        if (root / name).exists():
            files[name] = regular_file(root / name)
    # Keep this handoff useful to a VPS Codex without duplicating the giant
    # compiled resource parts, Git metadata, target folders or old artifacts.
    for folder in ('handoff/tools', 'handoff/tests', 'docs/superpowers/plans'):
        for path in sorted((root / folder).glob('*r86*')):
            if path.is_file():
                regular_file(path)
                files['source-patches/' + path.relative_to(root).as_posix()] = path
    for name in SOURCE_CONTEXT:
        if (root / name).exists():
            files['source-patches/' + name] = regular_file(root / name)
    return files


def verify_archive(path, prefix, manifest):
    """Stream every member; no extraction, path following or code execution."""
    seen = set()
    expected_names = set(manifest['files']) | {'manifest.json'}
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            if not member.name.startswith(prefix + '/') or not member.isfile():
                raise ValueError('Archive has an unsafe or non-file member')
            name = member.name[len(prefix) + 1:]
            parts = PurePosixPath(name)
            if parts.is_absolute() or '..' in parts.parts or chr(92) in name:
                raise ValueError('Archive member path refused: ' + name)
            if name in seen or name not in expected_names:
                raise ValueError('Archive duplicate or unexpected member: ' + name)
            seen.add(name)
            with archive.extractfile(member) as source:
                if name == 'manifest.json':
                    if json.load(source) != manifest:
                        raise ValueError('Archive manifest differs from prepared inputs')
                    continue
                digest = hashlib.sha256()
                length = 0
                while block := source.read(CHUNK):
                    digest.update(block)
                    length += len(block)
            expected = manifest['files'][name]
            if (length != expected['bytes'] or digest.hexdigest() != expected['sha256']
                    or member.mode != expected['mode']):
                raise ValueError('Archive payload size/hash/mode differs: ' + name)
    if seen != expected_names:
        raise ValueError('Archive is missing payloads: ' + ', '.join(sorted(expected_names - seen)))
    return len(manifest['files'])


def package(root, page, server, output, expected_sha256, expected_server_sha256=None):
    root, page, server, output = map(plain_path, (root, page, server, output))
    receipt_path = output.with_name(output.name + '.receipt.json')
    if output.exists() or output.is_symlink() or receipt_path.exists() or receipt_path.is_symlink():
        raise ValueError('Output or receipt already exists; choose a new archive')
    if not output.parent.is_dir() or not output.name.endswith('.tar.gz'):
        raise ValueError('Output must be a new .tar.gz in an existing directory')
    if not root.is_dir():
        raise ValueError('Source root must be a directory')
    if not isinstance(expected_sha256, str):
        raise ValueError('An explicit frozen HTML SHA-256 is required')
    for value in (expected_sha256, expected_server_sha256):
        if value is not None and not re.fullmatch('[0-9a-fA-F]{64}', value):
            raise ValueError('Expected SHA-256 must contain exactly 64 hexadecimal characters')
    page, server = regular_file(page), regular_file(server)
    if sha(page) != expected_sha256.lower():
        raise ValueError('HTML SHA-256 does not match the explicit frozen release')
    if expected_server_sha256 is not None and sha(server) != expected_server_sha256.lower():
        raise ValueError('Linux server SHA-256 does not match the explicit verified build')
    elf = inspect_elf(server)
    app = regular_file(root / 'handoff/bundle/app.js.html')
    app_sha = sha(app)
    require_canonical_app_suffix(page, app)
    profile = json.loads(regular_file(root / 'data/aircraft/frontline.json').read_text(encoding='utf-8-sig'))
    if profile.get('source', {}).get('appSha256') != app_sha:
        raise ValueError('aircraft profile source app hash does not match the canonical app')
    files = payloads(root, page, server)
    embedded = {
        'start.sh': START_SCRIPT,
        'verify-package.py': VERIFY_SCRIPT.encode('utf-8'),
        'README.txt': (
            'TankForge R8.6 Linux amd64 complete VPS handoff\n\n'
            'Read CODEX_VPS_UPGRADE.md before upgrading an existing installation.\n'
            'Default config files are clean-install examples, not replacements for live custom config.\n'
            'Extract to a NEW directory and run: python3 verify-package.py\n'
            'Fresh install: chmod +x tg-server start.sh && ./start.sh\n'
            'HTTP / and WebSocket /ws must reach the same updated service.\n'
            'This archive includes noncommercial CC BY-NC-SA 3.0 water adaptation and retained MIT notices.\n'
            'No remote service was stopped, modified or deployed by this packaging tool.\n'
            'The Linux server was inspected, not executed, by this tool.\n'
        ).encode('utf-8'),
    }
    manifest_files = {name: {'bytes': path.stat().st_size, 'sha256': sha(path),
                             'mode': 0o755 if name == 'tg-server' else 0o644}
                      for name, path in files.items()}
    for name, data in embedded.items():
        manifest_files[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                                'mode': 0o755 if name in ('start.sh', 'verify-package.py') else 0o644}
    embedded['SHA256SUMS'] = ''.join(
        value['sha256'] + '  ' + name + '\n'
        for name, value in sorted(manifest_files.items())).encode('utf-8')
    manifest_files['SHA256SUMS'] = {'bytes': len(embedded['SHA256SUMS']),
                                   'sha256': hashlib.sha256(embedded['SHA256SUMS']).hexdigest(),
                                   'mode': 0o644}
    identity = source_identity(root)
    identity['canonicalAppSha256'] = app_sha
    manifest = {'schema': 'TankForgeR86FullVpsHandoffV1', 'release': 'R8.6',
                'platform': 'linux-amd64-musl', 'source': identity, 'elf': elf,
                'htmlSha256': expected_sha256.lower(),
                'upgradeGuide': 'CODEX_VPS_UPGRADE.md', 'files': manifest_files}
    embedded['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    prefix = output.name.removesuffix('.tar.gz')
    temporary = None
    try:
        handle, filename = tempfile.mkstemp(prefix='.' + output.name + '.', suffix='.tmp', dir=output.parent)
        temporary = Path(filename)
        with os.fdopen(handle, 'wb') as destination:
            with tarfile.open(fileobj=destination, mode='w:gz', compresslevel=6) as archive:
                for name, path in files.items():
                    regular_file(path)
                    info = archive.gettarinfo(str(path), arcname=prefix + '/' + name)
                    info.uid = info.gid = 0
                    info.uname = info.gname = ''
                    info.mode = manifest_files[name]['mode']
                    with path.open('rb') as source:
                        archive.addfile(info, source)
                for name, data in embedded.items():
                    info = tarfile.TarInfo(prefix + '/' + name)
                    info.size = len(data)
                    info.mode = manifest_files[name]['mode'] if name in manifest_files else 0o644
                    archive.addfile(info, io.BytesIO(data))
        count = verify_archive(temporary, prefix, manifest)
        for name, path in files.items():
            regular_file(path)
            if path.stat().st_size != manifest_files[name]['bytes'] or sha(path) != manifest_files[name]['sha256']:
                raise ValueError('Source input changed during packaging: ' + name)
        if sha(app) != app_sha:
            raise ValueError('Canonical app changed during packaging')
        if payloads(root, page, server) != files:
            raise ValueError('Source payload membership changed during packaging')
        os.link(temporary, output)  # exclusive publication, including a race at the output name
        result = {'schema': 'TankForgeR86FullVpsHandoffReceiptV1',
                  'archive': str(output), 'bytes': output.stat().st_size, 'sha256': sha(output),
                  'verifiedFiles': count, 'totalTarMembers': count + 1,
                  'htmlSha256': manifest_files[PAGE_NAME]['sha256'],
                  'serverSha256': manifest_files['tg-server']['sha256'],
                  'canonicalAppSha256': app_sha, 'sourceInputsStable': True,
                  'dataFiles': sum(name.startswith('data/') for name in files),
                  'configFiles': sum(name.startswith('config/') for name in files),
                  'sourcePatchFiles': sum(name.startswith('source-patches/') for name in files),
                  'source': identity, 'elf': elf, 'binaryExecuted': False,
                  'executedOnLinux': False, 'productionDeployed': False}
        with receipt_path.open('x', encoding='utf-8') as receipt:
            receipt.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        return result
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--page', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--server-sha256')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.root, args.page, args.server, args.output,
                             args.expected_sha256, args.server_sha256), ensure_ascii=False, indent=2))
