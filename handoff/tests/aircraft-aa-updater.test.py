import gzip
import importlib.util
import io
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'server/vps/update-aircraft-aa.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.target = root / 'target'
        self.package = root / 'package'
        self.package.mkdir()
        self.page = self.target / 'client/web/dist/tankforge-range.html'
        self.catalog = self.target / 'data/aircraft/aircraft.json'
        self.page.parent.mkdir(parents=True)
        self.catalog.parent.mkdir(parents=True)
        self.old_page, self.new_page = b'<html>old source</html>', b'<html>new verified source</html>'
        before = {'types': {'mig17f': {'parts': [1], 'skin': [2], 'guns': ['retained']}, 'f104g': {'kept': True}}}
        after = json.loads(json.dumps(before))
        after['types']['mig17f'].update(parts=[3], skin=[4])
        self.page.write_bytes(self.old_page)
        self.old_gzip = gzip.compress(self.old_page, mtime=0)
        Path(str(self.page) + '.gz').write_bytes(self.old_gzip)
        self.catalog.write_text(json.dumps(before))
        self.old_catalog = self.catalog.read_bytes()
        (self.package / 'index.html.gz').write_bytes(gzip.compress(self.new_page, mtime=0))
        (self.package / 'aircraft.json').write_text(json.dumps(after))
        manifest = {
            'oldPageSha256': updater.sha(self.page), 'oldCatalogSha256': updater.sha(self.catalog),
            'oldGzipSha256': updater.sha(Path(str(self.page) + '.gz')),
            'newGzipSha256': updater.sha(self.package / 'index.html.gz'),
            'newCatalogSha256': updater.sha(self.package / 'aircraft.json'),
            'newPageBytes': len(self.new_page),
            'newPageSha256': updater.hashlib.sha256(self.new_page).hexdigest(),
        }
        (self.package / 'release.json').write_text(json.dumps(manifest))

    def run_update(self, *, dry=False, served=None):
        def request(url, **kwargs):
            value = url.full_url if hasattr(url, 'full_url') else url
            return io.BytesIO(b'ok' if value.endswith('/health') else self.new_page if served is None else served)
        identity = {'pid': 54321, 'startTicks': '1000'}
        with patch.dict(os.environ, TARGET=str(self.target)), patch.object(updater.os, 'getpid', return_value=12345), patch.object(sys, 'argv', ['updater'] + (['--dry-run'] if dry else []) + [str(self.package)]), patch.object(updater, 'process_identity', return_value=identity), patch.object(updater, 'restart', return_value=identity) as restart, patch.object(updater.urllib.request, 'urlopen', side_effect=request):
            updater.main()
            return restart.call_count

    def test_dry_run_has_no_mutations(self):
        self.assertEqual(self.run_update(dry=True), 0)
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(self.catalog.read_bytes(), self.old_catalog)
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_install_checks_served_bytes_and_is_idempotent(self):
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(self.page.read_bytes(), self.new_page)
        self.assertEqual(self.catalog.read_bytes(), (self.package / 'aircraft.json').read_bytes())
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)
        self.assertEqual(self.run_update(), 0)

    def test_failed_served_hash_rolls_back_all_three_files(self):
        with self.assertRaisesRegex(AssertionError, 'did not serve'):
            self.run_update(served=b'wrong running page')
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(self.catalog.read_bytes(), self.old_catalog)
        self.assertEqual(Path(str(self.page) + '.gz').read_bytes(), self.old_gzip)
        self.assertEqual(list(self.target.rglob('*.new-*')), [])

    def test_changed_baseline_rejected_before_writes(self):
        self.page.write_bytes(b'unrelated later update')
        with self.assertRaisesRegex(AssertionError, 'inspected baseline'):
            self.run_update()
        self.assertEqual(self.page.read_bytes(), b'unrelated later update')
        self.assertEqual(self.catalog.read_bytes(), self.old_catalog)
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_new_files_without_process_receipt_reload_without_more_backups(self):
        self.run_update()
        Path(str(self.page) + '.release.json').unlink()
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)

    def test_new_files_with_stale_process_receipt_reload(self):
        self.run_update()
        receipt = Path(str(self.page) + '.release.json')
        value = json.loads(receipt.read_bytes())
        value['process']['startTicks'] = 'old-process'
        receipt.write_text(json.dumps(value))
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)

    def test_new_page_and_catalog_never_hide_an_invalid_gzip(self):
        self.run_update()
        Path(str(self.page) + '.gz').write_bytes(self.old_gzip)
        with self.assertRaisesRegex(AssertionError, 'Installed gzip'):
            self.run_update()


if __name__ == '__main__':
    unittest.main()
