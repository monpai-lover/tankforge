"""Importer connectivity contracts, including vertices split at UV seams."""
import importlib.util
import pathlib
import sys
import unittest

import numpy as np

TOOLS = pathlib.Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('glb_vehicle', TOOLS / 'glb-vehicle.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


class ConnectedPieces(unittest.TestCase):
    def test_uv_split_corners_weld_but_distant_piece_stays_separate(self):
        p = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0],
                      [1, 0, 0], [1, 1, 0], [0, 1, 0],
                      [5, 0, 0], [6, 0, 0], [5, 1, 0]], float)
        before = p.copy()
        labels = imp.components(p, np.array([[0, 1, 2], [3, 4, 5], [6, 7, 8]]))
        self.assertEqual(labels[0], labels[1])
        self.assertNotEqual(labels[0], labels[2])
        np.testing.assert_array_equal(p, before)


if __name__ == '__main__':
    unittest.main()
