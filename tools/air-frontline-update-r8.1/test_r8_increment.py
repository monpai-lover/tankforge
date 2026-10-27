"""Synthetic R8 utility checks. These do not prepare or validate a real release."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
import build_delivery as builder

HERE=Path(__file__).resolve().parent
OLD=Path('C:/Users/24908/.codex/scratch/tankforge-airwar-online-20261025/worktree/tools/air-frontline-update-r7')

class R8IncrementTests(unittest.TestCase):
    def test_unique_r8_name_current_source_and_original_intake(self):
        self.assertEqual(builder.NAME,'tankforge-penetration-r8.1-linux-amd64-20261027')
        self.assertEqual(builder.SOURCE,Path('D:/TankForge-workspaces/r8.1-penetration-20261027/online-source'))
        self.assertEqual(builder.INTAKE,OLD.parents[2]/'intake')

    def test_both_baseline_manifest_pins_are_immutable(self):
        pins=getattr(builder,'ALTERNATE_MANIFEST_PINS',{})
        self.assertEqual(pins.get('r6'),'e7988f2fac6fe99550431785cf973dbae6af4fb2cafae76d923105183c1f6b93')
        self.assertEqual(pins.get('r7'),'662114bf8a950a4b469f893880b9e3b8f67d7eccc9c70e875c17a04fa77bba7a')

    def test_safe_installer_and_offline_verifier_are_reused_byte_identically(self):
        expected={'install.py':'7bc9271063a22d174e22fa70c4c8fe6febc3b74509bcdd1b0d6379b6a79f7b94',
                  'verify_actual_release.py':'f82051349074b84c5e247f623ef70072ed7fcf4fb8865a372abfe45f2a1a37d8'}
        for name,pin in expected.items():
            self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(),pin,name)

    def test_each_included_alternate_requires_its_own_exact_install_receipt(self):
        spec=importlib.util.spec_from_file_location('r8_increment_finalizer',HERE/'finalize_delivery_r8.py')
        finalizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(finalizer)
        role_fn=getattr(finalizer,'required_install_roles',None)
        self.assertTrue(callable(role_fn),'R8 finalizer needs explicit cohort-to-install-role mapping')
        manifest={'alternate_baselines':[
            {'id':'original-r6','source_manifest_sha256':'e7988f2fac6fe99550431785cf973dbae6af4fb2cafae76d923105183c1f6b93'},
            {'id':'original-r7','source_manifest_sha256':'662114bf8a950a4b469f893880b9e3b8f67d7eccc9c70e875c17a04fa77bba7a'},
        ]}
        self.assertEqual(role_fn(manifest),{'install-primary':'primary','install-r6':'original-r6','install-r7':'original-r7'})
        manifest['alternate_baselines'][1]['source_manifest_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'pin|baseline|cohort'):role_fn(manifest)

    def test_run_schema_and_template_are_r8_only_examples(self):
        import json
        example=HERE/'R8-RUNS.example.json';schema=HERE/'R8-RUNS.schema.json'
        self.assertTrue(example.is_file() and schema.is_file(),'R8 evidence index template and schema are required')
        value=json.loads(example.read_text(encoding='utf-8'))
        self.assertEqual(value['schema'],'TankForgeR8RunSetV1')
        self.assertEqual(value['version'],'tankforge-penetration-r8.1-linux-amd64-20261027')
        self.assertIn('install-r7',{r['name'] for r in value['runs']})
        self.assertEqual(json.loads(schema.read_text(encoding='utf-8'))['properties']['schema']['const'],'TankForgeR8RunSetV1')

    def test_unpinned_manifest_is_rejected_even_with_a_previous_release_name(self):
        import test_installer
        fixture=test_installer.InstallerTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        fixture.manifest['version']='tankforge-airwar-models-guided-linux-amd64-20261026-r7';fixture.write_manifest()
        with self.assertRaisesRegex(ValueError,'immutable|pin'):builder.alternate_from_package(fixture.package)

    def test_duplicate_alternate_pin_is_rejected_before_candidate_creation(self):
        from unittest.mock import patch
        row={'id':'previous-r7','source_manifest_sha256':builder.R7_MANIFEST_PIN}
        with patch.object(builder,'alternate_from_package',return_value=row):
            with self.assertRaisesRegex(ValueError,'Duplicate'):builder.alternate_packages(['first','again'])

if __name__=='__main__':unittest.main(verbosity=2)
