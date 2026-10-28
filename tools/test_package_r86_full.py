#!/usr/bin/env python3
"""Small archive and safety regressions; fixtures are never executed as Linux code."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('package_r86_full.py')


def load_module():
    if not SCRIPT.is_file():
        raise AssertionError('R8.6 full VPS packager must be implemented')
    spec = importlib.util.spec_from_file_location('package_r86_full', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def elf_fixture():
    # Only a static ELF metadata fixture for inspection, not an executable build.
    header = bytearray(64)
    header[:7] = b'\x7fELF\x02\x01\x01'
    struct.pack_into('<HHIQQQIHHHHHH', header, 16,
                     3, 62, 1, 0, 64, 0, 0, 64, 56, 2, 0, 0, 0)
    load = struct.pack('<IIQQQQQQ', 1, 5, 0, 0, 0, 176, 176, 4096)
    stack = struct.pack('<IIQQQQQQ', 0x6474e551, 6, 0, 0, 0, 0, 0, 16)
    return bytes(header) + load + stack


class FullPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='tf-r86-package-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'source with spaces'
        self.root.mkdir()
        for folder in ['data/aircraft', 'config', 'handoff/bundle', 'handoff/tools',
                       'docs/third-party', 'docs/releases/r86-20261028']:
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        self.page = self.directory / 'actual page.html'
        self.server = self.directory / 'server fixture'
        self.server.write_bytes(elf_fixture())
        app = b'<script>const version="r86-test";</script>\n'
        (self.root / 'handoff/bundle/app.js.html').write_bytes(app)
        self.page.write_bytes(b'<!doctype html><title>small archive test</title>\n' + app)
        self.digest = hashlib.sha256(self.page.read_bytes()).hexdigest()
        (self.root / 'data/aircraft/frontline.json').write_text(json.dumps({
            'source': {'appSha256': hashlib.sha256(app).hexdigest()}, 'aircraft': []
        }), encoding='utf-8')
        (self.root / 'data/map.json').write_bytes(b'{"map":"fixture"}\n')
        (self.root / 'config/rules.json').write_bytes(b'{"rules":"fixture"}\n')
        (self.root / 'SOURCES.md').write_text('Test source attribution.\n', encoding='utf-8')
        for name in ['afl_ext-prococean-LICENSE.txt', 'afl_ext-prococean-reference.glsl',
                     'frank-hugenroth-water-LICENSE.txt', 'frank-hugenroth-water-reference.glsl']:
            (self.root / 'docs/third-party' / name).write_text(name + '\n', encoding='utf-8')
        (self.root / 'docs/releases/r86-20261028/CODEX_VPS_UPGRADE.md').write_text(
            '# Test upgrade instructions\nPreserve live configuration.\n', encoding='utf-8')
        (self.root / 'handoff/tools/patch_r86_water.mjs').write_text(
            '// Source pointer fixture\n', encoding='utf-8')
        self.output = self.directory / 'tankforge-r86-test.tar.gz'

    def package(self):
        return load_module().package(self.root, self.page, self.server,
                                     self.output, self.digest)

    def test_full_roundtrip_has_all_data_config_notices_and_source_pointers(self):
        receipt = self.package()
        self.assertEqual(receipt['htmlSha256'], self.digest)
        self.assertFalse(receipt['binaryExecuted'])
        self.assertTrue(receipt['sourceInputsStable'])
        prefix = self.output.name.removesuffix('.tar.gz')
        with tarfile.open(self.output, 'r:gz') as archive:
            files = {m.name.removeprefix(prefix + '/'): m for m in archive}
            manifest = json.load(archive.extractfile(files['manifest.json']))
            self.assertEqual(set(files) - {'manifest.json'}, set(manifest['files']))
            for name in ['data/map.json', 'config/rules.json', 'SOURCES.md',
                         'CODEX_VPS_UPGRADE.md', 'verify-package.py', 'SHA256SUMS',
                         'docs/third-party/frank-hugenroth-water-LICENSE.txt',
                         'source-patches/handoff/tools/patch_r86_water.mjs']:
                self.assertIn(name, files)
            for name in ['tg-server', 'start.sh', 'verify-package.py']:
                self.assertEqual(files[name].mode, 0o755)
            self.assertEqual(archive.extractfile(files['tankforge-r86.html']).read(),
                             self.page.read_bytes())
        self.assertEqual(receipt['verifiedFiles'], len(manifest['files']))

    def test_extracted_verifier_runs_from_any_directory_and_detects_tamper(self):
        self.package()
        destination = self.directory / 'extracted package'
        destination.mkdir()
        with tarfile.open(self.output, 'r:gz') as archive:
            archive.extractall(destination, filter='data')
        package_dir = destination / self.output.name.removesuffix('.tar.gz')
        verifier = package_dir / 'verify-package.py'
        command = [sys.executable, str(verifier)]
        result = subprocess.run(command, cwd=self.directory, capture_output=True,
                                text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertTrue(json.loads(result.stdout)['passed'])
        (package_dir / 'data/map.json').write_bytes(b'altered map')
        result = subprocess.run(command, cwd=self.directory, capture_output=True,
                                text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn(['data/map.json', 'size/hash mismatch'], json.loads(result.stdout)['failures'])

    def test_existing_output_is_preserved(self):
        self.output.write_bytes(b'user-owned existing output')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.package()
        self.assertEqual(self.output.read_bytes(), b'user-owned existing output')

    def test_wrong_html_digest_has_no_output(self):
        self.digest = '0' * 64
        with self.assertRaisesRegex(ValueError, 'HTML SHA-256'):
            self.package()
        self.assertFalse(self.output.exists())

    def test_matching_html_digest_with_unrelated_page_cannot_claim_current_app(self):
        self.page.write_bytes(b'<!doctype html><title>old unrelated page</title>\n')
        self.digest = hashlib.sha256(self.page.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'canonical app suffix'):
            self.package()
        self.assertFalse(self.output.exists())

    def test_added_payload_after_readback_prevents_publication(self):
        module = load_module()
        original_verify = module.verify_archive

        def add_payload_after_readback(*args):
            verified = original_verify(*args)
            (self.root / 'data/added-during-build.json').write_bytes(b'{"added":true}\n')
            return verified

        module.verify_archive = add_payload_after_readback
        with self.assertRaisesRegex(ValueError, 'payload membership changed'):
            module.package(self.root, self.page, self.server, self.output, self.digest)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('.' + self.output.name + '.*.tmp')), [])

    def test_stale_profile_source_has_no_output(self):
        path = self.root / 'data/aircraft/frontline.json'
        path.write_text('{"source":{"appSha256":"stale"}}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'aircraft.*app'):
            self.package()
        self.assertFalse(self.output.exists())

    def test_missing_required_reference_license_has_no_output(self):
        (self.root / 'docs/third-party/frank-hugenroth-water-LICENSE.txt').unlink()
        with self.assertRaisesRegex(ValueError, 'Required regular file'):
            self.package()
        self.assertFalse(self.output.exists())

    def test_symlinked_payload_is_rejected(self):
        link = self.root / 'data/linked.json'
        try:
            link.symlink_to(self.page)
        except OSError as error:
            self.skipTest('OS does not permit test symlinks: ' + str(error))
        with self.assertRaisesRegex(ValueError, '[Ss]ymlink|[Rr]eparse'):
            self.package()
        self.assertFalse(self.output.exists())

    def test_symlinked_explicit_input_is_rejected_before_resolve(self):
        link = self.directory / 'linked page.html'
        try:
            link.symlink_to(self.page)
        except OSError as error:
            self.skipTest('OS does not permit test symlinks: ' + str(error))
        self.page = link
        with self.assertRaisesRegex(ValueError, '[Ss]ymlink|[Rr]eparse'):
            self.package()

    def test_archive_readback_rejects_extra_duplicate_and_missing_payloads(self):
        module = load_module()
        payload = b'complete payload'
        manifest = {'files': {'payload.txt': {
            'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
            'mode': 0o644}}}
        for case, names in [('extra', ['payload.txt', 'extra.txt']),
                            ('duplicate', ['payload.txt', 'payload.txt']),
                            ('missing', []), ('tampered', ['payload.txt'])]:
            archive_path = self.directory / (case + '.tar.gz')
            with tarfile.open(archive_path, 'w:gz') as archive:
                for name in names:
                    actual = b'tampered payload' if case == 'tampered' else payload
                    info = tarfile.TarInfo('prefix/' + name)
                    info.size = len(actual)
                    info.mode = 0o644
                    archive.addfile(info, io.BytesIO(actual))
                data = (json.dumps(manifest, sort_keys=True) + '\n').encode()
                info = tarfile.TarInfo('prefix/manifest.json')
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            with self.subTest(case=case), self.assertRaisesRegex(ValueError, 'Archive'):
                module.verify_archive(archive_path, 'prefix', manifest)


if __name__ == '__main__':
    unittest.main()
