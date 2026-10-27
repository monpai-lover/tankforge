#!/usr/bin/env python3
"""Reassemble the frozen R8.1 HTML without changing its source assets.

Only Python's standard library is required. The default root follows this file,
so the command can run from any working directory. The output must be new; a
verified temporary file is published with an exclusive hard link so an existing
output can never be overwritten, including if another process creates it first.
"""
import argparse
from contextlib import ExitStack
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import zlib


RELEASE_SHA256 = 'f2d507c002fa0a8aed351ce606685cb76fa5d926c0ed1db7c5d4ced41373e4fa'
CHUNK_BYTES = 1024 * 1024
PART_NAMES = tuple(f'data.line.gz.part{index:02d}' for index in range(5))


class _PartStream:
    """Expose consecutive compressed files as one bounded-read input stream."""

    def __init__(self, streams):
        self._streams = iter(streams)
        self._current = next(self._streams, None)

    def read(self, size):
        if size < 0:
            raise ValueError('Unbounded compressed input reads are not supported')
        if size == 0:
            return b''
        while self._current is not None:
            block = self._current.read(size)
            if block:
                return block
            self._current = next(self._streams, None)
        return b''


def rebuild(root, output, expected_sha256=RELEASE_SHA256):
    """Write and verify head + decompressed five-part data + app, in that order."""
    root = Path(root).resolve(strict=True)
    output = Path(os.path.abspath(output))
    if output.exists() or output.is_symlink():
        raise ValueError(f'Output already exists: {output}')
    if not output.parent.is_dir():
        raise ValueError(f'Output parent directory does not exist: {output.parent}')
    if not isinstance(expected_sha256, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256):
        raise ValueError('Expected SHA-256 must contain exactly 64 hexadecimal characters')
    expected_sha256 = expected_sha256.lower()

    bundle = root / 'handoff' / 'bundle'
    actual_names = {file.name for file in bundle.glob('data.line.gz.part*')}
    required_names = set(PART_NAMES)
    if actual_names != required_names:
        missing = ', '.join(sorted(required_names - actual_names)) or 'none'
        extra = ', '.join(sorted(actual_names - required_names)) or 'none'
        raise ValueError('Expected exactly consecutive part00 through part04; '
                         f'missing: {missing}; unexpected: {extra}')
    head, app = bundle / 'head.html', bundle / 'app.js.html'
    parts = [bundle / name for name in PART_NAMES]
    for file in [head, *parts, app]:
        if not file.is_file():
            raise ValueError(f'Required input is not a file: {file}')

    digest = hashlib.sha256()
    written = 0
    temporary = None
    try:
        descriptor, name = tempfile.mkstemp(prefix=f'.{output.name}.', suffix='.tmp',
                                             dir=output.parent)
        temporary = Path(name)
        with os.fdopen(descriptor, 'wb') as destination:
            def copy_stream(source):
                nonlocal written
                for block in iter(lambda: source.read(CHUNK_BYTES), b''):
                    destination.write(block)
                    digest.update(block)
                    written += len(block)

            with head.open('rb') as source:
                copy_stream(source)
            with ExitStack() as stack:
                streams = [stack.enter_context(part.open('rb')) for part in parts]
                try:
                    with gzip.GzipFile(fileobj=_PartStream(streams), mode='rb') as source:
                        copy_stream(source)
                except (OSError, EOFError, zlib.error) as error:
                    raise ValueError(f'Invalid compressed data: {error}') from error
            with app.open('rb') as source:
                copy_stream(source)
            actual_sha256 = digest.hexdigest()
            if actual_sha256 != expected_sha256:
                raise ValueError(f'SHA-256 mismatch: expected {expected_sha256}, got {actual_sha256}')
            destination.flush()
            os.fsync(destination.fileno())

        try:
            os.link(temporary, output)
        except FileExistsError as error:
            raise ValueError(f'Output already exists: {output}') from error
        return {'schema': 'TankForgeFrozenHandoffRebuildV1', 'root': str(root),
                'output': str(output), 'bytes': written, 'sha256': actual_sha256,
                'expectedSha256': expected_sha256, 'parts': list(PART_NAMES)}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1],
                        help='Source repository root (default: parent of this tools directory)')
    parser.add_argument('--output', type=Path, required=True,
                        help='New HTML path in an existing directory; never overwritten')
    parser.add_argument('--expected-sha256', default=RELEASE_SHA256,
                        help='Expected complete HTML SHA-256 (default: frozen R8.1 release)')
    args = parser.parse_args(argv)
    try:
        result = rebuild(args.root, args.output, args.expected_sha256)
    except (ValueError, OSError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
