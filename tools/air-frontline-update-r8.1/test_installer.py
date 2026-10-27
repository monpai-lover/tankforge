import gzip
import hashlib
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
INSTALLER = HERE / 'install.py'
SHA = lambda value: hashlib.sha256(value).hexdigest()

def elf(payload):
    data = bytearray(64)
    data[:4] = b'\x7fELF'
    data[4:7] = bytes([2, 1, 1])
    struct.pack_into('<HH', data, 16, 2, 62)
    return bytes(data) + payload

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(INSTALLER.is_file(), 'version-bound incremental installer is missing')
        spec = importlib.util.spec_from_file_location('air_update_under_test', INSTALLER)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory(prefix='tankforge-update-tests-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'live'
        self.package = Path(self.temp.name) / 'package'
        (self.root / 'client/web/dist').mkdir(parents=True)
        (self.root / 'target/release').mkdir(parents=True)
        (self.root / 'data/frontline').mkdir(parents=True)
        (self.package / 'payload').mkdir(parents=True)
        self.prefix = '<html><script type="application/json" id="tf-data">{"模型":"完整保留"}</script>\n'.encode()
        self.old_tail = b'<script>(()=>{window.version=1})();</script></html>\n'
        self.new_tail = b'<script>(()=>{window.version=2})();</script></html>\n'
        self.old_page = self.prefix + self.old_tail
        self.new_page = self.prefix + self.new_tail
        self.old_bin, self.new_bin = elf(b'old-server'), elf(b'new-server')
        self.page = self.root / 'client/web/dist/tankforge-range.html'
        self.binary = self.root / 'target/release/tg-server'
        self.page.write_bytes(self.old_page)
        Path(str(self.page)+'.gz').write_bytes(gzip.compress(self.old_page, mtime=0))
        self.binary.write_bytes(self.old_bin)
        self.map = self.root / 'data/frontline/korea.json'
        self.map.write_bytes(b'{"map":"unchanged"}\n')
        (self.package / 'payload/app.tail.html').write_bytes(self.new_tail)
        (self.package / 'payload/tg-server').write_bytes(self.new_bin)
        self.manifest = {
            'schema': 'TankForgeAirFrontlineIncrementV1',
            'baseline': {'html_sha256': SHA(self.old_page), 'html_bytes': len(self.old_page),
                         'prefix_bytes': len(self.prefix), 'prefix_sha256': SHA(self.prefix),
                         'tail_sha256': SHA(self.old_tail), 'binary_sha256': SHA(self.old_bin),
                         'data_files': {'data/frontline/korea.json': SHA(self.map.read_bytes())}},
            'candidate': {'html_sha256': SHA(self.new_page), 'html_bytes': len(self.new_page),
                          'tail_file': 'payload/app.tail.html', 'tail_sha256': SHA(self.new_tail),
                          'binary_file': 'payload/tg-server', 'binary_sha256': SHA(self.new_bin)}
        }
        self.write_manifest()

    def write_manifest(self):
        (self.package / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')

    def run_update(self, **kwargs):
        return self.module.install(self.package, self.root, **kwargs)

    def add_overlay(self, relative='data/aircraft/frontline.json', payload=b'{"weapons":"native-approved"}\n'):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        previous = b'{"weapons":"baseline"}\n'
        target.write_bytes(previous)
        payload_file = 'payload/overlay-' + str(len(self.manifest['candidate'].get('data_overlays', []))) + '.json'
        (self.package / payload_file).write_bytes(payload)
        self.manifest['baseline']['data_files'][relative] = SHA(previous)
        self.manifest['candidate'].setdefault('data_overlays', []).append({
            'path': relative, 'payload_file': payload_file, 'sha256': SHA(payload), 'bytes': len(payload),
        })
        self.write_manifest()
        return target, previous, payload

    def add_absent_overlay(self):
        relative = 'data/vehicles/ru_pantsir_sm_sv/surface_armor.json'
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = b'{"surface":"recovered-original-fixture"}\n'
        payload_file = 'payload/recovered-surface.json'
        (self.package / payload_file).write_bytes(payload)
        self.manifest['baseline']['absent_data_files'] = [relative]
        self.manifest['candidate'].setdefault('data_overlays', []).append({
            'path': relative, 'payload_file': payload_file, 'sha256': SHA(payload), 'bytes': len(payload),
        })
        self.write_manifest()
        return target, payload

    def test_absent_runtime_addition_dry_run_apply_and_rollback_restore_absence(self):
        target, payload = self.add_absent_overlay()
        before = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertTrue(self.run_update()['dry_run'])
        self.assertFalse(target.exists())
        self.assertEqual(before, {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        applied = self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), payload)
        journal = Path(applied['journal'])
        record = json.loads((journal / 'journal.json').read_text(encoding='utf-8'))
        relative = target.relative_to(self.root).as_posix()
        self.assertEqual(record['absent_data_files'], [relative])
        item = next(item for item in record['files'] if item['path'] == relative)
        self.assertFalse(item['existed'])
        self.assertNotIn('backup', item)
        self.assertNotIn('old_sha256', item)
        self.module.rollback(self.root, journal, offline=True)
        self.assertFalse(target.exists())
        self.assertTrue(target.parent.is_dir())
        self.assertEqual(before, {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file() and '.tankforge-air-' not in p.as_posix()})

    def test_absent_runtime_addition_mid_commit_failure_restores_absence_and_cohort(self):
        target, payload = self.add_absent_overlay()
        second, previous, _ = self.add_overlay()
        replace = self.module.os.replace
        failed = False
        def fail_second(source, destination):
            nonlocal failed
            if Path(destination) == second and not failed:
                failed = True
                self.assertEqual(target.read_bytes(), payload)
                raise OSError('injected after absent runtime publication')
            return replace(source, destination)
        with patch.object(self.module.os, 'replace', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'injected after absent'):
                self.run_update(apply=True, offline=True)
        self.assertFalse(target.exists())
        self.assertEqual(second.read_bytes(), previous)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_absent_runtime_addition_refuses_independent_preexisting_destination(self):
        target, _ = self.add_absent_overlay()
        independent = b'{"surface":"independent"}\n'
        target.write_bytes(independent)
        for apply in (False, True):
            with self.subTest(apply=apply), self.assertRaisesRegex(ValueError, 'absent|exist|baseline'):
                self.run_update(apply=apply, offline=True)
        self.assertEqual(target.read_bytes(), independent)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_absent_runtime_addition_rollback_refuses_independent_new_bytes(self):
        target, _ = self.add_absent_overlay()
        applied = self.run_update(apply=True, offline=True)
        independent = b'{"surface":"another-deployment"}\n'
        target.write_bytes(independent)
        with self.assertRaisesRegex(ValueError, 'independently|destination|data'):
            self.module.rollback(self.root, Path(applied['journal']), offline=True)
        self.assertEqual(target.read_bytes(), independent)
        self.assertEqual(self.binary.read_bytes(), self.new_bin)
        self.assertEqual(self.page.read_bytes(), self.new_page)

    def test_absent_runtime_addition_requires_existing_parent_directories(self):
        target, _ = self.add_absent_overlay()
        target.parent.rmdir()
        with self.assertRaisesRegex(ValueError, 'parent|director'):
            self.run_update(apply=True, offline=True)
        self.assertFalse(target.parent.exists())
        self.assertEqual(self.binary.read_bytes(), self.old_bin)

    def test_absent_runtime_whitelist_rejects_conflicts_duplicates_unsafe_and_malformed_paths(self):
        target, _ = self.add_absent_overlay()
        relative = target.relative_to(self.root).as_posix()
        invalid = [None, {}, relative, [relative, relative], ['../outside.json'],
                   ['data/../outside.json'], ['data\\outside.json'], [42],
                   ['data/frontline/korea.json']]
        for absent in invalid:
            with self.subTest(absent=absent):
                self.manifest['baseline']['absent_data_files'] = absent
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, 'absent|baseline|path|Duplicate'):
                    self.run_update(apply=True, offline=True)
        self.assertFalse(target.exists())
        self.assertEqual(self.binary.read_bytes(), self.old_bin)

    def test_absent_runtime_addition_unhealthy_service_restores_absence_before_old_restart(self):
        target, payload = self.add_absent_overlay()
        operations = []
        def service_operation(service, operation):
            operations.append(operation)
            if operations == ['stop', 'start']:
                self.assertEqual(target.read_bytes(), payload)
            if operations == ['stop', 'start', 'stop', 'start']:
                self.assertFalse(target.exists())
                self.assertEqual(self.binary.read_bytes(), self.old_bin)
        with patch.object(self.module, 'service_state', return_value=123), \
             patch.object(self.module, 'service_command', side_effect=service_operation), \
             patch.object(self.module, 'verify_started', side_effect=RuntimeError('new service unhealthy')):
            with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                self.run_update(apply=True, service='tankforge')
        self.assertEqual(operations, ['stop', 'start', 'stop', 'start'])
        self.assertFalse(target.exists())

    def runtime_builder_fixture(self):
        spec = importlib.util.spec_from_file_location('air_builder_under_test', HERE / 'build_delivery.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        relative = 'data/vehicles/ru_pantsir_sm_sv/surface_armor.json'
        self.assertEqual(set(builder.RUNTIME_ADDITIONS), {relative}, 'only the exact recovered runtime path may be added')
        source = Path(self.temp.name) / 'source'
        source_map = source / 'data/frontline/korea.json'
        source_map.parent.mkdir(parents=True)
        source_map.write_bytes(self.map.read_bytes())
        addition = source / relative
        addition.parent.mkdir(parents=True)
        (self.root / relative).parent.mkdir(parents=True)
        payload = b'{"surface":"exact-recovery-test-fixture"}\n'
        addition.write_bytes(payload)
        note_path = 'docs/provenance-recovery-20261026/pantsir-embedded-surface-recovery.json'
        note = source / note_path
        note.parent.mkdir(parents=True)
        note.write_text(json.dumps({'recoveredPath': relative, 'bytes': len(payload), 'sha256': SHA(payload)}), encoding='utf-8')
        builder.SOURCE, builder.RELEASE = source, self.root
        builder.RUNTIME_ADDITIONS = {relative: {'sha256': SHA(payload), 'bytes': len(payload), 'recovery_note': note_path}}
        return builder, addition, note

    def test_runtime_builder_adds_only_exact_absent_recovery_and_source_delta_reuses_payload(self):
        builder, addition, _ = self.runtime_builder_fixture()
        pins, overlays, backups, absent = builder.runtime_data_overlays(self.package)
        relative = addition.relative_to(builder.SOURCE).as_posix()
        self.assertEqual(absent, [relative])
        self.assertNotIn(relative, pins)
        self.assertEqual(backups, [])
        entry = next(item for item in overlays if item['path'] == relative)
        self.assertEqual((self.package / entry['payload_file']).read_bytes(), addition.read_bytes())
        intake = Path(self.temp.name) / 'intake'
        intake.mkdir()
        (intake / 'handoff-extraction.json').write_text(json.dumps({'files': [], 'archiveSha256': 'a' * 64}), encoding='utf-8')
        builder.INTAKE = intake
        (self.package / 'manifest.json').write_text(json.dumps({'candidate': {'data_overlays': overlays}}), encoding='utf-8')
        builder.source_delta(self.package)
        delta = json.loads((self.package / 'source-delta.json').read_text(encoding='utf-8'))
        record = next(item for item in delta['files'] if item['path'] == relative)
        self.assertEqual(record['content'], entry['payload_file'])
        self.assertIsNone(record['old_sha256'])
        self.assertFalse((self.package / 'source-delta' / relative).exists(), 'runtime recovery must not be duplicated in source-delta')

    def test_runtime_builder_refuses_preexisting_recovery_or_changed_exact_bytes(self):
        builder, addition, _ = self.runtime_builder_fixture()
        relative = addition.relative_to(builder.SOURCE).as_posix()
        target = builder.RELEASE / relative
        target.write_bytes(addition.read_bytes())
        with self.assertRaisesRegex((AssertionError, ValueError), 'absent|baseline|existing'):
            builder.runtime_data_overlays(self.package)
        target.unlink()
        addition.write_bytes(b'changed recovery')
        with self.assertRaisesRegex((AssertionError, ValueError), 'recovery|hash|SHA|bytes'):
            builder.runtime_data_overlays(self.package)

    def test_runtime_builder_requires_recovery_note_matching_exact_payload(self):
        builder, _, note = self.runtime_builder_fixture()
        note.unlink()
        with self.assertRaisesRegex((AssertionError, ValueError), 'recovery|note|receipt'):
            builder.runtime_data_overlays(self.package)

    def test_complete_release_copy_verifier_records_added_runtime_file_and_restored_absence(self):
        target, payload = self.add_absent_overlay()
        (self.root / 'tg-server').write_bytes(self.old_bin)
        spec = importlib.util.spec_from_file_location('air_release_verifier_under_test', HERE / 'verify_actual_release.py')
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        clone = Path(self.temp.name) / 'verified-clone'
        result = verifier.verify(self.package, self.root, clone)
        relative = target.relative_to(self.root).as_posix()
        self.assertEqual(result['runtimeDataAdditions'], [{'path': relative, 'sha256': SHA(payload)}])
        self.assertTrue(result['rollbackRestoredAddedRuntimeAbsence'])
        self.assertFalse((clone / relative).exists())
        self.assertFalse(target.exists())

    def test_archive_refuses_runtime_recovery_payload_different_from_exact_source(self):
        builder, addition, note = self.runtime_builder_fixture()
        _, overlays, _, absent = builder.runtime_data_overlays(self.package)
        self.manifest['baseline']['absent_data_files'] = absent
        self.manifest['candidate']['data_overlays'] = overlays
        entry = overlays[0]
        changed = b'{"surface":"independently-replaced"}\n'
        (self.package / entry['payload_file']).write_bytes(changed)
        entry.update(sha256=SHA(changed), bytes=len(changed))
        self.write_manifest()
        evidence = self.package / 'evidence'
        evidence.mkdir()
        (evidence / note.name).write_bytes(note.read_bytes())
        (evidence / 'validation.json').write_text(json.dumps({'manifestSha256': builder.sha(self.package / 'manifest.json')}), encoding='utf-8')
        (self.package / 'README-zh.md').write_text('固定基准与回滚。\n', encoding='utf-8')
        (self.package / 'source-delta.json').write_text(json.dumps({'files': []}), encoding='utf-8')
        destination = Path(self.temp.name) / 'refused-recovery.tar.gz'
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(AssertionError, 'recovery|payload|exact'):
            builder.archive(self.package, destination)
        self.assertFalse(destination.exists())

    def test_dry_run_validates_full_candidate_without_modifying_live_files(self):
        before = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.run_update()
        self.assertTrue(result['validated'])
        self.assertTrue(result['dry_run'])
        after = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_offline_apply_and_explicit_rollback_restore_the_whole_cohort(self):
        result = self.run_update(apply=True, offline=True)
        self.assertEqual(self.page.read_bytes(), self.new_page)
        self.assertEqual(gzip.decompress(Path(str(self.page)+'.gz').read_bytes()), self.new_page)
        self.assertEqual(self.binary.read_bytes(), self.new_bin)
        self.assertEqual(self.map.read_bytes(), b'{"map":"unchanged"}\n')
        restored = self.module.rollback(self.root, Path(result['journal']), offline=True)
        self.assertTrue(restored['restored'])
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(gzip.decompress(Path(str(self.page)+'.gz').read_bytes()), self.old_page)

    def test_modified_baseline_and_bad_payload_are_refused_without_changes(self):
        self.binary.write_bytes(elf(b'another-deployment'))
        with self.assertRaisesRegex(Exception, 'baseline|Baseline|基准'):
            self.run_update(apply=True, offline=True)
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.binary.write_bytes(self.old_bin)
        (self.package / 'payload/app.tail.html').write_bytes(b'corrupt')
        with self.assertRaises(Exception):
            self.run_update(apply=True, offline=True)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)

    def test_mid_commit_failure_rolls_back_binary_page_and_precompressed_page(self):
        original_replace = self.module.os.replace
        failed = False
        def fail_once(source, destination):
            nonlocal failed
            if Path(destination) == self.page and not failed:
                failed = True
                raise OSError('injected page publication failure')
            return original_replace(source, destination)
        with patch.object(self.module.os, 'replace', side_effect=fail_once):
            with self.assertRaisesRegex(OSError, 'injected'):
                self.run_update(apply=True, offline=True)
        self.assertTrue(failed)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(gzip.decompress(Path(str(self.page)+'.gz').read_bytes()), self.old_page)

    def test_live_apply_requires_service_coordination_or_explicit_offline(self):
        with self.assertRaisesRegex(Exception, 'service|offline|服务'):
            self.run_update(apply=True)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_traversal_payload_and_modified_map_are_rejected(self):
        self.manifest['candidate']['tail_file'] = '../payload/app.tail.html'
        self.write_manifest()
        with self.assertRaises(Exception):
            self.run_update()
        self.manifest['candidate']['tail_file'] = 'payload/app.tail.html'
        self.write_manifest()
        self.map.write_bytes(b'{"changed":true}')
        with self.assertRaisesRegex(Exception, 'data|Data|资料|数据'):
            self.run_update()

    def test_gzip_only_baseline_can_be_validated_and_rollback_keeps_it_gzip_only(self):
        self.page.unlink()
        result = self.run_update(apply=True, offline=True)
        self.assertEqual(self.page.read_bytes(), self.new_page)
        self.module.rollback(self.root, Path(result['journal']), offline=True)
        self.assertFalse(self.page.exists())
        self.assertEqual(gzip.decompress(Path(str(self.page)+'.gz').read_bytes()), self.old_page)

    def test_unhealthy_new_service_is_stopped_before_restoring_old_files(self):
        operations = []
        def service_operation(service, operation):
            operations.append(operation)
            if operations == ['stop', 'start', 'stop']:
                self.assertEqual(self.binary.read_bytes(), self.new_bin)
            if operations == ['stop', 'start', 'stop', 'start']:
                self.assertEqual(self.binary.read_bytes(), self.old_bin)
        with patch.object(self.module, 'service_state', return_value=123), \
             patch.object(self.module, 'service_command', side_effect=service_operation), \
             patch.object(self.module, 'verify_started', side_effect=RuntimeError('new service unhealthy')):
            with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                self.run_update(apply=True, service='tankforge')
        self.assertEqual(operations, ['stop', 'start', 'stop', 'start'])
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_rollback_refuses_runtime_data_changed_by_another_deployment(self):
        result = self.run_update(apply=True, offline=True)
        self.map.write_bytes(b'{"anotherDeployment":true}')
        with self.assertRaisesRegex(Exception, 'data|Data|资料|数据'):
            self.module.rollback(self.root, Path(result['journal']), offline=True)
        self.assertEqual(self.binary.read_bytes(), self.new_bin)

    def test_insufficient_staging_space_refuses_before_live_publication(self):
        with patch.object(self.module.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)):
            with self.assertRaisesRegex(Exception, 'space|Space|空间|空間'):
                self.run_update(apply=True, offline=True)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_data_overlay_apply_and_rollback_restore_the_same_complete_cohort(self):
        target, previous, candidate = self.add_overlay()
        result = self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), candidate, 'the approved overlay must publish with the new server/page')
        self.assertEqual(self.binary.read_bytes(), self.new_bin)
        self.assertEqual(self.page.read_bytes(), self.new_page)
        record = json.loads((Path(result['journal']) / 'journal.json').read_text(encoding='utf-8'))
        self.assertIn(target.relative_to(self.root).as_posix(), [item['path'] for item in record['files']])
        restored = self.module.rollback(self.root, Path(result['journal']), offline=True)
        self.assertTrue(restored['restored'], 'rollback must admit its own applied overlay hash')
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(gzip.decompress(Path(str(self.page) + '.gz').read_bytes()), self.old_page)

    def test_data_overlay_mid_commit_failure_restores_already_applied_overlay_and_app(self):
        first, first_old, _ = self.add_overlay()
        second, second_old, _ = self.add_overlay('data/aircraft/aircraft.json', b'{"damage":"new"}\n')
        replace = self.module.os.replace
        failed = False
        def fail_once(source, destination):
            nonlocal failed
            if Path(destination) == second and not failed:
                failed = True
                self.assertNotEqual(first.read_bytes(), first_old, 'failure occurs after an actual overlay commit')
                raise OSError('injected mid-overlay publication failure')
            return replace(source, destination)
        with patch.object(self.module.os, 'replace', side_effect=fail_once):
            with self.assertRaisesRegex(OSError, 'injected mid-overlay'):
                self.run_update(apply=True, offline=True)
        self.assertTrue(failed)
        self.assertEqual(first.read_bytes(), first_old)
        self.assertEqual(second.read_bytes(), second_old)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)
        self.assertEqual(gzip.decompress(Path(str(self.page) + '.gz').read_bytes()), self.old_page)
        journals = list(self.root.glob('.tankforge-air-rollback-*'))
        self.assertEqual(len(journals), 1)
        self.assertEqual(json.loads((journals[0] / 'journal.json').read_text())['state'], 'rolled_back')

    def test_data_overlay_without_a_required_baseline_pin_is_refused_before_publication(self):
        target, previous, _ = self.add_overlay()
        del self.manifest['baseline']['data_files'][target.relative_to(self.root).as_posix()]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'baseline|pinned|overlay'):
            self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_data_overlay_corrupt_payload_or_byte_count_is_refused_without_changes(self):
        target, previous, _ = self.add_overlay()
        entry = self.manifest['candidate']['data_overlays'][0]
        payload = self.package / entry['payload_file']
        valid = payload.read_bytes()
        payload.write_bytes(b'corrupt overlay')
        with self.assertRaisesRegex(ValueError, 'payload|overlay|hash'):
            self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        payload.write_bytes(valid)
        entry['bytes'] += 1
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'bytes|size|overlay'):
            self.run_update()
        self.assertEqual(target.read_bytes(), previous)

    def test_data_overlay_paths_and_payload_paths_are_checked_before_apply(self):
        target, previous, _ = self.add_overlay()
        entry = self.manifest['candidate']['data_overlays'][0]
        safe_payload = entry['payload_file']
        entry['payload_file'] = '../outside.json'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'path|payload|overlay'):
            self.run_update()
        entry['payload_file'] = safe_payload
        entry['path'] = '../outside.json'
        self.manifest['baseline']['data_files']['../outside.json'] = SHA(previous)
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'path|overlay'):
            self.run_update()
        self.assertEqual(target.read_bytes(), previous)

    def test_data_overlay_duplicate_destinations_are_refused_before_publication(self):
        target, previous, _ = self.add_overlay()
        entry = self.manifest['candidate']['data_overlays'][0]
        self.manifest['candidate']['data_overlays'].append(dict(entry))
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'duplicate|Duplicate|overlay'):
            self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)

    def test_data_overlay_rollback_rejects_independent_change_without_overwriting_other_files(self):
        target, _, candidate = self.add_overlay()
        result = self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), candidate)
        independent = b'{"weapons":"another-deployment"}\n'
        target.write_bytes(independent)
        with self.assertRaisesRegex(ValueError, 'independently|data|destination'):
            self.module.rollback(self.root, Path(result['journal']), offline=True)
        self.assertEqual(target.read_bytes(), independent)
        self.assertEqual(self.binary.read_bytes(), self.new_bin)
        self.assertEqual(self.page.read_bytes(), self.new_page)

    def test_data_overlay_dry_run_validates_but_preserves_every_live_file(self):
        target, previous, _ = self.add_overlay()
        before = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.run_update()
        self.assertTrue(result['dry_run'])
        self.assertEqual(target.read_bytes(), previous)
        after = {p.relative_to(self.root).as_posix(): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(after, before)

    def test_data_overlay_unhealthy_service_restores_data_before_restarting_old_server(self):
        target, previous, candidate = self.add_overlay()
        operations = []
        def service_operation(service, operation):
            operations.append(operation)
            if operations == ['stop', 'start']:
                self.assertEqual(target.read_bytes(), candidate)
                self.assertEqual(self.binary.read_bytes(), self.new_bin)
            if operations == ['stop', 'start', 'stop', 'start']:
                self.assertEqual(target.read_bytes(), previous)
                self.assertEqual(self.binary.read_bytes(), self.old_bin)
        with patch.object(self.module, 'service_state', return_value=123), \
             patch.object(self.module, 'service_command', side_effect=service_operation), \
             patch.object(self.module, 'verify_started', side_effect=RuntimeError('new service unhealthy')):
            with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                self.run_update(apply=True, service='tankforge')
        self.assertEqual(operations, ['stop', 'start', 'stop', 'start'])
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_data_overlay_cannot_publish_over_the_binary_or_page_cohort(self):
        payload = b'{"not":"a server binary"}'
        payload_file = 'payload/overlay-collision.json'
        (self.package / payload_file).write_bytes(payload)
        path = self.binary.relative_to(self.root).as_posix()
        self.manifest['baseline']['data_files'][path] = SHA(self.old_bin)
        self.manifest['candidate']['data_overlays'] = [{
            'path': path, 'payload_file': payload_file, 'sha256': SHA(payload), 'bytes': len(payload),
        }]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'collid|cohort|overlay'):
            self.run_update(apply=True, offline=True)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def test_data_overlay_missing_live_baseline_and_malformed_records_are_refused(self):
        target, previous, _ = self.add_overlay()
        target.unlink()
        with self.assertRaisesRegex(ValueError, 'Required file missing'):
            self.run_update(apply=True, offline=True)
        target.write_bytes(previous)
        good = dict(self.manifest['candidate']['data_overlays'][0])
        invalid = [None, {}, {'bad':'record'}, [dict(good, bytes=True)],
                   [dict(good, bytes=-1)], [dict(good, sha256='invalid')], [dict(good, mass=0)]]
        for overlays in invalid:
            with self.subTest(overlays=overlays):
                self.manifest['candidate']['data_overlays'] = overlays
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, 'overlay|baseline'):
                    self.run_update(apply=True, offline=True)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(target.read_bytes(), previous)

    def test_data_overlay_payload_changed_during_staging_is_refused_before_publication(self):
        target, previous, _ = self.add_overlay()
        entry = self.manifest['candidate']['data_overlays'][0]
        payload = self.package / entry['payload_file']
        copy = self.module.shutil.copy2
        def corrupt_staged_overlay(source, destination, *args, **kwargs):
            result = copy(source, destination, *args, **kwargs)
            if Path(source) == payload:
                Path(destination).write_bytes(b'changed while staging')
            return result
        with patch.object(self.module.shutil, 'copy2', side_effect=corrupt_staged_overlay):
            with self.assertRaisesRegex(ValueError, 'overlay.*staging'):
                self.run_update(apply=True, offline=True)
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(self.binary.read_bytes(), self.old_bin)
        self.assertEqual(self.page.read_bytes(), self.old_page)

    def assert_rollback_cli_conflict(self, conflict):
        target, _, candidate = self.add_overlay()
        applied = self.run_update(apply=True, offline=True)
        journal = Path(applied['journal'])
        result = subprocess.run([
            sys.executable, str(INSTALLER), '--root', str(self.root),
            '--rollback', str(journal), conflict, '--offline',
        ], capture_output=True, text=True, timeout=20)
        self.assertNotEqual(result.returncode, 0, 'ambiguous rollback flags must fail before mutating live files')
        self.assertIn('rollback', result.stderr)
        self.assertIn(conflict, result.stderr)
        self.assertEqual(self.binary.read_bytes(), self.new_bin)
        self.assertEqual(self.page.read_bytes(), self.new_page)
        self.assertEqual(gzip.decompress(Path(str(self.page) + '.gz').read_bytes()), self.new_page)
        self.assertEqual(target.read_bytes(), candidate)
        record = json.loads((journal / 'journal.json').read_text(encoding='utf-8'))
        self.assertEqual(record['state'], 'committed')

    def test_cli_rollback_with_dry_run_is_refused_without_restoring_candidate_files(self):
        self.assert_rollback_cli_conflict('--dry-run')

    def test_cli_rollback_with_apply_is_refused_without_restoring_candidate_files(self):
        self.assert_rollback_cli_conflict('--apply')

if __name__ == '__main__':
    unittest.main(verbosity=2)
