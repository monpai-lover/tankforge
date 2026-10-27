"""Regression coverage for executable evidence and a manifest-bound delivery."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

import build_delivery as builder
import test_installer as fixtures


def static_elf(extra_kind=None):
    """A small ELF64 executable with a real executable PT_LOAD and entry."""
    base = 0x400000
    count = 1 + (extra_kind is not None)
    code_offset = 64 + 56 * count
    code = b'\x90\xc3'
    header = bytearray(64)
    header[:7] = b'\x7fELF\x02\x01\x01'
    struct.pack_into('<HHIQQQ', header, 16, 2, 62, 1, base + code_offset, 64, 0)
    struct.pack_into('<HHHHHH', header, 52, 64, 56, count, 0, 0, 0)
    load = struct.pack('<IIQQQQQQ', 1, 5, code_offset, base + code_offset,
                       base + code_offset, len(code), len(code), 0x1000)
    if extra_kind is None:
        return bytes(header) + load + code
    data = b'/lib/ld-musl-x86_64.so.1\0' if extra_kind == 3 else struct.pack('<qQqQ', 1, 1, 0, 0)
    offset = code_offset + len(code)
    extra = struct.pack('<IIQQQQQQ', extra_kind, 4, offset, base + offset,
                        base + offset, len(data), len(data), 1)
    return bytes(header) + load + extra + code + data


class ElfEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tankforge-elf-test-')
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'tg-server'

    def report(self, data):
        self.file.write_bytes(data)
        return builder.elf_report(self.file)

    def test_valid_static_executable_has_structural_evidence_without_execution_claim(self):
        data = static_elf()
        report = self.report(data)
        self.assertEqual(report['class'], 'ELF64')
        self.assertEqual(report['machine'], 'AMD64')
        self.assertEqual(report['declaredBuildTarget'], 'x86_64-unknown-linux-musl')
        self.assertFalse(report['ptInterp'])
        self.assertEqual(report['dtNeeded'], [])
        self.assertTrue(report['linuxExecution'].startswith('NOT RUN:'))
        self.assertEqual(report['bytes'], len(data))
        self.assertEqual(report['sha256'], hashlib.sha256(data).hexdigest())

    def test_tiny_relocatable_object_and_truncated_header_are_rejected(self):
        header = bytearray(static_elf()[:64])
        struct.pack_into('<H', header, 16, 1)
        struct.pack_into('<H', header, 56, 0)
        with self.assertRaisesRegex(AssertionError, 'not an executable'):
            self.report(bytes(header))
        with self.assertRaisesRegex(AssertionError, 'Truncated ELF header'):
            self.report(bytes(header[:63]))

    def test_truncated_program_table_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'Truncated ELF program table'):
            self.report(static_elf()[:119])

    def test_entry_must_point_inside_file_backed_executable_load_segment(self):
        data = bytearray(static_elf())
        struct.pack_into('<Q', data, 24, 0x500000)
        with self.assertRaisesRegex(AssertionError, 'entry point'):
            self.report(bytes(data))
        data = bytearray(static_elf())
        struct.pack_into('<I', data, 68, 4)
        with self.assertRaisesRegex(AssertionError, 'entry point'):
            self.report(bytes(data))

    def test_an_elf_without_a_load_segment_is_rejected(self):
        data = bytearray(static_elf())
        struct.pack_into('<I', data, 64, 4)
        with self.assertRaisesRegex(AssertionError, 'load segment'):
            self.report(bytes(data))

    def test_truncated_file_backed_segment_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'Truncated ELF segment'):
            self.report(static_elf()[:-1])

    def test_external_linux_loader_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'external Linux loader'):
            self.report(static_elf(extra_kind=3))

    def test_dynamic_shared_library_requirement_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'shared library'):
            self.report(static_elf(extra_kind=2))


class ArchiveBindingTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.InstallerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.folder = self.fixture.package
        self.destination = self.folder.parent / 'delivery.tar.gz'
        self.fixture.new_bin = static_elf()
        (self.folder / 'payload/tg-server').write_bytes(self.fixture.new_bin)
        self.fixture.manifest['candidate']['binary_sha256'] = fixtures.SHA(self.fixture.new_bin)
        self.fixture.add_overlay()
        self.fixture.manifest['version'] = builder.NAME
        self.fixture.write_manifest()
        source = self.folder / 'source-delta/crates/server/src/mode.rs'
        source.parent.mkdir(parents=True)
        source.write_bytes(b'// accepted source delta\n')
        self.source = source
        builder.write_json(self.folder / 'source-delta.json', {'files': [{
            'path': 'crates/server/src/mode.rs', 'old_sha256': None,
            'content': 'source-delta/crates/server/src/mode.rs',
            'sha256': builder.sha(source), 'bytes': source.stat().st_size,
        }]})
        (self.folder / 'README-zh.md').write_text('使用固定基准更新及回滚。\n', encoding='utf-8')
        self.validation = self.folder / 'evidence/validation.json'
        builder.write_json(self.validation, {'schema': 'TankForgeAirwarR8ValidationV1', 'version': builder.NAME,
            'result': 'PASS_WITH_EXPLICIT_UNVERIFIED_SCOPES', 'manifestSha256': builder.sha(self.folder / 'manifest.json'),
            'sourceDeltaSha256': builder.sha(self.folder / 'source-delta.json'), 'candidate': self.fixture.manifest['candidate']})

    def archive(self):
        with contextlib.redirect_stdout(io.StringIO()):
            builder.archive(self.folder, self.destination)

    def assert_unpublished(self):
        self.assertFalse(self.destination.exists())
        self.assertFalse(self.destination.with_name(self.destination.name + '.receipt.json').exists())
        self.assertFalse((self.folder / 'FILES.json').exists())

    def test_valid_increment_archives_all_members_and_binds_each_hash_and_mode(self):
        self.archive()
        receipt = json.loads(self.destination.with_name(self.destination.name + '.receipt.json').read_text())
        self.assertEqual(receipt['result'], 'PASS')
        self.assertEqual(receipt['sha256'], builder.sha(self.destination))
        with tarfile.open(self.destination, 'r:gz') as archive:
            members = archive.getmembers()
            names = [member.name for member in members]
            self.assertEqual(len(names), len(set(names)), 'no ambiguous duplicate archive members')
            records = json.load(archive.extractfile(builder.NAME + '/FILES.json'))
            self.assertEqual(len(members), len(records) + 1)
            self.assertEqual(receipt['membersRehashed'], len(members))
            for member in members:
                self.assertTrue(member.isfile())
                self.assertTrue(member.name.startswith(builder.NAME + '/'))
                name = member.name[len(builder.NAME) + 1:]
                if name == 'FILES.json':
                    continue
                content = archive.extractfile(member).read()
                self.assertEqual(hashlib.sha256(content).hexdigest(), records[name]['sha256'])
                self.assertEqual(len(content), records[name]['bytes'])
                self.assertEqual(member.mode, 0o755 if name == 'payload/tg-server' else 0o644)

    def test_changed_candidate_binary_app_or_overlay_is_refused_before_publishing(self):
        overlay = self.fixture.manifest['candidate']['data_overlays'][0]['payload_file']
        for name in ('payload/tg-server', 'payload/app.tail.html', overlay):
            with self.subTest(payload=name):
                payload = self.folder / name
                previous = payload.read_bytes()
                payload.write_bytes(previous + b'changed after validation')
                with self.assertRaisesRegex(ValueError, 'payload|overlay|hash'):
                    self.archive()
                self.assert_unpublished()
                payload.write_bytes(previous)

    def test_changed_source_delta_bytes_are_refused_before_publishing(self):
        self.source.write_bytes(b'// independently changed after validation\n')
        with self.assertRaisesRegex(AssertionError, 'Source delta changed'):
            self.archive()
        self.assert_unpublished()

    def test_manifest_must_match_the_manifest_that_was_validated(self):
        builder.write_json(self.validation, {'manifestSha256': '0' * 64})
        with self.assertRaisesRegex(AssertionError, 'Validated manifest changed'):
            self.archive()
        self.assert_unpublished()

    def test_old_r6_validation_cannot_authorize_a_new_r8_archive(self):
        value = json.loads(self.validation.read_text())
        value['schema'] = 'TankForgeAirFrontlineValidationV1'
        builder.write_json(self.validation, value)
        with self.assertRaisesRegex(AssertionError, 'R8|validation|schema'):
            self.archive()
        self.assert_unpublished()


if __name__ == '__main__':
    unittest.main(verbosity=2)
