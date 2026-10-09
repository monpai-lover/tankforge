"""Keep custom turret rebuilds independent of the donor's folding casemate."""
import copy
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools'))
import build_hetzer_sdkfz1401 as builder


class CustomTurretRecipe(unittest.TestCase):
    def test_custom_turret_does_not_inherit_donor_fold_arcs_or_armor(self):
        captured = []
        def capture(spec):
            captured.append(copy.deepcopy(spec))
            return []
        with patch.object(builder.gen, 'write_vehicle', side_effect=capture), \
             patch.object(builder, 'source_glacis', return_value={'id': 'hull_upper_front'}), \
             patch.object(builder.subprocess, 'run'):
            builder.main()
        spec, = captured
        for key in ('depression_by_bearing_deg', 'folded_depression_by_bearing_deg',
                    'fold_depression_stages', 'fold_yaw_limit_stages', 'folded_yaw_limit_deg'):
            self.assertFalse(key in spec, f'custom turret must not inherit {key}')
        self.assertFalse(any(p.get('hinge') for p in spec['plates']))
        original = next(p for p in builder.gen.hetzer('flak')['plates'] if p['id'] == 'hull_side_r')
        actual = next(p for p in spec['plates'] if p['id'] == 'hull_side_r')
        self.assertEqual(actual, original, 'original chassis armor remains independent of donor recipe')


if __name__ == '__main__':
    unittest.main()
