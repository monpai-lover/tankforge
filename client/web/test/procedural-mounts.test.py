"""Mount repairs are reproducible, bounded and retain weapon/armor contracts."""
import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
try:
    from procedural_mounts import apply_flak38_mount, apply_m901_mount
except ModuleNotFoundError:
    apply_flak38_mount = apply_m901_mount = None


class MountTest(unittest.TestCase):
    def test_flak_length_and_mount_contracts_are_preserved(self):
        import gen_vehicles
        for builder in [gen_vehicles.flak38t, gen_vehicles.hetzer_flak, gen_vehicles.rso_flak]:
            source = builder()
            with self.subTest(vehicle=source['id']):
                self.assertIsNotNone(apply_flak38_mount)
                before = copy.deepcopy(source)
                result = apply_flak38_mount(source)
                self.assertIs(result, source)
                for key in before.keys() - {'parts', 'modules'}:
                    self.assertEqual(result[key], before[key], key)
                receiver = next(p for p in result['parts'] if p.get('name') == 'flak38_receiver')
                rear = receiver['pos'][2] - receiver['size'][2] / 2
                self.assertAlmostEqual(result['mount'][2] + result['muzzle_offset'] - rear, 2.25)
                breech = next(m for m in result['modules'] if m['kind'] == 'gun_breech')
                self.assertEqual(list(breech['center'].values()), receiver['pos'])
                self.assertEqual(list(breech['half_extents'].values()), [.07, .08, .30])
                first = copy.deepcopy(result)
                self.assertEqual(apply_flak38_mount(result), first, 'reapplying cannot duplicate support hardware')
                visual = json.loads((ROOT / 'data/vehicles' / source['id'] / 'visual.json').read_text(encoding='utf8'))
                from procedural_refinements import refine_procedural_spec
                self.assertEqual(refine_procedural_spec(copy.deepcopy(result))['parts'], visual['parts'])

    def test_m901_keeps_head_weapon_armor_and_paired_running_gear(self):
        import gen_vehicles
        from procedural_running_gear import apply_m113_running_gear
        self.assertIsNotNone(apply_m901_mount)
        source = apply_m113_running_gear(gen_vehicles.m113_tow())
        before = copy.deepcopy(source)
        result = apply_m901_mount(source)
        self.assertIs(result, source)
        for key in before.keys() - {'parts'}:
            self.assertEqual(result[key], before[key], key)
        self.assertEqual(result['parts'][20:25], before['parts'][20:25], 'hammerhead and tube envelopes are retained')
        self.assertEqual(result['parts'][27:29], before['parts'][27:29], 'rear tube envelopes are retained')
        first = copy.deepcopy(result)
        self.assertEqual(apply_m901_mount(result), first, 'reapplying cannot duplicate the fork or pins')
        visual = json.loads((ROOT / 'data/vehicles/us_m901_itv/visual.json').read_text(encoding='utf8'))
        self.assertEqual(result['parts'], visual['parts'])


if __name__ == '__main__':
    unittest.main()
