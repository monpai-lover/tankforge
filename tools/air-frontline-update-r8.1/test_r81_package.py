"""R8.1 packaging and exact R8 cohort checks; no final release is prepared."""
import copy
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_delivery as builder
import test_installer
import finalize_delivery_r8 as finalizer

R8_PIN = '42d5d7461ea8d794a64d427b004014c71de05497e6a3ce9d17f3999b24ed3fa3'
R8_PACKAGE = Path('D:/TankForge-validation/delivery-r8-verified-20261027/tankforge-airwar-r8-linux-amd64-20261027')
R8_TOOLS = Path('D:/TankForge-workspaces/r8-20261027/worktree/tools/air-frontline-update-r8')
HERE = Path(__file__).resolve().parent
SHA = lambda data: hashlib.sha256(data).hexdigest()


class R81SourceDeltaTests(unittest.TestCase):
    ARMOR_PATHS = (
        'data/vehicles/de_pz4_h/armor.json',
        'data/vehicles/de_panther_g/armor.json',
        'data/vehicles/de_panther_f/armor.json',
    )

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tankforge-r81-source-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.release = self.root / 'release'
        self.intake = self.root / 'intake'
        self.destination = self.root / 'destination'

    def write(self, root, name, data):
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        return file

    def test_source_discovery_includes_all_barrel_content_and_excludes_generated_folders(self):
        included = {
            'data/barrel-shapes/index.json',
            'data/barrel-shapes/records/trusted-record.json',
            'data/barrel-shapes/geometry/content-addressed.bin',
            'data/barrel-shapes/geometry/nested/opaque.raw',
        }
        excluded = {
            'data/barrel-shapes/__pycache__/generated.json',
            'data/barrel-shapes/out/generated.bin',
            'data/vehicles/unrelated/new.json',
        }
        for name in included | excluded:
            self.write(self.source, name, b'fixture')
        actual = {file.relative_to(self.source).as_posix()
                  for file in builder.source_candidates({}, root=self.source)}
        self.assertEqual(actual, included)

    def test_delta_includes_new_barrel_content_and_reuses_exact_runtime_armor_payloads(self):
        originals = []
        for name in self.ARMOR_PATHS:
            old = b'{"armor_mm":[80]}\n'
            self.write(self.release, name, old)
            self.write(self.source, name, b'{"armor_mm":[80,5]}\n')
            originals.append({'archivePath': 'TankForge/source-baseline/' + name,
                              'sha256': SHA(old)})
        unchanged = 'data/barrel-shapes/geometry/unchanged.bin'
        geometry = b'unchanged original geometry'
        self.write(self.source, unchanged, geometry)
        originals.append({'archivePath': 'TankForge/source-baseline/' + unchanged,
                          'sha256': SHA(geometry)})
        new_barrels = {
            'data/barrel-shapes/index.json': b'{"records":["trusted-record"]}\n',
            'data/barrel-shapes/records/trusted-record.json': b'{"trusted":true}\n',
            'data/barrel-shapes/geometry/content-addressed.bin': b'new binary geometry',
            'data/barrel-shapes/geometry/nested/opaque.raw': b'new opaque geometry',
        }
        for name, data in new_barrels.items():
            self.write(self.source, name, data)
        builder.write_json(self.intake / 'handoff-extraction.json', {
            'archiveSha256': 'f' * 64, 'files': originals})
        with patch.multiple(builder, SOURCE=self.source, RELEASE=self.release,
                            INTAKE=self.intake, RUNTIME_ADDITIONS={}):
            _, overlays, _, absent = builder.runtime_data_overlays(self.destination)
            builder.write_json(self.destination / 'manifest.json', {
                'candidate': {'data_overlays': overlays}})
            builder.source_delta(self.destination)
        self.assertEqual(absent, [])
        self.assertEqual({entry['path'] for entry in overlays}, set(self.ARMOR_PATHS))
        delta = json.loads((self.destination / 'source-delta.json').read_text(encoding='utf-8'))
        changes = {entry['path']: entry for entry in delta['files']}
        self.assertEqual(set(changes), set(self.ARMOR_PATHS) | set(new_barrels))
        self.assertNotIn(unchanged, changes)
        self.assertFalse((self.destination / 'source-delta' / unchanged).exists())
        for name, data in new_barrels.items():
            self.assertEqual(changes[name]['content'], 'source-delta/' + name)
            self.assertEqual(changes[name]['sha256'], SHA(data))
            self.assertEqual((self.destination / changes[name]['content']).read_bytes(), data)
        for name in self.ARMOR_PATHS:
            self.assertEqual(changes[name]['content'], 'payload/' + name)
            self.assertEqual(changes[name]['sha256'], SHA((self.source / name).read_bytes()))
            self.assertEqual((self.destination / changes[name]['content']).read_bytes(),
                             (self.source / name).read_bytes())
            self.assertFalse((self.destination / 'source-delta' / name).exists())

    def test_unrelated_vehicle_armor_changes_remain_refused(self):
        name = 'data/vehicles/unrelated/armor.json'
        self.write(self.release, name, b'{"armor_mm":[20]}\n')
        self.write(self.source, name, b'{"armor_mm":[999]}\n')
        with patch.multiple(builder, SOURCE=self.source, RELEASE=self.release,
                            RUNTIME_ADDITIONS={}):
            with self.assertRaisesRegex(AssertionError, 'Unexpected runtime data change'):
                builder.runtime_data_overlays(self.destination)
        self.assertFalse(self.destination.exists())


