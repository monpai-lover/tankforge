"""Source receipts for the five measured hollow turret-seat corrections."""
import copy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
from rebuild_procedural_models import BUILDERS
from procedural_refinements import refine_procedural_spec

TARGETS = {'de_tiger_e', 'de_panther_g', 'de_panther_f', 'us_m4a1_76w', 'us_m4a3_76w_hvss'}


class TurretSeatTest(unittest.TestCase):
    def test_source_builders_create_one_hollow_collar_and_reapplying_is_identical(self):
        for vid in TARGETS:
            with self.subTest(vehicle=vid):
                spec = refine_procedural_spec(BUILDERS[vid]())
                collars = [p for p in spec['parts'] if p.get('name') == 'turret_seat_collar']
                self.assertEqual(len(collars), 1)
                collar = collars[0]
                self.assertEqual(collar['type'], 'loft')
                self.assertEqual(collar['caps'], [False, False])
                self.assertEqual(collar['rings'][0], collar['rings'][-1])
                self.assertEqual(refine_procedural_spec(copy.deepcopy(spec)), spec)

    def test_other_source_builders_do_not_receive_a_seat_patch(self):
        for vid, builder in BUILDERS.items():
            if vid not in TARGETS:
                self.assertFalse(any(p.get('name') == 'turret_seat_collar' for p in refine_procedural_spec(builder())['parts']), vid)


if __name__ == '__main__':
    unittest.main()
