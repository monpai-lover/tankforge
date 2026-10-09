"""Named wheel ownership and measured rest-pose import regressions."""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

import numpy as np

TOOLS = pathlib.Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('glb_vehicle', TOOLS / 'glb-vehicle.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


class NamedArticulation(unittest.TestCase):
    def collect(self, pieces, **cfg):
        groups, counts = {}, {}
        with patch.object(imp, 'scene_meshes', return_value=pieces):
            imp.collect(0, {}, None, dict(mirror_x=False, **cfg), groups, counts,
                        [('road_wheel:1:0', np.array([1.3, .58, 2.04]), .58)], 1.3, set())
        return groups, counts

    def piece(self, name, points):
        p = np.asarray(points, float)
        return (0, {'attributes': {}}, p, np.tile([0., 1., 0.], (len(p), 1)),
                None, np.array([[0, 1, 2]]), ('Vehicle', name))

    def test_named_wheel_keeps_outer_tread_and_fixed_axle_on_correct_mounts(self):
        tread = self.piece('Wheel_Right_1', [[1.3, 1.15, 2.04], [1.4, 1.15, 2.04], [1.3, 1.12, 2.08]])
        axle = self.piece('Chassis', [[1.2, .57, 2.03], [1.3, .59, 2.03], [1.2, .58, 2.05]])
        groups, counts = self.collect([tread, axle], wheel_nodes={'road_wheel:1:0': ['Wheel_Right_1']})
        self.assertEqual(counts.get('road_wheel:1:0'), 1, 'outer tread belongs to its named wheel')
        self.assertEqual(counts.get('hull'), 1, 'fixed axle does not rotate just because its centre is near the wheel')
        for key, group in groups.items():
            y = np.concatenate(group['P'])[:, 1]
            if key[0] == 'road_wheel:1:0':
                self.assertGreater(y.min(), 1.1)
            if key[0] == 'hull':
                self.assertLess(y.max(), .6)

    def test_hatch_closes_about_its_measured_hinge_without_moving_other_geometry(self):
        hatch = self.piece('Hatch_Left', [[-.67, 2.48, .32], [-.8, 2.48, .32], [-.67, 2.4, .42]])
        fixed = self.piece('Hull', [[0, 1.9, 0], [.1, 1.9, 0], [0, 1.9, .1]])
        groups, _ = self.collect([hatch, fixed], node_rest_poses=[
            {'nodes': ['Hatch_Left'], 'pivot': [-.67, 1.895, .32], 'rotation_x_deg': 80}])
        for key, group in groups.items():
            points = np.concatenate(group['P'])
            if key[-1] == 'Hatch_Left':
                self.assertLess(points[:, 1].max(), 2.01)
            else:
                np.testing.assert_allclose(points, fixed[2])


if __name__ == '__main__':
    unittest.main()
