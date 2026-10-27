#!/usr/bin/env python3
"""Regression checks for actual renderer-matrix audit transforms and side contact."""
import json
import math
import os
import runpy
import tempfile
import unittest
from pathlib import Path
import numpy as np

with tempfile.TemporaryDirectory() as directory:
    Path(directory, 'report.json').write_text(json.dumps({'models': []}))
    previous = os.environ.get('TF_AUDIT_OUT')
    os.environ['TF_AUDIT_OUT'] = directory
    API = runpy.run_path(str(Path(__file__).resolve().parents[1]/'mount-v3/analyze-jets.py'))
    if previous is None:
        del os.environ['TF_AUDIT_OUT']
    else:
        os.environ['TF_AUDIT_OUT'] = previous


class TransformTests(unittest.TestCase):
    def setUp(self):
        self.local = np.array([[[1., 0., 0.], [0., 2., 0.], [0., 0., 3.]]])
        self.matrix = [0,1,0,0, -1,0,0,0, 0,0,1,0, 3,4,5,1]
        self.rotation = [0, 0, math.sqrt(.5), math.sqrt(.5)]
        self.expected = np.array([[[3.,5.,5.], [1.,4.,5.], [3.,4.,8.]]])

    def test_actual_renderer_matrix_transforms_source_triangle(self):
        actual = API['store_triangles'](self.local, {'nodeLocal': self.matrix, 'p': [999,999,999]})
        np.testing.assert_allclose(actual, self.expected, atol=1e-12)

    def test_rotated_socket_quaternion_is_correct_legacy_report_fallback(self):
        actual = API['store_triangles'](self.local, {'storeRotation': self.rotation, 'p': [3,4,5]})
        np.testing.assert_allclose(actual, self.expected, atol=1e-12)

    def test_renderer_matrix_overrides_inconsistent_metadata(self):
        actual = API['store_triangles'](self.local, {'nodeLocal': self.matrix, 'storeRotation': [0,0,0,1], 'p': [9,9,9]})
        np.testing.assert_allclose(actual, self.expected, atol=1e-12)

    def test_bad_or_non_affine_matrices_rejected(self):
        for matrix in ([0]*15, [float('nan')]+self.matrix[1:], self.matrix[:-1]+[0]):
            with self.assertRaises(ValueError):
                API['store_triangles'](self.local, {'nodeLocal': matrix})

    def test_side_mount_contact_exception_rotates_without_widening(self):
        frame = API['contact_basis']({'nodeLocal': self.matrix})
        # Both triangles intersect at the narrow side-facing attachment face.
        store = np.array([[[.02,.08,-.1], [.02,.08,.1], [.025,.085,.1]]])
        rail = np.array([[[-1.,-1.,0.], [1.,-1.,0.], [0.,1.,0.]]])
        self.assertIsNotNone(API['hit'](store, rail, [0,0,0]))
        self.assertIsNone(API['hit'](store, rail, [0,0,0], frame))
        # Moving beyond the original .035m face-normal tolerance must flag it.
        store[:,:,0] += .04
        self.assertIsNotNone(API['hit'](store, rail, [0,0,0], frame))

    def test_contact_frame_does_not_expand_for_scaled_node(self):
        matrix = self.matrix.copy()
        matrix[0:3] = [v*2 for v in matrix[0:3]]
        frame = API['contact_basis']({'nodeLocal': matrix})
        np.testing.assert_allclose(frame.T@frame, np.eye(3), atol=1e-12)


if __name__ == '__main__':
    unittest.main(verbosity=2)
