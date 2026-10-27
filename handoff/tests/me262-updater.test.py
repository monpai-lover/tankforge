"""Exercise the actual updater against real small files; never a live service."""
import contextlib
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'me262_updater', Path(__file__).resolve().parents[1] / 'server/vps/update-me262.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)

# Independent fixture from the reviewed production gun factory, not the guard.
EXPECTED_GUNS = {
    'me262': ('air_mk108_', [100, 100, 80, 80], 650, 'he_30_mk108'),
    'me262a2a': ('air_mk108_', [100, 100], 650, 'he_30_mk108'),
    'me262u4': ('air_mk214a_', [32], 150, 'ap_50_mk214a'),
}


class Me262UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.target, self.package = root / 'target', root / 'package'
        self.package.mkdir()
        self.page = self.target / 'client/web/dist/tankforge-range.html'
        self.catalog = self.target / 'data/aircraft/aircraft.json'
        self.page.parent.mkdir(parents=True)
        self.catalog.parent.mkdir(parents=True)
        self.old_page, self.new_page = b'<html>old public source</html>', b'<html>reviewed Me262 source</html>'
        self.before = {
            'version': 1, 'generated': 'preserved baseline',
            'types': {'me262': {'name': 'old Me262', 'parts': ['old']},
                      'mig17f': {'parts': [1], 'skin': [2], 'active': True}},
            'shells': {'he_30_mk108': {'mass_kg': .33, 'speed_ms': 505,
                                     'filler_kg': .11952, 'caliber_mm': 30,
                                     'incendiary': True}},
            'missiles': {'retained': {'mass': 1}},
        }
        self.after = copy.deepcopy(self.before)
        for aircraft, (prefix, rounds, rpm, shell) in EXPECTED_GUNS.items():
            self.after['types'][aircraft] = {
                'name': aircraft, 'year': 1945 if aircraft == 'me262u4' else 1944,
                'parts': ['new source-bound damage'], 'skin': ['new skin'],
                'guns': [{'id': prefix + str(i), 'kind': 'cannon', 'ammo': ammo,
                          'rpm': rpm, 'owner': 'body', 'shells': [shell]}
                         for i, ammo in enumerate(rounds)],
                'loadouts': [{'index': 0, 'stores': {}}],
            }
        self.after['shells']['ap_50_mk214a'] = {
            'mass_kg': 2.06, 'speed_ms': 835, 'filler_kg': .02822,
            'caliber_mm': 50, 'incendiary': True,
        }
        self.page.write_bytes(self.old_page)
        self.old_gzip = gzip.compress(self.old_page, mtime=0)
        Path(str(self.page) + '.gz').write_bytes(self.old_gzip)
        self.catalog.write_text(json.dumps(self.before))
        self.old_catalog = self.catalog.read_bytes()
        (self.package / 'index.html.gz').write_bytes(gzip.compress(self.new_page, mtime=0))
        (self.package / 'aircraft.json').write_text(json.dumps(self.after))
        self.manifest = {
            'oldPageSha256': updater.sha(self.page),
            'oldCatalogSha256': updater.sha(self.catalog),
            'oldGzipSha256': updater.sha(Path(str(self.page) + '.gz')),
            'newGzipSha256': updater.sha(self.package / 'index.html.gz'),
            'newCatalogSha256': updater.sha(self.package / 'aircraft.json'),
            'newPageBytes': len(self.new_page),
            'newPageSha256': updater.hashlib.sha256(self.new_page).hexdigest(),
        }
        self.write_manifest()
        self.identity = {'pid': 54321, 'startTicks': '1000'}

    def write_manifest(self):
        (self.package / 'release.json').write_text(json.dumps(self.manifest))

    def replace_catalog(self, value):
        (self.package / 'aircraft.json').write_text(json.dumps(value))
        # A re-signed manifest cannot bypass the semantic whitelist.
        self.manifest['newCatalogSha256'] = updater.sha(self.package / 'aircraft.json')
        self.write_manifest()

    def run_update(self, *, dry=False, served=None, identity=None, current_missing=False):
        identity = identity or self.identity

        def request(url, **kwargs):
            value = url.full_url if hasattr(url, 'full_url') else url
            return io.BytesIO(b'ok' if value.endswith('/health') else
                              self.new_page if served is None else served)

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, TARGET=str(self.target)))
            stack.enter_context(patch.object(updater.os, 'getpid', return_value=12345))
            stack.enter_context(patch.object(sys, 'argv', ['updater'] +
                                (['--dry-run'] if dry else []) + [str(self.package)]))
            stack.enter_context(patch.object(updater, 'process_identity',
                                return_value=None if current_missing else identity))
            restart = stack.enter_context(patch.object(updater, 'restart', return_value=identity))
            stack.enter_context(patch.object(updater.urllib.request, 'urlopen', side_effect=request))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            updater.main()
            return restart.call_count

    def assert_old_files(self):
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(self.catalog.read_bytes(), self.old_catalog)
        self.assertEqual(Path(str(self.page) + '.gz').read_bytes(), self.old_gzip)
        self.assertEqual(list(self.target.rglob('*.new-*')), [])

    def test_valid_guard_does_not_mutate_inputs(self):
        before, after = copy.deepcopy(self.before), copy.deepcopy(self.after)
        updater.validate_catalog(self.before, self.after)
        self.assertEqual(self.before, before)
        self.assertEqual(self.after, after)

    def test_dry_run_does_not_write_or_restart(self):
        self.assertEqual(self.run_update(dry=True), 0)
        self.assert_old_files()
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_install_three_files_receipt_and_current_process_idempotence(self):
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(self.page.read_bytes(), self.new_page)
        self.assertEqual(self.catalog.read_bytes(), (self.package / 'aircraft.json').read_bytes())
        self.assertEqual(Path(str(self.page) + '.gz').read_bytes(), (self.package / 'index.html.gz').read_bytes())
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)
        receipt = json.loads(Path(str(self.page) + '.release.json').read_text())
        self.assertEqual(receipt, {'pageSha256': self.manifest['newPageSha256'],
                                  'catalogSha256': self.manifest['newCatalogSha256'],
                                  'gzipSha256': self.manifest['newGzipSha256'],
                                  'process': self.identity})
        self.assertEqual(self.run_update(), 0)

    def test_tampered_non_me262_type_rejected_before_any_write(self):
        self.after['types']['mig17f']['parts'] = ['tampered']
        self.replace_catalog(self.after)
        with self.assertRaisesRegex(AssertionError, 'non-Me262'):
            self.run_update()
        self.assert_old_files()
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_boolean_number_change_cannot_hide_in_python_equality(self):
        self.after['types']['mig17f']['active'] = 1
        self.replace_catalog(self.after)
        with self.assertRaisesRegex(AssertionError, 'non-Me262'):
            self.run_update()
        self.assert_old_files()

    def test_type_keys_must_be_exact_additions(self):
        for action in ['extra', 'removed', 'missing_variant']:
            with self.subTest(action=action):
                value = copy.deepcopy(self.after)
                if action == 'extra':
                    value['types']['new_unreviewed'] = {}
                elif action == 'removed':
                    del value['types']['mig17f']
                else:
                    del value['types']['me262u4']
                with self.assertRaisesRegex(AssertionError, 'type keys'):
                    updater.validate_catalog(self.before, value)

    def test_unchanged_shells_missiles_and_top_level_values_are_preserved(self):
        for section in ['shells', 'missiles', 'generated']:
            with self.subTest(section=section):
                value = copy.deepcopy(self.after)
                if section == 'shells':
                    value['shells']['he_30_mk108']['speed_ms'] = 999
                elif section == 'missiles':
                    value['missiles']['retained']['mass'] = 5
                else:
                    value['generated'] = 'silently re-exported'
                with self.assertRaisesRegex(AssertionError, 'non-Me262'):
                    updater.validate_catalog(self.before, value)

    def test_extra_shell_and_top_level_keys_rejected(self):
        value = copy.deepcopy(self.after)
        value['shells']['unreviewed'] = {}
        with self.assertRaisesRegex(AssertionError, 'projectile keys'):
            updater.validate_catalog(self.before, value)
        value = copy.deepcopy(self.after)
        value['unexpected'] = 1
        with self.assertRaisesRegex(AssertionError, 'top-level keys'):
            updater.validate_catalog(self.before, value)

    def test_all_three_variants_fixed_feed_counts_and_ammo_checked(self):
        for aircraft in EXPECTED_GUNS:
            for corruption in ['feed_count', 'ammo', 'id', 'extra_belt']:
                with self.subTest(aircraft=aircraft, corruption=corruption):
                    value = copy.deepcopy(self.after)
                    guns = value['types'][aircraft]['guns']
                    if corruption == 'feed_count':
                        guns.pop()
                    elif corruption == 'ammo':
                        guns[0]['ammo'] += 1
                    elif corruption == 'id':
                        guns[0]['id'] = 'different_feed'
                    else:
                        guns[0]['belt'] = 'invented'
                    with self.assertRaisesRegex(AssertionError, 'fixed gun feed'):
                        updater.validate_catalog(self.before, value)

    def test_projectile_reference_and_game_default_shell_checked(self):
        value = copy.deepcopy(self.after)
        value['types']['me262u4']['guns'][0]['shells'] = ['missing_projectile']
        with self.assertRaisesRegex(AssertionError, 'fixed gun feed/projectile'):
            updater.validate_catalog(self.before, value)
        for key, replacement in [('speed_ms', 999), ('incendiary', 1), ('extra', True)]:
            with self.subTest(key=key):
                value = copy.deepcopy(self.after)
                value['shells']['ap_50_mk214a'][key] = replacement
                with self.assertRaisesRegex(AssertionError, 'game projectile defaults'):
                    updater.validate_catalog(self.before, value)

    def test_failed_served_page_rolls_back_shared_three_file_transaction(self):
        with self.assertRaisesRegex(AssertionError, 'did not serve'):
            self.run_update(served=b'wrong running page')
        self.assert_old_files()
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)
        self.assertFalse(Path(str(self.page) + '.release.json').exists())

    def test_partial_replace_failure_restores_already_switched_page(self):
        real_replace = updater.os.replace

        def fail_gzip(src, dst):
            if str(src).endswith('.new-20261025000000-12345') and Path(dst) == Path(str(self.page) + '.gz'):
                raise OSError('fixture staged gzip switch failed')
            return real_replace(src, dst)

        with patch.object(updater.time, 'strftime', return_value='20261025000000'), \
                patch.object(updater.os, 'replace', side_effect=fail_gzip):
            with self.assertRaisesRegex(OSError, 'gzip switch failed'):
                self.run_update()
        self.assert_old_files()

    def test_changed_baseline_rejected_without_overwriting_later_update(self):
        self.page.write_bytes(b'later independent update')
        with self.assertRaisesRegex(AssertionError, 'inspected baseline'):
            self.run_update()
        self.assertEqual(self.page.read_bytes(), b'later independent update')
        self.assertEqual(self.catalog.read_bytes(), self.old_catalog)
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_missing_installed_gzip_rejected_before_mutation(self):
        Path(str(self.page) + '.gz').unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_update()
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(self.catalog.read_bytes(), self.old_catalog)
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_current_receipt_cannot_hide_missing_or_wrong_gzip(self):
        self.run_update()
        installed_gzip = Path(str(self.page) + '.gz')
        installed_gzip.unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_update()
        installed_gzip.write_bytes(self.old_gzip)
        with self.assertRaisesRegex(AssertionError, 'Installed gzip'):
            self.run_update()

    def test_missing_or_truncated_package_gzip_rejected_before_mutation(self):
        compressed = self.package / 'index.html.gz'
        compressed.unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_update()
        compressed.write_bytes(gzip.compress(self.new_page, mtime=0)[:-5])
        self.manifest['newGzipSha256'] = updater.sha(compressed)
        self.write_manifest()
        with self.assertRaises(EOFError):
            self.run_update()
        self.assert_old_files()
        self.assertEqual(list(self.target.rglob('*.bak-*')), [])

    def test_missing_receipt_reloads_without_new_backups(self):
        self.run_update()
        Path(str(self.page) + '.release.json').unlink()
        self.assertEqual(self.run_update(), 1)
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)

    def test_every_receipt_hash_is_required_for_idempotent_current_process(self):
        self.run_update()
        path = Path(str(self.page) + '.release.json')
        for field in ['pageSha256', 'catalogSha256', 'gzipSha256']:
            with self.subTest(field=field):
                value = json.loads(path.read_text())
                value[field] = 'stale'
                path.write_text(json.dumps(value))
                self.assertEqual(self.run_update(), 1)
                self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)

    def test_pid_and_start_ticks_both_invalidate_receipt(self):
        self.run_update()
        for identity in [{'pid': 54321, 'startTicks': '2000'},
                         {'pid': 54322, 'startTicks': '2000'}]:
            with self.subTest(identity=identity):
                self.assertEqual(self.run_update(identity=identity), 1)
        self.assertEqual(self.run_update(identity=identity), 0)
        self.assertEqual(len(list(self.target.rglob('*.bak-*'))), 3)

    def test_absent_current_process_cannot_reuse_receipt(self):
        self.run_update()
        self.assertEqual(self.run_update(current_missing=True), 1)

    def test_process_identity_uses_real_current_pid_start_ticks(self):
        own_pid = os.getpid()
        expected = (Path('/proc') / str(own_pid) / 'stat').read_text().rsplit(')', 1)[1].split()[19]
        with patch.object(updater.subprocess, 'check_output', return_value=str(own_pid).encode()):
            self.assertEqual(updater.process_identity('fixture-unit'),
                             {'pid': own_pid, 'startTicks': expected})

    def test_restart_requires_new_process_identity_not_only_successful_command(self):
        old = {'pid': 7000, 'startTicks': '100'}
        new = {'pid': 7000, 'startTicks': '200'}
        with patch.object(updater, 'process_identity', side_effect=[old, old, new]), \
                patch.object(updater.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
                patch.object(updater.shutil, 'which', return_value=None), \
                patch.object(updater.time, 'sleep') as sleep:
            self.assertEqual(updater.restart(self.target, 'fixture-unit'), new)
            self.assertEqual(sleep.call_count, 1)


if __name__ == '__main__':
    unittest.main()
