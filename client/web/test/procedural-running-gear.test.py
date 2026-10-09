"""Bounded running-gear regeneration preserves station and vehicle contracts."""
import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
try:
    from procedural_running_gear import apply_hvss_running_gear, apply_m113_running_gear
except ModuleNotFoundError:
    apply_hvss_running_gear = apply_m113_running_gear = None


class RunningGearTest(unittest.TestCase):
    def test_real_source_builders_recreate_only_the_running_gear_repairs(self):
        import gen_vehicles
        from procedural_refinements import refine_procedural_spec
        for vehicle_id, builder, apply in [
            ('us_m4a3_76w_hvss', gen_vehicles.sherman, apply_hvss_running_gear),
            ('us_m901_itv', gen_vehicles.m113_tow, apply_m113_running_gear),
        ]:
            with self.subTest(vehicle_id=vehicle_id):
                self.assertIsNotNone(apply)
                visual = json.loads((ROOT / 'data/vehicles' / vehicle_id / 'visual.json').read_text(encoding='utf8'))
                source = refine_procedural_spec(apply(builder()))
                self.assertEqual(source['running_gear'], visual['running_gear'])
                self.assertEqual(source['parts'], visual['parts'])

    def test_source_helpers_recreate_paired_wheels_without_rewriting_other_contracts(self):
        for vehicle_id, apply, count, width in [
            ('us_m4a3_76w_hvss', apply_hvss_running_gear, 6, .42),
            ('us_m901_itv', apply_m113_running_gear, 5, .30),
        ]:
            with self.subTest(vehicle_id=vehicle_id):
                self.assertIsNotNone(apply, 'the generator needs a reusable bounded helper')
                visual = json.loads((ROOT / 'data/vehicles' / vehicle_id / 'visual.json').read_text(encoding='utf8'))
                source = copy.deepcopy(visual)
                source['id'] = vehicle_id
                source['untouched_contract'] = {'gun': [1, 2, 3]}
                by_z = {w['z']: dict(w, w=width, x=0) for w in source['running_gear']['wheels']}
                source['running_gear']['wheels'] = list(by_z.values())
                before = copy.deepcopy(source)
                result = apply(source)
                self.assertIs(result, source, 'the source builder owns its returned spec')
                self.assertEqual(len(result['running_gear']['wheels']), count * 2)
                self.assertEqual(result['untouched_contract'], before['untouched_contract'])
                for key in ['track_x', 'track_width', 'track_thickness', 'sprocket', 'idler', 'rollers']:
                    self.assertEqual(result['running_gear'][key], before['running_gear'][key])
                first = copy.deepcopy(result)
                self.assertEqual(apply(result), first, 'reapplying does not duplicate wheel discs or arms')
                self.assertEqual(result['running_gear'], visual['running_gear'], 'stored vehicle uses the exact generator geometry')
                self.assertEqual(result['parts'], visual['parts'])


if __name__ == '__main__':
    unittest.main()