class R81PackageTests(unittest.TestCase):
    def test_candidate_name_and_source_are_distinct_from_preserved_r8(self):
        self.assertEqual(builder.NAME, 'tankforge-penetration-r8.1-linux-amd64-20261027')
        self.assertEqual(builder.SOURCE, Path('D:/TankForge-workspaces/r8.1-penetration-20261027/online-source'))

    def test_original_r6_r7_and_verified_r8_pins_are_retained(self):
        self.assertEqual(builder.ALTERNATE_MANIFEST_PINS, {
            'r6': 'e7988f2fac6fe99550431785cf973dbae6af4fb2cafae76d923105183c1f6b93',
            'r7': '662114bf8a950a4b469f893880b9e3b8f67d7eccc9c70e875c17a04fa77bba7a',
            'r8': R8_PIN,
        })

    def test_actual_verified_r8_package_is_accepted_without_an_explicit_pin_bypass(self):
        self.assertEqual(builder.sha(R8_PACKAGE / 'manifest.json'), R8_PIN)
        actual = builder.alternate_from_package(R8_PACKAGE)
        self.assertEqual(actual['id'], 'tankforge-airwar-r8-linux-amd64-20261027')
        self.assertEqual(actual['source_manifest_sha256'], R8_PIN)
        self.assertEqual(actual['baseline']['tail_sha256'], builder.sha(R8_PACKAGE / 'payload/app.tail.html'))
        self.assertEqual(actual['baseline']['binary_sha256'], builder.sha(R8_PACKAGE / 'payload/tg-server'))

    def test_r8_alternate_requires_its_own_exact_install_role(self):
        self.assertEqual(finalizer.required_install_roles({'alternate_baselines': [
            {'id': 'tankforge-airwar-r8-linux-amd64-20261027', 'source_manifest_sha256': R8_PIN},
        ]}), {'install-primary': 'primary', 'install-r8': 'tankforge-airwar-r8-linux-amd64-20261027'})

    def test_installer_and_offline_verifier_are_byte_identical_to_r8(self):
        for name in ('install.py', 'verify_actual_release.py'):
            self.assertEqual((HERE / name).read_bytes(), (R8_TOOLS / name).read_bytes(), name)

    def test_focused_r81_test_is_bound_into_prepared_tool_manifest(self):
        self.assertIn('test_r81_package.py', builder.TOOL_NAMES)

    def test_run_template_and_schema_bind_the_r81_name(self):
        example = json.loads((HERE / 'R8-RUNS.example.json').read_text(encoding='utf-8'))
        schema = json.loads((HERE / 'R8-RUNS.schema.json').read_text(encoding='utf-8'))
        self.assertEqual(example['version'], builder.NAME)
        self.assertEqual(schema['properties']['version']['const'], builder.NAME)

    def test_duplicate_r8_alternate_is_rejected_before_creating_output(self):
        row = {'id': 'r8-fixture', 'source_manifest_sha256': R8_PIN}
        with patch.object(builder, 'alternate_from_package', return_value=row):
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                builder.alternate_packages(['one', 'two'])

    def test_r8_whole_cohort_can_apply_and_rollback_its_own_bytes(self):
        fixture = test_installer.InstallerTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        target, old_data, new_data = fixture.add_overlay()
        alt = copy.deepcopy(fixture.manifest['baseline'])
        page = fixture.prefix + b'<script>r8-fixture</script></html>'
        binary = test_installer.elf(b'r8-binary')
        r8_data = b'{"r8-data":true}\n'
        alt.update(html_sha256=SHA(page), html_bytes=len(page),
                   tail_sha256=SHA(page[len(fixture.prefix):]), binary_sha256=SHA(binary))
        alt['data_files'][target.relative_to(fixture.root).as_posix()] = SHA(r8_data)
        fixture.manifest['alternate_baselines'] = [{'id': 'r8-fixture',
            'source_manifest_sha256': R8_PIN, 'baseline': alt}]
        fixture.write_manifest()
        fixture.page.write_bytes(page)
        Path(str(fixture.page) + '.gz').write_bytes(gzip.compress(page, mtime=0))
        fixture.binary.write_bytes(binary)
        target.write_bytes(r8_data)
        result = fixture.run_update(apply=True, offline=True)
        self.assertEqual(result['selected_baseline'], 'r8-fixture')
        self.assertEqual(fixture.page.read_bytes(), fixture.new_page)
        self.assertEqual(target.read_bytes(), new_data)
        fixture.module.rollback(fixture.root, Path(result['journal']), offline=True)
        self.assertEqual(fixture.page.read_bytes(), page)
        self.assertEqual(fixture.binary.read_bytes(), binary)
        self.assertEqual(target.read_bytes(), r8_data)

    def test_mixed_r8_page_binary_and_old_data_are_refused_without_mutation(self):
        fixture = test_installer.InstallerTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        target, old_data, _ = fixture.add_overlay()
        alt = copy.deepcopy(fixture.manifest['baseline'])
        page = fixture.prefix + b'<script>r8-fixture</script></html>'
        binary = test_installer.elf(b'r8-binary')
        alt.update(html_sha256=SHA(page), html_bytes=len(page),
                   tail_sha256=SHA(page[len(fixture.prefix):]), binary_sha256=SHA(binary))
        alt['data_files'][target.relative_to(fixture.root).as_posix()] = SHA(b'{"r8-data":true}\n')
        fixture.manifest['alternate_baselines'] = [{'id': 'r8-fixture',
            'source_manifest_sha256': R8_PIN, 'baseline': alt}]
        fixture.write_manifest()
        fixture.page.write_bytes(page)
        fixture.binary.write_bytes(binary)
        before = {p.relative_to(fixture.root).as_posix(): p.read_bytes()
                  for p in fixture.root.rglob('*') if p.is_file()}
        with self.assertRaisesRegex(ValueError, 'baseline|cohort|Runtime'):
            fixture.run_update(apply=True, offline=True)
        after = {p.relative_to(fixture.root).as_posix(): p.read_bytes()
                 for p in fixture.root.rglob('*') if p.is_file()}
        self.assertEqual(after, before)
        self.assertEqual(target.read_bytes(), old_data)


if __name__ == '__main__':
    unittest.main(verbosity=2)
