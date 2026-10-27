#!/usr/bin/env python3
"""Small real-file regression tests for the portable frozen-page assembler."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('rebuild_current_handoff.py')


class RebuildCurrentHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='tankforge-rebuild-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'repository with spaces'
        self.bundle = self.root / 'handoff' / 'bundle'
        self.bundle.mkdir(parents=True)
        self.head = b'<!doctype html>\n<script id="tf-data">'
        # Cross the assembler's chunk size and every compressed-file boundary.
        self.assets = bytes(range(256)) * 9001 + b'</script>\n'
        self.app = b'<script>window.gameReady = true;</script>\n'
        (self.bundle / 'head.html').write_bytes(self.head)
        (self.bundle / 'app.js.html').write_bytes(self.app)
        packed = gzip.compress(self.assets, mtime=0)
        for index in range(5):
            start, end = len(packed) * index // 5, len(packed) * (index + 1) // 5
            (self.bundle / f'data.line.gz.part{index:02d}').write_bytes(packed[start:end])
        self.expected = self.head + self.assets + self.app
        self.digest = hashlib.sha256(self.expected).hexdigest()
        self.output = self.directory / 'rebuilt page.html'

    def run_cli(self, *, script=SCRIPT, root=True, expected=True, cwd=None):
        command = [sys.executable, str(script), '--output', str(self.output)]
        if root:
            command.extend(['--root', str(self.root)])
        if expected:
            command.extend(['--expected-sha256', self.digest])
        return subprocess.run(command, cwd=cwd, text=True, capture_output=True,
                              timeout=30, check=False)

    def assert_no_partial_output(self):
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('.rebuilt page.html.*.tmp')), [])

    def test_valid_stream_across_five_parts(self):
        before = {p.name: p.read_bytes() for p in self.bundle.iterdir()}
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['bytes'], len(self.expected))
        self.assertEqual(receipt['sha256'], self.digest)
        self.assertEqual(self.output.read_bytes(), self.expected)
        self.assertEqual({p.name: p.read_bytes() for p in self.bundle.iterdir()}, before)

    def test_missing_middle_part_is_rejected_without_output(self):
        (self.bundle / 'data.line.gz.part02').unlink()
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('part00 through part04', result.stderr)
        self.assertIn('part02', result.stderr)
        self.assert_no_partial_output()

    def test_extra_part_is_rejected_without_output(self):
        (self.bundle / 'data.line.gz.part05').write_bytes(b'extra')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('part00 through part04', result.stderr)
        self.assert_no_partial_output()

    def test_hash_mismatch_removes_only_its_temporary_file(self):
        sentinel = self.directory / '.rebuilt page.html.unrelated.tmp'
        sentinel.write_bytes(b'keep this')
        self.digest = '0' * 64
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SHA-256 mismatch', result.stderr)
        self.assertFalse(self.output.exists())
        self.assertEqual(sentinel.read_bytes(), b'keep this')
        self.assertEqual(list(self.directory.glob('.rebuilt page.html.*.tmp')), [sentinel])

    def test_existing_output_is_preserved(self):
        self.output.write_bytes(b'original output')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Output already exists', result.stderr)
        self.assertEqual(self.output.read_bytes(), b'original output')
        self.assertEqual(list(self.directory.glob('.rebuilt page.html.*.tmp')), [])

    def test_corrupt_gzip_leaves_no_partial_output(self):
        (self.bundle / 'data.line.gz.part02').write_bytes(b'broken compressed bytes')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Invalid compressed data', result.stderr)
        self.assert_no_partial_output()

    def test_default_expected_hash_is_the_frozen_release(self):
        result = self.run_cli(expected=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SHA-256 mismatch', result.stderr)
        self.assertIn('f2d507c002fa0a8aed351ce606685cb76fa5d926c0ed1db7c5d4ced41373e4fa', result.stderr)
        self.assert_no_partial_output()

    def test_default_root_follows_script_from_another_working_directory(self):
        self.assertTrue(SCRIPT.is_file(), 'The portable rebuild entry point is not implemented')
        local_script = self.root / 'tools' / SCRIPT.name
        local_script.parent.mkdir()
        shutil.copyfile(SCRIPT, local_script)
        elsewhere = self.directory / 'unrelated working directory'
        elsewhere.mkdir()
        result = self.run_cli(script=local_script, root=False, cwd=elsewhere)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_bytes(), self.expected)


if __name__ == '__main__':
    unittest.main()
