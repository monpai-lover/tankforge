import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
import gen_vehicles as gen
import wt_import as wt


class LauncherSourcesTest(unittest.TestCase):
    def test_guided_source_definitions_do_not_regenerate_cannon_parts(self):
        for s in (gen.m113_tow(), gen.bmp_k64('atgm'), gen.bmp_k64('kit')):
            with self.subTest(vehicle=s['id']):
                self.assertTrue(any(m['kind'] == 'launcher' for m in s['modules']))
                self.assertFalse(any(m['kind'] in ('gun_breech', 'gun_barrel') for m in s['modules']))
                self.assertEqual({m.get('weapon_group') for m in s['modules'] if m['kind'] == 'launcher'}, {'main_launcher'})
        self.assertTrue(any(m['kind'] == 'gun_breech' for m in gen.bmp_k64('base')['modules']))

    def test_mixed_source_import_preserves_cannons_and_measures_two_rocket_apparatus(self):
        source = json.loads((ROOT / 'data/vehicles/su_bmpt34/weapons.json').read_text())
        guns = [{'gun': source['main_gun'], 'mount_m': source['mount_m'], 'muzzle_offset_m': source['muzzle_offset_m']}, *source['extra_guns']]
        modules = json.loads((ROOT / 'data/vehicles/su_bmpt34/modules.json').read_text())
        before = copy.deepcopy(modules)
        self.assertTrue(callable(getattr(wt, 'launcher_modules', None)), 'source importer must preserve launcher damage anatomy')
        generated = wt.launcher_modules(guns)
        self.assertEqual(len(generated), 2)
        self.assertTrue(all(m['kind'] == 'launcher' for m in generated))
        self.assertEqual(len({m.get('weapon_group') for m in generated}), 2, 'groups identify actual mounted instances')
        self.assertEqual(modules, before, 'launcher synthesis cannot rewrite source cannon modules')
        self.assertEqual(sorted(generated, key=lambda m: m['id']), sorted([m for m in modules if m['kind'] == 'launcher'], key=lambda m: m['id']))


if __name__ == '__main__':
    unittest.main()
