"""Read-only source/output consistency for every supported procedural builder."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
import gen_vehicles as gen
from rebuild_procedural_models import BUILDERS
from procedural_refinements import refine_procedural_spec


class RegenerationTest(unittest.TestCase):
    def test_source_recreates_every_published_bundle_without_writing_any_file(self):
        self.assertEqual(len(BUILDERS), 26)  # Prototype A has its separate legacy patcher.
        for vehicle_id, builder in BUILDERS.items():
            with self.subTest(vehicle=vehicle_id):
                records = {}
                def capture(path, value, **kwargs):
                    records[Path(path).name] = copy.deepcopy(value)
                with patch.object(gen, 'dump', capture):
                    self.assertEqual(gen.write_vehicle(builder()), [])
                self.assertEqual(set(records), {'vehicle.json', 'armor.json', 'weapons.json',
                                               'engine.json', 'crew.json', 'modules.json', 'visual.json'})
                for name, value in records.items():
                    stored = json.loads((ROOT / 'data/vehicles' / vehicle_id / name).read_text(encoding='utf8'))
                    self.assertEqual(value, stored, f'{vehicle_id}/{name}: published bundle diverges from source')

    def test_all_combined_repairs_are_idempotent_and_exclude_supplied_models(self):
        for vehicle_id, builder in BUILDERS.items():
            with self.subTest(vehicle=vehicle_id):
                first = refine_procedural_spec(builder())
                self.assertEqual(refine_procedural_spec(copy.deepcopy(first)), first)
        excluded = {'su_t10m', 'su_bmpt34', 'us_m56', 'xp_kda35', 'de_gepard', 'de_aufkl_panther',
                    'de_vk1602', 'de_hetzer_mk103', 'de_hetzer_mk103_camo', 'de_sdkfz140_1',
                    'de_hetzer_sdkfz1401', 'xp_bmp_k64', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet', 'su_att_m46'}
        self.assertTrue(excluded.isdisjoint(BUILDERS))


if __name__ == '__main__':
    unittest.main()
