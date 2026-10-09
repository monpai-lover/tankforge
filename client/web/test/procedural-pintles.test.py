"""Source regeneration keeps bounded roof-gun repairs and attachment bases."""
import copy
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
try:
    from procedural_pintles import apply_procedural_pintles
except ModuleNotFoundError:
    apply_procedural_pintles = None

BUILDERS = {'su_is2': 'is2', 'su_t54': 't54', 'us_m8': 'm8', 'us_m10': 'm10',
            'us_m4a2': 'm4a2', 'us_m4a3_75w': 'm4a3_75w',
            'us_m4a1_76w': 'm4a1_76w', 'us_m4a3_76w_hvss': 'sherman', 'de_hetzer': 'hetzer_jagd'}


class PintleTest(unittest.TestCase):
    def test_source_repair_preserves_base_and_unrelated_contracts_and_is_idempotent(self):
        self.assertIsNotNone(apply_procedural_pintles, 'bounded regeneration helper must exist')
        import gen_vehicles
        for vehicle_id, builder in BUILDERS.items():
            with self.subTest(vehicle_id=vehicle_id):
                before = getattr(gen_vehicles, builder)()
                after = apply_procedural_pintles(copy.deepcopy(before))
                old = next(m for m in before['secondary'] if m['mount'] == 'pintle')
                new = next(m for m in after['secondary'] if m['mount'] == 'pintle')
                self.assertEqual(old['position_m'][0::2], new['position_m'][0::2])
                self.assertAlmostEqual(old['position_m'][1] - old.get('post_m', .34),
                                       new['position_m'][1] - new['post_m'], places=6)
                for key in before.keys() - {'secondary', 'mg_variants'}:
                    self.assertEqual(before[key], after[key])
                expected = copy.deepcopy(after)
                self.assertEqual(apply_procedural_pintles(after), expected)
                stored = json.loads((ROOT / 'data/vehicles' / vehicle_id / 'weapons.json').read_text(encoding='utf8'))
                from procedural_refinements import refine_procedural_spec
                integrated = refine_procedural_spec(copy.deepcopy(after))
                self.assertEqual(integrated['secondary'], stored['secondary'])

    def test_unknown_and_imported_vehicle_specs_are_unchanged(self):
        self.assertIsNotNone(apply_procedural_pintles)
        for vehicle_id in ('proto_a', 'de_hetzer_mk103', 'su_t10m', 'de_pz3_j'):
            source = {'id': vehicle_id, 'secondary': [{'id': 'roof_mg34', 'mount': 'pintle', 'position_m': [0, 1, 0]}]}
            before = copy.deepcopy(source)
            self.assertIs(apply_procedural_pintles(source), source)
            self.assertEqual(source, before)


if __name__ == '__main__':
    unittest.main()
